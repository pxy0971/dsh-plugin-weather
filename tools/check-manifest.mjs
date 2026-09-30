// Confirm the manifest resolves the way the Host's client-plugin scanner will.
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const pkgPath = process.argv[2] ?? 'D:/AI/DeepSeek Harness/my-plugin/package.json'
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const dir = pkgPath.slice(0, pkgPath.lastIndexOf('/'))

console.log('name             :', pkg.name)
console.log('dsh.client       :', JSON.stringify(pkg.dsh.client))
console.log('exports[./client]:', pkg.exports['./client'])

const resolved = join(dir, pkg.exports['./client'])
console.log('resolves to      :', resolved)
const exists = statSync(resolved, { throwIfNoEntry: false })
console.log('exists           :', exists !== undefined, exists?.size ?? 0, 'bytes')

if (exists !== undefined) {
  const source = readFileSync(resolved, 'utf8')
  const stamp = /PACKAGE_BUILD_STAMP = '([^']+)'/.exec(source)
  console.log('build stamp      :', stamp?.[1] ?? 'MISSING')
  console.log('self-registers   :', source.includes('__ModuleLoader__.load'))
  console.log('registration id  :', /id: '([^']+)'/.exec(source)?.[1] ?? 'MISSING')
  console.log('inlines core     :', source.includes('__DSH_WEATHER_CORE__'))
}
