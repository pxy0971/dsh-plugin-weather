/**
 * Interrogate a *running* DSH Host about one client plugin, using its stored
 * browser-session secret rather than a launch token.
 *
 * This is how the plugin gets verified against the user's own live Desktop instance,
 * whose `?token=` URL is long gone but whose signing secret persists. See
 * `tools/session-cookie.mjs` for why recomputing the cookie is the documented
 * verification path rather than a bypass of it.
 *
 * It answers, in order: is the plugin advertised as a client row, is its advertised
 * bundle actually served, and do the served bytes carry the build we think they do.
 *
 *   node tools/probe-live.mjs [base-url] [plugin-name]
 */

import { sessionCookieFor } from './session-cookie.mjs'

const [, , baseArg = 'http://127.0.0.1:19387', pluginArg = 'dsh-plugin-weather'] = process.argv
const base = baseArg.replace(/\/+$/, '')
const pluginName = pluginArg

const cookie = sessionCookieFor(base)
const headers = { Cookie: cookie }

console.log('probing           :', base)
console.log('plugin            :', pluginName)
console.log('cookie            :', cookie.slice(0, 24) + '…')

const response = await fetch(`${base}/`, { headers })
const index = await response.text()
console.log('document status   :', response.status, `${index.length} bytes`)
if (response.status !== 200) {
  console.log('body              :', JSON.stringify(index.slice(0, 200)))
  process.exit(1)
}

/**
 * Pull one injected `globalThis[...]` JSON payload out of the document.
 *
 * The Host injects these as `<script>globalThis["__DSH_BOOT__"] = {…}</script>`, but
 * the exact key quoting and trailing separator are the shell's business, so this
 * brackets from the assignment to the closing tag and trims a trailing semicolon
 * rather than matching the whole shape.
 *
 * @param html - the document text.
 * @param key - the global name to look for.
 * @returns the parsed value, or `undefined`.
 */
function injectedJson(html, key) {
  const marker = `globalThis["${key}"]`
  const at = html.indexOf(marker)
  if (at === -1) return undefined
  const equals = html.indexOf('=', at + marker.length)
  if (equals === -1) return undefined
  const end = html.indexOf('</script>', equals)
  if (end === -1) return undefined
  const literal = html.slice(equals + 1, end).trim().replace(/;\s*$/, '')
  try {
    return JSON.parse(literal)
  } catch (cause) {
    console.log(`${key}: payload did not parse — ${cause.message}`)
    console.log('  raw head:', JSON.stringify(literal.slice(0, 160)))
    return undefined
  }
}

const graph = injectedJson(index, '__DSH_BOOT__')
if (graph === undefined) {
  console.log('boot graph        : NOT FOUND in the document')
  const keys = [...index.matchAll(/globalThis\["([^"]+)"\]/g)].map(match => match[1])
  console.log('injected keys     :', [...new Set(keys)].join(', '))
  console.log('body head         :', JSON.stringify(index.slice(0, 200)))
  process.exit(1)
}
const rows = graph.entries ?? []
const row = rows.find(entry => entry.id === pluginName)

console.log('boot graph rows   :', rows.length)
console.log('weather row       :', row === undefined ? 'ABSENT' : JSON.stringify(row))

const clientRows = rows.filter(entry => typeof entry.url === 'string' && entry.url.includes('client.js'))
console.log('client rows       :', clientRows.length)
console.log('  sample ids      :', clientRows.slice(0, 8).map(entry => entry.id).join(', '))

if (row === undefined) {
  console.log('\nverdict           : the Host did NOT advertise this plugin as a client module.')
  console.log('                    The failure is in Host composition, not the browser.')
  process.exit(1)
}

const comboUrl = new URL(row.url, `${base}/`).href
const combo = await fetch(comboUrl, { headers })
const body = await combo.text()
console.log('\nbundle url        :', comboUrl)
console.log('bundle status     :', combo.status, `${body.length} bytes`)

const stamp = /PACKAGE_BUILD_STAMP = '([^']+)'/.exec(body)
console.log('served build      :', stamp?.[1] ?? 'MISSING')
console.log('self-registers    :', body.includes('__ModuleLoader__.load'))
console.log('registration id   :', /id: '([^']+)'/.exec(body)?.[1] ?? 'MISSING')

// The one-resource URL is a different route from the combo: DSH only answers it for
// URLs it advertised, which is worth knowing when a browser falls back to it.
const single = await fetch(`${base}/plugins/${pluginName}/client.js`, { headers })
console.log('one-resource url  :', single.status, `(${(await single.text()).length} bytes, expected 404 without a rev)`)

const verdict = combo.status === 200 && body.includes('__ModuleLoader__.load')
console.log(
  verdict
    ? '\nverdict           : the Host advertises AND serves this plugin correctly.'
    : '\nverdict           : advertised but NOT served — the bundle route is the problem.',
)
process.exitCode = verdict ? 0 : 1
