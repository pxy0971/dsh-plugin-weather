/**
 * Generate the shipped browser bundle and the Host-facing locale module.
 *
 * Two artifacts come out of one run, both from single sources of truth:
 *
 * | output             | built from                                  | consumed by                |
 * | ------------------ | ------------------------------------------- | -------------------------- |
 * | `client/client.js` | `src/client.template.mjs` + core + locale +  | DSH's client module system |
 * |                    | `package.json`                               |                            |
 * | `lib/locale.js`    | `src/locale.mjs`                             | the Host half / docs       |
 *
 * The browser bundle is a hand-written `window.__ModuleLoader__.load({...})`
 * registration, which is exactly DSH's client bundle contract — no bundler is
 * involved, so the whole build is four string substitutions and a JSON dump. That
 * matters because the bundle may only `require` DSH's frozen platform table, and a
 * general-purpose bundler would happily emit relative requires the module system
 * cannot resolve.
 *
 * The output lives at `client/client.js` and is advertised as `"./client"` in
 * `package.json`: that is the exact layout the ecosystem's shipped client plugins use
 * and the one DSH's client-plugin scanner resolves, so it is the safest thing to
 * imitate rather than invent. Sources live under `src/` so a generated file is never
 * mistaken for a hand-edited one.
 *
 * `src/weather-core.js` is inlined verbatim rather than emitted, so there is no
 * generated copy of the core to keep in sync; the Host half reads that same file
 * through `lib/weather-core-binding.js`.
 *
 * Run it after editing the template, the shared core, or the dictionaries:
 *
 *   node tools/build-client.mjs
 *
 * `node tools/test.mjs` fails when a generated artifact drifts from its source.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const paths = {
  core: join(root, 'src', 'weather-core.js'),
  locale: join(root, 'src', 'locale.mjs'),
  template: join(root, 'src', 'client.template.mjs'),
  manifest: join(root, 'package.json'),
  outBundle: join(root, 'client', 'client.js'),
  outLocale: join(root, 'lib', 'locale.js'),
}

/**
 * Assert an inlined text payload cannot break out of its insertion point.
 *
 * The core source lands verbatim inside a `var WEATHER_CORE_SOURCE = "..."` slot
 * that was written by hand, and the template's own sentinel must not survive into
 * the shipped bundle.
 *
 * @param label - which artifact the text belongs to, for the error message.
 * @param text - the text about to be inlined.
 */
function assertInlinable(label, text) {
  const problems = [
    [/<\/script/i, 'a closing script tag'],
    [/__INLINE_/, 'a build sentinel (would be substituted recursively)'],
  ]
  for (const [pattern, description] of problems) {
    if (pattern.test(text)) {
      throw new Error(`tools/build-client.mjs: ${label} contains ${description}; it cannot be inlined safely`)
    }
  }
}

/** The one `export` line `src/weather-core.js` may carry, stripped before inlining. */
const CORE_EXPORT_LINE = 'export { installWeatherCore }'

/** The Host-only self-installation call, rewritten before inlining. */
const CORE_HOST_CALL = 'installWeatherCore(globalThis)'

/**
 * Assert the shared core is inlinable.
 *
 * The inlined copy is evaluated with `new Function('scope', source)`, which has no
 * module loader, so any `export` statement would be a syntax error at panel mount
 * rather than at build time. Exactly one export is permitted — the single binding
 * line the Host half needs — and {@link inlineCoreSource} rewrites both that line
 * and the Host-only self-installation call.
 *
 * @param text - the `src/weather-core.js` source.
 */
function assertCoreIsInlinable(text) {
  assertInlinable('src/weather-core.js', text)
  if (/^\s*import\s/m.test(text)) {
    throw new Error(
      'tools/build-client.mjs: src/weather-core.js must not use `import` — the browser bundle evaluates it with new Function',
    )
  }
  const exportLines = text.match(/^\s*export\s.*$/gm) ?? []
  for (const line of exportLines) {
    if (line.trim() === CORE_EXPORT_LINE) continue
    throw new Error(
      `tools/build-client.mjs: src/weather-core.js may only export via \`${CORE_EXPORT_LINE}\`, found ${JSON.stringify(line.trim())}. ` +
        'The inlined copy is evaluated with new Function, which cannot parse an export statement.',
    )
  }
  if (!exportLines.some(line => line.trim() === CORE_EXPORT_LINE)) {
    throw new Error(
      `tools/build-client.mjs: src/weather-core.js must keep the \`${CORE_EXPORT_LINE}\` line so lib/weather-core-binding.js can import it`,
    )
  }
  const hostCalls = text.split(CORE_HOST_CALL).length - 1
  if (hostCalls !== 1) {
    throw new Error(
      `tools/build-client.mjs: src/weather-core.js must call \`${CORE_HOST_CALL}\` exactly once (found ${hostCalls}). ` +
        'The Host half relies on it to publish the shared core, and the inlined copy rewrites it to the caller scope.',
    )
  }
}

/**
 * Produce the copy of the core that the browser bundle inlines.
 *
 * Two rewrites, both required for a correct browser copy:
 *
 * 1. drop the `export` binding line, which is a syntax error inside `new Function`;
 * 2. replace the `installWeatherCore(globalThis)` self-installation with
 *    `installWeatherCore(scope)`, so the bundle's private scope is populated and
 *    nothing is written to the page's global object — which is what lets two
 *    plugins that each inline their own copy coexist.
 *
 * The result is a self-contained program: evaluating it with
 * `new Function('scope', source)(scope)` publishes the core. Everything else
 * reaches the browser byte for byte, so the two halves cannot drift.
 *
 * @param text - the `src/weather-core.js` source.
 * @returns the inlinable source.
 */
export function inlineCoreSource(text) {
  assertCoreIsInlinable(text)
  return text.split(CORE_EXPORT_LINE).join('').split(CORE_HOST_CALL).join('installWeatherCore(scope)')
}

/**
 * Read and validate every build input.
 * @returns the sources plus the parsed manifest.
 */
export function readSources() {
  const core = readFileSync(paths.core, 'utf8')
  const locale = readFileSync(paths.locale, 'utf8')
  const template = readFileSync(paths.template, 'utf8')
  const manifest = JSON.parse(readFileSync(paths.manifest, 'utf8'))
  assertCoreIsInlinable(core)
  assertInlinable('src/locale.mjs', locale)
  return { core, locale, template, manifest }
}

/**
 * Load the `zh` and `en` dictionaries from `src/locale.mjs`.
 *
 * The module is imported rather than string-parsed: it is plain ESM with no side
 * effects, so a dynamic `import()` is both simpler and stricter than matching the
 * object literals by hand, and it fails loudly if a value is not representable in
 * the JSON the browser bundle needs.
 *
 * @returns `{ zh, en }` as plain objects.
 */
export async function loadDictionaries() {
  const module = await import(pathToFileURL(paths.locale).href)
  const dictionaries = {}
  for (const name of ['zh', 'en']) {
    const table = module[name]
    if (table === null || typeof table !== 'object') {
      throw new Error(`tools/build-client.mjs: src/locale.mjs does not export a \`${name}\` dictionary object`)
    }
    // Round-tripping through JSON is the real assertion: whatever survives this is
    // exactly what the inlined `JSON.stringify` payload will contain.
    dictionaries[name] = JSON.parse(JSON.stringify(table))
  }
  return dictionaries
}

/**
 * Render the shipped browser bundle.
 *
 * The build stamp is a two-pass substitution: the bundle is rendered once with a
 * placeholder so its finished bytes can be hashed, then rendered again with
 * `package@version+hash`. The hash covers the placeholder form, which is what makes
 * it stable — hashing the final text would be self-referential.
 *
 * @param sources - output of {@link readSources}.
 * @param dictionaries - `{ zh, en }` from {@link loadDictionaries}.
 * @returns the `client/client.js` text plus the stamp it carries.
 */
export function renderBundle(sources, dictionaries) {
  const { core, template, manifest } = sources
  const substitutions = [
    ['__INLINE_PACKAGE__', manifest.name],
    ['__INLINE_VERSION__', manifest.version],
    ['__INLINE_CORE__', JSON.stringify(inlineCoreSource(core))],
    ['__INLINE_LOCALE__', JSON.stringify(dictionaries)],
  ]
  /**
   * Substitute every sentinel except the build stamp.
   * @param buildStamp - value for the stamp slot.
   * @returns the bundle text.
   */
  const substitute = buildStamp => {
    let bundle = template
    for (const [token, value] of substitutions) {
      if (!bundle.includes(token)) {
        throw new Error(`tools/build-client.mjs: src/client.template.mjs is missing the ${token} sentinel`)
      }
      bundle = bundle.split(token).join(value)
    }
    if (!bundle.includes('__INLINE_BUILD__')) {
      throw new Error('tools/build-client.mjs: src/client.template.mjs is missing the __INLINE_BUILD__ sentinel')
    }
    return bundle.split('__INLINE_BUILD__').join(buildStamp)
  }

  const provisional = substitute('__INLINE_BUILD__')
  const digest = createHash('sha256').update(provisional).digest('hex').slice(0, 12)
  const stamp = `${manifest.name}@${manifest.version}+${digest}`
  const bundle = substitute(stamp)
  if (bundle.includes('__INLINE_')) {
    throw new Error('tools/build-client.mjs: an unsubstituted build sentinel survived into the bundle')
  }
  return { bundle, stamp }
}

/**
 * Render the generated Host-facing locale module.
 * @param dictionaries - parsed `{ zh, en }`.
 * @returns the `lib/locale.js` text.
 */
export function renderLocaleModule(dictionaries) {
  return `// GENERATED FILE — do not edit by hand.
//
// Produced by \`node tools/build-client.mjs\` from \`src/locale.mjs\`, the single
// source of truth for every panel string. \`node tools/test.mjs\` fails when the two
// drift apart.
//
// The browser bundle inlines the same dictionaries, because it cannot import a
// sibling file.

/** Simplified Chinese dictionary. */
export const zh = ${JSON.stringify(dictionaries.zh, null, 2)}

/** English dictionary. */
export const en = ${JSON.stringify(dictionaries.en, null, 2)}

export default { zh, en }
`
}

/**
 * Write a file only when its content changed, so a watch loop does not churn mtimes.
 * @param path - destination path.
 * @param content - desired file content.
 * @returns `true` when the file was rewritten.
 */
function writeIfChanged(path, content) {
  let current
  try {
    current = readFileSync(path, 'utf8')
  } catch {
    current = undefined
  }
  if (current === content) return false
  writeFileSync(path, content, 'utf8')
  return true
}

/**
 * Run the whole build.
 * @returns the list of regenerated paths.
 */
export async function build() {
  const sources = readSources()
  const dictionaries = await loadDictionaries()
  const { bundle } = renderBundle(sources, dictionaries)
  const outputs = [
    [paths.outLocale, renderLocaleModule(dictionaries)],
    [paths.outBundle, bundle],
  ]
  const changed = []
  for (const [path, content] of outputs) {
    if (writeIfChanged(path, content)) changed.push(path)
  }
  return changed
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const changed = await build()
  console.log(
    changed.length === 0
      ? 'build-client: all artifacts already up to date'
      : `build-client: regenerated ${changed.length} artifact(s)\n${changed.map(path => `  ${path}`).join('\n')}`,
  )
}

export { paths }
