/**
 * Offline test bench for the Host half of `dsh-plugin-weather`.
 *
 * `tools/test.mjs` covers the shared domain core and the browser bundle. This file
 * covers the parts that only exist on the Host:
 *
 * 1. **Config resolution** — a Cordis context whose `config` face refuses (the exact
 *    failure a hand-edited profile produced) must still yield a working service with
 *    the documented defaults, and a valid config object must be honoured.
 * 2. **The model tool** — the definition registered as `get_weather`, including its
 *    argument validation, its place-name resolution, its error paths, and the
 *    projection it hands back to the model.
 * 3. **The cache** — the TTL and LRU behaviour of {@link ForecastCache}.
 *
 * The `@deepseek-ai/dsh-tools` import is redirected to a local stub by
 * `tools/test/loader-hooks.mjs`, and `globalThis.fetch` is replaced per test so no
 * network call is made.
 *
 * Run with `node tools/test-host.mjs`. Exits non-zero when any case fails.
 *
 * @module dsh-plugin-weather/tests-host
 */

import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

// Must be registered before the Host half is imported.
register(pathToFileURL(join(here, 'test', 'loader-hooks.mjs')).href)

const host = await import(pathToFileURL(join(root, 'lib', 'index.js')).href)

/**
 * The same `defineTool` the Host half resolves at runtime.
 *
 * The Host half imports this package lazily (so a composition without it still gets
 * the panel), which means the bench has to supply it explicitly rather than relying
 * on the module-level import. Going through the specifier the hook rewrites keeps the
 * bench honest: if the hook stops covering the import, this line fails.
 */
const { defineTool } = await import('@deepseek-ai/dsh-tools')

/** Collected results, printed as one report at the end. */
const results = []

/**
 * Register and run one test case.
 * @param name - human-readable case name.
 * @param body - the case body; a throw fails the case.
 */
async function test(name, body) {
  try {
    await body()
    results.push({ name, ok: true })
  } catch (cause) {
    results.push({ name, ok: false, message: cause instanceof Error ? cause.message : String(cause) })
  }
}

/**
 * Assert a condition.
 * @param condition - value that must be truthy.
 * @param message - failure explanation.
 */
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/**
 * Assert deep equality for JSON-shaped values.
 * @param actual - produced value.
 * @param expected - required value.
 * @param message - failure explanation.
 */
function assertEqual(actual, expected, message) {
  const left = JSON.stringify(actual)
  const right = JSON.stringify(expected)
  if (left !== right) throw new Error(`${message}\n  actual:   ${left}\n  expected: ${right}`)
}

/* --------------------------------------------------------------- test doubles */

const GEOCODE_PAYLOAD = {
  results: [
    {
      id: 1808926,
      name: '杭州',
      latitude: 30.29365,
      longitude: 120.16142,
      timezone: 'Asia/Shanghai',
      country: '中国',
      country_code: 'CN',
      admin1: '浙江',
      admin2: '杭州市',
      elevation: 12,
      population: 9236032,
    },
  ],
}

/**
 * Build a minimal Open-Meteo forecast payload.
 * @param options - `days` to size the daily arrays, `latitude`/`longitude` to label
 *   the block, as the multi-location response does.
 * @returns the payload body.
 */
function forecastPayload(options = {}) {
  const days = Number.isInteger(options.days) ? options.days : 3
  const hours = Array.from({ length: 24 }, (_, index) => `2026-09-30T${String(index).padStart(2, '0')}:00`)
  const dates = Array.from({ length: days }, (_, index) => `2026-09-${String(30 + index).padStart(2, '0')}`)
  return {
    latitude: options.latitude ?? 30.29365,
    longitude: options.longitude ?? 120.16142,
    timezone: 'Asia/Shanghai',
    timezone_abbreviation: 'GMT+8',
    utc_offset_seconds: 28800,
    elevation: 12,
    current: {
      time: '2026-09-30T14:00',
      temperature_2m: 29,
      relative_humidity_2m: 71,
      apparent_temperature: 33.1,
      is_day: 1,
      precipitation: 0.2,
      weather_code: 53,
      cloud_cover: 72,
      pressure_msl: 1011.5,
      wind_speed_10m: 9.8,
      wind_direction_10m: 5,
      wind_gusts_10m: 24.8,
    },
    hourly: {
      time: hours,
      temperature_2m: hours.map(() => 25),
      apparent_temperature: hours.map(() => 26),
      precipitation_probability: hours.map(() => 10),
      precipitation: hours.map(() => 0),
      weather_code: hours.map(() => 3),
      wind_speed_10m: hours.map(() => 8),
      relative_humidity_2m: hours.map(() => 60),
      uv_index: hours.map(() => 2),
      is_day: hours.map(() => 1),
    },
    daily: {
      time: dates,
      weather_code: dates.map(() => 61),
      temperature_2m_max: dates.map(() => 26),
      temperature_2m_min: dates.map(() => 17),
      apparent_temperature_max: dates.map(() => 30),
      apparent_temperature_min: dates.map(() => 18),
      sunrise: dates.map(date => `${date}T05:52`),
      sunset: dates.map(date => `${date}T17:46`),
      daylight_duration: dates.map(() => 42880.86),
      uv_index_max: dates.map(() => 2),
      precipitation_sum: dates.map(() => 3),
      precipitation_probability_max: dates.map(() => 20),
      wind_speed_10m_max: dates.map(() => 14.6),
    },
  }
}

/**
 * Count how many locations a forecast request asked for.
 *
 * A comma-separated coordinate list is how the multi-location request is expressed,
 * so the real provider answers with one array element per entry; the stub has to
 * mirror that or the service's length check would reject a legitimate call.
 *
 * @param text - the request URL.
 * @returns the number of requested locations, at least one.
 */
function requestedLocations(text) {
  const match = /[?&]latitude=([^&]*)/.exec(text)
  if (match === null) return 1
  const list = decodeURIComponent(match[1]).split(',').filter(part => part !== '')
  return Math.max(1, list.length)
}

/**
 * Read a numeric query parameter out of a request URL.
 * @param text - the request URL.
 * @param name - the parameter name.
 * @returns the parsed number, or `undefined`.
 */
function queryNumber(text, name) {
  const match = new RegExp(`[?&]${name}=([^&]*)`).exec(text)
  if (match === null) return undefined
  const value = Number(decodeURIComponent(match[1]))
  return Number.isFinite(value) ? value : undefined
}

/** Requests observed by the current fetch stub. */
let requests = []

/**
 * Install a fetch stub that answers geocoding and forecast calls from fixtures.
 * @param options - `failGeocode`, `failForecast`, or `failStatus` to force errors.
 * @returns a restore function.
 */
function stubFetch(options = {}) {
  const original = globalThis.fetch
  requests = []
  globalThis.fetch = async url => {
    const text = String(url)
    requests.push(text)
    if (text.includes('geocoding-api')) {
      if (options.failGeocode === true) throw new Error('network down')
      if (options.emptyGeocode === true) return new Response(JSON.stringify({}), { status: 200 })
      return new Response(JSON.stringify(GEOCODE_PAYLOAD), { status: 200 })
    }
    if (options.failForecast === true) {
      return new Response('nope', { status: options.failStatus ?? 503 })
    }
    const count = requestedLocations(text)
    const days = queryNumber(text, 'forecast_days') ?? 3
    const body = count === 1 ? forecastPayload({ days }) : Array.from({ length: count }, () => forecastPayload({ days }))
    return new Response(JSON.stringify(body), { status: 200 })
  }
  return () => {
    globalThis.fetch = original
  }
}

/**
 * Build a Cordis-like context for the plugin body.
 * @param options - `config` to expose, `refuseConfig` to make the read throw, and a
 *   `tools` registry to receive registrations.
 * @returns `{ ctx, provided, registered, disposed, effects }`.
 */
function makeContext(options = {}) {
  const provided = []
  const registered = []
  const registeredEffects = []
  const disposed = []
  /** Promises returned by effect bodies, awaited by `allSettled()`. */
  const pending = []
  const ctx = {
    /**
     * The plugin's own config face, as Cordis exposes it.
     * @returns the configured object.
     */
    get config() {
      if (options.refuseConfig === true) throw new Error('cannot get property "config" without inject')
      return options.config
    },
    /**
     * Service lookup.
     * @param key - service key.
     * @returns the tools registry when asked for.
     */
    get(key) {
      return key === 'tools' && options.tools !== false ? { register: definition => registered.push(definition) } : undefined
    },
    /**
     * Publish a service.
     * @param key - service key.
     * @param value - service value.
     */
    provide(key, value) {
      provided.push([key, value])
    },
    /**
     * Register an owned effect, running the body immediately.
     *
     * Cordis treats an effect body's return value as either a disposer or a promise of
     * one. The Host half now returns a promise (its tool registration waits on a lazy
     * import), so the promise is retained and `allSettled()` can await it the way the
     * real fiber would.
     *
     * @param body - the effect body.
     * @param label - effect label.
     */
    effect(body, label) {
      const cleanup = body()
      if (cleanup !== null && typeof cleanup === 'object' && typeof cleanup.then === 'function') {
        pending.push(cleanup)
        cleanup.catch(() => {})
      }
      registeredEffects.push({ label, cleanup })
      return () => cleanup?.()
    },
  }
  return {
    ctx,
    provided,
    registered,
    effects: registeredEffects,
    disposed,
    /**
     * Await every promise an effect body returned, so async registrations settle.
     * @returns a promise resolved once nothing is pending.
     */
    async allSettled() {
      // Two rounds: a settled promise may have queued another.
      await Promise.allSettled(pending)
      await Promise.allSettled(pending)
    },
    /**
     * Run every registered effect cleanup, as fiber disposal would.
     */
    dispose() {
      for (const entry of registeredEffects.reverse()) {
        const cleanup = entry.cleanup
        if (cleanup !== null && typeof cleanup === 'object' && typeof cleanup.then === 'function') cleanup.then(fn => fn?.())
        else cleanup?.()
      }
    },
  }
}

/* ------------------------------------------------------------------ config */

await test('host: a refusing config face still yields a working service', async () => {
  const made = makeContext({ refuseConfig: true, tools: true })
  host.apply(made.ctx)
  assertEqual(made.provided.length, 1, 'the weather service is published')
  assertEqual(made.provided[0][0], 'weather', 'the service is published under the documented key')
  const diagnostics = made.provided[0][1].diagnostics()
  assertEqual(diagnostics.units, 'metric', 'metric is the default')
  assertEqual(diagnostics.language, 'zh', 'Chinese place names are the default')
  assertEqual(diagnostics.cache.ttlSeconds, 600, 'the default cache TTL is ten minutes')

  // The service is published synchronously — that is what the browser bundle depends
  // on — while the tool is registered after its lazy import resolves. The service must
  // not wait on the tool package, because a Host row that never reaches ACTIVE would
  // take the panel down with it.
  await made.allSettled()
  assertEqual(made.registered.length, 1, 'the model tool is registered once the import settles')
})

await test('host: a missing tool package still activates the panel service', async () => {
  // The regression this locks down: the Host half used to import `@deepseek-ai/dsh-tools`
  // at module scope, so a composition where that package does not resolve failed the
  // whole plugin during activation — and because a browser bundle is only advertised
  // for a row that reached ACTIVE, the panel disappeared along with the tool.
  const made = makeContext({ tools: true })
  host.toolImportFault.message = 'simulated: @deepseek-ai/dsh-tools is not installed'
  try {
    host.apply(made.ctx)
    assertEqual(made.provided.length, 1, 'the weather service is published anyway')
    await made.allSettled()
    assertEqual(made.registered.length, 0, 'no tool is registered')
    const failure = made.provided[0][1].toolError
    assert(typeof failure === 'string' && failure.includes('not installed'), `the failure is recorded, got ${JSON.stringify(failure)}`)
    assertEqual(made.provided[0][1].diagnostics().units, 'metric', 'the service is fully usable without the tool')
  } finally {
    host.toolImportFault.message = undefined
  }
})

await test('host: a valid config object is honoured and junk falls back', () => {
  const { ctx, provided } = makeContext({
    config: { cacheTtlSeconds: 30, cacheLimit: 2, units: 'imperial', language: 'en' },
  })
  host.apply(ctx)
  const diagnostics = provided[0][1].diagnostics()
  assertEqual(diagnostics.units, 'imperial', 'the configured unit system is used')
  assertEqual(diagnostics.language, 'en', 'the configured language is used')
  assertEqual(diagnostics.cache.ttlSeconds, 30, 'the configured TTL is used')

  const bad = makeContext({ config: { cacheTtlSeconds: 'soon', units: 42 } })
  host.apply(bad.ctx)
  const fallback = bad.provided[0][1].diagnostics()
  assertEqual(fallback.units, 'metric', 'a non-string unit value falls back to metric')
  assertEqual(fallback.cache.ttlSeconds, 600, 'a non-numeric TTL falls back to the default')
})

await test('host: the plugin tolerates a composition without a tools registry', () => {
  const { ctx, provided, registered } = makeContext({ tools: false })
  host.apply(ctx)
  assertEqual(provided.length, 1, 'the service is still published')
  assertEqual(registered.length, 0, 'no tool is registered when the registry is absent')
})

await test('host: the plugin declares its service key and injects tools', () => {
  assertEqual(host.name, 'weather', 'the exported name is the service key')
  assert(Array.isArray(host.inject), 'inject is an array')
  assertEqual(host.inject, ['tools'], 'only the tools registry is injected')
})

/* -------------------------------------------------------------------- cache */

await test('cache: entries expire at the TTL boundary and re-fetch', () => {
  const cache = new host.ForecastCache({ ttlSeconds: 10, limit: 8 })
  const location = { latitude: 30.29365, longitude: 120.16142 }
  const key = host.ForecastCache.key(location, 'metric', 7)
  cache.set(key, { marker: 1 }, 1_000)
  assertEqual(cache.get(key, 10_999)?.marker, 1, 'a fresh entry is served')
  assertEqual(cache.get(key, 11_000), undefined, 'the entry expires exactly at its TTL')
  assertEqual(cache.get(key, 11_001), undefined, 'and stays gone')
  assertEqual(cache.stats().hits, 1, 'one hit was recorded')
  assertEqual(cache.stats().misses, 2, 'two misses were recorded')
})

await test('cache: the least recently used entry is evicted past the limit', () => {
  const cache = new host.ForecastCache({ ttlSeconds: 600, limit: 2 })
  const key = (id, units = 'metric') => host.ForecastCache.key({ latitude: id, longitude: id }, units, 7)
  cache.set(key(1), { id: 1 })
  cache.set(key(2), { id: 2 })
  // Touching entry 1 makes entry 2 the least recently used.
  cache.get(key(1))
  cache.set(key(3), { id: 3 })
  assertEqual(cache.get(key(1))?.id, 1, 'the touched entry survives')
  assertEqual(cache.get(key(2)), undefined, 'the least recently used entry was evicted')
  assertEqual(cache.get(key(3))?.id, 3, 'the newest entry is present')
  assertEqual(cache.stats().size, 2, 'the limit is respected')
})

await test('cache: the key separates units, horizons, and distinct places', () => {
  const location = { latitude: 1, longitude: 2 }
  const keys = [
    host.ForecastCache.key(location, 'metric', 7),
    host.ForecastCache.key(location, 'imperial', 7),
    host.ForecastCache.key(location, 'metric', 3),
    host.ForecastCache.key({ latitude: 5, longitude: 6 }, 'metric', 7),
  ]
  assertEqual(new Set(keys).size, 4, 'each distinct request gets its own key')
  // Coordinates are rounded to four decimals, which is roughly 11 m at the equator:
  // two points that close are the same place for a city-level forecast, so sharing a
  // key is deliberate rather than a collision.
  assertEqual(
    host.ForecastCache.key(location, 'metric', 7),
    host.ForecastCache.key({ latitude: 1.000001, longitude: 2 }, 'metric', 7),
    'sub-11 m differences intentionally share an entry',
  )
})

await test('cache: a TTL of zero disables storage entirely', () => {
  const cache = new host.ForecastCache({ ttlSeconds: 0, limit: 4 })
  const key = host.ForecastCache.key({ latitude: 1, longitude: 2 }, 'metric', 7)
  cache.set(key, { marker: 1 })
  assertEqual(cache.get(key), undefined, 'nothing is cached when the TTL is zero')
})

/* --------------------------------------------------------------- the service */

await test('service: forecast is fetched once and then served from cache', async () => {
  const restore = stubFetch()
  try {
    const service = new host.WeatherService({ config: { cacheTtlSeconds: 600 } })
    const location = { latitude: 30.29365, longitude: 120.16142 }
    const first = await service.forecast(location, { units: 'metric', days: 3 })
    assertEqual(first.current.temperature, 29, 'the payload is normalised')
    const afterFirst = requests.length
    const second = await service.forecast(location, { units: 'metric', days: 3 })
    assertEqual(requests.length, afterFirst, 'the second read made no request')
    assertEqual(second.current.temperature, first.current.temperature, 'the cached bundle is returned')

    await service.forecast(location, { units: 'metric', days: 3, refresh: true })
    assertEqual(requests.length, afterFirst + 1, 'refresh bypasses the cache')

    await service.forecast(location, { units: 'imperial', days: 3 })
    assertEqual(requests.length, afterFirst + 2, 'a different unit system is a different cache key')
  } finally {
    restore()
  }
})

await test('service: a provider failure surfaces as a rejected promise', async () => {
  const restore = stubFetch({ failForecast: true, failStatus: 503 })
  try {
    const service = new host.WeatherService({})
    let message = ''
    try {
      await service.forecast({ latitude: 1, longitude: 2 }, {})
    } catch (cause) {
      message = cause.message
    }
    assert(message.includes('503'), `the HTTP status should reach the caller, got ${JSON.stringify(message)}`)
    assertEqual(service.cache.stats().size, 0, 'a failed request caches nothing')
  } finally {
    restore()
  }
})

await test('service: search normalizes candidates and rejects a blank query', async () => {
  const restore = stubFetch()
  try {
    const service = new host.WeatherService({})
    const rows = await service.search('杭州')
    assertEqual(rows.length, 1, 'one candidate came back')
    assertEqual(rows[0].name, '杭州', 'the place name is preserved')
    assertEqual(rows[0].label, '杭州 · 杭州市 · 浙江 · 中国', 'the label joins the administrative levels')
    assertEqual(await service.search('   '), [], 'a blank query short-circuits without a request')
    assertEqual(requests.length, 1, 'the blank query made no request')
  } finally {
    restore()
  }
})

await test('service: an empty geocoder response yields no candidates', async () => {
  const restore = stubFetch({ emptyGeocode: true })
  try {
    const service = new host.WeatherService({})
    assertEqual(await service.search('nowhere'), [], 'no results is an empty array, not an error')
  } finally {
    restore()
  }
})

await test('service: summaries issue one request for many cities', async () => {
  const restore = stubFetch()
  try {
    const service = new host.WeatherService({})
    const rows = await service.summaries([
      { id: 'a', name: 'A', latitude: 1, longitude: 2 },
      { id: 'b', name: 'B', latitude: 3, longitude: 4 },
    ])
    assertEqual(requests.length, 1, 'both cities share one request')
    assert(requests[0].includes('latitude=1%2C3'), 'the coordinate lists are joined')
    assertEqual(rows.length, 2, 'one summary per requested location')
    assertEqual(rows[0].id, 'a', 'the first saved city keeps its identity')
    assertEqual(rows[1].id, 'b', 'the second saved city keeps its identity')
    assertEqual(rows[0].temperature, 29, 'each summary carries the current temperature')
    assertEqual(rows[0].condition.en, 'Moderate drizzle', 'each summary carries its condition text')
  } finally {
    restore()
  }
})

await test('service: a summary response of the wrong length is rejected', async () => {
  const original = globalThis.fetch
  requests = []
  // One location requested, two rows answered: the positional mapping would silently
  // attribute the wrong weather to the wrong city, so the service must refuse it.
  globalThis.fetch = async url => {
    requests.push(String(url))
    return new Response(JSON.stringify([forecastPayload(), forecastPayload()]), { status: 200 })
  }
  try {
    const service = new host.WeatherService({})
    let message = ''
    try {
      await service.summaries([{ id: 'a', name: 'A', latitude: 1, longitude: 2 }])
    } catch (cause) {
      message = cause.message
    }
    assert(message.includes('2 rows'), `the mismatch should be reported, got ${JSON.stringify(message)}`)
  } finally {
    globalThis.fetch = original
  }
})

/* ------------------------------------------------------------- the model tool */

/**
 * Build the tool definition against a fresh service.
 * @param options - forwarded to the fetch stub.
 * @returns `{ tool, service, restore }`.
 */
function toolFixture(options = {}) {
  const restore = stubFetch(options)
  const service = new host.WeatherService({})
  return { tool: host.createGetWeatherTool(defineTool, service), service, restore }
}

await test('tool: the definition describes itself to the model', () => {
  const { tool, restore } = toolFixture()
  try {
    assertEqual(tool.name, 'get_weather', 'the tool name is stable')
    assert(tool.description.length > 40, 'the description explains when to use it')
    assert(tool.description.includes('location'), 'the description names its location argument')
    assertEqual(Object.keys(tool.parameters).sort(), ['days', 'latitude', 'location', 'longitude', 'units'], 'the parameter set is exact')
    assertEqual(tool.parameters.units.enum, ['metric', 'imperial'], 'the unit parameter is enumerated')
    assertEqual(tool.output.schema, { type: 'json' }, 'the output is declared as a JSON root')
    assertEqual(typeof tool.output.render, 'function', 'the output declares a renderer')
  } finally {
    restore()
  }
})

await test('tool: a place name is resolved and summarized', async () => {
  const { tool, restore } = toolFixture()
  try {
    const value = await tool.execute({ location: '杭州', days: 3 }, { signal: undefined })
    assertEqual(value.location.name, '杭州', 'the resolved place is reported')
    assertEqual(value.location.timezone, 'Asia/Shanghai', 'the resolved timezone is reported')
    assertEqual(value.forecast.current.temperature, 29, 'the current temperature is included')
    assertEqual(value.forecast.current.condition, 'Moderate drizzle', 'the condition is the English text')
    assertEqual(value.forecast.current.windDirection, 'N', 'the wind bearing is converted to a compass point')
    assertEqual(value.forecast.daily.length, 3, 'the requested number of days is returned')
    assertEqual(value.forecast.hourly.length, 8, 'the hourly projection is capped for the model')
    assertEqual(value.forecast.hourly[0].time, '2026-09-30T14:00', 'the hourly window starts at the current hour')
    assertEqual(value.forecast.temperatureUnit, '°C', 'the unit label is carried')
  } finally {
    restore()
  }
})

await test('tool: explicit coordinates skip the geocoder', async () => {
  const { tool, restore } = toolFixture()
  try {
    const value = await tool.execute({ latitude: 30.29365, longitude: 120.16142, days: 1 }, {})
    assertEqual(requests.length, 1, 'only the forecast was requested')
    assert(!requests[0].includes('geocoding'), 'the geocoder was not called')
    assertEqual(value.location.label, '30.3, 120.2', 'the label is built from the rounded coordinates')
    assertEqual(value.forecast.daily.length, 1, 'the day horizon is honoured')
  } finally {
    restore()
  }
})

await test('tool: days is clamped into the provider range', async () => {
  const restore = stubFetch()
  try {
    const service = new host.WeatherService({})
    const tool = host.createGetWeatherTool(defineTool, service)

    await tool.execute({ location: '杭州', days: 99 }, {})
    const capped = requests[requests.length - 1]
    assert(capped.includes('forecast_days=16'), `the request should ask for the clamped maximum, got ${capped}`)

    // A per-location horizon is not part of the cache key, so each case uses its own
    // coordinates to be sure it reaches the wire instead of a cached bundle.
    const zero = await tool.execute({ latitude: 10, longitude: 10, days: 0 }, {})
    assert(requests[requests.length - 1].includes('forecast_days=1'), 'zero clamps up to the one-day minimum')
    assertEqual(zero.forecast.daily.length, 1, 'a zero horizon still yields exactly one day')
    assertEqual((await tool.execute({ latitude: 11, longitude: 11, days: -3 }, {})).forecast.daily.length, 1, 'a negative horizon clamps up too')
    assertEqual((await tool.execute({ latitude: 12, longitude: 12, days: 16 }, {})).forecast.daily.length, 16, 'the maximum is honoured')
    assertEqual((await tool.execute({ latitude: 13, longitude: 13, days: 3 }, {})).forecast.daily.length, 3, 'an in-range horizon is used as given')
  } finally {
    restore()
  }
})

await test('tool: missing and malformed arguments fail with actionable messages', async () => {
  const { tool, restore } = toolFixture()
  try {
    const cases = [
      [{}, 'provide either'],
      [{ location: '   ' }, 'provide either'],
      [{ location: 'x'.repeat(200) }, 'at most'],
      [{ latitude: 30, longitude: Number.NaN }, 'provide either'],
    ]
    for (const [args, fragment] of cases) {
      let message = ''
      try {
        await tool.execute(args, {})
      } catch (cause) {
        message = cause.message
      }
      assert(message.includes(fragment), `expected ${JSON.stringify(fragment)} in the error for ${JSON.stringify(args)}, got ${JSON.stringify(message)}`)
    }
    assertEqual(requests.length, 0, 'no request is made for an invalid argument set')
  } finally {
    restore()
  }
})

await test('tool: an unmatched place name is reported, not guessed', async () => {
  const { tool, restore } = toolFixture({ emptyGeocode: true })
  try {
    let message = ''
    try {
      await tool.execute({ location: 'atlantis' }, {})
    } catch (cause) {
      message = cause.message
    }
    assert(message.includes('atlantis'), `the unmatched name should appear in the error, got ${JSON.stringify(message)}`)
    assertEqual(requests.length, 1, 'only the geocoder was consulted')
  } finally {
    restore()
  }
})

await test('tool: a network failure while geocoding propagates', async () => {
  const { tool, restore } = toolFixture({ failGeocode: true })
  try {
    let message = ''
    try {
      await tool.execute({ location: '杭州' }, {})
    } catch (cause) {
      message = cause.message
    }
    assert(message.includes('network down'), `the transport error should surface, got ${JSON.stringify(message)}`)
  } finally {
    restore()
  }
})

await test('tool: render produces model-facing text naming the place', async () => {
  const { tool, restore } = toolFixture()
  try {
    const value = await tool.execute({ location: '杭州', days: 1 }, {})
    const content = tool.output.render({}, value)
    assertEqual(content.length, 1, 'one content part is produced')
    assertEqual(content[0].type, 'text', 'the part is text')
    assert(content[0].text.includes('杭州'), 'the text names the place')
    assert(content[0].text.includes('29'), 'the text carries the temperature')
  } finally {
    restore()
  }
})

/* ------------------------------------------------------------------ report */

const failed = results.filter(row => row.ok === false)
for (const row of results) {
  console.log(`${row.ok ? 'ok  ' : 'FAIL'} ${row.name}`)
  if (!row.ok) console.log(`     ${row.message.split('\n').join('\n     ')}`)
}
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length > 0) process.exitCode = 1
