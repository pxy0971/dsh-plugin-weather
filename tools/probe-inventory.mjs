/**
 * Read a live DSH Host's plugin-inventory snapshot.
 *
 * The inventory is what Settings → Plugins renders: one row per Loader entry with its
 * resolved module name, enablement, and `fiberPhase`. That last field is the one that
 * matters when a plugin is installed and toggled on but does nothing — `failed` means
 * the Host plugin never activated, `active` means it did and the problem is elsewhere.
 *
 *   node tools/probe-inventory.mjs [base-url]
 */

import { sessionCookieFor } from './session-cookie.mjs'

const [, , baseArg = 'http://127.0.0.1:19387'] = process.argv
const base = baseArg.replace(/\/+$/, '')

// The gateway requires the payload to be exactly `{ args }`: the RPC envelope carries
// one named-args object, not the business method's parameters directly.
const body = {
  type: 'client-request',
  rpcId: 'inventory-probe',
  method: 'pluginInventory/list',
  payload: { args: {} },
}

const response = await fetch(`${base}/api/pluginInventory/list`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', Cookie: sessionCookieFor(base) },
  body: JSON.stringify(body),
})

console.log('status            :', response.status)
const text = await response.text()
if (response.status !== 200) {
  console.log('body              :', JSON.stringify(text.slice(0, 400)))
  process.exit(1)
}

const envelope = JSON.parse(text)
if (envelope.result?.ok !== true) {
  console.log('rpc error         :', JSON.stringify(envelope.result?.error ?? envelope).slice(0, 600))
  process.exit(1)
}

const snapshot = envelope.result.value
const entries = snapshot.entries ?? []

console.log('entries           :', entries.length)
console.log('managementAvailable:', snapshot.managementAvailable)
console.log()

/** Rows worth showing: third-party, or anything whose fiber is not plainly active. */
const interesting = entries.filter(
  entry => !String(entry.moduleName).startsWith('@deepseek-ai/') || entry.fiberPhase !== 'active' || entry.enabled === false,
)

for (const entry of interesting) {
  const title = typeof entry.meta?.title === 'string' ? entry.meta.title : (entry.meta?.title?.en ?? '')
  console.log(
    [
      `phase=${String(entry.fiberPhase).padEnd(8)}`,
      `enabled=${String(entry.enabled).padEnd(5)}`,
      `id=${String(entry.entryId).padEnd(24)}`,
      `module=${entry.moduleName}`,
      title === '' ? '' : ` title=${JSON.stringify(title)}`,
      entry.meta?.error === undefined ? '' : ` ERROR=${JSON.stringify(String(entry.meta.error).slice(0, 300))}`,
    ]
      .filter(part => part !== '')
      .join(' '),
  )
}

console.log()
const weather = entries.filter(entry => /weather/i.test(`${entry.entryId} ${entry.moduleName}`))
console.log('weather rows      :', weather.length === 0 ? 'NONE' : JSON.stringify(weather, null, 2))
