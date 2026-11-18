/*
 * Runs on Amazon / Flipkart / Myntra pages. Reads only the order, status and tracking text the page
 * shows you, and hands it to the background worker. It never submits a form, clicks anything, or
 * sends data to any server. Pages that are not order pages are ignored.
 *
 * Flipkart and Myntra are single-page apps: clicking "Orders" changes the address without loading a
 * new page, so the address is watched and the page is read again whenever it changes.
 *
 * (The "read all pages" crawl is not here: the background worker drives it, see lib/crawl.js.)
 */
(function () {
  'use strict'
  const OV = self.OV
  if (!OV) return
  const READERS = [OV.amazon, OV.flipkart, OV.myntra].filter(Boolean)
  const reader = READERS.find(r => r.hosts.test(location.hostname))
  if (!reader) return

  let timer = null
  let lastSent = ''
  let lastHref = ''
  let obs = null
  let obsStop = null

  function run(reason) {
    if (!reader.kind(location.href)) return
    let result
    try { result = reader.parse(document, location.href, Date.now()) } catch (e) { result = { kind: reader.kind(location.href), orders: [], error: String((e && e.message) || e) } }
    const orders = result.orders || []
    const key = JSON.stringify(orders.map(o => [o.id, o.status, o.live && o.live.text, o.events && o.events.length]))
    if (key === lastSent && reason !== 'manual') return
    lastSent = key
    const msg = { type: 'ov:orders', store: reader.store, kind: result.kind, url: location.href, count: orders.length, orders, error: result.error }
    // If nothing was recognised on a page that should have orders, keep a layout outline (no text) so the reader can be fixed.
    // A page that says outright that it holds no orders (an empty year) is not a page the reader failed on.
    if (!orders.length && !result.error) {
      if (OV.saysEmpty(document)) msg.empty = true
      else msg.outline = OV.outline(document, 400)
    }
    try { chrome.runtime.sendMessage(msg).catch(() => {}) } catch (e) { /* extension reloaded: page will be read again on next visit */ }
  }

  // Order pages load their lists after the page itself, so read again shortly after things settle.
  function schedule(reason, delay) { clearTimeout(timer); timer = setTimeout(() => run(reason), delay) }

  function watchPage() {
    lastSent = ''
    clearTimeout(timer)
    if (obs) obs.disconnect()
    clearTimeout(obsStop)
    if (!reader.kind(location.href) || !document.body) return
    schedule('load', 1500)
    // Lists keep growing as you scroll, so keep listening for a while; reads are skipped when nothing changed.
    obs = new MutationObserver(() => schedule('change', 2500))
    obs.observe(document.body, { childList: true, subtree: true })
    obsStop = setTimeout(() => obs.disconnect(), 5 * 60 * 1000)
  }

  lastHref = location.href
  watchPage()
  const poll = setInterval(() => {
    // After the extension is reloaded or updated this script is orphaned: stop quietly.
    if (!chrome.runtime || !chrome.runtime.id) { clearInterval(poll); if (obs) obs.disconnect(); return }
    if (location.href !== lastHref) { lastHref = location.href; watchPage() }
  }, 1000)

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'ov:read-now') return
    if (!reader.kind(location.href)) {
      sendResponse({ ok: false, reason: `This is not a ${reader.store} orders page. Open your orders list or one order's details, then try again.` })
      return
    }
    run('manual')
    sendResponse({ ok: true, store: reader.store })
  })
})()
