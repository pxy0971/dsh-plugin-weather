/**
 * Repro harness: boot a profile, read its plugin inventory, and report the
 * `fiberPhase` of selected rows.
 *
 * `plugins/**` failing to appear has two very different causes — the row was never
 * composed, or it was composed and its fiber never reached ACTIVE — and Settings'
 * "installed" list shows neither. The inventory RPC distinguishes them:
 *
 *   fiberPhase 'active'  the plugin body ran, so a missing client entry is a
 *                        client-side problem
 *   fiberPhase null      DISPOSED: the row exists but nothing is running it, so the
 *                        client scanner never sees a live package to advertise
 *   fiberPhase 'failed'  the plugin body threw; `meta.error` carries the message
 *
 * Usage: `node tools/check-inventory.mjs <base-url> <token>`
 */

import { sessionCookieFor } from './session-cookie.mjs'

const [, , baseArg = 'http://127.0.0.1:19411', token = ''] = process.argv
const base = baseArg.replace(/\/+$/, '')

// The launch token is optional: when the wrapper supplies it we exchange it, otherwise
// we fall back to the persistent secret so this works against an already-running Host.
let cookie
if (token !== '') {
  const exchange = await fetch(`${base}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' })
  cookie = (exchange.headers.get('set-cookie') ?? '').split(';', 1)[0]
} else {
  cookie = sessionCookieFor(base)
}

const response = await fetch(`${base}/api/pluginInventory/list`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', Cookie: cookie },
  body: JSON.stringify({
    type: 'client-request',
    rpcId: 'inventory',
    method: 'pluginInventory/list',
    payload: { args: {} },
  }),
})

const envelope = JSON.parse(await response.text())
if (envelope.result?.ok !== true) {
  console.log('rpc error:', JSON.stringify(envelope.result?.error ?? envelope).slice(0, 500))
  process.exit(1)
}

const entries = envelope.result.value.entries ?? []
const phases = {}
for (const entry of entries) phases[String(entry.fiberPhase)] = (phases[String(entry.fiberPhase)] ?? 0) + 1

console.log('inventory rows    :', entries.length)
console.log('phase histogram   :', JSON.stringify(phases))

const community = entries.filter(entry => !String(entry.moduleName).startsWith('@deepseek-ai/') && !String(entry.moduleName).startsWith('cordis:'))
console.log('\ncommunity rows:')
for (const entry of community) {
  console.log(
    `  phase=${String(entry.fiberPhase).padEnd(8)} enabled=${String(entry.enabled).padEnd(5)} ` +
      `id=${String(entry.entryId).padEnd(28)} module=${entry.moduleName}` +
      (entry.meta?.error === undefined ? '' : `\n      ERROR: ${String(entry.meta.error).slice(0, 400)}`),
  )
}

const disposed = entries.filter(entry => entry.fiberPhase === null && entry.enabled === true && !String(entry.entryId).includes(':'))
console.log('\nenabled-but-disposed (the contradictory state):', disposed.length === 0 ? 'none' : '')
for (const entry of disposed) console.log(`  id=${entry.entryId} module=${entry.moduleName}`)
