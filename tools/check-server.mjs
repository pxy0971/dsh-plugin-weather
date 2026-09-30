/**
 * Authenticated end-to-end check against a running DSH Web instance.
 *
 * Verifies the two things the offline benches cannot:
 *
 * 1. the boot graph the page receives names this plugin as a loadable row, and
 * 2. the Host serves the plugin's client bundle over the `/plugins` route.
 *
 * `dsh web` gates the document on a token printed in its startup banner. The token is
 * accepted as a `?token=` query on any request, so nothing else — no cookie jar, no
 * custom header — is needed to read the index's injected boot graph.
 *
 * Usage: `node tools/check-server.mjs <base-url> <token> [plugin-name]`
 */

const [, , base = 'http://127.0.0.1:19411', token = '', pluginName = 'dsh-plugin-weather'] = process.argv

if (token === '') {
  console.error('usage: node tools/check-server.mjs <base-url> <token> [plugin-name]')
  process.exit(2)
}

/**
 * Request one path with the web token attached.
 * @param path - path to request, including any query string.
 * @returns the status, text, and headers.
 */
async function get(path) {
  const url = `${base}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
  const response = await fetch(url, { headers: { Origin: base } })
  return { status: response.status, text: await response.text(), headers: response.headers }
}

let failures = 0

/**
 * Record one check.
 * @param label - what was checked.
 * @param ok - whether it held.
 * @param detail - extra context printed either way.
 */
function check(label, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
}

try {
  const index = await get('/')
  check('the document is served', index.status === 200, `status ${index.status}, ${index.text.length} bytes`)
  check('the page carries the boot graph', index.text.includes('__DSH_BOOT__'))

  const rows = index.text.split(pluginName).length - 1
  check('the boot graph names this plugin', rows > 0, `${rows} occurrence(s)`)
  if (rows === 0) {
    const at = index.text.indexOf('__DSH_BOOT__')
    console.log('  boot graph excerpt:', JSON.stringify(index.text.slice(at, at + 400)))
  }

  const bundle = await get(`/plugins/${pluginName}/client.js`)
  check('the client bundle is served', bundle.status === 200, `status ${bundle.status}, ${bundle.text.length} bytes`)
  check('the bundle self-registers', bundle.text.includes('__ModuleLoader__') && bundle.text.includes(pluginName))
  check('the bundle carries its inlined core', bundle.text.includes('__DSH_WEATHER_CORE__'))
  check('the bundle carries both dictionaries', bundle.text.includes('panel.hourly') && bundle.text.includes('\\u5929\\u6c14'))
} catch (cause) {
  failures += 1
  console.log('FAIL transport —', cause.message, cause.cause?.message ?? '')
}

console.log(failures === 0 ? '\nserver check passed' : `\nserver check failed (${failures})`)
if (failures > 0) process.exitCode = 1
