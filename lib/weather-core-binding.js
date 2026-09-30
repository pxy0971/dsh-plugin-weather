/**
 * Adapter that exposes the shared weather core as ordinary ESM bindings.
 *
 * `src/weather-core.js` is authored to be *inlined* into the browser bundle: it
 * declares a single `installWeatherCore(scope)` function and publishes its surface
 * onto the scope the caller hands it, because the bundle is a classic script that
 * cannot `import` a sibling and `new Function` cannot parse an `export` statement.
 *
 * That shape is wrong for the Host half, which is ordinary ESM and cannot use named
 * imports against a helper that exports nothing. This module bridges the two: it
 * installs the core into `globalThis` — so the module graph's own loading provides
 * one shared instance — and re-exports the surface as ordinary bindings.
 *
 * @module dsh-plugin-weather/weather-core
 */

import { installWeatherCore } from '../src/weather-core.js'

installWeatherCore(globalThis)

/**
 * The core's published surface.
 *
 * A module-scope `const` rather than a field read at each use, so a second copy of
 * the plugin loading in the same realm cannot swap the implementation underneath
 * this one mid-session.
 */
const core = globalThis.__DSH_WEATHER_CORE__

if (core === undefined) {
  throw new Error('dsh-plugin-weather: installWeatherCore did not publish __DSH_WEATHER_CORE__')
}

export const WEATHER_GEOCODE_ENDPOINT = core.WEATHER_GEOCODE_ENDPOINT
export const WEATHER_FORECAST_ENDPOINT = core.WEATHER_FORECAST_ENDPOINT
export const WEATHER_UNITS = core.WEATHER_UNITS
export const WEATHER_CODES = core.WEATHER_CODES
export const WEATHER_CODE_FALLBACK = core.WEATHER_CODE_FALLBACK
export const WEATHER_SEARCH_LIMIT = core.WEATHER_SEARCH_LIMIT
export const CURRENT_FIELDS = core.CURRENT_FIELDS
export const HOURLY_FIELDS = core.HOURLY_FIELDS
export const DAILY_FIELDS = core.DAILY_FIELDS
export const COMPASS_POINTS = core.COMPASS_POINTS
export const weatherCodeInfo = core.weatherCodeInfo
export const weatherGlyph = core.weatherGlyph
export const lifeIndices = core.lifeIndices
export const compassPoint = core.compassPoint
export const encodeQuery = core.encodeQuery
export const normalizeLocation = core.normalizeLocation
export const searchLocations = core.searchLocations
export const fetchForecast = core.fetchForecast
export const normalizeForecast = core.normalizeForecast
export const upcomingHours = core.upcomingHours
export const temperatureWindow = core.temperatureWindow
export const fetchSummaries = core.fetchSummaries
export const WEATHER_CORE = core

export default core
