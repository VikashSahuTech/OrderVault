import { mapPool } from './pool'

declare global {
  interface Window { google?: any }
}
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const ENV_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || ''
const CLIENT_ID_KEY = 'ov-google-client-id'

/** A client ID pasted in Setup & privacy (kept in this browser) wins over the one in .env. */
export function getStoredClientId(): string {
  try { return localStorage.getItem(CLIENT_ID_KEY) || '' } catch { return '' }
}
export function getClientId(): string {
  return getStoredClientId() || ENV_CLIENT_ID
}
export function isValidClientId(id: string): boolean {
  return /^[\w-]+\.apps\.googleusercontent\.com$/.test(id.trim()) && !id.startsWith('YOUR_')
}
/** Saves the pasted ID, or forgets it (empty string) so the .env value is used again. */
export function saveClientId(id: string): void {
  const value = id.trim()
  try {
    if (value) localStorage.setItem(CLIENT_ID_KEY, value)
    else localStorage.removeItem(CLIENT_ID_KEY)
  } catch { /* private mode: the ID only lasts until the page is closed */ }
}
export function isConfigured() {
  const id = getClientId()
  return !!id && !id.startsWith('YOUR_')
}
export function requestGmailToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) return reject(new Error('Google Identity Services did not load. Check your internet connection and refresh.'))
    if (!isConfigured()) return reject(new Error('Add your Google OAuth Client ID in Setup & privacy, then try again.'))
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: getClientId(),
      scope: SCOPE,
      callback: (response: any) => response?.access_token ? resolve(response.access_token) : reject(new Error(response?.error_description || response?.error || 'Google authorisation failed.'))
    })
    client.requestAccessToken({ prompt: 'consent' })
  })
}

export type LogLevel = 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR'
export type Logger = (level: LogLevel, message: string) => void

class GmailError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function gmailFetch(path: string, token: string, log?: Logger) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (response.ok) return response.json()
    const body = await response.json().catch(() => ({}))
    const message: string = body?.error?.message || `Gmail API error (${response.status})`
    const rateLimited = response.status === 429 || /quota|rate limit/i.test(message)
    if (!rateLimited || attempt >= 6) throw new GmailError(message, response.status)
    // Back off (10s, 20s, 30s...) so the per-minute quota can refill, then retry.
    const wait = 10 * (attempt + 1)
    log?.('WARN', `Gmail rate limit reached. Waiting ${wait}s, then retrying (${attempt + 1}/6)…`)
    await sleep(wait * 1000)
  }
}
function decodeBase64Url(value = ''): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized)
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
function collectBodies(part: any, mime: 'text/plain' | 'text/html' | 'both'): string[] {
  const result: string[] = []
  if (!part) return result
  if (part.body?.data && (mime === 'both' ? part.mimeType === 'text/plain' || part.mimeType === 'text/html' : part.mimeType === mime)) {
    result.push(decodeBase64Url(part.body.data))
  }
  for (const child of part.parts || []) result.push(...collectBodies(child, mime))
  return result
}
function header(headers: any[], name: string) {
  return headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || ''
}
const codePoint = (n: number) => n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' '
/**
 * Plain text from an email body. Line breaks are kept (block tags become newlines, table cells
 * become " | ") so the parser can read one value per line, e.g. a full product name.
 */
function toText(raw: string): string {
  return raw
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/t[dh]\s*>/gi, ' | ')
    .replace(/<\s*br\s*\/?>|<\/(?:p|div|tr|li|h[1-6]|table|section)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&rupee;/gi, '₹')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&amp;/gi, '&')
    .replace(/[ \t\f\v ​-‏⁠﻿]+/g, ' ')
    .replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n')
    .replace(/(?: \| ){2,}/g, ' | ')
    .trim()
}
export interface RawEmail {
  id: string; subject: string; from: string; date: string; body: string; snippet: string
  /** Original HTML, kept only for senders whose line items are read from the markup (Myntra). */
  html?: string
}
export interface FetchOptions {
  /** Only look at mail from the last N days (0 or undefined = no limit). */
  days?: number
  /** Stop after this many matching messages. */
  max?: number
  /** Receives progress messages for the sync log. */
  log?: Logger
}
const MARKETPLACE_SENDERS = 'from:amazon.in OR from:amazon.com OR from:flipkart.com OR from:myntra.com'
// Any shop's order mail usually has one of these in the subject, so this also finds stores we don't know by name.
const ORDER_SUBJECTS = 'order OR shipped OR shipment OR dispatched OR delivered OR "out for delivery" OR refund OR return OR cancelled OR purchase OR "thank you for shopping"'
const FETCH_CONCURRENCY = 6
export async function fetchOrderEmails(token: string, onProgress: (done:number,total:number)=>void, opts: FetchOptions = {}) {
  const { log } = opts
  const max = opts.max ?? 2000
  let q = `(${MARKETPLACE_SENDERS} OR subject:(${ORDER_SUBJECTS}))`
  if (opts.days) {
    const since = new Date(Date.now() - opts.days * 86400000)
    q += ` after:${since.getFullYear()}/${since.getMonth() + 1}/${since.getDate()}`
  }
  log?.('INFO', `Searching Gmail for order emails${opts.days ? ` from the last ${opts.days} days` : ' (all time)'}…`)
  let pageToken: string | undefined
  const ids: string[] = []
  do {
    const params = new URLSearchParams({ q, maxResults: '100' })
    if (pageToken) params.set('pageToken', pageToken)
    const data = await gmailFetch(`messages?${params.toString()}`, token, log)
    for (const item of data.messages || []) ids.push(item.id)
    pageToken = data.nextPageToken
    if (pageToken && ids.length < max) log?.('INFO', `Found ${ids.length} matching messages so far…`)
    if (ids.length >= max) break
  } while (pageToken)
  if (ids.length > max) ids.length = max
  log?.(ids.length ? 'SUCCESS' : 'WARN', ids.length ? `Found ${ids.length} matching messages${ids.length >= max ? ` (stopped at the ${max} limit; use a shorter Scan range to cover recent mail)` : ''}. Reading them one by one…` : 'No matching messages found.')

  let failed = 0
  let streak = 0
  // Several emails are read at once. One at a time was ~1 second each; Gmail allows far more than that.
  const results = await mapPool(ids, FETCH_CONCURRENCY, async (id): Promise<RawEmail | null> => {
    try {
      const msg = await gmailFetch(`messages/${id}?format=full`, token, log)
      const payload = msg.payload || {}
      const from = header(payload.headers, 'From')
      streak = 0
      return {
        id: msg.id,
        subject: header(payload.headers, 'Subject'),
        from,
        date: header(payload.headers, 'Date') || new Date(Number(msg.internalDate)).toISOString(),
        body: toText(collectBodies(payload, 'both').join('\n')),
        snippet: msg.snippet || '',
        html: /myntra/i.test(from) ? collectBodies(payload, 'text/html').join('\n') : undefined
      }
    } catch (e: any) {
      // A deleted or unreadable message shouldn't throw away everything read so far,
      // but an expired token or a run of failures means stop.
      if (e instanceof GmailError && e.status === 401) throw new Error('Google sign-in expired during the sync. Click Connect / sync Gmail to sign in again.')
      failed += 1; streak += 1
      log?.('WARN', `Skipped one email (${e?.message || 'unreadable'}).`)
      if (streak >= 5) throw new Error(`Gmail kept failing: ${e?.message || 'unknown error'}`)
      return null
    }
  }, done => {
    onProgress(done, ids.length)
    if (done % 50 === 0 && done < ids.length) log?.('INFO', `Read ${done} of ${ids.length} emails…`)
  })
  const emails = results.filter((m): m is RawEmail => m !== null)
  if (ids.length) log?.(failed ? 'WARN' : 'SUCCESS', `Read ${emails.length} of ${ids.length} emails${failed ? ` (${failed} skipped)` : ''}.`)
  return emails
}
