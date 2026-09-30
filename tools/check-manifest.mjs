/**
 * Check that a package's `dsh.client` declaration resolves the way DSH's client-plugin
 * scanner will resolve it.
 *
 * The scanner reads `exports["./client"]` out of the package manifest and joins it to
 * the package directory, so a manifest that looks right can still point at a file that
 * is not there — and that failure surfaces only as a missing sidebar entry inside a
 * running Harness. This answers the question without booting anything.
 *
 * Leaving the argument out checks this repository's own manifest.
 *
 *   node tools/check-manifest.mjs [path/to/package.json]
 */

import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgPath = resolve(process.argv[2] ?? join(here, '..', 'package.json'))
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const dir = dirname(pkgPath)

console.log('manifest          :', pkgPath)
console.log('name              :', pkg.name)
console.log('dsh.client        :', JSON.stringify(pkg.dsh?.client))
console.log('exports[./client] :', pkg.exports?.['./client'])

const relative = pkg.exports?.['./client']
if (typeof relative !== 'string') {
  console.log('\nFAIL: exports["./client"] must be a string, or an object with a string default')
  process.exit(1)
}

const clientPath = join(dir, relative)
console.log('resolves to       :', clientPath)
const stat = statSync(clientPath, { throwIfNoEntry: false })
if (stat === undefined) {
  console.log('\nFAIL: that path does not exist, so the scanner would reject this package')
  process.exit(1)
}
console.log('exists            :', stat.size, 'bytes')

const source = readFileSync(clientPath, 'utf8')
const registeredId = /id: '([^']+)'/.exec(source)?.[1]
const stamp = /PACKAGE_BUILD_STAMP = '([^']+)'/.exec(source)

console.log('build stamp       :', stamp?.[1] ?? 'MISSING')
console.log('self-registers    :', source.includes('__ModuleLoader__.load'))
console.log('registration id   :', registeredId ?? 'MISSING')
console.log('inlines the core  :', source.includes('__DSH_WEATHER_CORE__'))

const problems = []
if (!source.includes('__ModuleLoader__.load')) problems.push('the bundle does not call window.__ModuleLoader__.load')
if (registeredId !== pkg.name) problems.push(`the bundle registers ${JSON.stringify(registeredId)} but the package is ${JSON.stringify(pkg.name)}`)

console.log(problems.length === 0 ? '\nmanifest check passed' : `\nmanifest check failed:\n  ${problems.join('\n  ')}`)
process.exitCode = problems.length === 0 ? 0 : 1
