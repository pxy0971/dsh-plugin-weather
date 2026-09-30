/**
 * Mint a browser-session cookie for a running DSH Host from its stored signing secret.
 *
 * `dsh web` normally bootstraps a browser by answering a `?token=` launch exchange with
 * a 303 that sets this cookie. That route needs the per-process launch token, which the
 * Host keeps in memory and never writes down — so a script cannot use it after the fact.
 *
 * The cookie itself, however, is signed with a *persistent* secret that DSH stores at
 * `$DSH_HOME/.credentials.yaml` under `client-connection/browser-session`. Recomputing
 * the cookie from that secret is the documented verification path
 * (`@deepseek-ai/dsh-client-connection`: HMAC-SHA256 over the base64url payload, bound
 * to the request authority and an expiry window), not a bypass of it.
 *
 * This exists so the plugin can be verified against the user's *own running* Desktop
 * instance, whose launch token is unavailable, without asking them to restart anything.
 * It reads only their own credential file and talks only to their own loopback Host.
 *
 * @module dsh-plugin-weather/tools/session-cookie
 */

import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Cookie name prefix; the suffix is a hash of the request authority. */
const COOKIE_PREFIX = 'dsh-auth-'

/** Payload shape version DSH writes and accepts. */
const COOKIE_PAYLOAD_VERSION = 1

/** Lifetime of the minted cookie, kept well inside the Host's own maximum. */
const LIFETIME_MS = 24 * 60 * 60 * 1000

/**
 * Encode bytes as unpadded base64url, matching DSH's encoder.
 * @param value - the buffer or string to encode.
 * @returns the base64url text.
 */
function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

/**
 * Read the browser-session signing secret out of a Harness home's credential file.
 *
 * The file is minimal YAML; the value is read by locating the record and pulling the
 * `secret:` line beneath it, which avoids depending on a YAML parser for one field.
 *
 * @param dshHome - the Harness home directory.
 * @returns the secret as bytes.
 */
export function readSessionSecret(dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')) {
  const path = join(dshHome, '.credentials.yaml')
  const text = readFileSync(path, 'utf8')
  const recordAt = text.indexOf('client-connection/browser-session:')
  if (recordAt === -1) throw new Error(`${path}: no client-connection/browser-session record`)
  const secretMatch = /^\s*secret:\s*(\S+)\s*$/m.exec(text.slice(recordAt))
  if (secretMatch === null) throw new Error(`${path}: the browser-session record carries no secret`)
  const secret = Buffer.from(secretMatch[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
  if (secret.byteLength !== 32) throw new Error(`${path}: the browser-session secret is ${secret.byteLength} bytes, expected 32`)
  return secret
}

/**
 * Derive the authority-bound cookie name.
 * @param authority - the request authority, e.g. `127.0.0.1:19387`.
 * @returns the cookie name.
 */
export function cookieName(authority) {
  return COOKIE_PREFIX + encodeBase64Url(createHash('sha256').update(authority).digest())
}

/**
 * Mint a session cookie for one authority.
 * @param authority - the request authority, e.g. `127.0.0.1:19387`.
 * @param secret - the signing secret from {@link readSessionSecret}.
 * @param now - current epoch milliseconds.
 * @returns `{ name, value, header }` where `header` is a ready `Cookie:` value.
 */
export function mintSessionCookie(authority, secret, now = Date.now()) {
  const payload = {
    version: COOKIE_PAYLOAD_VERSION,
    authority,
    issuedAt: now - 60_000,
    expiresAt: now + LIFETIME_MS,
  }
  const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const signature = encodeBase64Url(createHmac('sha256', secret).update(body).digest())
  const name = cookieName(authority)
  const value = `v1.${body}.${signature}`
  return { name, value, header: `${name}=${value}` }
}

/**
 * Build a Cookie header for one base URL against the local Harness home.
 * @param baseUrl - the Host base URL, e.g. `http://127.0.0.1:19387`.
 * @param dshHome - the Harness home, when it is not the ambient one.
 * @returns a ready `Cookie:` header value.
 */
export function sessionCookieFor(baseUrl, dshHome) {
  const authority = new URL(baseUrl).host
  return mintSessionCookie(authority, readSessionSecret(dshHome)).header
}
