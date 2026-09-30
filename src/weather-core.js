/**
 * Shared weather domain core for both halves of `dsh-plugin-weather`.
 *
 * The whole file is one function that publishes its surface onto the scope object
 * the caller hands it. That shape is deliberate:
 *
 * - the browser bundle is a classic script with no module loader for its own
 *   siblings, so `tools/build-client.mjs` inlines this file as text and
 *   `lib/client.js` evaluates it with `new Function('scope', source)`. The core is
 *   written into the private `{}` the bundle passes, never into `globalThis`, so two
 *   plugins that each inline their own copy cannot overwrite one another;
 * - the Host half imports this module and calls {@link installWeatherCore} with
 *   `globalThis`, so the module graph itself provides the single shared instance
 *   through `lib/weather-core-binding.js`.
 *
 * Constraints that follow from being inlined, and that `tools/build-client.mjs`
 * enforces at build time:
 *
 * - the only `export` is the single line above, which the bundler strips,
 * - no `import` statements,
 * - no Node built-ins,
 * - no TypeScript syntax.
 *
 * Everything here is plain data plus pure functions. Network access is the only
 * impurity and it goes through the global `fetch`, which the browser and Node 22+
 * both provide.
 *
 * @module dsh-plugin-weather/weather-core
 */
function installWeatherCore(scope) {
  'use strict'

  /** Geocoding endpoint used for city name, postal-code, and coordinate search. */
  const WEATHER_GEOCODE_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search'

  /** Forecast endpoint used for the current, hourly, and daily payloads. */
  const WEATHER_FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast'

  /** How many candidate matches a name search asks the geocoder for. */
  const WEATHER_SEARCH_LIMIT = 8

  /** Supported display units, mapped to the Open-Meteo query parameters they set. */
  const WEATHER_UNITS = {
    metric: { temperature: 'celsius', wind: 'kmh', precipitation: 'mm', label: '°C' },
    imperial: { temperature: 'fahrenheit', wind: 'mph', precipitation: 'inch', label: '°F' },
  }

  /**
   * WMO 4677 weather interpretation codes mapped to display metadata.
   *
   * `day` and `night` are emoji glyphs: DSH's shipped icon set covers UI chrome
   * rather than meteorological conditions, so conditions render as glyphs. `key` is
   * a stable lookup id, and `zh` / `en` carry the condition text.
   */
  const WEATHER_CODES = {
    0: { key: 'clear', day: '☀️', night: '🌙', zh: '晴', en: 'Clear sky' },
    1: { key: 'mainlyClear', day: '🌤️', night: '🌙', zh: '大致晴朗', en: 'Mainly clear' },
    2: { key: 'partlyCloudy', day: '⛅', night: '☁️', zh: '局部多云', en: 'Partly cloudy' },
    3: { key: 'overcast', day: '☁️', night: '☁️', zh: '阴', en: 'Overcast' },
    45: { key: 'fog', day: '🌫️', night: '🌫️', zh: '雾', en: 'Fog' },
    48: { key: 'depositingRimeFog', day: '🌫️', night: '🌫️', zh: '霜雾', en: 'Depositing rime fog' },
    51: { key: 'lightDrizzle', day: '🌦️', night: '🌦️', zh: '小毛毛雨', en: 'Light drizzle' },
    53: { key: 'moderateDrizzle', day: '🌦️', night: '🌦️', zh: '毛毛雨', en: 'Moderate drizzle' },
    55: { key: 'denseDrizzle', day: '🌧️', night: '🌧️', zh: '浓密毛毛雨', en: 'Dense drizzle' },
    56: { key: 'lightFreezingDrizzle', day: '🌨️', night: '🌨️', zh: '轻度冻毛毛雨', en: 'Light freezing drizzle' },
    57: { key: 'denseFreezingDrizzle', day: '🌨️', night: '🌨️', zh: '强冻毛毛雨', en: 'Dense freezing drizzle' },
    61: { key: 'slightRain', day: '🌦️', night: '🌦️', zh: '小雨', en: 'Slight rain' },
    63: { key: 'moderateRain', day: '🌧️', night: '🌧️', zh: '中雨', en: 'Moderate rain' },
    65: { key: 'heavyRain', day: '🌧️', night: '🌧️', zh: '大雨', en: 'Heavy rain' },
    66: { key: 'lightFreezingRain', day: '🌨️', night: '🌨️', zh: '轻度冻雨', en: 'Light freezing rain' },
    67: { key: 'heavyFreezingRain', day: '🌨️', night: '🌨️', zh: '强冻雨', en: 'Heavy freezing rain' },
    71: { key: 'slightSnow', day: '🌨️', night: '🌨️', zh: '小雪', en: 'Slight snow' },
    73: { key: 'moderateSnow', day: '❄️', night: '❄️', zh: '中雪', en: 'Moderate snow' },
    75: { key: 'heavySnow', day: '❄️', night: '❄️', zh: '大雪', en: 'Heavy snow' },
    77: { key: 'snowGrains', day: '🌨️', night: '🌨️', zh: '米雪', en: 'Snow grains' },
    80: { key: 'slightShowers', day: '🌦️', night: '🌦️', zh: '小阵雨', en: 'Slight rain showers' },
    81: { key: 'moderateShowers', day: '🌧️', night: '🌧️', zh: '阵雨', en: 'Moderate rain showers' },
    82: { key: 'violentShowers', day: '⛈️', night: '⛈️', zh: '强阵雨', en: 'Violent rain showers' },
    85: { key: 'slightSnowShowers', day: '🌨️', night: '🌨️', zh: '小阵雪', en: 'Slight snow showers' },
    86: { key: 'heavySnowShowers', day: '❄️', night: '❄️', zh: '强阵雪', en: 'Heavy snow showers' },
    95: { key: 'thunderstorm', day: '⛈️', night: '⛈️', zh: '雷阵雨', en: 'Thunderstorm' },
    96: { key: 'thunderstormHail', day: '⛈️', night: '⛈️', zh: '雷阵雨伴小冰雹', en: 'Thunderstorm with slight hail' },
    99: { key: 'thunderstormHeavyHail', day: '⛈️', night: '⛈️', zh: '雷阵雨伴强冰雹', en: 'Thunderstorm with heavy hail' },
  }

  /** Unknown-code fallback so a new WMO code never blanks the panel. */
  const WEATHER_CODE_FALLBACK = { key: 'unknown', day: '🌡️', night: '🌡️', zh: '未知天气', en: 'Unknown' }

  /**
   * Resolve the display metadata for one WMO code.
   * @param code - WMO weather interpretation code from Open-Meteo.
   * @returns the matching entry, or the fallback for unknown codes.
   */
  function weatherCodeInfo(code) {
    return WEATHER_CODES[code] ?? WEATHER_CODE_FALLBACK
  }

  /**
   * Pick the glyph for a code, honouring day/night.
   * @param code - WMO weather interpretation code.
   * @param isDay - whether the local time at the location is daytime.
   * @returns an emoji glyph string.
   */
  function weatherGlyph(code, isDay) {
    const info = weatherCodeInfo(code)
    return isDay === false ? info.night : info.day
  }

  /**
   * Life-index definitions: which daily metric feeds which indicator, and the
   * ascending thresholds that separate its severity buckets.
   *
   * The thresholds are the only tunable part of the derived indices; the advice text
   * for each bucket lives in the client locale dictionary under
   * `panel.index.<key>.<level>`.
   */
  const LIFE_INDEX_DEFINITIONS = [
    { key: 'uv', metric: 'uv_index_max', thresholds: [3, 6, 8] },
    { key: 'precipitation', metric: 'precipitation_probability_max', thresholds: [20, 50, 80] },
    { key: 'wind', metric: 'wind_speed_10m_max', thresholds: [20, 39, 62] },
    { key: 'daylight', metric: 'daylight_duration', thresholds: [28800, 36000, 43200], kind: 'duration' },
  ]

  /**
   * Build the derived life-index rows for one day.
   *
   * Values are read from the daily payload; a metric the provider did not return is
   * skipped rather than guessed. `level` is a 0..3 severity bucket, where higher is
   * more noteworthy.
   *
   * @param daily - one day of the Open-Meteo daily object (parallel arrays).
   * @param index - the day index inside those arrays.
   * @returns an ordered array of `{ key, value, unit, level }` rows.
   */
  function lifeIndices(daily, index) {
    const rows = []
    for (const definition of LIFE_INDEX_DEFINITIONS) {
      const series = daily?.[definition.metric]
      const value = Array.isArray(series) ? series[index] : undefined
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      let level = 0
      for (const boundary of definition.thresholds) if (value >= boundary) level += 1
      rows.push({
        key: definition.key,
        value,
        unit: definition.kind === 'duration' ? 's' : 'raw',
        level,
      })
    }
    return rows
  }

  /**
   * Read a numeric field without throwing on a partial payload.
   * @param source - object or array to read from.
   * @param key - property name, or an array index.
   * @returns the finite number, or `undefined`.
   */
  function finiteNumber(source, key) {
    const value = source?.[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  }

  /** Compass points for wind direction, 16-wind rose starting at north. */
  const COMPASS_POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

  /**
   * Convert a meteorological wind bearing into a compass abbreviation.
   * @param degrees - bearing in degrees clockwise from north.
   * @returns a 1-3 character compass point, or `undefined` when unavailable.
   */
  function compassPoint(degrees) {
    if (typeof degrees !== 'number' || !Number.isFinite(degrees)) return undefined
    const normalized = ((degrees % 360) + 360) % 360
    return COMPASS_POINTS[Math.round(normalized / 22.5) % 16]
  }

  /**
   * Build a query string from defined values only, so unset options never reach the wire.
   * @param params - candidate query parameters.
   * @returns a `?...` query string, or an empty string when nothing is set.
   */
  function encodeQuery(params) {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue
      search.set(key, Array.isArray(value) ? value.join(',') : String(value))
    }
    const text = search.toString()
    return text === '' ? '' : `?${text}`
  }

  /**
   * Normalize one geocoder result into the shape the panel and the tool consume.
   * @param row - one raw `results[]` entry.
   * @returns a normalized location record.
   */
  function normalizeLocation(row) {
    const name = typeof row?.name === 'string' ? row.name : ''
    const admin1 = typeof row?.admin1 === 'string' ? row.admin1 : undefined
    const admin2 = typeof row?.admin2 === 'string' ? row.admin2 : undefined
    const country = typeof row?.country === 'string' ? row.country : undefined
    const parts = [name, admin2, admin1, country].filter(part => typeof part === 'string' && part !== '')
    const deduped = parts.filter((part, index) => parts.indexOf(part) === index)
    return {
      id: String(row?.id ?? `${row?.latitude},${row?.longitude}`),
      name: name === '' ? `${row?.latitude},${row?.longitude}` : name,
      label: deduped.join(' · '),
      country: country ?? '',
      countryCode: typeof row?.country_code === 'string' ? row.country_code : '',
      admin1: admin1 ?? '',
      latitude: Number(row?.latitude),
      longitude: Number(row?.longitude),
      timezone: typeof row?.timezone === 'string' ? row.timezone : 'auto',
      elevation: finiteNumber(row, 'elevation'),
      population: finiteNumber(row, 'population'),
    }
  }

  /**
   * Search for candidate locations by name, postal code, or free text.
   *
   * @param query - user-typed search text; trimmed and required.
   * @param options - `language` selects the returned place-name language, `count`
   *   caps the number of candidates, `signal` cancels the request.
   * @returns normalized candidate locations; an empty array for a blank query.
   * @throws when the provider answers with a non-2xx status.
   */
  async function searchLocations(query, options = {}) {
    const text = typeof query === 'string' ? query.trim() : ''
    if (text === '') return []
    const count = Number.isInteger(options.count) ? Math.min(Math.max(options.count, 1), 20) : WEATHER_SEARCH_LIMIT
    const url =
      WEATHER_GEOCODE_ENDPOINT +
      encodeQuery({
        name: text,
        count,
        language: options.language ?? 'zh',
        format: 'json',
      })
    const response = await fetch(url, { signal: options.signal })
    if (!response.ok) throw new Error(`weather: geocoding request failed with HTTP ${response.status}`)
    const payload = await response.json()
    const results = Array.isArray(payload?.results) ? payload.results : []
    return results
      .map(normalizeLocation)
      .filter(location => Number.isFinite(location.latitude) && Number.isFinite(location.longitude))
  }

  /**
   * Current-condition fields requested from the provider.
   *
   * Kept beside the hourly and daily selectors because the reader in
   * {@link normalizeForecast} must stay in sync with them.
   */
  const CURRENT_FIELDS = [
    'temperature_2m',
    'relative_humidity_2m',
    'apparent_temperature',
    'is_day',
    'precipitation',
    'weather_code',
    'cloud_cover',
    'pressure_msl',
    'wind_speed_10m',
    'wind_direction_10m',
    'wind_gusts_10m',
  ]

  /** Hourly fields requested from the provider. */
  const HOURLY_FIELDS = [
    'temperature_2m',
    'apparent_temperature',
    'precipitation_probability',
    'precipitation',
    'weather_code',
    'wind_speed_10m',
    'relative_humidity_2m',
    'uv_index',
    'is_day',
  ]

  /** Daily fields requested from the provider. */
  const DAILY_FIELDS = [
    'weather_code',
    'temperature_2m_max',
    'temperature_2m_min',
    'apparent_temperature_max',
    'apparent_temperature_min',
    'sunrise',
    'sunset',
    'daylight_duration',
    'uv_index_max',
    'precipitation_sum',
    'precipitation_probability_max',
    'wind_speed_10m_max',
  ]

  /**
   * Turn one raw Open-Meteo payload into the stable bundle the UI and tool consume.
   *
   * The provider returns column-oriented parallel arrays; this walks them once into
   * row-oriented objects and drops the raw response, so consumers never index into
   * `daily.temperature_2m_max[3]` themselves.
   *
   * @param payload - the raw JSON body.
   * @param context - `units` and the originating `location` for labelling.
   * @returns the normalized forecast bundle.
   */
  function normalizeForecast(payload, context = {}) {
    const units = context.units ?? 'metric'
    const current = payload?.current ?? {}
    const isDay = current.is_day === 1 || current.is_day === true
    const code = finiteNumber(current, 'weather_code')

    const hourlyTimes = Array.isArray(payload?.hourly?.time) ? payload.hourly.time : []
    const hourly = hourlyTimes.map((time, index) => ({
      time,
      temperature: finiteNumber(payload.hourly.temperature_2m, index),
      apparentTemperature: finiteNumber(payload.hourly.apparent_temperature, index),
      precipitationProbability: finiteNumber(payload.hourly.precipitation_probability, index),
      precipitation: finiteNumber(payload.hourly.precipitation, index),
      weatherCode: finiteNumber(payload.hourly.weather_code, index),
      windSpeed: finiteNumber(payload.hourly.wind_speed_10m, index),
      humidity: finiteNumber(payload.hourly.relative_humidity_2m, index),
      uvIndex: finiteNumber(payload.hourly.uv_index, index),
      isDay: payload.hourly.is_day?.[index] === 1,
    }))

    const dailyTimes = Array.isArray(payload?.daily?.time) ? payload.daily.time : []
    const daily = dailyTimes.map((date, index) => ({
      date,
      weatherCode: finiteNumber(payload.daily.weather_code, index),
      temperatureMax: finiteNumber(payload.daily.temperature_2m_max, index),
      temperatureMin: finiteNumber(payload.daily.temperature_2m_min, index),
      apparentTemperatureMax: finiteNumber(payload.daily.apparent_temperature_max, index),
      apparentTemperatureMin: finiteNumber(payload.daily.apparent_temperature_min, index),
      sunrise: payload.daily.sunrise?.[index],
      sunset: payload.daily.sunset?.[index],
      daylightDuration: finiteNumber(payload.daily.daylight_duration, index),
      uvIndexMax: finiteNumber(payload.daily.uv_index_max, index),
      precipitationSum: finiteNumber(payload.daily.precipitation_sum, index),
      precipitationProbabilityMax: finiteNumber(payload.daily.precipitation_probability_max, index),
      windSpeedMax: finiteNumber(payload.daily.wind_speed_10m_max, index),
      indices: lifeIndices(payload?.daily, index),
    }))

    return {
      units,
      unitLabels: WEATHER_UNITS[units] ?? WEATHER_UNITS.metric,
      timezone: payload?.timezone ?? 'UTC',
      timezoneAbbreviation: payload?.timezone_abbreviation ?? '',
      utcOffsetSeconds: finiteNumber(payload, 'utc_offset_seconds') ?? 0,
      elevation: finiteNumber(payload, 'elevation'),
      latitude: finiteNumber(payload, 'latitude') ?? Number(context.location?.latitude),
      longitude: finiteNumber(payload, 'longitude') ?? Number(context.location?.longitude),
      current: {
        time: current.time,
        temperature: finiteNumber(current, 'temperature_2m'),
        apparentTemperature: finiteNumber(current, 'apparent_temperature'),
        humidity: finiteNumber(current, 'relative_humidity_2m'),
        precipitation: finiteNumber(current, 'precipitation'),
        weatherCode: code,
        cloudCover: finiteNumber(current, 'cloud_cover'),
        pressure: finiteNumber(current, 'pressure_msl'),
        windSpeed: finiteNumber(current, 'wind_speed_10m'),
        windDirection: finiteNumber(current, 'wind_direction_10m'),
        windGusts: finiteNumber(current, 'wind_gusts_10m'),
        isDay,
        condition: weatherCodeInfo(code),
      },
      hourly,
      daily,
      fetchedAt: Date.now(),
    }
  }

  /**
   * Fetch the full forecast bundle for one coordinate.
   *
   * Requests are issued through the shared `fetch`. Open-Meteo's `timezone=auto`
   * makes every returned time string local to the location, so no client-side
   * timezone math is needed and the hourly series stays comparable as text.
   *
   * @param location - `{ latitude, longitude }`, or explicit coordinates.
   * @param options - `units` selects metric or imperial, `days` the daily horizon,
   *   `signal` cancels the request.
   * @returns the normalized forecast bundle, ready for rendering.
   * @throws when coordinates are missing or the provider answers non-2xx.
   */
  async function fetchForecast(location, options = {}) {
    const latitude = Number(location?.latitude)
    const longitude = Number(location?.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error('weather: fetchForecast needs finite latitude and longitude')
    }
    const units = WEATHER_UNITS[options.units] ?? WEATHER_UNITS.metric
    const days = Number.isInteger(options.days) ? Math.min(Math.max(options.days, 1), 16) : 7
    const url =
      WEATHER_FORECAST_ENDPOINT +
      encodeQuery({
        latitude,
        longitude,
        current: CURRENT_FIELDS,
        hourly: HOURLY_FIELDS,
        daily: DAILY_FIELDS,
        timezone: 'auto',
        forecast_days: days,
        temperature_unit: units.temperature,
        wind_speed_unit: units.wind,
        precipitation_unit: units.precipitation,
      })
    const response = await fetch(url, { signal: options.signal })
    if (!response.ok) throw new Error(`weather: forecast request failed with HTTP ${response.status}`)
    const payload = await response.json()
    if (typeof payload?.error === 'boolean' && payload.error) {
      throw new Error(`weather: provider rejected the request (${payload.reason ?? 'no reason given'})`)
    }
    return normalizeForecast(payload, { units: options.units ?? 'metric', location })
  }

  /**
   * Slice the hourly series down to the next `count` hours.
   *
   * Open-Meteo returns the whole local day starting at midnight, so the panel needs
   * to skip the hours that already passed. Both the hourly stamps and `current.time`
   * are local wall clock at the location (`timezone=auto`), so a lexicographic
   * compare on `YYYY-MM-DDTHH` is the timezone-correct test — no `Date` parsing, and
   * no dependency on the viewer's own timezone.
   *
   * @param forecast - a normalized bundle from {@link fetchForecast}.
   * @param count - how many hours to keep.
   * @returns up to `count` hourly rows starting at the current local hour.
   */
  function upcomingHours(forecast, count = 24) {
    const rows = Array.isArray(forecast?.hourly) ? forecast.hourly : []
    const nowText = typeof forecast?.current?.time === 'string' ? forecast.current.time.slice(0, 13) : undefined
    if (nowText === undefined) return rows.slice(0, count)
    const start = rows.findIndex(row => typeof row.time === 'string' && row.time.slice(0, 13) >= nowText)
    const from = start === -1 ? 0 : start
    return rows.slice(from, from + count)
  }

  /**
   * The intraday temperature window, used to scale the hourly sparkline.
   *
   * A flat series (or an empty one) would divide by zero, so the caller gets an
   * explicit `null` span and must render a flat line instead.
   *
   * @param rows - hourly rows, already sliced to the visible window.
   * @returns `{ min, max, span }` where `span` is `null` for a degenerate series.
   */
  function temperatureWindow(rows) {
    const values = rows.map(row => row.temperature).filter(value => typeof value === 'number' && Number.isFinite(value))
    if (values.length === 0) return { min: undefined, max: undefined, span: null }
    const min = Math.min(...values)
    const max = Math.max(...values)
    return { min, max, span: max === min ? null : max - min }
  }

  /**
   * Summarize several saved cities from one multi-location request.
   *
   * Open-Meteo accepts comma-separated coordinate lists and answers with an array,
   * so a favourites list costs one request instead of one per city. The response
   * order matches the request order, which is asserted rather than assumed.
   *
   * @param locations - saved locations, each with `latitude` and `longitude`.
   * @param options - `units` and `signal`, as for {@link fetchForecast}.
   * @returns one compact summary per input location, in input order.
   * @throws when the list is empty, the response length disagrees, or the provider
   *   answers non-2xx.
   */
  async function fetchSummaries(locations, options = {}) {
    const list = Array.isArray(locations) ? locations.filter(entry => Number.isFinite(Number(entry?.latitude))) : []
    if (list.length === 0) return []
    const units = WEATHER_UNITS[options.units] ?? WEATHER_UNITS.metric
    const url =
      WEATHER_FORECAST_ENDPOINT +
      encodeQuery({
        latitude: list.map(entry => Number(entry.latitude)),
        longitude: list.map(entry => Number(entry.longitude)),
        current: ['temperature_2m', 'weather_code', 'is_day', 'apparent_temperature'],
        daily: ['temperature_2m_max', 'temperature_2m_min'],
        timezone: 'auto',
        forecast_days: 1,
        temperature_unit: units.temperature,
      })
    const response = await fetch(url, { signal: options.signal })
    if (!response.ok) throw new Error(`weather: summary request failed with HTTP ${response.status}`)
    const payload = await response.json()
    const rows = Array.isArray(payload) ? payload : [payload]
    if (rows.length !== list.length) {
      throw new Error(`weather: summary request answered ${rows.length} rows for ${list.length} locations`)
    }
    return rows.map((row, index) => {
      const code = finiteNumber(row?.current, 'weather_code')
      return {
        id: list[index]?.id,
        name: list[index]?.name,
        label: list[index]?.label,
        timezone: row?.timezone,
        temperature: finiteNumber(row?.current, 'temperature_2m'),
        apparentTemperature: finiteNumber(row?.current, 'apparent_temperature'),
        temperatureMax: finiteNumber(row?.daily?.temperature_2m_max, 0),
        temperatureMin: finiteNumber(row?.daily?.temperature_2m_min, 0),
        weatherCode: code,
        isDay: row?.current?.is_day === 1,
        condition: weatherCodeInfo(code),
      }
    })
  }

  /** The complete shared surface, published for whichever half is consuming it. */
  const WEATHER_CORE = {
    WEATHER_GEOCODE_ENDPOINT,
    WEATHER_FORECAST_ENDPOINT,
    WEATHER_UNITS,
    WEATHER_CODES,
    WEATHER_CODE_FALLBACK,
    WEATHER_SEARCH_LIMIT,
    CURRENT_FIELDS,
    HOURLY_FIELDS,
    DAILY_FIELDS,
    COMPASS_POINTS,
    weatherCodeInfo,
    weatherGlyph,
    lifeIndices,
    compassPoint,
    encodeQuery,
    normalizeLocation,
    searchLocations,
    fetchForecast,
    normalizeForecast,
    upcomingHours,
    temperatureWindow,
    fetchSummaries,
  }

  scope.__DSH_WEATHER_CORE__ = WEATHER_CORE
}

// The browser bundle inlines everything above, strips the export line, and calls
// this function itself with a private `{}` so nothing lands on the page's global
// object. This invocation therefore exists only for the Host half, where
// `globalThis` is the right — and only — place to publish a shared instance.
installWeatherCore(globalThis)

export { installWeatherCore }
