/**
 * Offline test bench for the weather plugin.
 *
 * Three layers are exercised without a browser, a network, or DSH itself:
 *
 * 1. **Shared core** — the pure domain functions in `lib/weather-core.js`: WMO
 *    mapping, unit conversions, life-index severity, compass points, normalization
 *    of a raw provider payload, and the hourly-window slicing.
 * 2. **Generated bundle** — `lib/client.js` is evaluated against a stub
 *    `window.__ModuleLoader__` with the platform modules faked, proving the shipped
 *    artifact parses, registers exactly one module under the package id, exports the
 *    client plugin contract (`apply`/`inject`), and can materialize its inlined
 *    shared core.
 * 3. **Panel rendering** — the panel body is rendered through a minimal React
 *    stand-in and the resulting element tree is walked as text, so the loading
 *    state, the metric labels, and the localized strings are asserted end to end.
 *
 * Run with `node tools/test.mjs`. Exits non-zero when any case fails.
 *
 * @module dsh-plugin-weather/tests
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { createContext, runInContext } from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

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

/**
 * Assert a string contains a fragment.
 * @param haystack - the text to search.
 * @param needle - the required fragment.
 * @param message - failure explanation.
 */
function assertContains(haystack, needle, message) {
  if (!String(haystack).includes(needle)) {
    throw new Error(`${message}\n  looked for: ${JSON.stringify(needle)}\n  in: ${JSON.stringify(String(haystack).slice(0, 400))}`)
  }
}

/* ---------------------------------------------------------------- core layer */

/**
 * Load the shared domain core the way the Host does.
 *
 * This goes through `lib/weather-core-binding.js`, the module `lib/index.js`
 * imports, so the test covers the real resolution path: the authored core loads for
 * its side effect and the binding module finds the scope it published. A failure
 * there would break the Host plugin at startup, not just the test.
 */
const core = await import(pathToFileURL(join(root, 'lib', 'weather-core-binding.js')).href)

/**
 * Build a raw Open-Meteo-shaped payload for the chosen day count.
 * @param days - how many daily rows to emit.
 * @returns a payload with parallel arrays, as the provider sends them.
 */
function fixturePayload(days = 7) {
  const dates = Array.from({ length: days }, (_, index) => `2026-09-${String(30 + index).padStart(2, '0')}`)
  const hours = Array.from({ length: 48 }, (_, index) => {
    const day = 30 + Math.floor(index / 24)
    const hour = String(index % 24).padStart(2, '0')
    return `2026-09-${day}T${hour}:00`
  })
  return {
    latitude: 30.29,
    longitude: 120.16,
    timezone: 'Asia/Shanghai',
    timezone_abbreviation: 'GMT+8',
    utc_offset_seconds: 28800,
    elevation: 12,
    current: {
      time: '2026-09-30T14:00',
      interval: 900,
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
      temperature_2m: hours.map((_, index) => 20 + (index % 12)),
      apparent_temperature: hours.map((_, index) => 19 + (index % 12)),
      precipitation_probability: hours.map((_, index) => index % 100),
      precipitation: hours.map(() => 0),
      weather_code: hours.map(() => 3),
      wind_speed_10m: hours.map(() => 8),
      relative_humidity_2m: hours.map(() => 60),
      uv_index: hours.map(() => 2),
      is_day: hours.map((_, index) => (index % 24 >= 6 && index % 24 < 18 ? 1 : 0)),
    },
    daily: {
      time: dates,
      weather_code: dates.map(() => 61),
      temperature_2m_max: dates.map((_, index) => 26 + index),
      temperature_2m_min: dates.map((_, index) => 17 + index),
      apparent_temperature_max: dates.map(() => 30),
      apparent_temperature_min: dates.map(() => 18),
      sunrise: dates.map(date => `${date}T05:52`),
      sunset: dates.map(date => `${date}T17:46`),
      daylight_duration: dates.map(() => 42880.86),
      uv_index_max: dates.map((_, index) => index + 2),
      precipitation_sum: dates.map(() => 3),
      precipitation_probability_max: dates.map((_, index) => 20 + index * 10),
      wind_speed_10m_max: dates.map(() => 14.6),
    },
  }
}

await test('core: WMO codes map to glyphs, names, and a fallback', () => {
  assertEqual(core.weatherCodeInfo(0).en, 'Clear sky', 'code 0 should be clear')
  assertEqual(core.weatherCodeInfo(95).zh, '\u96f7\u9635\u96e8', 'code 95 should be a thunderstorm in Chinese')
  assertEqual(core.weatherCodeInfo(12345).key, 'unknown', 'an unmapped code must fall back, not throw')
  assertEqual(core.weatherGlyph(0, false), core.WEATHER_CODES[0].night, 'night should pick the night glyph')
})

await test('core: unknown WMO codes stay renderable', () => {
  const payload = fixturePayload(1)
  payload.current.weather_code = 4242
  const normalized = core.normalizeForecast(payload, { units: 'metric' })
  assertEqual(normalized.current.condition.key, 'unknown', 'the condition should fall back')
  assert(Number.isFinite(normalized.current.temperature), 'the rest of the payload must still normalize')
})

await test('core: life indices bucket severity and skip absent metrics', () => {
  const rows = core.lifeIndices(fixturePayload().daily, 0)
  const uv = rows.find(row => row.key === 'uv')
  assertEqual(uv.level, 0, 'uv_index_max 2 is below the first threshold of 3')
  assertEqual(rows.length, 4, 'all four defined indicators should produce a row')
  const trimmed = core.lifeIndices({ uv_index_max: [9] }, 0)
  assertEqual(trimmed.length, 1, 'only the present metric should produce a row')
  assertEqual(trimmed[0].level, 3, 'uv 9 is past every threshold')
})

await test('core: compassPoint wraps and rounds to the 16-wind rose', () => {
  assertEqual(core.compassPoint(0), 'N', '0 degrees is north')
  assertEqual(core.compassPoint(360), 'N', '360 degrees wraps to north')
  assertEqual(core.compassPoint(90), 'E', '90 degrees is east')
  assertEqual(core.compassPoint(-45), 'NW', 'negative bearings wrap')
  assertEqual(core.compassPoint(Number.NaN), undefined, 'a missing bearing is undefined, not north')
})

await test('core: normalizeForecast turns parallel arrays into rows', () => {
  const normalized = core.normalizeForecast(fixturePayload(7), { units: 'metric' })
  assertEqual(normalized.daily.length, 7, 'seven daily rows expected')
  assertEqual(normalized.hourly.length, 48, 'both fixture days should become hourly rows')
  assertEqual(normalized.current.condition.key, 'moderateDrizzle', 'code 53 is moderate drizzle')
  assertEqual(normalized.unitLabels.label, '\u00b0C', 'metric label')
  assertEqual(normalized.daily[0].indices.length, 4, 'each day carries its own indices')
  assertEqual(normalized.daily[1].temperatureMax, 27, 'the second day reads the second column entry')
})

await test('core: upcomingHours starts at the current local hour', () => {
  const normalized = core.normalizeForecast(fixturePayload(7), { units: 'metric' })
  const next = core.upcomingHours(normalized, 24)
  assertEqual(next.length, 24, 'a full window was requested')
  assertEqual(next[0].time, '2026-09-30T14:00', 'the window starts at current.time')
  const short = core.upcomingHours(normalized, 3)
  assertEqual(short.length, 3, 'the window honours its count')
})

await test('core: temperatureWindow reports a degenerate series as null span', () => {
  const flat = core.temperatureWindow([{ temperature: 20 }, { temperature: 20 }])
  assertEqual(flat.span, null, 'a flat series has no span to scale by')
  const varied = core.temperatureWindow([{ temperature: 10 }, { temperature: 30 }])
  assertEqual([varied.min, varied.max, varied.span], [10, 30, 20], 'min, max and span')
  assertEqual(core.temperatureWindow([]).span, null, 'an empty series has no span')
})

await test('core: encodeQuery omits empty values and joins arrays', () => {
  assertEqual(core.encodeQuery({ a: 1, b: undefined, c: '', d: [1, 2] }), '?a=1&d=1%2C2', 'only defined values reach the wire')
  assertEqual(core.encodeQuery({}), '', 'nothing set produces no query string')
})

await test('core: normalizeLocation dedupes repeated place names', () => {
  const location = core.normalizeLocation({
    id: 1,
    name: '\u676d\u5dde',
    admin2: '\u676d\u5dde\u5e02',
    admin1: '\u6d59\u6c5f',
    country: '\u4e2d\u56fd',
    latitude: 30,
    longitude: 120,
  })
  assertEqual(
    location.label,
    '\u676d\u5dde \u00b7 \u676d\u5dde\u5e02 \u00b7 \u6d59\u6c5f \u00b7 \u4e2d\u56fd',
    'the label drops nothing but repeats',
  )
  const bare = core.normalizeLocation({ latitude: 1, longitude: 2 })
  assertEqual(bare.name, '1,2', 'a nameless result falls back to its coordinates')
})

/* --------------------------------------------------------------- bundle layer */

const bundleSource = readFileSync(join(root, 'client', 'client.js'), 'utf8')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const shim = await import(pathToFileURL(join(here, 'test', 'react-shim.mjs')).href)
const ELEMENT_TYPE = shim.ELEMENT_TYPE

/** Captured registrations from the stub module loader. */
const registrations = []

/**
 * Build the stub globals the bundle expects.
 * @returns a vm sandbox context.
 */
function makeSandbox() {
  const window = {
    __ModuleLoader__: {
      /**
       * Capture one bundle registration.
       * @param registration - `{ id, factory }`.
       */
      load(registration) {
        registrations.push(registration)
      },
    },
    localStorage: {
      store: new Map(),
      /**
       * @param key - storage key.
       * @returns the stored string or null.
       */
      getItem(key) {
        return this.store.has(key) ? this.store.get(key) : null
      },
      /**
       * @param key - storage key.
       * @param value - value to store.
       */
      setItem(key, value) {
        this.store.set(key, String(value))
      },
    },
    setTimeout,
    clearTimeout,
  }
  return createContext({
    window,
    console,
    Intl,
    JSON,
    Math,
    Date,
    Number,
    String,
    Object,
    Array,
    Set,
    Map,
    URL,
    URLSearchParams,
    Promise,
    Error,
    Symbol,
    RegExp,
    isNaN,
    parseInt,
    parseFloat,
  })
}

const sandbox = makeSandbox()

await test('bundle: the shipped artifact parses and self-registers', () => {
  runInContext(bundleSource, sandbox, { filename: 'lib/client.js' })
  assertEqual(registrations.length, 1, 'the bundle must register exactly one module at load time')
})

/** Platform module ids the bundle is allowed to require. */
const iconNames = [
  'IconSearchOutlineRegular',
  'IconRefreshOutlineRegular',
  'IconPlusOutlineRegular',
  'IconTrashOutlineRegular',
  'IconCloseOutlineRegular',
  'IconGlobeOutlineRegular',
  'IconWarningOutlineRegular',
]

/**
 * Fake DSH's frozen platform module table.
 *
 * Anything outside the table throws, which is what makes the dependency-surface
 * test meaningful.
 *
 * @param specifier - the requested module id.
 * @returns the module namespace.
 */
function platformRequire(specifier) {
  if (specifier === 'react') return shim
  if (specifier === 'react/jsx-runtime') {
    return { jsx: shim.jsx, jsxs: shim.jsxs, Fragment: shim.Fragment }
  }
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') {
    const icons = {}
    for (const icon of iconNames) icons[icon] = props => shim.createElement('svg', { 'data-icon': icon, ...props })
    return icons
  }
  throw new Error(`the bundle requested a module outside the platform table: ${specifier}`)
}

/** The bundle's exported surface, materialized once. */
let bundleExports

/**
 * The bundle's exports, materialized on first use.
 *
 * Every later layer depends on this, so a load failure has to surface as a clear
 * error here rather than a `TypeError` on `undefined` inside an unrelated case.
 * When the load case already failed, the artifact is re-evaluated in a throwaway
 * sandbox so the remaining cases still report real results.
 *
 * @returns the bundle's export object.
 */
function bundle() {
  if (bundleExports !== undefined) return bundleExports
  let registration = registrations[0]
  if (registration === undefined) {
    const fresh = []
    const isolated = createContext({
      window: {
        __ModuleLoader__: {
          /**
           * @param entry - the registration to capture.
           */
          load(entry) {
            fresh.push(entry)
          },
        },
      },
      console,
      Intl,
      JSON,
      Math,
      Date,
      Number,
      String,
      Object,
      Array,
      Set,
      Map,
      URL,
      URLSearchParams,
      Promise,
      Error,
      Symbol,
      RegExp,
    })
    try {
      runInContext(bundleSource, isolated, { filename: 'lib/client.js' })
    } catch {
      /* The load case owns that failure; the message below is the useful one. */
    }
    registration = fresh[0]
  }
  if (registration === undefined) throw new Error('lib/client.js registered no module; run `node tools/build-client.mjs`')
  bundleExports = registration.factory(platformRequire)
  return bundleExports
}

await test('bundle: registers exactly one module under the package id', () => {
  assertEqual(registrations.length, 1, 'one registration expected')
  assertEqual(registrations[0]?.id, manifest.name, 'the registration id must be the package name')
  assertEqual(typeof registrations[0]?.factory, 'function', 'the registration must carry a factory')
})

await test('bundle: exports the client plugin contract', () => {
  const exported = bundle()
  assertEqual(typeof exported.apply, 'function', 'apply is required by the Cordis loader')
  assert(Array.isArray(exported.inject), 'inject must be an array of service keys')
  assert(exported.inject.includes('slots'), 'the slot registry is a hard dependency')
  assert(exported.inject.includes('locale'), 'the locale runtime is a hard dependency')
})

await test('bundle: requires only modules from the platform table', () => {
  // Materialization resolves every `require` through platformRequire, which throws
  // for anything outside the seed table. Reaching this assertion proves the
  // bundle's dependency surface is exactly React, the JSX runtime, and the shipped
  // primitives — no relative sibling require, which the module system cannot serve.
  bundle()
})

await test('bundle: the inlined shared core is live and complete', () => {
  const exported = bundle()
  assert(exported.MESSAGES.zh !== undefined && exported.MESSAGES.en !== undefined, 'both dictionaries are inlined')
  assertEqual(typeof exported.translator, 'function', 'the translator factory is exported')
  assertEqual(typeof exported.readState, 'function', 'the persistence reader is exported')

  const inlined = exported.getWeatherCore()
  assertEqual(typeof inlined.fetchForecast, 'function', 'the inlined core exposes its fetch entry point')
  assertEqual(typeof inlined.fetchSummaries, 'function', 'the inlined core exposes the summary entry point')
})

await test('bundle: the inlined core matches the Host copy', () => {
  // The browser half runs one evaluation of `lib/weather-core.js` inlined as text;
  // the Host half runs the same file as a module. If the two ever disagree, the
  // panel and the `get_weather` tool would answer differently for the same city, so
  // the tables are compared key for key rather than spot-checked.
  const inlined = bundle().getWeatherCore()
  assertEqual(Object.keys(inlined.WEATHER_CODES).sort(), Object.keys(core.WEATHER_CODES).sort(), 'the WMO table keys must match')
  for (const code of Object.keys(core.WEATHER_CODES)) {
    assertEqual(inlined.WEATHER_CODES[code], core.WEATHER_CODES[code], `WMO code ${code} must match the Host copy`)
  }
  assertEqual(inlined.WEATHER_UNITS, core.WEATHER_UNITS, 'the unit table must match')
  assertEqual(inlined.CURRENT_FIELDS, core.CURRENT_FIELDS, 'the current-field selector must match')
  assertEqual(inlined.HOURLY_FIELDS, core.HOURLY_FIELDS, 'the hourly-field selector must match')
  assertEqual(inlined.DAILY_FIELDS, core.DAILY_FIELDS, 'the daily-field selector must match')
  assertEqual(inlined.lifeIndices(fixturePayload().daily, 2), core.lifeIndices(fixturePayload().daily, 2), 'derived indices must match')
  // `fetchedAt` is `Date.now()`, so the two runs differ by construction; it is not
  // part of the shared contract.
  const withoutTimestamps = bundle_ => {
    const { fetchedAt, ...rest } = bundle_
    return rest
  }
  assertEqual(
    withoutTimestamps(inlined.normalizeForecast(fixturePayload(3), { units: 'imperial' })),
    withoutTimestamps(core.normalizeForecast(fixturePayload(3), { units: 'imperial' })),
    'normalization must agree for the same payload',
  )
})

await test('bundle: two inlined cores stay independent', () => {
  const first = bundle().getWeatherCore()
  const second = bundle().getWeatherCore()
  assert(first !== second, 'each evaluation must hand back its own scope object')
  assertEqual(first.weatherCodeInfo(3), second.weatherCodeInfo(3), 'both copies answer identically')
})

await test('locale: both dictionaries carry an identical key set', () => {
  const exported = bundle()
  const zh = Object.keys(exported.MESSAGES.zh).sort()
  const en = Object.keys(exported.MESSAGES.en).sort()
  assertEqual(zh, en, 'zh and en must be key-for-key identical for the locale runtime')
  assert(zh.length > 40, `expected a substantial dictionary, got ${zh.length} keys`)
})

await test('locale: translation falls back to English then to the key', () => {
  const exported = bundle()
  const zh = exported.translator('zh')
  const en = exported.translator('en')
  assertEqual(zh('panel.title'), '\u5929\u6c14', 'Chinese lookup')
  assertEqual(en('panel.title'), 'Weather', 'English lookup')
  assertEqual(en('panel.doesNotExist'), 'panel.doesNotExist', 'an unknown key surfaces as itself')
})

await test('locale: indices advice resolves for every severity bucket', () => {
  const t = bundle().translator('zh')
  for (const key of ['uv', 'precipitation', 'wind', 'daylight']) {
    for (const level of [0, 1, 2, 3]) {
      const text = t(`panel.index.${key}.${level}`)
      assert(!text.startsWith('panel.index.'), `missing advice for ${key} level ${level}`)
    }
    assert(!t(`panel.index.${key}.name`).startsWith('panel.index.'), `missing name for ${key}`)
  }
})

await test('formatting: temperature, clock, and day labels', () => {
  const exported = bundle()
  assertEqual(exported.formatTemperature(29.4, '\u00b0C'), '29\u00b0C', 'temperatures round')
  assertEqual(exported.formatTemperature(undefined, '\u00b0C'), '\u2013', 'a missing temperature is an em dash')
  assertEqual(exported.formatClock('2026-09-30T05:52'), '05:52', 'clock text is sliced from the local stamp')
  assertEqual(exported.formatDay('2026-09-30', 'en', 0, exported.translator('en')), 'Today', 'the first row is today')
  assertEqual(exported.formatDay('2026-10-01', 'en', 1, exported.translator('en')), 'Tomorrow', 'the second row is tomorrow')
  assertEqual(exported.formatDay('2026-10-02', 'en', 2, exported.translator('en')), 'Fri', 'later rows use the weekday')
})

await test('persistence: state round-trips through localStorage and survives junk', () => {
  const exported = bundle()
  const key = 'dsh-plugin-weather/v1'
  sandbox.window.localStorage.setItem(key, JSON.stringify({ cities: [], selectedId: 'x', units: 'imperial' }))
  const restored = exported.readState()
  assertEqual(restored.units, 'imperial', 'the unit preference persists')
  assert(restored.cities.length > 0, 'an empty city list falls back to the defaults')

  sandbox.window.localStorage.setItem(key, '{not json')
  assertEqual(exported.readState().units, 'metric', 'corrupt state falls back to metric')

  sandbox.window.localStorage.setItem(
    key,
    JSON.stringify({
      cities: [{ latitude: 1, longitude: 2, id: 'a', name: 'A', label: 'A' }],
      selectedId: 'a',
      units: 'metric',
    }),
  )
  assertEqual(exported.readState().cities.length, 1, 'a valid stored city list is honoured')

  sandbox.window.localStorage.setItem(key, JSON.stringify({ cities: [{ latitude: 'x', longitude: 2 }], units: 'metric' }))
  assert(exported.readState().cities.length > 0, 'a city without finite coordinates is dropped, not kept')
})

/* ------------------------------------------------------------- render layer */

/**
 * Instantiate an element, resolving function and class components.
 *
 * `useEffect` is intentionally never run: the bench renders once and inspects the
 * tree, so effects would only introduce timing into the assertions.
 *
 * @param element - an element node.
 * @returns the rendered node or primitive.
 */
function resolve(element) {
  if (element === null || element === undefined || typeof element !== 'object') return element
  if (element[ELEMENT_TYPE] !== true) return element
  const { type, props } = element
  if (typeof type !== 'function') return element
  if (typeof type.prototype?.render === 'function') return new type(props).render()
  return type(props)
}

/**
 * Flatten an element tree into its visible text and rendered attributes.
 * @param element - an element node or primitive.
 * @returns `{ text, attrs }`.
 */
function render(element) {
  const parts = []
  const attrs = []
  /**
   * Walk one node.
   * @param node - current node.
   */
  function walk(node) {
    if (node === null || node === undefined || node === false || node === true) return
    if (typeof node === 'string' || typeof node === 'number') {
      parts.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (typeof node !== 'object') return
    if (node[ELEMENT_TYPE] === true) {
      // The tag/component name is recorded as an attribute so the walk can assert on
      // element identity (`<svg`), while the component's own string props carry the
      // values a reader would actually see reflected into the DOM.
      const name = typeof node.type === 'string' ? node.type : node.type?.name ?? 'component'
      attrs.push(`<${name}`)
      for (const [propName, value] of Object.entries(node.props ?? {})) {
        if (propName === 'children') continue
        if (typeof value === 'string' || typeof value === 'number') attrs.push(`${propName}=${value}`)
      }
      // Resolve exactly once. A host element resolves to itself, so passing the
      // result back through `walk` would recurse forever; only a component's
      // rendered output is walked again.
      const resolved = resolve(node)
      if (resolved !== node) walk(resolved)
      else if (typeof node.type === 'string') walk(node.props?.children)
      return
    }
    if (node.props !== undefined) walk(node.props.children)
  }
  walk(element)
  return { text: parts.join(' '), attrs: attrs.join(' ') }
}

await test('render: the panel body mounts and shows its loading state', () => {
  shim.__resetHooks([])
  const exported = bundle()
  const t = exported.translator('en')
  const node = resolve(shim.createElement(exported.WeatherPanel, { ctx: {}, language: 'en', t }))
  const { text } = render(node)
  assertContains(text, 'Weather', 'the panel title renders')
  assertContains(text, 'Loading weather', 'the initial state is loading')
  assertContains(text, 'Units', 'the unit switch renders')
})

await test('render: sections draw the forecast data they are given', () => {
  const exported = bundle()
  const normalized = exported.getWeatherCore().normalizeForecast(fixturePayload(7), { units: 'metric' })
  const t = exported.translator('en')
  const rows = exported.getWeatherCore().upcomingHours(normalized, 24)

  shim.__resetHooks([])
  const hourly = render(shim.createElement(exported.Internal_HourlyStrip, { rows, language: 'en', t, units: 'metric' }))
  assertContains(hourly.text, 'Next 24 hours', 'the hourly header renders')
  // The first hour is labelled "Now" instead of its clock text, and every hour
  // carries its glyph, temperature, and precipitation chance.
  assertContains(hourly.text, 'Now', 'the leading hour is labelled as now')
  assertContains(hourly.text, '15:00', 'the following hour shows its clock text')
  assertContains(hourly.text, '22\u00b0', 'an hourly temperature renders')
  assertContains(hourly.text, '14%', 'an hourly precipitation chance renders')
  assertContains(hourly.attrs, 'className=dshw-hour', 'the hour cells are laid out in the strip')
  assertContains(hourly.attrs, '<path', 'the sparkline path is part of the card')

  shim.__resetHooks([])
  const daily = render(shim.createElement(exported.Internal_DailyList, { rows: normalized.daily, language: 'en', t, units: 'metric', unitLabel: '\u00b0C' }))
  assertContains(daily.text, '7-day forecast', 'the daily header renders')
  assertContains(daily.text, 'Today', 'the first day is today')
  assertContains(daily.text, '20%', 'the first day carries its precipitation chance')
  assertContains(daily.text, '80%', 'the last day carries its own precipitation chance')
  assertContains(daily.text, '26\u00b0C', 'a daily maximum renders with the unit label')
  assertContains(daily.text, '17\u00b0C', 'a daily minimum renders with the unit label')

  shim.__resetHooks([])
  const indices = render(shim.createElement(exported.Internal_LifeIndices, { indices: normalized.daily[0].indices, units: 'metric', t, language: 'en' }))
  assertContains(indices.text, 'Life indices', 'the indices header renders')
  assertContains(indices.text, 'UV index', 'the UV indicator is named')
  assertContains(indices.text, 'no special protection', 'uv level 0 resolves to its advice line')
  assertContains(indices.text, '11h 55m', 'the daylight duration is formatted as hours and minutes')
})

await test('render: the sparkline refuses to draw a flat series', () => {
  const exported = bundle()
  const flat = [
    { time: '2026-09-30T10:00', temperature: 20 },
    { time: '2026-09-30T11:00', temperature: 20 },
  ]
  shim.__resetHooks([])
  const drawn = render(shim.createElement(exported.Internal_Sparkline, { rows: flat }))
  assert(!drawn.attrs.includes('path'), 'a degenerate series must not produce a path element')

  shim.__resetHooks([])
  const varied = render(
    shim.createElement(exported.Internal_Sparkline, {
      rows: [
        { time: '2026-09-30T10:00', temperature: 10 },
        { time: '2026-09-30T11:00', temperature: 30 },
      ],
    }),
  )
  assert(varied.attrs.includes('path'), 'a varying series draws a path')
})

await test('render: the panel body renders in Chinese', () => {
  shim.__resetHooks([])
  const exported = bundle()
  const t = exported.translator('zh')
  const node = resolve(shim.createElement(exported.WeatherPanel, { ctx: {}, language: 'zh', t }))
  const { text } = render(node)
  assertContains(text, '\u5929\u6c14', 'the Chinese title renders')
  assertContains(text, '\u6b63\u5728\u83b7\u53d6\u5929\u6c14', 'the Chinese loading copy renders')
  assertContains(text, '7 \u5929\u9884\u62a5', 'the Chinese daily header renders')
})

await test('render: the sidebar glyph is a non-empty mark in both states', () => {
  const exported = bundle()
  const idle = render(shim.createElement(exported.WeatherPanelGlyph, { size: 16, active: false }))
  assert(idle.text.length > 0, 'the idle glyph renders a character')
  const active = render(shim.createElement(exported.WeatherPanelGlyph, { size: 18, active: true }))
  assert(active.text.length > 0, 'the active glyph renders too')
})

await test('slots: apply registers the sidebar entry and the main panel', () => {
  const exported = bundle()
  const registered = []
  const effects = []
  const fakeCtx = {
    locale: {
      /**
       * @returns an active locale snapshot.
       */
      getSnapshot: () => ({ active: 'zh' }),
      /**
       * @param namespace - locale namespace.
       * @param messages - dictionaries.
       * @returns a disposer.
       */
      register(namespace, messages) {
        registered.push({ namespace, messages })
        return () => {}
      },
      /**
       * @returns an unsubscribe function.
       */
      subscribe: () => () => {},
    },
    slots: {
      /**
       * @param key - the slot key being depended on.
       * @param factory - the deferred registration.
       * @returns a disposer.
       */
      inject(key, factory) {
        registered.push({ injected: key, factory })
        return () => {}
      },
      /**
       * @param options - the registration options.
       * @param component - the occupant component.
       * @returns a disposer.
       */
      register(options, component) {
        registered.push({ slot: options, component })
        return () => {}
      },
    },
    /**
     * @param body - the effect body.
     * @param label - the effect label.
     */
    effect(body, label) {
      effects.push({ label, dispose: body() })
    },
  }
  exported.apply(fakeCtx)

  const localeCall = registered.find(entry => entry.namespace === 'weather')
  assert(localeCall !== undefined, 'the weather dictionary is registered with the locale runtime')
  assertEqual(
    Object.keys(localeCall.messages.zh).length,
    Object.keys(localeCall.messages.en).length,
    'both dictionaries register together',
  )

  const injections = registered
    .filter(entry => entry.injected !== undefined)
    .map(entry => entry.injected)
    .sort()
  assertEqual(injections, ['main', 'sidebar.panellist'], 'both slots are injected with declaration-aware waiting')

  for (const entry of registered.filter(row => row.injected !== undefined)) entry.factory()
  const slots = registered.filter(entry => entry.slot !== undefined).map(entry => entry.slot)
  const main = slots.find(slot => slot.name === 'main')
  const sidebar = slots.find(slot => slot.name === 'sidebar.panellist')
  assert(main !== undefined, 'the main slot is registered')
  assertEqual(main.key, exported.PANEL_ID, 'the main slot key must match the sidebar id, or selectPanel throws')
  assert(sidebar !== undefined, 'the sidebar entry is registered')
  assertEqual(sidebar.id, exported.PANEL_ID, 'the sidebar id matches the main key')
  assertEqual(typeof sidebar.label, 'function', 'the sidebar label is a resolver so it follows the language')
  assertContains(sidebar.label(), '\u5929\u6c14', 'the sidebar label resolves in the active language')
  assertEqual(typeof main.locale, 'string', 'the main registration declares its locale namespace')
  assert(effects.length >= 2, 'registration effects are owned by the fiber')
})

/* ------------------------------------------------------------------ report */

const failed = results.filter(row => row.ok === false)
for (const row of results) {
  console.log(`${row.ok ? 'ok  ' : 'FAIL'} ${row.name}`)
  if (!row.ok) console.log(`     ${row.message.split('\n').join('\n     ')}`)
}
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length > 0) process.exitCode = 1
