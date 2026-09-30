/* TEMPLATE — the shipped bundle is `client/client.js`, generated from this file.
 *
 * `tools/build-client.mjs` substitutes five sentinels, named here in angle
 * brackets so this header never contains one literally:
 *
 *   <INLINE PACKAGE>    -> this package's name from `package.json`
 *   <INLINE VERSION>    -> this package's version from `package.json`
 *   <INLINE BUILD>      -> that version plus a hash of the finished bundle
 *   <INLINE CORE>       -> `src/weather-core.js` as source text (evaluated below)
 *   <INLINE LOCALE>     -> `src/locale.mjs` as a JSON literal
 *
 * Everything else is written as the final browser bundle: a single
 * `window.__ModuleLoader__.load({...})` registration wrapping one CommonJS factory,
 * which is exactly DSH's client bundle contract. No bundler, no build step beyond
 * the substitutions, and no imports outside the frozen platform table.
 *
 * The bundle may only `require` the platform seed table DSH installs before any
 * plugin runs:
 *
 *   react, react/jsx-runtime, react-dom, react-dom/client, @deepseek-ai/cordis,
 *   @deepseek-ai/dsh-client-store, @deepseek-ai/dsh-client-ui-slots,
 *   @deepseek-ai/dsh-client-ui-primitives, @deepseek-ai/dsh-client-ui-dockkit
 *
 * Sibling files are therefore reached through the inlined copy of the shared
 * weather core rather than a relative `require`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-weather',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { jsx, jsxs, Fragment } = require('react/jsx-runtime')
    const { IconSearchOutlineRegular, IconRefreshOutlineRegular, IconPlusOutlineRegular, IconTrashOutlineRegular, IconCloseOutlineRegular, IconGlobeOutlineRegular, IconWarningOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')

    const PACKAGE_NAME = 'dsh-plugin-weather'
    const PACKAGE_VERSION = '1.0.0'
    /** `package@version+hash`, so the panel can show which build the page loaded. */
    const PACKAGE_BUILD_STAMP = 'dsh-plugin-weather@1.0.0+01601fd16402'

    /* ---------------------------------------------------------------- shared core */

    // The shared weather core as source text, inlined by tools/build-client.mjs.
    const WEATHER_CORE_SOURCE = "/**\n * Shared weather domain core for both halves of `dsh-plugin-weather`.\n *\n * The whole file is one function that publishes its surface onto the scope object\n * the caller hands it. That shape is deliberate:\n *\n * - the browser bundle is a classic script with no module loader for its own\n *   siblings, so `tools/build-client.mjs` inlines this file as text and\n *   `lib/client.js` evaluates it with `new Function('scope', source)`. The core is\n *   written into the private `{}` the bundle passes, never into `globalThis`, so two\n *   plugins that each inline their own copy cannot overwrite one another;\n * - the Host half imports this module and calls {@link installWeatherCore} with\n *   `globalThis`, so the module graph itself provides the single shared instance\n *   through `lib/weather-core-binding.js`.\n *\n * Constraints that follow from being inlined, and that `tools/build-client.mjs`\n * enforces at build time:\n *\n * - the only `export` is the single line above, which the bundler strips,\n * - no `import` statements,\n * - no Node built-ins,\n * - no TypeScript syntax.\n *\n * Everything here is plain data plus pure functions. Network access is the only\n * impurity and it goes through the global `fetch`, which the browser and Node 22+\n * both provide.\n *\n * @module dsh-plugin-weather/weather-core\n */\nfunction installWeatherCore(scope) {\n  'use strict'\n\n  /** Geocoding endpoint used for city name, postal-code, and coordinate search. */\n  const WEATHER_GEOCODE_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search'\n\n  /** Forecast endpoint used for the current, hourly, and daily payloads. */\n  const WEATHER_FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast'\n\n  /** How many candidate matches a name search asks the geocoder for. */\n  const WEATHER_SEARCH_LIMIT = 8\n\n  /** Supported display units, mapped to the Open-Meteo query parameters they set. */\n  const WEATHER_UNITS = {\n    metric: { temperature: 'celsius', wind: 'kmh', precipitation: 'mm', label: '°C' },\n    imperial: { temperature: 'fahrenheit', wind: 'mph', precipitation: 'inch', label: '°F' },\n  }\n\n  /**\n   * WMO 4677 weather interpretation codes mapped to display metadata.\n   *\n   * `day` and `night` are emoji glyphs: DSH's shipped icon set covers UI chrome\n   * rather than meteorological conditions, so conditions render as glyphs. `key` is\n   * a stable lookup id, and `zh` / `en` carry the condition text.\n   */\n  const WEATHER_CODES = {\n    0: { key: 'clear', day: '☀️', night: '🌙', zh: '晴', en: 'Clear sky' },\n    1: { key: 'mainlyClear', day: '🌤️', night: '🌙', zh: '大致晴朗', en: 'Mainly clear' },\n    2: { key: 'partlyCloudy', day: '⛅', night: '☁️', zh: '局部多云', en: 'Partly cloudy' },\n    3: { key: 'overcast', day: '☁️', night: '☁️', zh: '阴', en: 'Overcast' },\n    45: { key: 'fog', day: '🌫️', night: '🌫️', zh: '雾', en: 'Fog' },\n    48: { key: 'depositingRimeFog', day: '🌫️', night: '🌫️', zh: '霜雾', en: 'Depositing rime fog' },\n    51: { key: 'lightDrizzle', day: '🌦️', night: '🌦️', zh: '小毛毛雨', en: 'Light drizzle' },\n    53: { key: 'moderateDrizzle', day: '🌦️', night: '🌦️', zh: '毛毛雨', en: 'Moderate drizzle' },\n    55: { key: 'denseDrizzle', day: '🌧️', night: '🌧️', zh: '浓密毛毛雨', en: 'Dense drizzle' },\n    56: { key: 'lightFreezingDrizzle', day: '🌨️', night: '🌨️', zh: '轻度冻毛毛雨', en: 'Light freezing drizzle' },\n    57: { key: 'denseFreezingDrizzle', day: '🌨️', night: '🌨️', zh: '强冻毛毛雨', en: 'Dense freezing drizzle' },\n    61: { key: 'slightRain', day: '🌦️', night: '🌦️', zh: '小雨', en: 'Slight rain' },\n    63: { key: 'moderateRain', day: '🌧️', night: '🌧️', zh: '中雨', en: 'Moderate rain' },\n    65: { key: 'heavyRain', day: '🌧️', night: '🌧️', zh: '大雨', en: 'Heavy rain' },\n    66: { key: 'lightFreezingRain', day: '🌨️', night: '🌨️', zh: '轻度冻雨', en: 'Light freezing rain' },\n    67: { key: 'heavyFreezingRain', day: '🌨️', night: '🌨️', zh: '强冻雨', en: 'Heavy freezing rain' },\n    71: { key: 'slightSnow', day: '🌨️', night: '🌨️', zh: '小雪', en: 'Slight snow' },\n    73: { key: 'moderateSnow', day: '❄️', night: '❄️', zh: '中雪', en: 'Moderate snow' },\n    75: { key: 'heavySnow', day: '❄️', night: '❄️', zh: '大雪', en: 'Heavy snow' },\n    77: { key: 'snowGrains', day: '🌨️', night: '🌨️', zh: '米雪', en: 'Snow grains' },\n    80: { key: 'slightShowers', day: '🌦️', night: '🌦️', zh: '小阵雨', en: 'Slight rain showers' },\n    81: { key: 'moderateShowers', day: '🌧️', night: '🌧️', zh: '阵雨', en: 'Moderate rain showers' },\n    82: { key: 'violentShowers', day: '⛈️', night: '⛈️', zh: '强阵雨', en: 'Violent rain showers' },\n    85: { key: 'slightSnowShowers', day: '🌨️', night: '🌨️', zh: '小阵雪', en: 'Slight snow showers' },\n    86: { key: 'heavySnowShowers', day: '❄️', night: '❄️', zh: '强阵雪', en: 'Heavy snow showers' },\n    95: { key: 'thunderstorm', day: '⛈️', night: '⛈️', zh: '雷阵雨', en: 'Thunderstorm' },\n    96: { key: 'thunderstormHail', day: '⛈️', night: '⛈️', zh: '雷阵雨伴小冰雹', en: 'Thunderstorm with slight hail' },\n    99: { key: 'thunderstormHeavyHail', day: '⛈️', night: '⛈️', zh: '雷阵雨伴强冰雹', en: 'Thunderstorm with heavy hail' },\n  }\n\n  /** Unknown-code fallback so a new WMO code never blanks the panel. */\n  const WEATHER_CODE_FALLBACK = { key: 'unknown', day: '🌡️', night: '🌡️', zh: '未知天气', en: 'Unknown' }\n\n  /**\n   * Resolve the display metadata for one WMO code.\n   * @param code - WMO weather interpretation code from Open-Meteo.\n   * @returns the matching entry, or the fallback for unknown codes.\n   */\n  function weatherCodeInfo(code) {\n    return WEATHER_CODES[code] ?? WEATHER_CODE_FALLBACK\n  }\n\n  /**\n   * Pick the glyph for a code, honouring day/night.\n   * @param code - WMO weather interpretation code.\n   * @param isDay - whether the local time at the location is daytime.\n   * @returns an emoji glyph string.\n   */\n  function weatherGlyph(code, isDay) {\n    const info = weatherCodeInfo(code)\n    return isDay === false ? info.night : info.day\n  }\n\n  /**\n   * Life-index definitions: which daily metric feeds which indicator, and the\n   * ascending thresholds that separate its severity buckets.\n   *\n   * The thresholds are the only tunable part of the derived indices; the advice text\n   * for each bucket lives in the client locale dictionary under\n   * `panel.index.<key>.<level>`.\n   */\n  const LIFE_INDEX_DEFINITIONS = [\n    { key: 'uv', metric: 'uv_index_max', thresholds: [3, 6, 8] },\n    { key: 'precipitation', metric: 'precipitation_probability_max', thresholds: [20, 50, 80] },\n    { key: 'wind', metric: 'wind_speed_10m_max', thresholds: [20, 39, 62] },\n    { key: 'daylight', metric: 'daylight_duration', thresholds: [28800, 36000, 43200], kind: 'duration' },\n  ]\n\n  /**\n   * Build the derived life-index rows for one day.\n   *\n   * Values are read from the daily payload; a metric the provider did not return is\n   * skipped rather than guessed. `level` is a 0..3 severity bucket, where higher is\n   * more noteworthy.\n   *\n   * @param daily - one day of the Open-Meteo daily object (parallel arrays).\n   * @param index - the day index inside those arrays.\n   * @returns an ordered array of `{ key, value, unit, level }` rows.\n   */\n  function lifeIndices(daily, index) {\n    const rows = []\n    for (const definition of LIFE_INDEX_DEFINITIONS) {\n      const series = daily?.[definition.metric]\n      const value = Array.isArray(series) ? series[index] : undefined\n      if (typeof value !== 'number' || !Number.isFinite(value)) continue\n      let level = 0\n      for (const boundary of definition.thresholds) if (value >= boundary) level += 1\n      rows.push({\n        key: definition.key,\n        value,\n        unit: definition.kind === 'duration' ? 's' : 'raw',\n        level,\n      })\n    }\n    return rows\n  }\n\n  /**\n   * Read a numeric field without throwing on a partial payload.\n   * @param source - object or array to read from.\n   * @param key - property name, or an array index.\n   * @returns the finite number, or `undefined`.\n   */\n  function finiteNumber(source, key) {\n    const value = source?.[key]\n    return typeof value === 'number' && Number.isFinite(value) ? value : undefined\n  }\n\n  /** Compass points for wind direction, 16-wind rose starting at north. */\n  const COMPASS_POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']\n\n  /**\n   * Convert a meteorological wind bearing into a compass abbreviation.\n   * @param degrees - bearing in degrees clockwise from north.\n   * @returns a 1-3 character compass point, or `undefined` when unavailable.\n   */\n  function compassPoint(degrees) {\n    if (typeof degrees !== 'number' || !Number.isFinite(degrees)) return undefined\n    const normalized = ((degrees % 360) + 360) % 360\n    return COMPASS_POINTS[Math.round(normalized / 22.5) % 16]\n  }\n\n  /**\n   * Build a query string from defined values only, so unset options never reach the wire.\n   * @param params - candidate query parameters.\n   * @returns a `?...` query string, or an empty string when nothing is set.\n   */\n  function encodeQuery(params) {\n    const search = new URLSearchParams()\n    for (const [key, value] of Object.entries(params)) {\n      if (value === undefined || value === null || value === '') continue\n      search.set(key, Array.isArray(value) ? value.join(',') : String(value))\n    }\n    const text = search.toString()\n    return text === '' ? '' : `?${text}`\n  }\n\n  /**\n   * Normalize one geocoder result into the shape the panel and the tool consume.\n   * @param row - one raw `results[]` entry.\n   * @returns a normalized location record.\n   */\n  function normalizeLocation(row) {\n    const name = typeof row?.name === 'string' ? row.name : ''\n    const admin1 = typeof row?.admin1 === 'string' ? row.admin1 : undefined\n    const admin2 = typeof row?.admin2 === 'string' ? row.admin2 : undefined\n    const country = typeof row?.country === 'string' ? row.country : undefined\n    const parts = [name, admin2, admin1, country].filter(part => typeof part === 'string' && part !== '')\n    const deduped = parts.filter((part, index) => parts.indexOf(part) === index)\n    return {\n      id: String(row?.id ?? `${row?.latitude},${row?.longitude}`),\n      name: name === '' ? `${row?.latitude},${row?.longitude}` : name,\n      label: deduped.join(' · '),\n      country: country ?? '',\n      countryCode: typeof row?.country_code === 'string' ? row.country_code : '',\n      admin1: admin1 ?? '',\n      latitude: Number(row?.latitude),\n      longitude: Number(row?.longitude),\n      timezone: typeof row?.timezone === 'string' ? row.timezone : 'auto',\n      elevation: finiteNumber(row, 'elevation'),\n      population: finiteNumber(row, 'population'),\n    }\n  }\n\n  /**\n   * Search for candidate locations by name, postal code, or free text.\n   *\n   * @param query - user-typed search text; trimmed and required.\n   * @param options - `language` selects the returned place-name language, `count`\n   *   caps the number of candidates, `signal` cancels the request.\n   * @returns normalized candidate locations; an empty array for a blank query.\n   * @throws when the provider answers with a non-2xx status.\n   */\n  async function searchLocations(query, options = {}) {\n    const text = typeof query === 'string' ? query.trim() : ''\n    if (text === '') return []\n    const count = Number.isInteger(options.count) ? Math.min(Math.max(options.count, 1), 20) : WEATHER_SEARCH_LIMIT\n    const url =\n      WEATHER_GEOCODE_ENDPOINT +\n      encodeQuery({\n        name: text,\n        count,\n        language: options.language ?? 'zh',\n        format: 'json',\n      })\n    const response = await fetch(url, { signal: options.signal })\n    if (!response.ok) throw new Error(`weather: geocoding request failed with HTTP ${response.status}`)\n    const payload = await response.json()\n    const results = Array.isArray(payload?.results) ? payload.results : []\n    return results\n      .map(normalizeLocation)\n      .filter(location => Number.isFinite(location.latitude) && Number.isFinite(location.longitude))\n  }\n\n  /**\n   * Current-condition fields requested from the provider.\n   *\n   * Kept beside the hourly and daily selectors because the reader in\n   * {@link normalizeForecast} must stay in sync with them.\n   */\n  const CURRENT_FIELDS = [\n    'temperature_2m',\n    'relative_humidity_2m',\n    'apparent_temperature',\n    'is_day',\n    'precipitation',\n    'weather_code',\n    'cloud_cover',\n    'pressure_msl',\n    'wind_speed_10m',\n    'wind_direction_10m',\n    'wind_gusts_10m',\n  ]\n\n  /** Hourly fields requested from the provider. */\n  const HOURLY_FIELDS = [\n    'temperature_2m',\n    'apparent_temperature',\n    'precipitation_probability',\n    'precipitation',\n    'weather_code',\n    'wind_speed_10m',\n    'relative_humidity_2m',\n    'uv_index',\n    'is_day',\n  ]\n\n  /** Daily fields requested from the provider. */\n  const DAILY_FIELDS = [\n    'weather_code',\n    'temperature_2m_max',\n    'temperature_2m_min',\n    'apparent_temperature_max',\n    'apparent_temperature_min',\n    'sunrise',\n    'sunset',\n    'daylight_duration',\n    'uv_index_max',\n    'precipitation_sum',\n    'precipitation_probability_max',\n    'wind_speed_10m_max',\n  ]\n\n  /**\n   * Turn one raw Open-Meteo payload into the stable bundle the UI and tool consume.\n   *\n   * The provider returns column-oriented parallel arrays; this walks them once into\n   * row-oriented objects and drops the raw response, so consumers never index into\n   * `daily.temperature_2m_max[3]` themselves.\n   *\n   * @param payload - the raw JSON body.\n   * @param context - `units` and the originating `location` for labelling.\n   * @returns the normalized forecast bundle.\n   */\n  function normalizeForecast(payload, context = {}) {\n    const units = context.units ?? 'metric'\n    const current = payload?.current ?? {}\n    const isDay = current.is_day === 1 || current.is_day === true\n    const code = finiteNumber(current, 'weather_code')\n\n    const hourlyTimes = Array.isArray(payload?.hourly?.time) ? payload.hourly.time : []\n    const hourly = hourlyTimes.map((time, index) => ({\n      time,\n      temperature: finiteNumber(payload.hourly.temperature_2m, index),\n      apparentTemperature: finiteNumber(payload.hourly.apparent_temperature, index),\n      precipitationProbability: finiteNumber(payload.hourly.precipitation_probability, index),\n      precipitation: finiteNumber(payload.hourly.precipitation, index),\n      weatherCode: finiteNumber(payload.hourly.weather_code, index),\n      windSpeed: finiteNumber(payload.hourly.wind_speed_10m, index),\n      humidity: finiteNumber(payload.hourly.relative_humidity_2m, index),\n      uvIndex: finiteNumber(payload.hourly.uv_index, index),\n      isDay: payload.hourly.is_day?.[index] === 1,\n    }))\n\n    const dailyTimes = Array.isArray(payload?.daily?.time) ? payload.daily.time : []\n    const daily = dailyTimes.map((date, index) => ({\n      date,\n      weatherCode: finiteNumber(payload.daily.weather_code, index),\n      temperatureMax: finiteNumber(payload.daily.temperature_2m_max, index),\n      temperatureMin: finiteNumber(payload.daily.temperature_2m_min, index),\n      apparentTemperatureMax: finiteNumber(payload.daily.apparent_temperature_max, index),\n      apparentTemperatureMin: finiteNumber(payload.daily.apparent_temperature_min, index),\n      sunrise: payload.daily.sunrise?.[index],\n      sunset: payload.daily.sunset?.[index],\n      daylightDuration: finiteNumber(payload.daily.daylight_duration, index),\n      uvIndexMax: finiteNumber(payload.daily.uv_index_max, index),\n      precipitationSum: finiteNumber(payload.daily.precipitation_sum, index),\n      precipitationProbabilityMax: finiteNumber(payload.daily.precipitation_probability_max, index),\n      windSpeedMax: finiteNumber(payload.daily.wind_speed_10m_max, index),\n      indices: lifeIndices(payload?.daily, index),\n    }))\n\n    return {\n      units,\n      unitLabels: WEATHER_UNITS[units] ?? WEATHER_UNITS.metric,\n      timezone: payload?.timezone ?? 'UTC',\n      timezoneAbbreviation: payload?.timezone_abbreviation ?? '',\n      utcOffsetSeconds: finiteNumber(payload, 'utc_offset_seconds') ?? 0,\n      elevation: finiteNumber(payload, 'elevation'),\n      latitude: finiteNumber(payload, 'latitude') ?? Number(context.location?.latitude),\n      longitude: finiteNumber(payload, 'longitude') ?? Number(context.location?.longitude),\n      current: {\n        time: current.time,\n        temperature: finiteNumber(current, 'temperature_2m'),\n        apparentTemperature: finiteNumber(current, 'apparent_temperature'),\n        humidity: finiteNumber(current, 'relative_humidity_2m'),\n        precipitation: finiteNumber(current, 'precipitation'),\n        weatherCode: code,\n        cloudCover: finiteNumber(current, 'cloud_cover'),\n        pressure: finiteNumber(current, 'pressure_msl'),\n        windSpeed: finiteNumber(current, 'wind_speed_10m'),\n        windDirection: finiteNumber(current, 'wind_direction_10m'),\n        windGusts: finiteNumber(current, 'wind_gusts_10m'),\n        isDay,\n        condition: weatherCodeInfo(code),\n      },\n      hourly,\n      daily,\n      fetchedAt: Date.now(),\n    }\n  }\n\n  /**\n   * Fetch the full forecast bundle for one coordinate.\n   *\n   * Requests are issued through the shared `fetch`. Open-Meteo's `timezone=auto`\n   * makes every returned time string local to the location, so no client-side\n   * timezone math is needed and the hourly series stays comparable as text.\n   *\n   * @param location - `{ latitude, longitude }`, or explicit coordinates.\n   * @param options - `units` selects metric or imperial, `days` the daily horizon,\n   *   `signal` cancels the request.\n   * @returns the normalized forecast bundle, ready for rendering.\n   * @throws when coordinates are missing or the provider answers non-2xx.\n   */\n  async function fetchForecast(location, options = {}) {\n    const latitude = Number(location?.latitude)\n    const longitude = Number(location?.longitude)\n    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {\n      throw new Error('weather: fetchForecast needs finite latitude and longitude')\n    }\n    const units = WEATHER_UNITS[options.units] ?? WEATHER_UNITS.metric\n    const days = Number.isInteger(options.days) ? Math.min(Math.max(options.days, 1), 16) : 7\n    const url =\n      WEATHER_FORECAST_ENDPOINT +\n      encodeQuery({\n        latitude,\n        longitude,\n        current: CURRENT_FIELDS,\n        hourly: HOURLY_FIELDS,\n        daily: DAILY_FIELDS,\n        timezone: 'auto',\n        forecast_days: days,\n        temperature_unit: units.temperature,\n        wind_speed_unit: units.wind,\n        precipitation_unit: units.precipitation,\n      })\n    const response = await fetch(url, { signal: options.signal })\n    if (!response.ok) throw new Error(`weather: forecast request failed with HTTP ${response.status}`)\n    const payload = await response.json()\n    if (typeof payload?.error === 'boolean' && payload.error) {\n      throw new Error(`weather: provider rejected the request (${payload.reason ?? 'no reason given'})`)\n    }\n    return normalizeForecast(payload, { units: options.units ?? 'metric', location })\n  }\n\n  /**\n   * Slice the hourly series down to the next `count` hours.\n   *\n   * Open-Meteo returns the whole local day starting at midnight, so the panel needs\n   * to skip the hours that already passed. Both the hourly stamps and `current.time`\n   * are local wall clock at the location (`timezone=auto`), so a lexicographic\n   * compare on `YYYY-MM-DDTHH` is the timezone-correct test — no `Date` parsing, and\n   * no dependency on the viewer's own timezone.\n   *\n   * @param forecast - a normalized bundle from {@link fetchForecast}.\n   * @param count - how many hours to keep.\n   * @returns up to `count` hourly rows starting at the current local hour.\n   */\n  function upcomingHours(forecast, count = 24) {\n    const rows = Array.isArray(forecast?.hourly) ? forecast.hourly : []\n    const nowText = typeof forecast?.current?.time === 'string' ? forecast.current.time.slice(0, 13) : undefined\n    if (nowText === undefined) return rows.slice(0, count)\n    const start = rows.findIndex(row => typeof row.time === 'string' && row.time.slice(0, 13) >= nowText)\n    const from = start === -1 ? 0 : start\n    return rows.slice(from, from + count)\n  }\n\n  /**\n   * The intraday temperature window, used to scale the hourly sparkline.\n   *\n   * A flat series (or an empty one) would divide by zero, so the caller gets an\n   * explicit `null` span and must render a flat line instead.\n   *\n   * @param rows - hourly rows, already sliced to the visible window.\n   * @returns `{ min, max, span }` where `span` is `null` for a degenerate series.\n   */\n  function temperatureWindow(rows) {\n    const values = rows.map(row => row.temperature).filter(value => typeof value === 'number' && Number.isFinite(value))\n    if (values.length === 0) return { min: undefined, max: undefined, span: null }\n    const min = Math.min(...values)\n    const max = Math.max(...values)\n    return { min, max, span: max === min ? null : max - min }\n  }\n\n  /**\n   * Summarize several saved cities from one multi-location request.\n   *\n   * Open-Meteo accepts comma-separated coordinate lists and answers with an array,\n   * so a favourites list costs one request instead of one per city. The response\n   * order matches the request order, which is asserted rather than assumed.\n   *\n   * @param locations - saved locations, each with `latitude` and `longitude`.\n   * @param options - `units` and `signal`, as for {@link fetchForecast}.\n   * @returns one compact summary per input location, in input order.\n   * @throws when the list is empty, the response length disagrees, or the provider\n   *   answers non-2xx.\n   */\n  async function fetchSummaries(locations, options = {}) {\n    const list = Array.isArray(locations) ? locations.filter(entry => Number.isFinite(Number(entry?.latitude))) : []\n    if (list.length === 0) return []\n    const units = WEATHER_UNITS[options.units] ?? WEATHER_UNITS.metric\n    const url =\n      WEATHER_FORECAST_ENDPOINT +\n      encodeQuery({\n        latitude: list.map(entry => Number(entry.latitude)),\n        longitude: list.map(entry => Number(entry.longitude)),\n        current: ['temperature_2m', 'weather_code', 'is_day', 'apparent_temperature'],\n        daily: ['temperature_2m_max', 'temperature_2m_min'],\n        timezone: 'auto',\n        forecast_days: 1,\n        temperature_unit: units.temperature,\n      })\n    const response = await fetch(url, { signal: options.signal })\n    if (!response.ok) throw new Error(`weather: summary request failed with HTTP ${response.status}`)\n    const payload = await response.json()\n    const rows = Array.isArray(payload) ? payload : [payload]\n    if (rows.length !== list.length) {\n      throw new Error(`weather: summary request answered ${rows.length} rows for ${list.length} locations`)\n    }\n    return rows.map((row, index) => {\n      const code = finiteNumber(row?.current, 'weather_code')\n      return {\n        id: list[index]?.id,\n        name: list[index]?.name,\n        label: list[index]?.label,\n        timezone: row?.timezone,\n        temperature: finiteNumber(row?.current, 'temperature_2m'),\n        apparentTemperature: finiteNumber(row?.current, 'apparent_temperature'),\n        temperatureMax: finiteNumber(row?.daily?.temperature_2m_max, 0),\n        temperatureMin: finiteNumber(row?.daily?.temperature_2m_min, 0),\n        weatherCode: code,\n        isDay: row?.current?.is_day === 1,\n        condition: weatherCodeInfo(code),\n      }\n    })\n  }\n\n  /** The complete shared surface, published for whichever half is consuming it. */\n  const WEATHER_CORE = {\n    WEATHER_GEOCODE_ENDPOINT,\n    WEATHER_FORECAST_ENDPOINT,\n    WEATHER_UNITS,\n    WEATHER_CODES,\n    WEATHER_CODE_FALLBACK,\n    WEATHER_SEARCH_LIMIT,\n    CURRENT_FIELDS,\n    HOURLY_FIELDS,\n    DAILY_FIELDS,\n    COMPASS_POINTS,\n    weatherCodeInfo,\n    weatherGlyph,\n    lifeIndices,\n    compassPoint,\n    encodeQuery,\n    normalizeLocation,\n    searchLocations,\n    fetchForecast,\n    normalizeForecast,\n    upcomingHours,\n    temperatureWindow,\n    fetchSummaries,\n  }\n\n  scope.__DSH_WEATHER_CORE__ = WEATHER_CORE\n}\n\n// The browser bundle inlines everything above, strips the export line, and calls\n// this function itself with a private `{}` so nothing lands on the page's global\n// object. This invocation therefore exists only for the Host half, where\n// `globalThis` is the right — and only — place to publish a shared instance.\ninstallWeatherCore(scope)\n\n\n"

    /**
     * Materialize the inlined shared core.
     *
     * The bundle is a classic script with no module loader for its own siblings, so
     * the core travels as text and is compiled and run once here. `new Function` is
     * used rather than `eval` so the source cannot capture this closure's scope, and
     * the core is handed a private object to populate — deliberately not
     * `globalThis`, so two plugins that each inline their own copy cannot overwrite
     * each other.
     *
     * `new Function('scope', source)` only *compiles* the core; the returned function
     * still has to be invoked with the scope it should populate.
     *
     * @returns the core's published surface.
     */
    function loadWeatherCore() {
      const scope = {}
      const install = new Function('scope', WEATHER_CORE_SOURCE)
      install(scope)
      const installed = scope.__DSH_WEATHER_CORE__
      if (installed === undefined) {
        throw new Error(
          'weather: the inlined core did not initialize (source ' +
            WEATHER_CORE_SOURCE.length +
            ' chars, tail ' +
            JSON.stringify(WEATHER_CORE_SOURCE.slice(-60)) +
            ')',
        )
      }
      return installed
    }

    const core = loadWeatherCore()
    const {
      weatherCodeInfo,
      weatherGlyph,
      compassPoint,
      searchLocations,
      fetchForecast,
      fetchSummaries,
      upcomingHours,
      temperatureWindow,
    } = core

    /* -------------------------------------------------------------------- locale */

    // Both shipped dictionaries, inlined by tools/build-client.mjs. Keys are shared
    // with lib/locale.mjs, which DSH's locale runtime requires verbatim.
    const MESSAGES = {"zh":{"panel.title":"天气","panel.subtitle":"实时天气、逐小时与 7 天预报","panel.search":"搜索城市","panel.searchPlaceholder":"输入城市名、邮编或「纬度,经度」","panel.searchEmpty":"没有找到匹配的城市，换个关键词试试。","panel.searchFailed":"搜索失败，请稍后重试。","panel.searchHint":"支持中文、英文与邮编，例如「杭州」「Tokyo」「310000」。","panel.current":"当前天气","panel.feelsLike":"体感","panel.high":"最高","panel.low":"最低","panel.humidity":"湿度","panel.wind":"风速","panel.gusts":"阵风","panel.pressure":"气压","panel.clouds":"云量","panel.precipitation":"降水","panel.uv":"紫外线","panel.sunrise":"日出","panel.sunset":"日落","panel.hourly":"未来 24 小时","panel.daily":"7 天预报","panel.indices":"生活指数","panel.updated":"更新于","panel.refresh":"刷新","panel.refreshing":"刷新中","panel.loading":"正在获取天气…","panel.loadFailed":"天气获取失败","panel.retry":"重试","panel.offline":"网络不可用，请检查连接。","panel.cities":"城市","panel.citiesEmpty":"还没有保存的城市，先搜索并添加一个。","panel.addCity":"添加城市","panel.removeCity":"移除城市","panel.setDefault":"设为默认","panel.defaultBadge":"默认","panel.today":"今天","panel.tomorrow":"明天","panel.settings":"显示设置","panel.units":"单位","panel.unitsMetric":"摄氏度 °C","panel.unitsImperial":"华氏度 °F","panel.now":"现在","panel.noData":"暂无数据","panel.about":"天气插件 {build}","panel.index.uv.name":"紫外线","panel.index.precipitation.name":"降水","panel.index.wind.name":"风力","panel.index.daylight.name":"日照","panel.index.uv.0":"紫外线较弱，无需特别防护。","panel.index.uv.1":"紫外线中等，外出建议防晒。","panel.index.uv.2":"紫外线较强，请做好防晒。","panel.index.uv.3":"紫外线极强，尽量避免长时间暴晒。","panel.index.precipitation.0":"降水概率低，无需带伞。","panel.index.precipitation.1":"可能有降水，建议带伞。","panel.index.precipitation.2":"降水概率较高，记得带伞。","panel.index.precipitation.3":"降水概率很高，务必带伞。","panel.index.wind.0":"风力温和，适合外出。","panel.index.wind.1":"风力较大，注意防风。","panel.index.wind.2":"风力强，减少户外活动。","panel.index.wind.3":"风力很强，注意安全。","panel.index.daylight.0":"日照很短，注意保暖。","panel.index.daylight.1":"日照偏短。","panel.index.daylight.2":"日照充足。","panel.index.daylight.3":"日照很长，注意防晒。","panel.crash":"天气面板渲染出错，已隔离显示。"},"en":{"panel.title":"Weather","panel.subtitle":"Live conditions, hourly and 7-day forecast","panel.search":"Search city","panel.searchPlaceholder":"City name, postal code, or \"lat,lon\"","panel.searchEmpty":"No matching city. Try another keyword.","panel.searchFailed":"Search failed. Please try again.","panel.searchHint":"Accepts Chinese, English, and postal codes — e.g. \"杭州\", \"Tokyo\", \"310000\".","panel.current":"Current conditions","panel.feelsLike":"Feels like","panel.high":"High","panel.low":"Low","panel.humidity":"Humidity","panel.wind":"Wind","panel.gusts":"Gusts","panel.pressure":"Pressure","panel.clouds":"Cloud cover","panel.precipitation":"Precipitation","panel.uv":"UV index","panel.sunrise":"Sunrise","panel.sunset":"Sunset","panel.hourly":"Next 24 hours","panel.daily":"7-day forecast","panel.indices":"Life indices","panel.updated":"Updated","panel.refresh":"Refresh","panel.refreshing":"Refreshing","panel.loading":"Loading weather…","panel.loadFailed":"Could not load weather","panel.retry":"Retry","panel.offline":"Network unavailable. Check your connection.","panel.cities":"Cities","panel.citiesEmpty":"No saved cities yet — search for one to add it.","panel.addCity":"Add city","panel.removeCity":"Remove city","panel.setDefault":"Make default","panel.defaultBadge":"Default","panel.today":"Today","panel.tomorrow":"Tomorrow","panel.settings":"Display settings","panel.units":"Units","panel.unitsMetric":"Celsius °C","panel.unitsImperial":"Fahrenheit °F","panel.now":"Now","panel.noData":"No data","panel.about":"Weather plugin {build}","panel.index.uv.name":"UV index","panel.index.precipitation.name":"Precipitation","panel.index.wind.name":"Wind","panel.index.daylight.name":"Daylight","panel.index.uv.0":"UV is low; no special protection needed.","panel.index.uv.1":"UV is moderate; consider sun protection.","panel.index.uv.2":"UV is high; protect yourself outdoors.","panel.index.uv.3":"UV is extreme; avoid prolonged exposure.","panel.index.precipitation.0":"Rain is unlikely; no umbrella needed.","panel.index.precipitation.1":"Some precipitation is possible; take an umbrella.","panel.index.precipitation.2":"Rain is likely; remember an umbrella.","panel.index.precipitation.3":"Rain is very likely; definitely take an umbrella.","panel.index.wind.0":"Winds are gentle; good for going out.","panel.index.wind.1":"Winds are picking up; mind the gusts.","panel.index.wind.2":"Strong winds; limit outdoor activity.","panel.index.wind.3":"Very strong winds; take care.","panel.index.daylight.0":"Very little daylight; keep warm.","panel.index.daylight.1":"Daylight is on the short side.","panel.index.daylight.2":"Plenty of daylight.","panel.index.daylight.3":"A very long day; watch the sun.","panel.crash":"The weather panel failed to render and was isolated."}}

    const LOCALE_NAMESPACE = 'weather'

    /**
     * Resolve the active language id from the locale service snapshot.
     * @param locale - `ctx.locale`, possibly unavailable on an older host.
     * @returns `'zh'` or `'en'`.
     */
    function readLanguage(locale) {
      try {
        const active = locale?.getSnapshot?.().active
        if (typeof active === 'string' && active.toLowerCase().startsWith('zh')) return 'zh'
      } catch {
        /* Fall through to English; a locale read must never break the panel. */
      }
      return 'en'
    }

    /**
     * Subscribe to locale changes.
     * @param locale - `ctx.locale`.
     * @param onChange - called with the new language id when it changes.
     * @returns an unsubscribe function.
     */
    function observeLanguage(locale, onChange) {
      let alive = true
      let previous = readLanguage(locale)
      const publish = () => {
        if (!alive) return
        const next = readLanguage(locale)
        if (next === previous) return
        previous = next
        onChange(next)
      }
      let unsubscribe = () => {}
      try {
        unsubscribe = locale?.subscribe?.(publish) ?? (() => {})
      } catch {
        /* An unsupported locale face keeps the initial language. */
      }
      return () => {
        alive = false
        unsubscribe()
      }
    }

    /**
     * Build a translator over the inlined dictionaries.
     * @param language - `'zh'` or `'en'`.
     * @returns a `(key, values?) => string` function with `{ }` placeholder support.
     */
    function translator(language) {
      const table = MESSAGES[language] ?? MESSAGES.en
      const fallback = MESSAGES.en
      return (key, values) => {
        let text = table[key] ?? fallback[key] ?? key
        if (values !== undefined) {
          for (const [name, value] of Object.entries(values)) text = text.split(`{${name}}`).join(String(value))
        }
        return text
      }
    }

    /* ---------------------------------------------------------------- persistence */

    const STORAGE_KEY = 'dsh-plugin-weather/v1'

    /** First-run cities, so the panel is never empty on a fresh profile. */
    const DEFAULT_CITIES = [
      { id: '1808926', name: '杭州', label: '杭州 · 浙江 · 中国', latitude: 30.29365, longitude: 120.16142, timezone: 'Asia/Shanghai' },
      { id: '1816670', name: '北京', label: '北京 · 中国', latitude: 39.9075, longitude: 116.39723, timezone: 'Asia/Shanghai' },
    ]

    /**
     * Read the persisted panel state.
     *
     * Storage is best-effort: a disabled or full `localStorage` must degrade to
     * in-memory defaults rather than throwing during render.
     *
     * @returns `{ cities, selectedId, units }` with every field validated.
     */
    function readState() {
      const fallback = { cities: DEFAULT_CITIES.slice(), selectedId: DEFAULT_CITIES[0].id, units: 'metric' }
      let raw
      try {
        raw = window.localStorage?.getItem(STORAGE_KEY)
      } catch {
        return fallback
      }
      if (typeof raw !== 'string' || raw === '') return fallback
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch {
        return fallback
      }
      const cities = Array.isArray(parsed?.cities)
        ? parsed.cities
            .filter(
              row =>
                row !== null &&
                typeof row === 'object' &&
                Number.isFinite(Number(row.latitude)) &&
                Number.isFinite(Number(row.longitude)),
            )
            .map(row => ({
              id: String(row.id ?? `${row.latitude},${row.longitude}`),
              name: typeof row.name === 'string' && row.name !== '' ? row.name : `${row.latitude},${row.longitude}`,
              label: typeof row.label === 'string' && row.label !== '' ? row.label : String(row.name ?? ''),
              latitude: Number(row.latitude),
              longitude: Number(row.longitude),
              timezone: typeof row.timezone === 'string' ? row.timezone : undefined,
            }))
        : []
      const list = cities.length > 0 ? cities : DEFAULT_CITIES.slice()
      const selectedId = list.some(row => row.id === parsed?.selectedId) ? parsed.selectedId : list[0].id
      return { cities: list, selectedId, units: parsed?.units === 'imperial' ? 'imperial' : 'metric' }
    }

    /**
     * Persist the panel state, ignoring storage failures.
     * @param state - the full state object.
     */
    function writeState(state) {
      try {
        window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state))
      } catch {
        /* A read-only storage keeps the session in memory only. */
      }
    }

    /* ------------------------------------------------------------------ formatting */

    /**
     * Format a temperature with its unit label.
     * @param value - degrees, possibly missing.
     * @param label - `°C` or `°F`.
     * @returns a display string.
     */
    function formatTemperature(value, label) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '–'
      return `${Math.round(value)}${label}`
    }

    /**
     * Format a wind speed with its unit.
     * @param value - speed in the active unit system.
     * @param units - `'metric'` or `'imperial'`.
     * @returns a display string.
     */
    function formatWind(value, units) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '–'
      return `${Math.round(value)} ${units === 'imperial' ? 'mph' : 'km/h'}`
    }

    /**
     * Format an accumulated precipitation depth.
     * @param value - depth in the active unit system.
     * @param units - `'metric'` or `'imperial'`.
     * @returns a display string.
     */
    function formatPrecipitation(value, units) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '–'
      const rounded = Math.round(value * 10) / 10
      return `${rounded} ${units === 'imperial' ? 'in' : 'mm'}`
    }

    /**
     * Extract the `HH:MM` part of an Open-Meteo local timestamp.
     * @param value - an ISO-like local string, or undefined.
     * @returns the clock text, or an em dash.
     */
    function formatClock(value) {
      if (typeof value !== 'string' || value.length < 16) return '–'
      return value.slice(11, 16)
    }

    /**
     * Parse the `YYYY-MM-DD` part of a local timestamp as a UTC date.
     *
     * The panel must not re-interpret the provider's local date in the viewer's
     * timezone, so the date is anchored at UTC noon and only read back through
     * UTC getters.
     *
     * @param value - a local timestamp string.
     * @returns a `Date`, or `undefined` when unparseable.
     */
    function localDate(value) {
      if (typeof value !== 'string' || value.length < 10) return undefined
      const parts = value.slice(0, 10).split('-')
      if (parts.length !== 3) return undefined
      const [year, month, day] = parts.map(Number)
      if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return undefined
      return new Date(Date.UTC(year, month - 1, day, 12))
    }

    /**
     * Weekday label for one forecast date.
     * @param value - the local date string.
     * @param language - `'zh'` or `'en'`.
     * @param index - the day's position in the list, used for today/tomorrow.
     * @param t - translator.
     * @returns a short weekday label.
     */
    function formatDay(value, language, index, t) {
      if (index === 0) return t('panel.today')
      if (index === 1) return t('panel.tomorrow')
      const date = localDate(value)
      if (date === undefined) return value
      const formatter = new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', { weekday: 'short', timeZone: 'UTC' })
      return formatter.format(date)
    }

    /**
     * `M/D` label for one forecast date.
     * @param value - the local date string.
     * @returns a short date label.
     */
    function formatMonthDay(value) {
      const date = localDate(value)
      if (date === undefined) return ''
      return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`
    }

    /**
     * Localized condition text for a WMO code.
     * @param code - the WMO code.
     * @param language - `'zh'` or `'en'`.
     * @returns the condition text.
     */
    function conditionText(code, language) {
      const info = weatherCodeInfo(code)
      return language === 'zh' ? info.zh : info.en
    }

    /* -------------------------------------------------------------------- styles */

    // One <style> node per plugin, matching the shipped plugins' convention so the
    // client module system can remove owned styles on unload. Class names carry a
    // `dshw-` prefix because they land in the global document.
    const STYLE_ID = PACKAGE_NAME + '/panel.css'

    const CSS = `
.dshw-root{height:100%;overflow-y:auto;overflow-x:hidden;padding:calc(var(--dsh-frame-top-clearance,0px) + 16px) 20px 32px;box-sizing:border-box;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.dshw-shell{max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.dshw-head{display:flex;align-items:flex-start;gap:12px}
.dshw-head-text{flex:1;min-width:0}
.dshw-title{margin:0;font-size:16px;font-weight:600;line-height:22px}
.dshw-subtitle{margin:2px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dshw-icon-button{display:grid;place-items:center;flex:none;width:32px;height:32px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshw-icon-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshw-icon-button:disabled{opacity:.5;cursor:default}
.dshw-icon-button:focus-visible,.dshw-chip:focus-visible,.dshw-result:focus-visible,.dshw-segment:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dshw-card{border-radius:16px;background:var(--dsw-alias-bg-module-platform);box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2);padding:16px}
.dshw-search{position:relative}
.dshw-search-field{display:flex;align-items:center;gap:8px;height:38px;padding:0 12px;border-radius:12px;background:var(--dsw-alias-bg-module-platform);box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2)}
.dshw-search-field:focus-within{box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary)}
.dshw-search-field svg{flex:none;color:var(--dsw-alias-label-tertiary)}
.dshw-search input{flex:1;min-width:0;border:0;background:transparent;color:inherit;font:inherit;font-size:13px;outline:none}
.dshw-search input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dshw-results{margin-top:8px;border-radius:12px;background:var(--dsw-alias-bg-module-platform);box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2),0 8px 24px #00000014;overflow:hidden}
.dshw-result{display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px;border:0;background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer}
.dshw-result:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshw-result-main{flex:1;min-width:0}
.dshw-result-name{display:block;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshw-result-meta{display:block;margin-top:1px;font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshw-note{padding:10px 12px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dshw-chips{display:flex;flex-wrap:wrap;gap:8px}
.dshw-chip{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border:0;border-radius:15px;background:var(--dsw-alias-bg-module-platform);box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.dshw-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshw-chip[data-active=true]{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);box-shadow:none}
.dshw-chip-temp{font-variant-numeric:tabular-nums;opacity:.8}
.dshw-hero{display:flex;align-items:center;gap:16px}
.dshw-hero-glyph{flex:none;display:grid;place-items:center;width:76px;height:76px;border-radius:50%;background:var(--dsw-alias-interactive-bg-hover);font-size:38px;line-height:1}
.dshw-hero-main{flex:1;min-width:0}
.dshw-hero-temp{font-size:44px;font-weight:300;line-height:1.05;font-variant-numeric:tabular-nums}
.dshw-hero-temp span{font-size:22px;font-weight:400;vertical-align:top;color:var(--dsw-alias-label-secondary)}
.dshw-hero-cond{margin-top:2px;font-size:14px}
.dshw-hero-where{margin-top:2px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dshw-hero-range{flex:none;text-align:right;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.dshw-hero-range b{display:block;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dshw-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:10px;margin-top:16px}
.dshw-metric{padding:9px 11px;border-radius:12px;background:var(--dsw-alias-interactive-bg-hover)}
.dshw-metric-label{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dshw-metric-value{margin-top:2px;font-size:14px;font-variant-numeric:tabular-nums}
.dshw-section-title{margin:0 0 10px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dshw-hourly-scroll{overflow-x:auto;padding-bottom:4px}
.dshw-hourly{display:flex;gap:2px;min-width:min-content}
.dshw-hour{flex:none;width:52px;text-align:center;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshw-hour-time{font-variant-numeric:tabular-nums}
.dshw-hour-glyph{margin:6px 0;font-size:19px;line-height:1}
.dshw-hour-temp{font-size:13px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
.dshw-hour-pop{margin-top:2px;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.dshw-spark{display:block;width:100%;height:56px;overflow:visible}
.dshw-spark path{fill:none;stroke:var(--dsw-alias-brand-primary);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.dshw-spark circle{fill:var(--dsw-alias-brand-primary)}
.dshw-days{display:flex;flex-direction:column}
.dshw-day{display:flex;align-items:center;gap:10px;padding:7px 0;font-size:13px}
.dshw-day + .dshw-day{box-shadow:inset 0 .5px 0 var(--dsw-alias-border-l1)}
.dshw-day-name{flex:none;width:64px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshw-day-date{flex:none;width:44px;font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dshw-day-glyph{flex:none;width:24px;text-align:center;font-size:17px;line-height:1}
.dshw-day-pop{flex:none;width:36px;font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dshw-day-cond{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshw-day-range{flex:none;display:flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums}
.dshw-day-bar{position:relative;width:64px;height:4px;border-radius:2px;background:var(--dsw-alias-interactive-bg-active)}
.dshw-day-bar i{position:absolute;top:0;bottom:0;border-radius:2px;background:var(--dsw-alias-brand-primary)}
.dshw-day-min{width:34px;text-align:right;color:var(--dsw-alias-label-secondary)}
.dshw-day-max{width:34px;text-align:right}
.dshw-indices{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.dshw-index{display:flex;flex-direction:column;gap:6px}
.dshw-index-head{display:flex;align-items:baseline;gap:8px;font-size:12px}
.dshw-index-name{color:var(--dsw-alias-label-secondary)}
.dshw-index-value{margin-left:auto;font-variant-numeric:tabular-nums}
.dshw-index-bar{display:flex;gap:3px}
.dshw-index-bar i{flex:1;height:4px;border-radius:2px;background:var(--dsw-alias-interactive-bg-active)}
.dshw-index-bar i[data-on=true]{background:var(--dsw-alias-brand-primary)}
.dshw-index-advice{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.dshw-state{display:flex;flex-direction:column;align-items:center;gap:10px;padding:36px 16px;text-align:center;font-size:13px;color:var(--dsw-alias-label-secondary)}
.dshw-state-error{color:var(--dsw-alias-label-primary)}
.dshw-button{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;border:0;border-radius:16px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);font:inherit;font-size:12px;cursor:pointer}
.dshw-button:hover{opacity:.9}
.dshw-settings{display:flex;align-items:center;gap:12px;font-size:13px}
.dshw-settings-label{flex:1}
.dshw-segments{display:inline-flex;gap:2px;padding:2px;border-radius:12px;background:var(--dsw-alias-interactive-bg-hover)}
.dshw-segment{height:26px;padding:0 12px;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.dshw-segment[data-active=true]{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);box-shadow:0 1px 3px #0000001a}
.dshw-spin{animation:dshw-spin 1s linear infinite}
@keyframes dshw-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.dshw-spin{animation:none}}
`

    /**
     * Inject this plugin's stylesheet once per document.
     *
     * DSH's client module system removes styles tagged with `data-plugin` when the
     * plugin unloads, so the node is tagged exactly like the shipped plugins.
     */
    function ensureStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`) !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = PACKAGE_NAME
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    /* ------------------------------------------------------------------ components */

    const { useState, useEffect, useMemo, useRef, useCallback, Component } = React

    /**
     * Sidebar glyph: the small weather mark in the rail.
     *
     * Registered into `sidebar.panellist`, which is rendered once per panel row and
     * once for the selected row's title, so it must stay cheap and stateless.
     *
     * @param props - `{ size, active }` supplied by the sidebar.
     * @returns the glyph element.
     */
    function WeatherPanelGlyph(props) {
      const size = typeof props?.size === 'number' ? props.size : 16
      const glyph = props?.active === true ? '🌤️' : '☀️'
      return jsx('span', {
        className: 'dshw-glyph',
        'aria-hidden': 'true',
        style: { fontSize: size, lineHeight: 1, display: 'block' },
        children: glyph,
      })
    }

    /**
     * One metric tile.
     * @param props - `{ label, value }`.
     * @returns the tile element.
     */
    function Metric({ label, value }) {
      return jsxs('div', {
        className: 'dshw-metric',
        children: [
          jsx('div', { className: 'dshw-metric-label', children: label }),
          jsx('div', { className: 'dshw-metric-value', children: value }),
        ],
      })
    }

    /**
     * Temperature sparkline for the hourly window.
     *
     * The polyline is drawn in a fixed viewBox scaled to fill the card width, with
     * `vector-effect: non-scaling-stroke` keeping the line 1.5px regardless of that
     * scale. A degenerate (flat) series returns `null` so the caller renders
     * nothing rather than dividing by zero.
     *
     * @param props - `{ rows }`, already sliced to the visible window.
     * @returns the SVG element, or `null`.
     */
    function Sparkline({ rows }) {
      const geometry = useMemo(() => {
        const { min, max, span } = temperatureWindow(rows)
        if (span === null || min === undefined || max === undefined) return null
        const width = 240
        const height = 56
        const inset = 6
        const step = rows.length > 1 ? width / (rows.length - 1) : width
        const points = rows.map((row, index) => {
          const value = typeof row.temperature === 'number' ? row.temperature : min
          const x = index * step
          const y = height - inset - ((value - min) / span) * (height - inset * 2)
          return { x, y, value }
        })
        const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
        let peak = points[0]
        for (const point of points) if (point.value > peak.value) peak = point
        return { points, line, peak, width, height }
      }, [rows])

      if (geometry === null) return null
      return jsxs('svg', {
        className: 'dshw-spark',
        viewBox: `0 0 ${geometry.width} ${geometry.height}`,
        preserveAspectRatio: 'none',
        role: 'img',
        'aria-hidden': 'true',
        children: [
          jsx('path', { d: geometry.line }),
          jsx('circle', { cx: geometry.peak.x.toFixed(2), cy: geometry.peak.y.toFixed(2), r: 2.5 }),
        ],
      })
    }

    /**
     * The hourly strip: glyph, temperature, and precipitation chance per hour.
     * @param props - `{ rows, language, t, units }`.
     * @returns the section element.
     */
    function HourlyStrip({ rows, language, t, units }) {
      const visible = rows.slice(0, 24)
      if (visible.length === 0) return null
      return jsxs('section', {
        className: 'dshw-card',
        children: [
          jsx('h3', { className: 'dshw-section-title', children: t('panel.hourly') }),
          jsx(Sparkline, { rows: visible }),
          jsx('div', {
            className: 'dshw-hourly-scroll',
            children: jsx('div', {
              className: 'dshw-hourly',
              children: visible.map((row, index) =>
                jsxs(
                  'div',
                  {
                    className: 'dshw-hour',
                    children: [
                      jsx('div', { className: 'dshw-hour-time', children: index === 0 ? t('panel.now') : formatClock(row.time) }),
                      jsx('div', { className: 'dshw-hour-glyph', children: weatherGlyph(row.weatherCode, row.isDay) }),
                      jsx('div', { className: 'dshw-hour-temp', children: formatTemperature(row.temperature, '°') }),
                      jsx('div', {
                        className: 'dshw-hour-pop',
                        children:
                          typeof row.precipitationProbability === 'number' ? `${Math.round(row.precipitationProbability)}%` : '\u00a0',
                      }),
                    ],
                  },
                  row.time,
                ),
              ),
            }),
          }),
        ],
      })
    }

    /**
     * The 7-day list with per-day temperature range bars.
     * @param props - `{ rows, language, t, units, unitLabel }`.
     * @returns the section element.
     */
    function DailyList({ rows, language, t, units, unitLabel }) {
      const window_ = useMemo(() => {
        const minimums = rows.map(row => row.temperatureMin).filter(value => typeof value === 'number')
        const maximums = rows.map(row => row.temperatureMax).filter(value => typeof value === 'number')
        if (minimums.length === 0 || maximums.length === 0) return null
        const min = Math.min(...minimums)
        const max = Math.max(...maximums)
        return { min, span: max === min ? null : max - min }
      }, [rows])

      if (rows.length === 0) return null
      return jsxs('section', {
        className: 'dshw-card',
        children: [
          jsx('h3', { className: 'dshw-section-title', children: t('panel.daily') }),
          jsx('div', {
            className: 'dshw-days',
            children: rows.map((row, index) => {
              let bar = null
              if (window_ !== null && window_.span !== null) {
                const start = ((row.temperatureMin - window_.min) / window_.span) * 100
                const width = ((row.temperatureMax - row.temperatureMin) / window_.span) * 100
                bar = jsx('span', {
                  className: 'dshw-day-bar',
                  children: jsx('i', { style: { left: `${start}%`, width: `${Math.max(width, 4)}%` } }),
                })
              }
              return jsxs(
                'div',
                {
                  className: 'dshw-day',
                  children: [
                    jsx('span', { className: 'dshw-day-name', children: formatDay(row.date, language, index, t) }),
                    jsx('span', { className: 'dshw-day-date', children: formatMonthDay(row.date) }),
                    jsx('span', { className: 'dshw-day-glyph', children: weatherGlyph(row.weatherCode, true) }),
                    jsx('span', {
                      className: 'dshw-day-pop',
                      children: typeof row.precipitationProbabilityMax === 'number' ? `${Math.round(row.precipitationProbabilityMax)}%` : '',
                    }),
                    jsx('span', { className: 'dshw-day-cond', children: conditionText(row.weatherCode, language) }),
                    jsxs('span', {
                      className: 'dshw-day-range',
                      children: [
                        jsx('span', { className: 'dshw-day-min', children: formatTemperature(row.temperatureMin, unitLabel) }),
                        bar,
                        jsx('span', { className: 'dshw-day-max', children: formatTemperature(row.temperatureMax, unitLabel) }),
                      ],
                    }),
                  ],
                },
                row.date,
              )
            }),
          }),
        ],
      })
    }

    /**
     * Derived life indices for the selected day.
     *
     * Each row renders the provider value plus a 3-segment severity bar and a
     * localized advice line chosen by the indicator's severity bucket.
     *
     * @param props - `{ indices, units, t, language }`.
     * @returns the section element, or `null` when the provider returned nothing.
     */
    function LifeIndices({ indices, units, t }) {
      if (!Array.isArray(indices) || indices.length === 0) return null
      return jsxs('section', {
        className: 'dshw-card',
        children: [
          jsx('h3', { className: 'dshw-section-title', children: t('panel.indices') }),
          jsx('div', {
            className: 'dshw-indices',
            children: indices.map(row => {
              let value
              if (row.key === 'daylight') {
                const hours = Math.floor(row.value / 3600)
                const minutes = Math.round((row.value % 3600) / 60)
                value = `${hours}h ${minutes}m`
              } else if (row.key === 'uv') {
                value = String(Math.round(row.value * 10) / 10)
              } else if (row.key === 'wind') {
                value = formatWind(row.value, units)
              } else {
                value = `${Math.round(row.value)}%`
              }
              const severity = Math.min(Math.max(row.level, 0), 3)
              return jsxs(
                'div',
                {
                  className: 'dshw-index',
                  children: [
                    jsxs('div', {
                      className: 'dshw-index-head',
                      children: [
                        jsx('span', { className: 'dshw-index-name', children: t(`panel.index.${row.key}.name`) }),
                        jsx('span', { className: 'dshw-index-value', children: value }),
                      ],
                    }),
                    jsx('div', {
                      className: 'dshw-index-bar',
                      children: [0, 1, 2].map(segment => jsx('i', { 'data-on': segment < severity ? 'true' : 'false' }, segment)),
                    }),
                    jsx('div', { className: 'dshw-index-advice', children: t(`panel.index.${row.key}.${severity}`) }),
                  ],
                },
                row.key,
              )
            }),
          }),
        ],
      })
    }

    /**
     * City search box with an inline result list.
     *
     * Results carry an add/remove toggle so the same list serves both "switch city"
     * and "manage favourites". Selecting a result also switches to it, because that
     * is nearly always the intent after a search.
     *
     * @param props - the component's props.
     * @returns the search element.
     */
    function CitySearch({ t, language, cities, onAdd, onRemove, onSelect, addSignal }) {
      const [query, setQuery] = useState('')
      const [results, setResults] = useState([])
      const [status, setStatus] = useState('idle')
      const [focused, setFocused] = useState(false)
      const requestId = useRef(0)

      // Debounced search. The effect owns its AbortController so an in-flight
      // request is cancelled when the query changes or the panel unmounts.
      useEffect(() => {
        const text = query.trim()
        if (text.length < 1) {
          setResults([])
          setStatus('idle')
          return undefined
        }
        const controller = new AbortController()
        const id = requestId.current + 1
        requestId.current = id
        setStatus('loading')
        const timer = window.setTimeout(() => {
          searchLocations(text, { language, count: 6, signal: controller.signal })
            .then(rows => {
              if (requestId.current !== id || controller.signal.aborted) return
              setResults(rows)
              setStatus(rows.length === 0 ? 'empty' : 'done')
            })
            .catch(() => {
              if (requestId.current !== id || controller.signal.aborted) return
              setResults([])
              setStatus('failed')
            })
        }, 280)
        return () => {
          controller.abort()
          window.clearTimeout(timer)
        }
      }, [query, language, addSignal])

      const savedIds = useMemo(() => new Set(cities.map(city => city.id)), [cities])
      const open = focused && query.trim() !== ''

      return jsxs('div', {
        className: 'dshw-search',
        children: [
          jsxs('div', {
            className: 'dshw-search-field',
            children: [
              jsx(IconSearchOutlineRegular, { size: 15 }),
              jsx('input', {
                type: 'text',
                value: query,
                placeholder: t('panel.searchPlaceholder'),
                'aria-label': t('panel.search'),
                onChange: event => setQuery(event.target.value),
                onFocus: () => setFocused(true),
                onBlur: () => window.setTimeout(() => setFocused(false), 150),
                onKeyDown: event => {
                  if (event.key !== 'Escape') return
                  setQuery('')
                  setResults([])
                },
              }),
              query === '' ? null : jsx('button', {
                type: 'button',
                className: 'dshw-icon-button',
                style: { width: 22, height: 22 },
                'aria-label': t('panel.search'),
                onClick: () => {
                  setQuery('')
                  setResults([])
                },
                children: jsx(IconCloseOutlineRegular, { size: 12 }),
              }),
            ],
          }),
          !open
            ? null
            : jsx('div', {
                className: 'dshw-results',
                children:
                  status === 'failed'
                    ? jsx('div', { className: 'dshw-note', children: t('panel.searchFailed') })
                    : status === 'empty'
                      ? jsx('div', { className: 'dshw-note', children: t('panel.searchEmpty') })
                      : status === 'loading' && results.length === 0
                        ? jsx('div', { className: 'dshw-note', children: t('panel.loading') })
                        : results.map(row => {
                            const saved = savedIds.has(row.id)
                            return jsxs(
                              'div',
                              {
                                className: 'dshw-result',
                                role: 'button',
                                tabIndex: 0,
                                onClick: () => {
                                  if (!saved) onAdd(row)
                                  onSelect(row.id)
                                  setQuery('')
                                  setResults([])
                                },
                                onKeyDown: event => {
                                  if (event.key !== 'Enter' && event.key !== ' ') return
                                  event.preventDefault()
                                  if (!saved) onAdd(row)
                                  onSelect(row.id)
                                  setQuery('')
                                  setResults([])
                                },
                                children: [
                                  jsxs('span', {
                                    className: 'dshw-result-main',
                                    children: [
                                      jsx('span', { className: 'dshw-result-name', children: row.name }),
                                      jsx('span', { className: 'dshw-result-meta', children: row.label }),
                                    ],
                                  }),
                                  jsx('button', {
                                    type: 'button',
                                    className: 'dshw-icon-button',
                                    style: { width: 26, height: 26 },
                                    'aria-label': saved ? t('panel.removeCity') : t('panel.addCity'),
                                    onClick: event => {
                                      event.stopPropagation()
                                      if (saved) onRemove(row.id)
                                      else onAdd(row)
                                    },
                                    children: saved ? jsx(IconTrashOutlineRegular, { size: 13 }) : jsx(IconPlusOutlineRegular, { size: 13 }),
                                  }),
                                ],
                              },
                              `${row.id}:${saved}`,
                            )
                          }),
              }),
        ],
      })
    }

    /**
     * Error boundary wrapping the panel.
     *
     * A slot occupant's crash is contained by the renderer, but a contained crash
     * still blanks the panel. Catching here keeps the message readable and leaves
     * the sidebar entry usable.
     */
    class PanelBoundary extends Component {
      /** @param props - React props. */
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      /**
       * Switch to the fallback view after a descendant throws.
       * @returns the next state.
       */
      static getDerivedStateFromError() {
        return { failed: true }
      }

      /**
       * Render children, or the isolated-failure notice.
       * @returns the element tree.
       */
      render() {
        if (!this.state.failed) return this.props.children
        return jsxs('div', {
          className: 'dshw-root',
          children: jsxs('div', {
            className: 'dshw-shell',
            children: [
              jsx('div', {
                className: 'dshw-card dshw-state dshw-state-error',
                children: [
                  jsx(IconWarningOutlineRegular, { size: 18 }),
                  jsx('div', { children: this.props.message }),
                ],
              }),
              jsx('button', {
                type: 'button',
                className: 'dshw-button',
                onClick: () => this.setState({ failed: false }),
                children: this.props.retryLabel,
              }),
            ],
          }),
        })
      }
    }

    /**
     * The weather panel body.
     *
     * Owns the persisted city list, the selected city, the unit preference, and two
     * independent fetches: the selected city's full forecast and the one-request
     * summary strip for every saved city. Both carry abort controllers so a rapid
     * city switch cannot let a stale response win.
     *
     * @param props - `{ ctx, language, t }`, assembled by the plugin body.
     * @returns the panel element.
     */
    function WeatherPanel({ ctx, language, t }) {
      const initial = useMemo(readState, [])
      const [cities, setCities] = useState(initial.cities)
      const [selectedId, setSelectedId] = useState(initial.selectedId)
      const [units, setUnits] = useState(initial.units)
      const [forecast, setForecast] = useState(null)
      const [summaries, setSummaries] = useState({})
      const [state, setState] = useState('loading')
      const [error, setError] = useState('')
      const [reloadToken, setReloadToken] = useState(0)
      const [summaryToken, setSummaryToken] = useState(0)

      const selected = useMemo(() => cities.find(city => city.id === selectedId) ?? cities[0], [cities, selectedId])

      // Persist every state change. Storage failures are swallowed by writeState.
      useEffect(() => {
        writeState({ cities, selectedId, units })
      }, [cities, selectedId, units])

      // Full forecast for the selected city.
      useEffect(() => {
        if (selected === undefined) return undefined
        const controller = new AbortController()
        setState('loading')
        setError('')
        fetchForecast(selected, { units, days: 7, signal: controller.signal })
          .then(bundle => {
            if (controller.signal.aborted) return
            setForecast(bundle)
            setState('ready')
          })
          .catch(cause => {
            if (controller.signal.aborted) return
            setError(cause instanceof Error ? cause.message : String(cause))
            setState('failed')
          })
        return () => controller.abort()
      }, [selected, units, reloadToken])

      // One multi-location request backs every chip's current temperature.
      useEffect(() => {
        if (cities.length === 0) {
          setSummaries({})
          return undefined
        }
        const controller = new AbortController()
        fetchSummaries(cities, { units, signal: controller.signal })
          .then(rows => {
            if (controller.signal.aborted) return
            const next = {}
            for (const row of rows) if (row.id !== undefined) next[row.id] = row
            setSummaries(next)
          })
          .catch(() => {
            /* The strip is decorative; a failure leaves the previous values. */
          })
        return () => controller.abort()
      }, [cities, units, summaryToken])

      const addCity = useCallback(location => {
        setCities(previous =>
          previous.some(city => city.id === location.id)
            ? previous
            : previous.concat([
                {
                  id: location.id,
                  name: location.name,
                  label: location.label,
                  latitude: location.latitude,
                  longitude: location.longitude,
                  timezone: location.timezone,
                },
              ]),
        )
        setSummaryToken(token => token + 1)
      }, [])

      const removeCity = useCallback(
        id => {
          setCities(previous => {
            if (previous.length <= 1) return previous
            const next = previous.filter(city => city.id !== id)
            if (id === selectedId) setSelectedId(next[0].id)
            return next
          })
          setSummaryToken(token => token + 1)
        },
        [selectedId],
      )

      const today = forecast?.daily?.[0]
      const current = forecast?.current
      const unitLabel = forecast?.unitLabels?.label ?? (units === 'imperial' ? '°F' : '°C')
      const hourly = useMemo(() => (forecast === null ? [] : upcomingHours(forecast, 24)), [forecast])

      return jsxs('div', {
        className: 'dshw-root',
        children: jsxs('div', {
          className: 'dshw-shell',
          children: [
            jsxs('header', {
              className: 'dshw-head',
              children: [
                jsxs('div', {
                  className: 'dshw-head-text',
                  children: [
                    jsx('h1', { className: 'dshw-title', children: t('panel.title') }),
                    jsx('p', { className: 'dshw-subtitle', children: t('panel.subtitle') }),
                  ],
                }),
                jsx('button', {
                  type: 'button',
                  className: 'dshw-icon-button',
                  title: state === 'loading' ? t('panel.refreshing') : t('panel.refresh'),
                  'aria-label': state === 'loading' ? t('panel.refreshing') : t('panel.refresh'),
                  disabled: state === 'loading',
                  onClick: () => setReloadToken(token => token + 1),
                  children: jsx(IconRefreshOutlineRegular, { size: 16, className: state === 'loading' ? 'dshw-spin' : undefined }),
                }),
              ],
            }),

            jsx(CitySearch, {
              t,
              language,
              cities,
              onAdd: addCity,
              onRemove: removeCity,
              onSelect: setSelectedId,
              addSignal: summaryToken,
            }),

            cities.length === 0
              ? null
              : jsx('div', {
                  className: 'dshw-chips',
                  role: 'tablist',
                  'aria-label': t('panel.cities'),
                  children: cities.map(city => {
                    const summary = summaries[city.id]
                    return jsxs(
                      'button',
                      {
                        type: 'button',
                        role: 'tab',
                        className: 'dshw-chip',
                        'data-active': city.id === selectedId ? 'true' : 'false',
                        'aria-selected': city.id === selectedId ? 'true' : 'false',
                        onClick: () => setSelectedId(city.id),
                        onContextMenu: event => {
                          event.preventDefault()
                          removeCity(city.id)
                        },
                        title: `${city.label} — ${t('panel.removeCity')}: ${t('panel.removeCity')}`,
                        children: [
                          jsx('span', { children: city.name }),
                          summary === undefined
                            ? null
                            : jsxs(Fragment, {
                                children: [
                                  jsx('span', {
                                    className: 'dshw-chip-temp',
                                    children: formatTemperature(summary.temperature, '°'),
                                  }),
                                  jsx('span', { 'aria-hidden': 'true', children: weatherGlyph(summary.weatherCode, summary.isDay) }),
                                ],
                              }),
                        ],
                      },
                      city.id,
                    )
                  }),
                }),

            state === 'loading' && forecast === null
              ? jsxs('div', {
                  className: 'dshw-card dshw-state',
                  children: [jsx(IconRefreshOutlineRegular, { size: 18, className: 'dshw-spin' }), jsx('div', { children: t('panel.loading') })],
                })
              : null,

            state === 'failed'
              ? jsxs('div', {
                  className: 'dshw-card dshw-state dshw-state-error',
                  children: [
                    jsx(IconWarningOutlineRegular, { size: 18 }),
                    jsx('div', { children: error === '' ? t('panel.loadFailed') : error }),
                    jsx('button', {
                      type: 'button',
                      className: 'dshw-button',
                      onClick: () => setReloadToken(token => token + 1),
                      children: t('panel.retry'),
                    }),
                  ],
                })
              : null,

            current === undefined
              ? null
              : jsxs('section', {
                  className: 'dshw-card',
                  children: [
                    jsxs('div', {
                      className: 'dshw-hero',
                      children: [
                        jsx('div', {
                          className: 'dshw-hero-glyph',
                          'aria-hidden': 'true',
                          children: weatherGlyph(current.weatherCode, current.isDay),
                        }),
                        jsxs('div', {
                          className: 'dshw-hero-main',
                          children: [
                            jsxs('div', {
                              className: 'dshw-hero-temp',
                              children: [
                                String(typeof current.temperature === 'number' ? Math.round(current.temperature) : '–'),
                                jsx('span', { children: units === 'imperial' ? '°F' : '°C' }),
                              ],
                            }),
                            jsx('div', { className: 'dshw-hero-cond', children: conditionText(current.weatherCode, language) }),
                            jsx('div', {
                              className: 'dshw-hero-where',
                              children: `${selected?.label ?? ''} · ${formatClock(current.time)}`,
                            }),
                          ],
                        }),
                        jsxs('div', {
                          className: 'dshw-hero-range',
                          children: [
                            jsxs('span', {
                              children: [
                                jsx('b', { children: t('panel.high') }),
                                formatTemperature(today?.temperatureMax, unitLabel),
                              ],
                            }),
                            jsxs('span', {
                              children: [
                                jsx('b', { children: t('panel.low') }),
                                formatTemperature(today?.temperatureMin, unitLabel),
                              ],
                            }),
                          ],
                        }),
                      ],
                    }),
                    jsxs('div', {
                      className: 'dshw-metrics',
                      children: [
                        jsx(Metric, { label: t('panel.feelsLike'), value: formatTemperature(current.apparentTemperature, unitLabel) }),
                        jsx(Metric, {
                          label: t('panel.humidity'),
                          value: typeof current.humidity === 'number' ? `${Math.round(current.humidity)}%` : '–',
                        }),
                        jsx(Metric, {
                          label: t('panel.wind'),
                          value: `${formatWind(current.windSpeed, units)}${compassPoint(current.windDirection) === undefined ? '' : ` ${compassPoint(current.windDirection)}`}`,
                        }),
                        jsx(Metric, { label: t('panel.gusts'), value: formatWind(current.windGusts, units) }),
                        jsx(Metric, {
                          label: t('panel.pressure'),
                          value: typeof current.pressure === 'number' ? `${Math.round(current.pressure)} hPa` : '–',
                        }),
                        jsx(Metric, {
                          label: t('panel.clouds'),
                          value: typeof current.cloudCover === 'number' ? `${Math.round(current.cloudCover)}%` : '–',
                        }),
                        jsx(Metric, { label: t('panel.precipitation'), value: formatPrecipitation(current.precipitation, units) }),
                        jsx(Metric, { label: t('panel.sunrise'), value: formatClock(today?.sunrise) }),
                        jsx(Metric, { label: t('panel.sunset'), value: formatClock(today?.sunset) }),
                      ],
                    }),
                  ],
                }),

            jsx(HourlyStrip, { rows: hourly, language, t, units }),
            jsx(DailyList, { rows: forecast?.daily ?? [], language, t, units, unitLabel }),
            jsx(LifeIndices, { indices: today?.indices ?? [], units, t, language }),

            jsxs('section', {
              className: 'dshw-card dshw-settings',
              children: [
                jsx('span', { className: 'dshw-settings-label', children: t('panel.units') }),
                jsx('span', {
                  className: 'dshw-segments',
                  role: 'group',
                  'aria-label': t('panel.units'),
                  children: [
                    jsx('button', {
                      type: 'button',
                      className: 'dshw-segment',
                      'data-active': units === 'metric' ? 'true' : 'false',
                      'aria-pressed': units === 'metric' ? 'true' : 'false',
                      onClick: () => setUnits('metric'),
                      children: t('panel.unitsMetric'),
                    }),
                    jsx('button', {
                      type: 'button',
                      className: 'dshw-segment',
                      'data-active': units === 'imperial' ? 'true' : 'false',
                      'aria-pressed': units === 'imperial' ? 'true' : 'false',
                      onClick: () => setUnits('imperial'),
                      children: t('panel.unitsImperial'),
                    }),
                  ],
                }),
              ],
            }),

            forecast === null
              ? null
              : jsx('div', {
                  className: 'dshw-note',
                  style: { textAlign: 'center' },
                  children: `${t('panel.updated')} ${formatClock(new Date(forecast.fetchedAt).toISOString())} · Open-Meteo`,
                }),

            // Build stamp. The bundle is rebuilt in place, so "which version is the
            // browser actually running" is otherwise unanswerable from the screen —
            // the label can be right while the bundle behind it is stale. `data-dshw-build`
            // makes that readable from the DOM too.
            jsx('div', {
              className: 'dshw-note',
              'data-dshw-build': PACKAGE_BUILD_STAMP,
              style: { textAlign: 'center', fontSize: 10, opacity: 0.7 },
              children: t('panel.about', { build: PACKAGE_BUILD_STAMP }),
            }),
          ],
        }),
      })
    }

    /* ----------------------------------------------------------------- plugin body */

    /**
     * Required client services.
     *
     * `slots` is the render/slot registry; `locale` supplies the active language and
     * the namespace dictionary. Both are mandatory — without `slots` there is
     * nothing to register into, so letting the fiber wait is correct.
     */
    const inject = ['slots', 'locale']

    /** The panel id shared by the sidebar entry and the `main` keyed slot. */
    const PANEL_ID = 'weather'

    /**
     * Client plugin body.
     *
     * Registers two slot occupants under one fiber: the sidebar entry glyph into the
     * root-scoped `sidebar.panellist` list, and the panel body into the root-scoped
     * `main` keyed slot under {@link PANEL_ID}. The layout's own `selectPanel`
     * resolves that key when the sidebar row is clicked, so the two ids must match.
     *
     * @param ctx - the client context for this plugin's fiber.
     */
    function apply(ctx) {
      ensureStyles()

      // The dictionary is registered with the locale runtime as well as consumed
      // locally, so the strings resolve through DSH like every other plugin's.
      ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, MESSAGES), 'weather: dictionaries')

      const state = { language: readLanguage(ctx.locale) }
      ctx.effect(
        () => observeLanguage(ctx.locale, language => {
          state.language = language
        }),
        'weather: language observer',
      )

      // One stable component identity per registration: the sidebar renders the
      // glyph per row, and the main slot renders the panel, so they cannot share a
      // component even though they share a plugin body.
      function PanelGlyph(props) {
        return jsx(WeatherPanelGlyph, props)
      }

      function PanelBody() {
        // Re-render on language change through a tiny subscription rather than a
        // context, because the slot props carry no locale seat of their own.
        const [language, setLanguage] = useState(state.language)
        useEffect(() => observeLanguage(ctx.locale, setLanguage), [])
        const t = useMemo(() => translator(language), [language])
        return jsx(PanelBoundary, {
          message: t('panel.crash'),
          retryLabel: t('panel.retry'),
          children: jsx(WeatherPanel, { ctx, language, t }),
        })
      }

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            locale: LOCALE_NAMESPACE,
          },
          PanelBody,
        ),
      )

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 20,
            label: () => translator(state.language)('panel.title'),
          },
          PanelGlyph,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.WeatherPanel = WeatherPanel
    exports.WeatherPanelGlyph = WeatherPanelGlyph
    // Exported for the offline test bench in tools/test, which renders the panel
    // body without a browser, checks the translated tree, and diffs the inlined
    // core against the Host's evaluated copy so the two cannot silently diverge.
    exports.translator = translator
    exports.readState = readState
    exports.writeState = writeState
    exports.formatTemperature = formatTemperature
    exports.formatClock = formatClock
    exports.formatDay = formatDay
    exports.MESSAGES = MESSAGES
    exports.PANEL_ID = PANEL_ID
    exports.getWeatherCore = loadWeatherCore
    // The section components are exported under an `Internal` prefix purely so the
    // offline bench can render them against fixture data: `WeatherPanel` reads its
    // data from an effect, which the bench deliberately never runs. They are not a
    // supported extension surface and may change shape without notice.
    exports.Internal_HourlyStrip = HourlyStrip
    exports.Internal_DailyList = DailyList
    exports.Internal_LifeIndices = LifeIndices
    exports.Internal_Sparkline = Sparkline
    return module.exports
  },
})
