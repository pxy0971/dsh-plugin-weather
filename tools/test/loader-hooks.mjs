/**
 * Module-resolution hook that lets the test bench load the Host half offline.
 *
 * `lib/index.js` imports `defineTool` from `@deepseek-ai/dsh-tools`, which is only
 * available inside a running DSH installation. The bench must still cover the Host
 * code paths — config resolution, cache behaviour, and the model tool body — so this
 * hook rewrites exactly that one specifier to `./dsh-tools-stub.mjs`.
 *
 * Every other specifier resolves normally, so a future import that the bench cannot
 * satisfy fails loudly instead of being silently stubbed.
 */

import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const stubUrl = pathToFileURL(join(here, 'dsh-tools-stub.mjs')).href

/**
 * Redirect the `dsh-tools` specifier to the local stub.
 * @param specifier - the requested module specifier.
 * @param context - Node's resolve context.
 * @param nextResolve - the default resolver.
 * @returns the resolution result.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@deepseek-ai/dsh-tools') {
    return { url: stubUrl, shortCircuit: true, format: 'module' }
  }
  return nextResolve(specifier, context)
}
