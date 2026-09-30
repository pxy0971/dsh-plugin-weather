/**
 * Start a profile's Web UI, read the launch token from its banner, and hand both to
 * another command.
 *
 * `dsh web` mints a fresh browser-session token per process and prints its
 * pre-authenticated URL once, so any scripted check against a *new* instance needs to
 * capture that line. This wrapper does the capture, waits for the port to answer, runs
 * the child command, and always tears the server down again:
 *
 *   node tools/with-web.mjs --profile weathersmoke --port 19411 -- node tools/browser-check.mjs
 *
 * The child receives the base URL and the token as its last two arguments, so
 * `node tools/browser-check.mjs <base> <token>` works unchanged.
 */

import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/**
 * Build the argv that `resources/runtime/cli/bin/dsh.cmd` expands to.
 *
 * The shim sets `ELECTRON_RUN_AS_NODE=1` and runs the Desktop installation's own
 * executable against the packaged CLI entry. Launching that directly — instead of
 * going through `cmd.exe` — keeps the arguments intact when a path contains a space,
 * which `shell: true` mangles.
 *
 * @returns `{ executable, args, env }` for the spawn call.
 */
function dshLaunch() {
  const install = 'D:/AI/DeepSeek Harness'
  return {
    executable: join(install, 'DeepSeek Harness.exe'),
    args: [
      '--expose-internals',
      `${install}/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js`,
    ],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }
}

const argv = process.argv.slice(2)
/**
 * Read a repeatable `--flag value` option.
 * @param name - flag name without dashes.
 * @param fallback - value used when the flag is absent.
 * @returns the parsed value.
 */
function option(name, fallback) {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? fallback : argv[at + 1]
}

const profile = option('profile', 'weathersmoke')
const port = Number(option('port', '19411'))
const dshHome = option('home', join(root, '.dsh-test'))
const separator = argv.indexOf('--')
const command = separator === -1 ? ['node', 'tools/browser-check.mjs'] : argv.slice(separator + 1)
const logDir = join(root, '.dsh-test', 'logs')
mkdirSync(logDir, { recursive: true })
const stdoutPath = join(logDir, `web-${port}.out.log`)
const stderrPath = join(logDir, `web-${port}.err.log`)
const stdout = createWriteStream(stdoutPath)
const stderr = createWriteStream(stderrPath)

// A previous run's banner would be read as this run's token, so start from empty files.
rmSync(stdoutPath, { force: true })
rmSync(stderrPath, { force: true })

const launch = dshLaunch()
const server = spawn(launch.executable, [...launch.args, '--profile', profile, '--no-open', '--port', String(port)], {
  cwd: root,
  env: { ...process.env, ...launch.env, DSH_HOME: dshHome },
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.pipe(stdout)
server.stderr.pipe(stderr)
server.on('error', cause => {
  console.log('server failed to start:', cause.message)
})

/**
 * Read the accumulated stdout so far.
 * @returns the log text.
 */
function readLog() {
  try {
    return readFileSync(stdoutPath, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Read the accumulated stderr so far.
 * @returns the log text.
 */
function readError() {
  try {
    return readFileSync(stderrPath, 'utf8')
  } catch {
    return ''
  }
}

let exitCode = 1
try {
  /** The pre-authenticated URL printed exactly once per process. */
  let launchUrl
  for (let attempt = 0; attempt < 240; attempt++) {
    const match = /dsh web: (\S+)/.exec(readLog())
    if (match !== null) {
      launchUrl = match[1]
      break
    }
    if (server.exitCode !== null) break
    await delay(500)
  }
  if (launchUrl === undefined) {
    throw new Error(`no launch URL after 120s. stderr:\n${readError().slice(-2000)}`)
  }
  const token = new URL(launchUrl).searchParams.get('token')
  const base = launchUrl.replace(/\?.*$/, '')
  console.log('dsh web:', base, '(token captured)')

  // Wait for the listener to accept requests before handing over.
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(`${base}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' })
      if (response.status === 303 || response.status === 200) break
    } catch {
      /* not listening yet */
    }
    await delay(500)
  }

  exitCode = await new Promise(resolve => {
    const child = spawn(command[0], [...command.slice(1), base, token], { cwd: root, stdio: 'inherit' })
    child.on('exit', code => resolve(code ?? 1))
    child.on('error', cause => {
      console.log('child failed to start:', cause.message)
      resolve(1)
    })
  })

  // A startup failure report is the most useful thing to surface if the child passed
  // but the host itself complained while composing.
  const errors = readError()
  if (/startup failed|did not activate/.test(errors)) {
    console.log('\nhost reported activation problems:\n' + errors.slice(-3000))
    exitCode = 1
  }
} catch (cause) {
  console.log('FAIL wrapper —', cause.message)
} finally {
  server.kill()
  await delay(500)
  if (server.exitCode === null) server.kill('SIGKILL')
}

process.exitCode = exitCode
