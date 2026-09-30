/**
 * Real-browser acceptance check for the weather panel.
 *
 * Everything else in this repository's test estate runs without a browser: the domain
 * core, the bundle's parse/registration contract, and the component trees all pass
 * offline. None of that proves the panel actually mounts in DSH's own slot system
 * against a real React, a real DOM, and real network responses, which is exactly what
 * this script does.
 *
 * It drives headless Chrome over the DevTools Protocol — no Playwright, no npm
 * install — against a running DSH Web instance:
 *
 * 1. authenticate through the `?token=` launch exchange `dsh web` prints, so the
 *    browser-session cookie is minted the way a user's click would;
 * 2. wait for the client module system to boot and report per-plugin failures, which
 *    is how a bundle outside the platform module table would surface;
 * 3. click the panel's sidebar entry and assert the rendered panel contains live
 *    forecast data fetched from Open-Meteo;
 * 4. capture a screenshot so the result can be inspected rather than only asserted.
 *
 * Usage:
 *   node tools/browser-check.mjs <base-url> <token> [--out <png>] [--keep-open]
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root, so every default path is relative to the checkout. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

const args = process.argv.slice(2)
/**
 * Read a repeatable `--flag value` option.
 * @param name - flag name without dashes.
 * @param fallback - value used when the flag is absent.
 * @returns the parsed value.
 */
function option(name, fallback) {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? fallback : args[at + 1]
}

const positional = args.filter((value, index) => !value.startsWith('--') && (index === 0 || !args[index - 1].startsWith('--')))
// The wrapper passes the base URL as `scheme://authority/`, so the trailing slash has
// to go before any path is appended — `${base}/` would produce `//`, which the
// webserver rejects with a 400 before authentication is even considered.
const base = (positional[0] ?? 'http://127.0.0.1:19411').replace(/\/+$/, '')
const token = positional[1] ?? ''
const outPath = option('out', '')
const debugPort = Number(option('port', '19422'))
const userDataDir = option('profile', REPO_ROOT + '/.chrome-profile')

if (token === '') {
  console.error('usage: node tools/browser-check.mjs <base-url> <token> [--out <png>]')
  process.exit(2)
}

const failures = []

/**
 * Record one check.
 * @param label - what was checked.
 * @param ok - whether it held.
 * @param detail - extra context printed either way.
 */
function check(label, ok, detail = '') {
  if (!ok) failures.push(label)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
}

/**
 * Find an installed Chromium-family browser.
 * @returns the executable path.
 */
function findBrowser() {
  for (const candidate of CHROME_CANDIDATES) if (existsSync(candidate)) return candidate
  throw new Error('no Chrome or Edge installation found')
}

/**
 * Minimal DevTools Protocol client over one WebSocket.
 *
 * Node 22 ships a global `WebSocket`, so this needs no dependency.
 */
class Devtools {
  /**
   * @param url - the browser's WebSocket debugger URL.
   */
  constructor(url) {
    this.socket = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.events = []
    this.listeners = []
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.id !== undefined) {
        const entry = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (entry === undefined) return
        if (message.error !== undefined) entry.reject(new Error(`${entry.method}: ${message.error.message}`))
        else entry.resolve(message.result)
        return
      }
      this.events.push(message)
      for (const listener of this.listeners) listener(message)
    })
  }

  /**
   * Resolve once the socket is open.
   * @returns a promise resolving to this client.
   */
  ready() {
    if (this.socket.readyState === 1) return Promise.resolve(this)
    return new Promise((resolve, reject) => {
      this.socket.addEventListener('open', () => resolve(this), { once: true })
      this.socket.addEventListener('error', () => reject(new Error('devtools socket failed')), { once: true })
    })
  }

  /**
   * Send one protocol command.
   * @param method - protocol method name.
   * @param params - method parameters.
   * @param sessionId - optional attached target session.
   * @returns the command result.
   */
  send(method, params = {}, sessionId) {
    const id = this.nextId++
    const payload = { id, method, params }
    if (sessionId !== undefined) payload.sessionId = sessionId
    this.socket.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
    })
  }

  /**
   * Subscribe to protocol events.
   * @param listener - called with every event message.
   */
  on(listener) {
    this.listeners.push(listener)
  }

  /**
   * Evaluate an expression in a page and return its JSON value.
   * @param sessionId - the page session.
   * @param expression - the expression source.
   * @param awaitPromise - whether to await a returned promise.
   * @returns the evaluated value.
   */
  async evaluate(sessionId, expression, awaitPromise = false) {
    const result = await this.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise, userGesture: true },
      sessionId,
    )
    if (result.exceptionDetails !== undefined) {
      throw new Error(`page evaluate failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
    }
    return result.result.value
  }

  /** Close the socket. */
  close() {
    try {
      this.socket.close()
    } catch {
      /* already gone */
    }
  }
}

/**
 * Wait until a predicate over a page expression becomes truthy.
 * @param devtools - the protocol client.
 * @param sessionId - the page session.
 * @param expression - expression evaluated on each poll.
 * @param options - `timeoutMs`, `intervalMs`, and a `label` for the failure message.
 * @returns the first truthy value.
 */
async function waitFor(devtools, sessionId, expression, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000
  const intervalMs = options.intervalMs ?? 250
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      last = await devtools.evaluate(sessionId, expression)
      if (last) return last
    } catch (cause) {
      last = cause.message
    }
    await delay(intervalMs)
  }
  throw new Error(`timed out waiting for ${options.label ?? expression}: last=${JSON.stringify(last)}`)
}

const browserPath = findBrowser()
console.log('browser:', browserPath)
mkdirSync(userDataDir, { recursive: true })

const child = spawn(
  browserPath,
  [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=1440,1000',
    'about:blank',
  ],
  { stdio: 'ignore', detached: false },
)

let devtools
try {
  // The browser needs a moment before the debugging endpoint answers.
  let version
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json()
      break
    } catch {
      await delay(250)
    }
  }
  if (version === undefined) throw new Error(`the browser did not expose a debugging endpoint on ${debugPort}`)
  console.log('browser version:', version['Browser'])

  devtools = await new Devtools(version.webSocketDebuggerUrl).ready()
  await devtools.send('Target.setDiscoverTargets', { discover: true })
  const { targetId } = await devtools.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await devtools.send('Target.attachToTarget', { targetId, flatten: true })
  await devtools.send('Page.enable', {}, sessionId)
  await devtools.send('Runtime.enable', {}, sessionId)
  await devtools.send('Log.enable', {}, sessionId)
  await devtools.send('Network.enable', {}, sessionId)
  // A headless page reports `document.hasFocus() === false`. Focus emulation keeps the
  // page in the state a real user's window would be in.
  await devtools.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId).catch(() => undefined)

  /** Console errors and failed requests collected while the page runs. */
  const consoleErrors = []
  const failedRequests = []
  devtools.on(message => {
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' '))
    }
    if (message.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
    }
    if (message.method === 'Network.loadingFailed') {
      // `net::ERR_ABORTED` is what a request the page itself cancelled reports, which
      // the panel does on every city switch and unmount when it aborts the superseded
      // fetch. Only a genuine transport failure is interesting here.
      const errorText = String(message.params.errorText)
      const canceled = message.params.canceled === true || errorText.includes('ERR_ABORTED')
      if (!canceled) failedRequests.push(`${message.params.type}: ${errorText}`)
    }
  })

  // ---------------------------------------------------------------- authenticate
  //
  // `dsh web` mints its browser-session cookie by answering the token exchange with
  // a 303 whose Location is the directory-relative `./`. Two details matter:
  //
  // * the response must be read with `redirect: 'manual'` — following it re-requests
  //   the same path *without* the token, which the fence answers with a 401 and no
  //   cookie at all;
  // * the cookie belongs in the *browser's* jar, not this script's. It is therefore
  //   installed explicitly rather than relying on the earlier fetch.
  const authenticated = `${base}/?token=${encodeURIComponent(token)}`
  const exchange = await fetch(authenticated, { redirect: 'manual' })
  const setCookie = exchange.headers.get('set-cookie') ?? ''
  if (exchange.status !== 303) {
    console.log('exchange diagnostics:', JSON.stringify({
      requested: authenticated,
      status: exchange.status,
      location: exchange.headers.get('location'),
      contentType: exchange.headers.get('content-type'),
      body: (await exchange.text()).slice(0, 300),
    }))
  }
  check('the launch token exchanges for a session cookie', exchange.status === 303 && setCookie !== '', `status ${exchange.status}`)

  if (setCookie !== '') {
    const segments = setCookie.split(';')
    const [name, value] = [segments[0].slice(0, segments[0].indexOf('=')), segments[0].slice(segments[0].indexOf('=') + 1)]
    const origin = new URL(base).origin
    await devtools.send('Network.setCookie', {
      name,
      value,
      url: `${origin}/`,
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
    }, sessionId)
    const stored = await devtools.send('Network.getCookies', { urls: [`${origin}/`] }, sessionId)
    check('the session cookie reaches the browser jar', stored.cookies.some(entry => entry.name === name), `${stored.cookies.length} cookie(s)`)
  }

  // A fresh profile opens DSH's own first-run overlay: the preview note, then the
  // API-key onboarding. Both cover the panel with a mask that swallows clicks, so
  // they have to be dismissed before anything is clicked, and the injected script
  // repeats the dismissal for whichever appears later.
  const onboardingDismissLabels = [
    '继续',
    'Continue',
    '开始使用',
    'Get started',
    '稍后配置',
    'Configure later',
    '稍后再说',
    'Skip for now',
  ]
  await devtools.send(
    'Page.addScriptToEvaluateOnNewDocument',
    {
      source: `(() => {
        const labels = ${JSON.stringify(onboardingDismissLabels)}
        const dismiss = () => {
          for (const entry of document.querySelectorAll('button')) {
            if (labels.includes((entry.innerText ?? '').trim())) { entry.click(); return true }
          }
          return false
        }
        const timer = setInterval(dismiss, 200)
        setTimeout(() => clearInterval(timer), 30000)
      })()`,
    },
    sessionId,
  )

  await devtools.send('Page.navigate', { url: `${base}/` }, sessionId)
  await waitFor(devtools, sessionId, 'document.readyState === "complete"', { label: 'the document to load' })
  const title = await devtools.evaluate(sessionId, 'document.title')
  check('the authenticated document loads', typeof title === 'string' && title.length > 0, `title ${JSON.stringify(title)}`)

  // Dismiss both overlays explicitly as well, then confirm neither is left — a click
  // swallowed by their mask would otherwise look like a broken control.
  const dismissNow = `(() => {
     const labels = ${JSON.stringify(onboardingDismissLabels)}
     let clicked = false
     for (const entry of document.querySelectorAll('button')) {
       if (labels.includes((entry.innerText ?? '').trim())) { entry.click(); clicked = true }
     }
     return clicked
   })()`
  await devtools.evaluate(sessionId, dismissNow)
  await delay(800)
  await devtools.evaluate(sessionId, dismissNow)
  await delay(800)
  const onboardingGone = await devtools.evaluate(
    sessionId,
    `(() => {
       const labels = ${JSON.stringify(onboardingDismissLabels)}
       return ![...document.querySelectorAll('button')].some(entry => labels.includes((entry.innerText ?? '').trim()))
     })()`,
  )
  check('the host first-run overlays are dismissed', onboardingGone === true)

  // The host injects `__DSH_BOOT__` as `{ rev, entries: [{ id, url, … }] }`; the row
  // ids are the packages the page will load, so this is the authoritative answer to
  // "did DSH compose this plugin into the client module graph".
  const boot = await devtools.evaluate(
    sessionId,
    `(() => {
       const graph = window.__DSH_BOOT__
       if (graph === undefined) return JSON.stringify({ present: false })
       const entries = graph.entries ?? graph.modules ?? graph.plugins ?? []
       const ids = entries.map(entry => (typeof entry === 'string' ? entry : entry.id))
       return JSON.stringify({
         present: true,
         total: ids.length,
         weather: ids.filter(id => String(id).includes('weather')),
       })
     })()`,
  )
  const parsedBoot = JSON.parse(String(boot))
  check(
    'the boot graph offers the weather plugin',
    parsedBoot.present === true && parsedBoot.weather.length > 0,
    `${parsedBoot.total ?? 0} row(s), weather: ${JSON.stringify(parsedBoot.weather ?? [])}`,
  )

  if (parsedBoot.weather?.length === 0) {
    const diagnostics = await devtools.evaluate(
      sessionId,
      `JSON.stringify({
         url: location.href,
         title: document.title,
         moduleRows: (window.__DSH_BOOT__?.entries ?? []).length,
         rootHtmlLength: document.getElementById('root')?.innerHTML.length ?? -1,
         bodyText: (document.body?.innerText ?? '').slice(0, 600),
       })`,
    )
    console.log('page diagnostics:', diagnostics)
    console.log('console errors:', JSON.stringify(consoleErrors.slice(0, 6), null, 2))
    console.log('failed requests:', JSON.stringify(failedRequests.slice(0, 6), null, 2))
    const indexHtml = await (await fetch(`${base}/`, { headers: { Cookie: setCookie.split(';', 1)[0] } })).text().catch(() => '')
    writeFileSync(join(REPO_ROOT, 'docs', 'index-dump.html'), indexHtml)
    throw new Error('the page booted without offering the weather plugin')
  }

  // ------------------------------------------------------------------- load the app
  const panelReady = await waitFor(
    devtools,
    sessionId,
    `(() => {
       const rows = [...document.querySelectorAll('button[aria-label]')]
       return rows.some(row => row.getAttribute('aria-label') === '天气' || row.getAttribute('aria-label') === 'Weather')
     })()`,
    { label: 'the weather sidebar entry to render', timeoutMs: 45_000 },
  )
  check('the sidebar entry renders', panelReady === true)

  // The module system records a per-plugin import failure; surface it rather than
  // letting a missing bundle look like a slow network.
  const moduleStatus = await devtools.evaluate(
    sessionId,
    `(() => {
       try {
         const text = document.body.innerText
         return text.includes('client bundles not found') || text.includes('did not register') ? text.slice(0, 300) : ''
       } catch { return '' }
     })()`,
  )
  check('no client-bundle failure is reported on the page', moduleStatus === '', String(moduleStatus).slice(0, 200))

  // ------------------------------------------------------------------ open the panel
  const clicked = await devtools.evaluate(
    sessionId,
    `(() => {
       const row = [...document.querySelectorAll('button[aria-label]')]
         .find(candidate => ['天气', 'Weather'].includes(candidate.getAttribute('aria-label')))
       if (row === undefined) return 'no row'
       row.click()
       return 'clicked'
     })()`,
  )
  check('the sidebar entry is clickable', clicked === 'clicked', clicked)

  const panelText = await waitFor(
    devtools,
    sessionId,
    `(() => {
       const root = document.querySelector('.dshw-root')
       if (root === null) return ''
       const text = root.innerText
       return text.length > 120 ? text : ''
     })()`,
    { label: 'the panel to render its forecast', timeoutMs: 45_000 },
  )
  check('the panel mounts', typeof panelText === 'string' && panelText.length > 120, `${String(panelText).length} chars`)

  const normalized = String(panelText).replace(/\s+/g, ' ')
  check('the panel shows the current temperature', /\d+°[CF]/.test(normalized), normalized.slice(0, 120))
  check('the panel shows the hourly section', /(Next 24 hours|未来 24 小时)/.test(normalized))
  check('the panel shows the daily section', /(7-day forecast|7 天预报)/.test(normalized))
  check('the panel shows the life indices', /(Life indices|生活指数)/.test(normalized))
  check('the panel shows the city chips', /(杭州|北京)/.test(normalized))
  check(
    'the panel reports no load failure',
    !/(Could not load weather|天气获取失败|Loading weather|正在获取天气)/.test(normalized),
    normalized.slice(0, 200),
  )

  // The sparkline and range bars are the parts a text assertion cannot see.
  const svgCount = await devtools.evaluate(sessionId, 'document.querySelectorAll(".dshw-root svg.dshw-spark path").length')
  check('the temperature sparkline draws', Number(svgCount) >= 1, `${svgCount} path(s)`)

  const chipCount = await devtools.evaluate(sessionId, 'document.querySelectorAll(".dshw-chip").length')
  check('the city chips render', Number(chipCount) >= 2, `${chipCount} chip(s)`)

  // ------------------------------------------------------------- city switching
  //
  // The chip row is the primary switch control and the part a user touches most, so
  // it is asserted by clicking it rather than by reaching through React internals.
  const beforeSwitch = await devtools.evaluate(
    sessionId,
    'document.querySelector(".dshw-root .dshw-hero-where")?.innerText ?? ""',
  )
  check('the panel names the selected city', String(beforeSwitch).includes('杭州'), JSON.stringify(beforeSwitch))

  const switched = await devtools.evaluate(
    sessionId,
    `(() => {
       const chip = [...document.querySelectorAll('.dshw-chip')].find(entry => entry.innerText.includes('北京'))
       if (chip === undefined) return 'no chip'
       chip.click()
       return 'clicked'
     })()`,
  )
  check('the second city chip is clickable', switched === 'clicked', switched)

  const afterSwitch = await waitFor(
    devtools,
    sessionId,
    `(() => {
       const text = document.querySelector('.dshw-root .dshw-hero-where')?.innerText ?? ''
       return text.includes('北京') ? text : ''
     })()`,
    { label: 'the panel to switch to the second city', timeoutMs: 30_000 },
  )
  check('clicking a chip switches the panel', String(afterSwitch).includes('北京'), JSON.stringify(afterSwitch))

  const activeChip = await devtools.evaluate(
    sessionId,
    'document.querySelector(".dshw-chip[data-active=true]")?.innerText ?? ""',
  )
  check('the selected chip is marked active', String(activeChip).includes('北京'), JSON.stringify(activeChip))

  // ------------------------------------------------------------------ unit switch
  const unitSwitch = await devtools.evaluate(
    sessionId,
    `(() => {
       const segments = [...document.querySelectorAll('.dshw-segment')]
       const imperial = segments.find(entry => /Fahrenheit|华氏/.test(entry.innerText))
       if (imperial === undefined) return 'no segment'
       imperial.click()
       return 'clicked'
     })()`,
  )
  check('the unit switch is clickable', unitSwitch === 'clicked', unitSwitch)
  const imperialShown = await waitFor(
    devtools,
    sessionId,
    `(() => document.body.innerText.includes('°F') ? 'imperial' : '')()`,
    { label: 'the panel to re-render in Fahrenheit', timeoutMs: 30_000 },
  )
  check('switching units re-renders the forecast', imperialShown === 'imperial')

  // The search box is asserted as present rather than driven: a synthetic `input`
  // event cannot update a React controlled input, and the geocoding path behind it is
  // covered by the Host bench. Its sibling assertions here are the interaction proof.
  const searchUi = await devtools.evaluate(
    sessionId,
    `JSON.stringify({
       input: document.querySelectorAll('.dshw-root input[type=text]').length,
       labelled: document.querySelector('.dshw-root input[type=text]')?.getAttribute('aria-label') ?? '',
     })`,
  )
  const parsedSearch = JSON.parse(searchUi)
  check('the search field is present and labelled', parsedSearch.input === 1 && parsedSearch.labelled !== '', searchUi)

  // The build stamp the page is actually running. Reported as evidence rather than
  // asserted against a constant, because a stale bundle is exactly the failure this
  // check exists to make visible: the sidebar label can be right while the code
  // behind it is not the code just built.
  const buildStamp = await devtools.evaluate(
    sessionId,
    'document.querySelector(".dshw-root [data-dshw-build]")?.getAttribute("data-dshw-build") ?? ""',
  )
  check('the panel reports which build it is running', String(buildStamp).includes('dsh-plugin-weather@'), String(buildStamp))

  check('no uncaught page exception occurred', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
  check('no plugin resource failed to load', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '))

  // Captured last, so the image shows the post-interaction state — second city
  // selected, units switched — which is what a reviewer needs to see.
  if (outPath !== '') {
    const shot = await devtools.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId)
    const target = outPath.startsWith('/') || /^[A-Za-z]:/.test(outPath) ? outPath : `${process.cwd()}/${outPath}`
    writeFileSync(target, Buffer.from(shot.data, 'base64'))
    console.log('screenshot:', target)
  }
} catch (cause) {
  failures.push('harness')
  console.log('FAIL harness —', cause.message)
} finally {
  devtools?.close()
  child.kill()
}
console.log(failures.length === 0 ? '\nbrowser check passed' : `\nbrowser check failed: ${failures.join(', ')}`)
if (failures.length > 0) process.exitCode = 1
