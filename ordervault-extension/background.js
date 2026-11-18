/* Keeps the saved orders and the reminder for orders still on their way. Everything stays on this device. */
importScripts('lib/common.js', 'lib/merge.js', 'lib/myntra.js', 'lib/crawl.js')
const OV = self.OV
const KEY = 'orders'
const META = 'meta'
const MAX_PER_SHOP = 3000
const REFRESH_AFTER_MS = 6 * 3600 * 1000
let queue = Promise.resolve()

// All writes go through one queue so two pages reporting at once cannot overwrite each other.
const serial = (fn) => (queue = queue.then(fn, fn))

async function load() {
  const got = await chrome.storage.local.get([KEY, META])
  return { orders: got[KEY] || {}, meta: got[META] || {} }
}

async function ingest(msg) {
  const { orders, meta } = await load()
  const incoming = (msg.orders || []).filter(o => o && typeof o.id === 'string' && o.id.length < 200)
  // The lines of cards whose status could not be read are kept per order (in meta, not on the order itself), so the popup
  // can show what those cards say. An order drops out of the list as soon as it has a status.
  const unread = { ...(meta.unread || {}) }
  const shop = { ...(unread[msg.store] || {}) }
  for (const o of incoming) {
    if (Array.isArray(o.unread)) shop[o.id] = o.unread.filter(l => typeof l === 'string').slice(0, 14)
    else delete shop[o.id]
    delete o.unread
  }
  delete meta.unreadLines   // the older, shop-less tally
  const { map, added, changed } = OV.mergeAll(orders, incoming)
  for (const id of Object.keys(shop)) if (!map[id] || (map[id].status && map[id].status !== 'Unknown')) delete shop[id]
  meta.unread = { ...unread, [msg.store]: shop }
  // A size limit, per shop: one shop's long history can never push another shop's orders out. Within a shop the oldest go
  // first, and anything still on its way or added by hand is always kept.
  const byShop = {}
  for (const id of Object.keys(map)) (byShop[map[id].store || '?'] = byShop[map[id].store || '?'] || []).push(id)
  for (const ids of Object.values(byShop)) {
    if (ids.length <= MAX_PER_SHOP) continue
    ids.sort((a, b) => String(map[b].placedAt || '').localeCompare(String(map[a].placedAt || '')))
    for (const id of ids.slice(MAX_PER_SHOP)) if (!OV.isActive(map[id]) && !map[id].manual) delete map[id]
  }
  // Order-like links a one-page read could not turn into orders: kept (shapes only) so they can be looked at in the popup.
  if (Array.isArray(msg.unmatched)) meta.unmatched = { ...(meta.unmatched || {}), [msg.store]: msg.unmatched.length ? { at: new Date().toISOString(), shapes: msg.unmatched.slice(0, 10).map(s => [String(s[0]).slice(0, 120), Number(s[1]) || 0]) } : undefined }
  const m = { ...meta, lastRead:{ ...(meta.lastRead || {}), [msg.store]: { at: new Date().toISOString(), kind: msg.kind, count: incoming.length } } }
  if (!incoming.length && msg.empty) { if (m.unrecognised) delete m.unrecognised[msg.store] }   // an empty period, not a page the reader failed on
  else if (!incoming.length) m.unrecognised = { ...(m.unrecognised || {}), [msg.store]: { at: new Date().toISOString(), url: new URL(msg.url).origin + new URL(msg.url).pathname, outline: msg.outline || '', error: msg.error } }
  else if (m.unrecognised) delete m.unrecognised[msg.store]
  await chrome.storage.local.set({ [KEY]: map, [META]: m })
  await updateBadge(map)
  return { added, changed }
}

async function updateBadge(map) {
  const active = Object.values(map).filter(OV.isActive).length
  await chrome.action.setBadgeBackgroundColor({ color: '#7963f5' })
  await chrome.action.setBadgeText({ text: active ? String(Math.min(active, 99)) : '' })
}

// Reading every page of the Myntra list is driven from here, started by the popup button.
const crawler = OV.crawl({ api: chrome, ingest: (m) => serial(() => ingest(m)), done: (r) => announce('Myntra', r).catch(() => {}) })
crawler.listen()
const readShop = OV.readShop({ api: chrome, ingest: (m) => serial(() => ingest(m)) })
// After a complete Amazon read, saved Amazon entries that the read did not find are leftovers of earlier, wrong readings
// (session ids mistaken for order numbers, for instance). They are removed; entries added by hand are never touched.
const prune = (store, keepIds) => serial(async () => {
  const { orders, meta } = await load()
  const keep = new Set(keepIds)
  let removed = 0
  for (const id of Object.keys(orders)) if (orders[id].store === store && !orders[id].manual && !keep.has(id)) { delete orders[id]; removed++ }
  if (removed) { await chrome.storage.local.set({ [KEY]: orders }); await updateBadge(orders) }
  return removed
})
const amazonCrawler = OV.crawlAmazon({ api: chrome, ingest: (m) => serial(() => ingest(m)), prune, done: (r) => announce('Amazon', r).catch(() => {}) })
// If this process was restarted while an Amazon read was under way (the extension reloaded, or Chrome stopped it for being
// idle), carry on from where it was. A short alarm keeps waking it while the read lasts.
amazonCrawler.resume().catch(() => {})
crawler.resume().catch(() => {})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return
  // One button per shop, from the popup only. Each opens its orders page in a background tab, reads it, and closes it.
  if (msg.type === 'ov:read-shop' && !sender.tab) {
    const store = String(msg.store)
    chrome.storage.local.get('crawl').then(async (got) => {
      if (got.crawl && got.crawl.running && Date.now() - (got.crawl.updatedAt || 0) < 90000) return sendResponse({ ok: false, message: `${got.crawl.store || 'A shop'} is still being read. Press Stop first, or wait until it finishes.` })
      const speed = ['careful', 'normal', 'fast'].includes(msg.speed) ? msg.speed : 'normal'
      if (store === 'Amazon') { await amazonCrawler.start(speed); return sendResponse({ ok: true, message: 'Reading Amazon in background tabs that close by themselves.' }) }
      if (store === 'Myntra') { await crawler.start(null, speed); return sendResponse({ ok: true, message: 'Reading Myntra in background tabs that close by themselves.' }) }
      const res = await readShop(store)
      announce(store, res).catch(() => {})
      sendResponse(res)
    }).catch((e) => sendResponse({ ok: false, message: String((e && e.message) || e) }))
    return true
  }
  if (msg.type === 'ov:crawl-stop') {
    Promise.all([crawler.stop(), amazonCrawler.stop()]).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }))
    return true
  }
  // Only pages of the three shops, in a real tab, may report orders.
  if (msg.type === 'ov:orders') {
    let ok = false
    try { const h = new URL(sender.url || '').hostname; ok = /(?:^|\.)(?:amazon\.in|flipkart\.com|myntra\.com)$/.test(h) && sender.tab } catch (e) { ok = false }
    if (!ok) return
    serial(() => ingest(msg)).then(r => sendResponse(r), () => sendResponse({ error: true }))
    return true
  }
})

// Once a day (and at install) a reminder to open the shop pages, because only an open page can be read.
chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create('ov-stale', { periodInMinutes: 360 })
  const { orders } = await load()
  await updateBadge(orders)
})
chrome.runtime.onStartup.addListener(async () => { const { orders } = await load(); await updateBadge(orders) })

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'ov-crawl') { amazonCrawler.resume().catch(() => {}); crawler.resume().catch(() => {}); return }
  if (alarm.name !== 'ov-stale') return
  const { orders, meta } = await load()
  const now = Date.now()
  const stale = Object.values(orders).filter(o => OV.isActive(o) && now - new Date((o.live || {}).checkedAt || 0).getTime() > REFRESH_AFTER_MS)
  if (!stale.length) return
  // At most one reminder a day.
  if (meta.lastReminder && now - new Date(meta.lastReminder).getTime() < 22 * 3600 * 1000) return
  await chrome.storage.local.set({ [META]: { ...meta, lastReminder: new Date().toISOString() } })
  chrome.notifications.create('ov-stale', {
    type: 'basic', iconUrl: iconDataUrl(), title: 'OrderVault Tracker',
    message: `${stale.length} order${stale.length === 1 ? ' is' : 's are'} still on the way. Open your Amazon, Flipkart or Myntra orders page to refresh them.`
  })
})

// ------------------------------------------------------------ "read finished" notices and history
//
// When a read of a shop ends (every page of Myntra, every period of Amazon, the whole Flipkart list), a desktop notice says
// which shop, how many orders and at what time, and the same line is kept in a short history shown in the popup.

const HISTORY_MAX = 30
/** "2 min 14 s", "48 s", "1 h 05 min": how long a read took. */
const fmtTaken = (ms) => {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s < 60) return s + ' s'
  const m = Math.floor(s / 60)
  if (m < 60) return m + ' min ' + String(s % 60).padStart(2, '0') + ' s'
  return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min'
}

/** Records one finished read and shows the notice. `ok` is false for a read that stopped early or found nothing. */
function announce(store, result) { return serial(() => announceNow(store, result)) }
async function announceNow(store, result) {
  const at = new Date()
  const { orders, meta } = await load()
  const saved = Object.values(orders).filter(o => o.store === store).length
  const entry = {
    at: at.toISOString(), store, ok: !!result.ok, read: result.count || 0, saved,
    ms: typeof result.ms === 'number' ? result.ms : undefined,   // how long the read took
    // The one-line outcome shown in the history ("Done: 60 of 60 pages, 299 orders ...").
    text: String(result.message || '').slice(0, 300)
  }
  const history = [entry, ...(meta.history || [])].slice(0, HISTORY_MAX)
  await chrome.storage.local.set({ [META]: { ...meta, history } })
  if (meta.notify !== true) return   // desktop notices are off until switched on (in the Developer section of the popup)
  const took = typeof entry.ms === 'number' ? fmtTaken(entry.ms) : ''
  const title = result.ok ? `${store}: ${entry.read} order${entry.read === 1 ? '' : 's'} read` : `${store}: read did not finish`
  const body = result.ok
    ? `${took ? 'Time taken: ' + took + '. ' : ''}${saved} ${store} order${saved === 1 ? ' is' : 's are'} now saved on this device.`
    : `${took ? 'Stopped after ' + took + '. ' : ''}${entry.text || 'It stopped early.'}`.slice(0, 220)
  try { chrome.notifications.create('ov-read-' + store + '-' + at.getTime(), { type: 'basic', iconUrl: iconDataUrl(), title, message: body, priority: 1 }) } catch (e) { /* notices are optional */ }
}

// A solid 1x1 purple pixel keeps notifications working without shipping image files.
function iconDataUrl() {
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
}
