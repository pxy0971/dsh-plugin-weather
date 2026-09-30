/**
 * Host half of `dsh-plugin-weather`.
 *
 * Responsibilities:
 *
 * - Provide the `weather` Cordis service so other Host plugins (and this
 *   package's own `/client` half, if it ever mounts a bridge) can read forecasts
 *   through one cached entry point.
 * - Register the model-facing `get_weather` tool, so an agent can answer
 *   "do I need an umbrella in Hangzhou tomorrow" without the user opening the
 *   panel.
 *
 * All network work goes through `src/weather-core.js`, which is also the source of
 * truth the browser bundle inlines. See `tools/build-client.mjs`.
 *
 * `@deepseek-ai/dsh-tools` is loaded lazily rather than imported at the top of this
 * module. A static import is resolved during activation, before `apply()` runs, so a
 * composition in which that package does not resolve would fail this whole plugin —
 * and with it the browser bundle, which the Host only advertises for a row whose
 * fiber reached ACTIVE. The tool is a nice-to-have; the panel is the point, so the
 * import is deferred and its failure degrades to "no tool" instead of "no plugin".
 *
 * @module dsh-plugin-weather
 */

import {
  WEATHER_UNITS,
  compassPoint,
  fetchForecast,
  fetchSummaries,
  searchLocations,
  upcomingHours,
  weatherCodeInfo,
} from './weather-core-binding.js'

/** Cordis service key. Also the name the panel's diagnostics use. */
export const name = 'weather'

/**
 * Required Host services.
 *
 * `tools` is injected so the definition registers as soon as the registry is
 * available, and unregisters with this plugin's fiber. A missing `tools` service
 * disables only the tool, never the service, because `tools` is optional at the
 * type level (`ctx.get('tools')`).
 */
export const inject = ['tools']

/** Default time-to-live for a cached forecast, in seconds. */
const DEFAULT_CACHE_TTL_SECONDS = 600

/** Default ceiling on cached forecast entries, so a long session cannot grow unbounded. */
const DEFAULT_CACHE_LIMIT = 256

/** Longest location string accepted from the model before it is rejected as input. */
const MAX_LOCATION_CHARS = 120

/**
 * Read one config value with a type guard, falling back when absent or malformed.
 *
 * The Host passes only the `config` sub-object of this plugin's Loader entry, and a
 * missing or hand-edited value must never stop the plugin from loading.
 *
 * @param config - the raw config object, possibly undefined.
 * @param key - property name to read.
 * @param fallback - value used when the property is absent or the wrong type.
 * @returns the configured value or the fallback.
 */
function readConfig(config, key, fallback) {
  const value = config?.[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== typeof fallback) return fallback
  return value
}

/**
 * Resolve this entry's `config` sub-object without making it a hard dependency.
 *
 * Cordis exposes a plugin's own configuration through the context proxy, but
 * reading an unregistered key throws (`cannot get property "config" without
 * inject`). Declaring `config` in `inject` would make the *service* required and
 * could hold the fiber inactive, so the read is instead attempted defensively: an
 * absent or refusing config face degrades to `{}`, and {@link readConfig} then
 * supplies the defaults. That keeps a hand-edited profile from stopping the plugin
 * from activating.
 *
 * @param ctx - the Host context for this plugin's fiber.
 * @returns the config object, or `{}` when unavailable.
 */
function resolvePluginConfig(ctx) {
  for (const read of [() => ctx.config, () => ctx.get('config')]) {
    try {
      const value = read()
      if (value !== null && typeof value === 'object') return value
    } catch {
      /* Fall through to the next source, then to the defaults. */
    }
  }
  return {}
}

/**
 * Bounded TTL cache for forecast bundles.
 *
 * Forecast responses are the expensive part of this plugin (one HTTP round trip
 * each, and the panel refetches whenever the city or units change). Two keys must
 * not collide, so the cache key is the full parameter tuple rather than the city
 * id alone.
 */
export class ForecastCache {
  /** @param options - `ttlSeconds` and `limit`, both already validated. */
  constructor({ ttlSeconds = DEFAULT_CACHE_TTL_SECONDS, limit = DEFAULT_CACHE_LIMIT } = {}) {
    this.ttlMs = Math.max(0, ttlSeconds) * 1000
    this.limit = Math.max(1, limit)
    /** Insertion-ordered map, used as an LRU: the oldest key is the first entry. */
    this.entries = new Map()
    this.hits = 0
    this.misses = 0
  }

  /**
   * Build the cache key for one forecast request.
   * @param location - the location object.
   * @param units - `metric` or `imperial`.
   * @param days - daily horizon.
   * @returns a stable string key.
   */
  static key(location, units, days) {
    const round = value => (Number.isFinite(Number(value)) ? Number(value).toFixed(4) : 'x')
    return `${round(location?.latitude)},${round(location?.longitude)}|${units}|${days}`
  }

  /**
   * Read a live entry, refreshing its LRU position.
   * @param key - cache key from {@link ForecastCache.key}.
   * @param now - current epoch milliseconds.
   * @returns the cached bundle, or `undefined` when absent or expired.
   */
  get(key, now = Date.now()) {
    const row = this.entries.get(key)
    if (row === undefined) {
      this.misses += 1
      return undefined
    }
    if (row.expiresAt <= now) {
      this.entries.delete(key)
      this.misses += 1
      return undefined
    }
    this.entries.delete(key)
    this.entries.set(key, row)
    this.hits += 1
    return row.value
  }

  /**
   * Store a bundle, evicting the least recently used entry past the limit.
   * @param key - cache key from {@link ForecastCache.key}.
   * @param value - the normalized forecast bundle.
   * @param now - current epoch milliseconds.
   */
  set(key, value, now = Date.now()) {
    if (this.ttlMs === 0) return
    this.entries.delete(key)
    this.entries.set(key, { value, expiresAt: now + this.ttlMs })
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next()
      if (oldest.done === true) break
      this.entries.delete(oldest.value)
    }
  }

  /** Drop every entry. */
  clear() {
    this.entries.clear()
  }

  /**
   * Cache counters for diagnostics.
   * @returns `{ size, hits, misses, ttlSeconds }`.
   */
  stats() {
    return { size: this.entries.size, hits: this.hits, misses: this.misses, ttlSeconds: this.ttlMs / 1000 }
  }
}

/**
 * Round a number for model-facing text, keeping one decimal only when it carries information.
 * @param value - the number, possibly undefined.
 * @returns a display string, or `undefined` when the value is missing.
 */
function round(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Number.isInteger(value) ? value : Math.round(value * 10) / 10
}

/**
 * Compact one normalized forecast bundle for the model.
 *
 * The panel renders the full bundle; the model gets a trimmed projection with
 * `undefined` fields dropped, because a tool result is paid for on every
 * subsequent request until compaction. Undefined keys are removed rather than
 * serialized as `null`, so an absent provider field never reads as a real zero.
 *
 * @param bundle - output of `fetchForecast`.
 * @param options - `dailyDays` and `hourlyHours` limits for the projection.
 * @returns a JSON-safe summary object.
 */
function summarizeForModel(bundle, { dailyDays = 5, hourlyHours = 8 } = {}) {
  const compact = object =>
    Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined))

  const current = compact({
    time: bundle.current.time,
    temperature: round(bundle.current.temperature),
    apparentTemperature: round(bundle.current.apparentTemperature),
    humidity: round(bundle.current.humidity),
    precipitation: round(bundle.current.precipitation),
    condition: bundle.current.condition.en,
    cloudCover: round(bundle.current.cloudCover),
    pressure: round(bundle.current.pressure),
    windSpeed: round(bundle.current.windSpeed),
    windDirection: compassPoint(bundle.current.windDirection),
    windGusts: round(bundle.current.windGusts),
    isDay: bundle.current.isDay,
  })

  const hourly = upcomingHours(bundle, hourlyHours).map(row =>
    compact({
      time: row.time,
      temperature: round(row.temperature),
      precipitationProbability: round(row.precipitationProbability),
      condition: weatherCodeInfo(row.weatherCode).en,
    }),
  )

  const daily = bundle.daily.slice(0, dailyDays).map(row =>
    compact({
      date: row.date,
      condition: weatherCodeInfo(row.weatherCode).en,
      temperatureMax: round(row.temperatureMax),
      temperatureMin: round(row.temperatureMin),
      precipitationSum: round(row.precipitationSum),
      precipitationProbabilityMax: round(row.precipitationProbabilityMax),
      uvIndexMax: round(row.uvIndexMax),
      sunrise: typeof row.sunrise === 'string' ? row.sunrise.slice(11, 16) : row.sunrise,
      sunset: typeof row.sunset === 'string' ? row.sunset.slice(11, 16) : row.sunset,
      windSpeedMax: round(row.windSpeedMax),
    }),
  )

  return {
    units: bundle.units,
    temperatureUnit: bundle.unitLabels.label,
    timezone: bundle.timezone,
    current,
    hourly,
    daily,
  }
}

/**
 * The Host `weather` service: one cached entry point over the shared core.
 *
 * Every method is safe to call concurrently; the cache is keyed by the full
 * request tuple, so two callers asking for different units never collide.
 */
export class WeatherService {
  /**
   * @param options - `config` from the Loader entry, plus an optional cache for tests.
   */
  constructor({ config, cache } = {}) {
    this.config = config ?? {}
    const ttlSeconds = readConfig(this.config, 'cacheTtlSeconds', DEFAULT_CACHE_TTL_SECONDS)
    const limit = readConfig(this.config, 'cacheLimit', DEFAULT_CACHE_LIMIT)
    this.cache = cache ?? new ForecastCache({ ttlSeconds, limit })
    this.defaultUnits = readConfig(this.config, 'units', 'metric')
    this.defaultLanguage = readConfig(this.config, 'language', 'zh')
  }

  /**
   * Search for candidate locations.
   * @param query - user text; names, postal codes, and coordinates all work.
   * @param options - `count`, `language`, and an abort `signal`.
   * @returns normalized candidate locations.
   */
  async search(query, options = {}) {
    return searchLocations(query, {
      count: options.count,
      language: options.language ?? this.defaultLanguage,
      signal: options.signal,
    })
  }

  /**
   * Read the normalized forecast bundle for one location, served from cache when fresh.
   * @param location - `{ latitude, longitude }`.
   * @param options - `units`, `days`, `signal`, and `refresh` to bypass the cache.
   * @returns the normalized forecast bundle.
   */
  async forecast(location, options = {}) {
    const units = options.units === 'imperial' ? 'imperial' : options.units === 'metric' ? 'metric' : this.defaultUnits
    const days = Number.isInteger(options.days) ? options.days : 7
    const key = ForecastCache.key(location, units, days)
    if (options.refresh !== true) {
      const cached = this.cache.get(key)
      if (cached !== undefined) return cached
    }
    const bundle = await fetchForecast(location, { units, days, signal: options.signal })
    this.cache.set(key, bundle)
    return bundle
  }

  /**
   * One compact summary per saved city, for the panel's favourites list.
   * @param locations - saved locations.
   * @param options - `units` and `signal`.
   * @returns one summary per input location, in input order.
   */
  async summaries(locations, options = {}) {
    return fetchSummaries(locations, {
      units: options.units === 'imperial' ? 'imperial' : 'metric',
      signal: options.signal,
    })
  }

  /**
   * Cache and configuration counters.
   * @returns `{ cache, units, language }`.
   */
  diagnostics() {
    return { cache: this.cache.stats(), units: this.defaultUnits, language: this.defaultLanguage }
  }
}

/**
 * Test hook: when set to a string, {@link loadDefineTool} rejects with it instead of
 * importing. Exists only so the bench can prove that a missing tool package degrades
 * to "no tool" rather than "no plugin" — the failure mode that keeps the browser
 * bundle from ever being advertised.
 */
export const toolImportFault = { message: undefined }

/**
 * Load `defineTool` from `@deepseek-ai/dsh-tools` on first use.
 *
 * Deferred so this plugin never fails to activate over the tool registry: a
 * composition in which that package does not resolve must still get the panel. The
 * specifier is held in a variable so the bundler's static analysis does not hoist it
 * back into an eager import.
 *
 * @returns the `defineTool` export.
 * @throws when the package is absent, which the caller treats as "no tool".
 */
async function loadDefineTool() {
  if (typeof toolImportFault.message === 'string') throw new Error(toolImportFault.message)
  const specifier = '@deepseek-ai/dsh-tools'
  const module = await import(specifier)
  if (typeof module.defineTool !== 'function') {
    throw new Error(`${specifier} does not export defineTool`)
  }
  return module.defineTool
}

/**
 * Build the model-facing tool definition bound to one service instance.
 *
 * A factory rather than a module-level constant because a Cordis tool body
 * receives only `(args, exec)`: `exec` carries the caller's `signal`, arguments,
 * and correlation ids, but not a context to resolve sibling services from. The
 * body therefore closes over the service directly.
 *
 * `location` is deliberately a free-text string rather than a coordinate pair:
 * the model usually has a place name, and resolving it through the geocoder here
 * keeps the tool surface small. `latitude`/`longitude` stay available for callers
 * that already know the coordinate.
 *
 * @param defineTool - the registry's definition builder.
 * @param service - the `WeatherService` this definition dispatches to.
 * @returns a registry-ready tool definition.
 */
export function createGetWeatherTool(defineTool, service) {
  return defineTool({
    name: 'get_weather',
    description:
      'Look up current weather and forecast for a place. Provide either `location` (a city name such as "Hangzhou" or "杭州", or a postal code) or both `latitude` and `longitude`. Returns current conditions plus an hourly and daily forecast. Use this instead of guessing at weather.',
    parameters: {
      location: { type: 'string', description: 'Place name or postal code, e.g. "Hangzhou", "杭州", "310000".' },
      latitude: { type: 'number', description: 'Latitude in decimal degrees. Use with longitude and instead of location.' },
      longitude: { type: 'number', description: 'Longitude in decimal degrees. Use with latitude and instead of location.' },
      units: {
        type: 'string',
        enum: ['metric', 'imperial'],
        description: 'metric = °C and km/h (default), imperial = °F and mph.',
      },
      days: { type: 'integer', description: 'How many forecast days to return, 1-16. Defaults to 5.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [
        {
          type: 'text',
          text:
            `Weather for ${value?.location?.label ?? value?.location?.name ?? 'the requested place'}:\n` +
            `${JSON.stringify(value?.forecast ?? value, null, 2)}`,
        },
      ],
    },
    /**
     * Resolve the target, then project the forecast down to a model-sized shape.
     * @param args - validated tool arguments.
     * @param exec - execution context carrying the caller's abort signal.
     * @returns the summary object declared by `output.schema`.
     */
    async execute(args, exec) {
      const hasCoordinates = Number.isFinite(args.latitude) && Number.isFinite(args.longitude)
      let target
      if (hasCoordinates) {
        const label = `${round(args.latitude)}, ${round(args.longitude)}`
        target = { id: label, name: label, label, latitude: args.latitude, longitude: args.longitude }
      } else {
        const query = typeof args.location === 'string' ? args.location.trim() : ''
        if (query === '') throw new Error('get_weather: provide either `location` or both `latitude` and `longitude`')
        if (query.length > MAX_LOCATION_CHARS) {
          throw new Error(`get_weather: location must be at most ${MAX_LOCATION_CHARS} characters`)
        }
        const candidates = await service.search(query, { count: 1, signal: exec.signal })
        if (candidates.length === 0) throw new Error(`get_weather: no location matched ${JSON.stringify(query)}`)
        target = candidates[0]
      }

      const days = Number.isInteger(args.days) ? Math.min(Math.max(args.days, 1), 16) : 5
      const bundle = await service.forecast(target, { units: args.units, days, signal: exec.signal })
      return {
        location: { id: target.id, name: target.name, label: target.label, timezone: bundle.timezone },
        place: { latitude: bundle.latitude, longitude: bundle.longitude, elevation: bundle.elevation },
        forecast: summarizeForModel(bundle, { dailyDays: days, hourlyHours: 8 }),
      }
    },
  })
}

/**
 * Cordis plugin body: publish the service, register the tool, own both lifetimes.
 *
 * The service is published unconditionally and first. Everything after it is
 * best-effort, because the panel — the reason this plugin exists — only needs the
 * Host row to reach ACTIVE, and a browser bundle is advertised for an active row
 * whether or not the model tool was registered.
 *
 * @param ctx - the Host context for this plugin's fiber.
 */
export function apply(ctx) {
  const service = new WeatherService({ config: resolvePluginConfig(ctx) })
  ctx.provide(name, service)
  ctx.effect(() => () => service.cache.clear(), 'weather: cache cleanup')

  // The client half reads the service through Typert reflection when a bridge
  // mounts. Until then this is inert metadata, so a composition without the
  // gateway still loads.
  Object.defineProperty(service, 'typertRemote', {
    value: Object.freeze({ service, serviceKey: name, namespace: name }),
    enumerable: false,
  })

  // `tools` is optional and so is its package: a composition without the registry,
  // or one where `@deepseek-ai/dsh-tools` does not resolve from this package, still
  // gets a working panel. The failure is recorded rather than thrown, because
  // throwing here would dispose the row's fiber and take the browser bundle down
  // with it. The promise is returned from the effect so Cordis owns its lifetime and
  // disposes the registration, exactly as an async effect body is meant to work.
  const tools = ctx.get('tools')
  if (tools === undefined || tools === null) return

  return ctx.effect(
    () =>
      loadDefineTool()
        .then(defineTool => tools.register(createGetWeatherTool(defineTool, service)))
        .catch(cause => {
          service.toolError = cause instanceof Error ? cause.message : String(cause)
          return undefined
        }),
    'weather: get_weather tool',
  )
}

export { WEATHER_UNITS, summarizeForModel }
export default { name, inject, apply }
