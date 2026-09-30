/**
 * Locate the DeepSeek Harness installation this repository's tooling drives.
 *
 * The integration checks need the installation's own executable, because the Desktop
 * profile can only be booted by the Desktop shell and the packaged CLI lives inside
 * `app.asar`. That path is machine-specific, so it is discovered rather than baked in:
 *
 *   1. `DSH_INSTALL_DIR`, when the operator sets it;
 *   2. the directory of the running `DeepSeek Harness.exe`, when this repository is
 *      being used from inside the installation tree;
 *   3. a small set of conventional locations.
 *
 * A wrong guess fails loudly with the list of what was tried, so a contributor on
 * another machine is told exactly which variable to set rather than getting an opaque
 * `ENOENT`.
 *
 * @module dsh-plugin-weather/tools/dsh-install
 */

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** Conventional installation roots, tried in order after the environment variable. */
const CONVENTIONAL_ROOTS = [
  'D:/AI/DeepSeek Harness',
  join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DeepSeek Harness'),
  join(process.env.ProgramFiles ?? '', 'DeepSeek Harness'),
  join(process.env['ProgramFiles(x86)'] ?? '', 'DeepSeek Harness'),
]

/**
 * Whether a directory looks like a DeepSeek Harness installation.
 * @param root - candidate installation root.
 * @returns true when the Desktop executable and the packaged payload are both there.
 */
function isInstallRoot(root) {
  if (root === '' || root === undefined) return false
  return existsSync(join(root, 'DeepSeek Harness.exe')) && existsSync(join(root, 'resources', 'app.asar'))
}

/**
 * Resolve the installation root.
 *
 * @param options - `required` throws instead of returning `undefined`.
 * @returns the installation root, or `undefined` when `required` is false and nothing
 *   matched.
 * @throws when `required` is true and no candidate is an installation.
 */
export function resolveInstallRoot(options = {}) {
  const tried = []
  const candidates = [
    process.env.DSH_INSTALL_DIR,
    // Walk up from this repository: a checkout placed inside the installation tree
    // finds its own installation without any configuration.
    ...ancestors(here, 4),
    ...CONVENTIONAL_ROOTS,
  ]

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === '') continue
    const root = resolve(candidate)
    tried.push(root)
    if (isInstallRoot(root)) return root
  }

  if (options.required !== true) return undefined
  throw new Error(
    'tools/dsh-install.mjs: could not find a DeepSeek Harness installation.\n' +
      'Set DSH_INSTALL_DIR to the folder containing "DeepSeek Harness.exe", for example:\n' +
      '  $env:DSH_INSTALL_DIR = "C:\\Program Files\\DeepSeek Harness"\n' +
      'Tried:\n' +
      tried.map(root => `  ${root}`).join('\n'),
  )
}

/**
 * List a directory and its ancestors, nearest first.
 * @param from - starting directory.
 * @param depth - how many levels up to include.
 * @returns absolute paths.
 */
function ancestors(from, depth) {
  const out = []
  let current = resolve(from)
  for (let level = 0; level <= depth; level++) {
    out.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return out
}

/**
 * Paths inside an installation that its tooling needs.
 * @param root - the installation root from {@link resolveInstallRoot}.
 * @returns the executable, CLI entry, and packaged payload paths.
 */
export function installPaths(root) {
  return {
    root,
    executable: join(root, 'DeepSeek Harness.exe'),
    cli: join(root, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'),
    payload: join(root, 'resources', 'app.asar', 'dsh'),
    runtime: join(root, 'resources', 'runtime'),
  }
}

export { here as toolsDirectory }
