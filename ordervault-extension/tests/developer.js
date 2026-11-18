/* The Developer switch in the popup: off by default; technical sections only when it is on; the green note always; notices off by default. */
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')
const root = path.join(__dirname, '..')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let fails = 0
const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + extra)) }

const css = fs.readFileSync(path.join(root, 'popup', 'popup.css'), 'utf8')

function open(store0) {
  const html = fs.readFileSync(path.join(root, 'popup', 'popup.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '')
  const dom = new JSDOM(html, { url: 'chrome-extension://abc/popup/popup.html', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window
  const store = JSON.parse(JSON.stringify(store0))
  const sent = []
  w.chrome = {
    storage: { local: {
      get: async (k) => { const r = {}; for (const key of [].concat(k)) if (key in store) r[key] = JSON.parse(JSON.stringify(store[key])); return r },
      set: async (r) => { for (const k of Object.keys(r)) store[k] = JSON.parse(JSON.stringify(r[k])) },
      remove: async () => {}
    }, onChanged: { addListener: () => {} } },
    tabs: { query: async () => [], sendMessage: async () => ({}) },
    runtime: { sendMessage: async (m) => { sent.push(m); return { ok: true, message: 'Reading Myntra in background tabs that close by themselves.' } } },
    action: { setBadgeText: async () => {} }
  }
  for (const f of ['lib/common.js', 'lib/merge.js', 'lib/search.js', 'popup/popup.js']) w.eval(fs.readFileSync(path.join(root, f), 'utf8'))
  return { w, store, sent }
}
const o = (id, extra) => ({ id: 'Amazon:' + id, store: 'Amazon', orderId: id, product: 'Item ' + id, status: 'Delivered', events: [], live: { checkedAt: '2026-11-12T10:00:00Z' }, ...(extra || {}) })
const shown = (w, sel) => { const e = w.document.querySelector(sel); return !!e && !e.hidden && !(e.closest('[hidden]')) }
// jsdom does not apply the stylesheet, so "hidden by CSS" is checked by rule: the rule must exist and the body class decides it
const cssHides = (sel) => new RegExp('body:not\\(\\.dev\\) ' + sel.replace(/[#.]/g, '\\$&') + '[,{]').test(css) || new RegExp('body:not\\(\\.dev\\) ' + sel.replace(/[#.]/g, '\\$&') + '\\{').test(css)

async function main() {
  const orders = { 'Amazon:1': o('1'), 'Amazon:2': o('2', { status: 'Unknown' }) }
  const meta = {
    lastRead: { Amazon: { at: new Date().toISOString(), kind: 'list', count: 2 } },
    history: [{ at: new Date().toISOString(), store: 'Amazon', ok: true, read: 2, saved: 2, ms: 5000, text: 'Done' }],
    unmatched: { Flipkart: { at: new Date().toISOString(), shapes: [['/minutes/order/<id>', 2]] } },
    unrecognised: { Myntra: { at: new Date().toISOString(), url: 'https://www.myntra.com/my/orders', outline: 'body' } }
  }
  const crawl = { running: false, store: 'Myntra', message: 'Done: 60 of 60 pages, 299 orders', trace: ['13:35:35 tab 1: reading page 51', '13:35:39 tab 2: reading page 52'], updatedAt: Date.now() }

  // ---- off by default
  const a = open({ orders, meta, crawl })
  await sleep(150)
  ok('developer: the switch is in the header and is off by default', !!a.w.document.querySelector('header #dev') && a.w.document.getElementById('dev').checked === false && !a.w.document.body.classList.contains('dev'))
  const html = fs.readFileSync(path.join(root, 'popup', 'popup.html'), 'utf8')
  ok('developer: it is a toggle switch (a sliding track), not a plain tick box', /class="switch dev-toggle"/.test(html) && /id="dev" role="switch"/.test(html) && /<span class="track"/.test(html) && /\.switch \.track\{[^}]*border-radius:999px/.test(css) && /\.switch input:checked \+ \.track::after\{[^}]*translateX/.test(css) && /\.switch input\{[^}]*opacity:0/.test(css), 'html/css')
  ok('developer: the notice option is a toggle switch too', /class="switch notify"/.test(html) && /id="notify" role="switch"/.test(html))
  ok('developer: both switches have a label that can be read out ( "Developer mode" on the left of its switch )', /aria-label="Developer mode"/.test(html) && /id="notify" role="switch" aria-label="Show a desktop notice/.test(html) && /<span class="lbl">Developer mode<\/span>\s*<input type="checkbox" id="dev"/.test(html))
  ok('developer: it is placed in the top right corner', /\.dev-toggle\{[^}]*position:absolute[^}]*top:\d+px[^}]*right:\d+px/.test(css))
  ok('developer off: the per-shop "saved · last read" lines, the history, and the three diagnostic lists are hidden by the stylesheet', ['#reads', '#history-note', '#unmatched-note', '#unread-note', '#help'].every(cssHides), ['#reads', '#history-note', '#unmatched-note', '#unread-note', '#help'].filter(s => !cssHides(s)).join())
  ok('developer off: the step log is not in the progress text', !/Steps:/.test(a.w.document.getElementById('crawl-msg').textContent), a.w.document.getElementById('crawl-msg').textContent)
  ok('developer off: a finished read shows nothing extra under the buttons', a.w.document.getElementById('crawl-msg').hidden === true, a.w.document.getElementById('crawl-msg').textContent)
  ok('developer off: one line still points out what needs attention', shown(a.w, '#attention') && /no status/.test(a.w.document.getElementById('attention').textContent) && /Developer/.test(a.w.document.getElementById('attention').textContent), a.w.document.getElementById('attention').textContent)
  ok('the orders, search and tabs are there either way', a.w.document.querySelectorAll('#list .item').length >= 1 && !!a.w.document.getElementById('q') && a.w.document.querySelectorAll('#tabs button').length > 0)

  // ---- on
  a.w.document.getElementById('dev').checked = true
  a.w.document.getElementById('dev').dispatchEvent(new a.w.Event('change', { bubbles: true }))
  await sleep(50)
  ok('developer on: the body is marked, so the stylesheet shows the technical sections', a.w.document.body.classList.contains('dev'))
  ok('developer on: the step log is shown', /Steps:/.test(a.w.document.getElementById('crawl-msg').textContent) && /reading page 52/.test(a.w.document.getElementById('crawl-msg').textContent), a.w.document.getElementById('crawl-msg').textContent)
  ok('developer on: the one-line pointer is gone (the details are there instead)', /body\.dev \.attention\{display:none\}/.test(css))
  ok('developer on: the setting is remembered', a.store.dev === true, JSON.stringify(a.store.dev))
  ok('developer on: the read lines per shop are filled in', /Amazon/.test(a.w.document.getElementById('reads').textContent) && /saved/.test(a.w.document.getElementById('reads').textContent), a.w.document.getElementById('reads').textContent)
  ok('developer on: the recent-reads list is filled in', a.w.document.querySelectorAll('#history-list li').length === 1)

  // ---- remembered across opening the popup
  const b = open({ orders, meta, crawl, dev: true })
  await sleep(150)
  ok('developer: stays on the next time the popup is opened', b.w.document.body.classList.contains('dev') && b.w.document.getElementById('dev').checked === true)
  const c = open({ orders, meta, crawl, dev: false })
  await sleep(150)
  ok('developer: stays off when it was left off', !c.w.document.body.classList.contains('dev'))

  // ---- notices: off by default
  const d = open({ orders, meta, crawl })
  await sleep(150)
  ok('notice: "Show a desktop notice" is off by default', d.w.document.getElementById('notify').checked === false && !/id="notify"[^>]*checked/.test(fs.readFileSync(path.join(root, 'popup', 'popup.html'), 'utf8')))
  const e = open({ orders, meta: { ...meta, notify: true }, crawl })
  await sleep(150)
  ok('notice: and on only when it was switched on', e.w.document.getElementById('notify').checked === true)
  e.w.document.getElementById('notify').checked = false
  e.w.document.getElementById('notify').dispatchEvent(new e.w.Event('change', { bubbles: true }))
  await sleep(50)
  ok('notice: switching it off is saved', e.store.meta.notify === false, JSON.stringify(e.store.meta.notify))

  // ---- a problem is shown even without Developer
  const stopped = { running: false, store: 'Amazon', message: 'Stopped: Amazon opened a page other than your orders list (usually the sign-in page). Sign in, then press the Amazon button again.', trace: ['x'], updatedAt: Date.now() }
  const f = open({ orders, meta, crawl: stopped })
  await sleep(150)
  ok('developer off: a read that stopped still says why (a sign-in is needed)', f.w.document.getElementById('crawl-msg').hidden === false && /sign in/i.test(f.w.document.getElementById('crawl-msg').textContent) && !/Steps:/.test(f.w.document.getElementById('crawl-msg').textContent), f.w.document.getElementById('crawl-msg').textContent)
  const live = { running: true, store: 'Myntra', message: 'Read 20 of 60 pages', orders: 100, trace: ['x'], updatedAt: Date.now() }
  const g = open({ orders, meta, crawl: live })
  await sleep(150)
  ok('developer off: the Stop button is shown while a read runs', g.w.document.getElementById('crawl-stop').hidden === false)
  ok('developer off: the live progress text is not shown', g.w.document.getElementById('crawl-msg').hidden === true, g.w.document.getElementById('crawl-msg').textContent)

  // ---- the order count is said once in the progress text
  const countOf = (crawlState) => { const x = open({ orders, meta, crawl: crawlState, dev: true }); return x }
  const amz = countOf({ running: true, store: 'Amazon', message: 'Reading Amazon: 2026, page 12 · 461 orders so far', orders: 461, trace: [], updatedAt: Date.now() })
  await sleep(150)
  const t1 = amz.w.document.getElementById('crawl-msg').textContent
  ok('progress: an Amazon message that already has the count does not get it again', (t1.match(/orders so far/g) || []).length === 1 && /461 orders so far/.test(t1), t1)
  const myn = countOf({ running: true, store: 'Myntra', message: 'Read 20 of 60 pages', orders: 100, trace: [], updatedAt: Date.now() })
  await sleep(150)
  const t2 = myn.w.document.getElementById('crawl-msg').textContent
  ok('progress: a Myntra message with no count gets it once', (t2.match(/orders so far/g) || []).length === 1 && /Read 20 of 60 pages · 100 orders so far/.test(t2), t2)
  const none = countOf({ running: true, store: 'Amazon', message: 'Opening your Amazon orders', orders: 0, trace: [], updatedAt: Date.now() })
  await sleep(150)
  ok('progress: no count is shown before anything has been read', !/orders so far/.test(none.w.document.getElementById('crawl-msg').textContent), none.w.document.getElementById('crawl-msg').textContent)

  // ---- the green note: always, whatever the switch says
  ok('the green note is not under Developer: no rule hides it', !/body:not\(\.dev\)[^{]*#note/.test(css) && !/body:not\(\.dev\)[^{]*\.note/.test(css))
  ok('pressing a shop button shows the green note with Developer off', await (async () => {
    const h = open({ orders, meta, crawl })
    await sleep(150)
    ;[...h.w.document.querySelectorAll('#open-row button')].find(x => /Myntra/.test(x.textContent)).click()
    await sleep(200)
    const n = h.w.document.getElementById('note')
    return !n.hidden && /Reading Myntra in background tabs that close by themselves/.test(n.textContent) && !h.w.document.body.classList.contains('dev') && !/Open this window again/.test(n.textContent)
  })())

  // ---- the "no status" list shows the kept lines for Myntra, and says what to do when none were kept
  const withLines = open({ orders: { 'Myntra:iq1': { id: 'Myntra:iq1', store: 'Myntra', orderId: 'iq1', product: 'Zed Jacket', events: [], live: {} } }, meta: { unread: { Myntra: { 'Myntra:iq1': ['Delivery Rescheduled', 'We will update you soon'] } } }, dev: true })
  await sleep(150)
  const ut = withLines.w.document.getElementById('unread-text').textContent
  ok('no status: the lines the card shows are listed, by shop', /Myntra: 1 order with no status/.test(ut) && /Delivery Rescheduled/.test(ut) && /We will update you soon/.test(ut), ut)
  ok('no status: product names are not in the list', !/Zed/.test(ut), ut)
  const noLines = open({ orders: { 'Myntra:iq1': { id: 'Myntra:iq1', store: 'Myntra', orderId: 'iq1', product: 'Zed Jacket', events: [], live: {} } }, meta: {}, dev: true })
  await sleep(150)
  ok('no status: when no lines were kept (read before they were recorded) it says to press the shop button again', /press the shop button again/.test(noLines.w.document.getElementById('unread-text').textContent), noLines.w.document.getElementById('unread-text').textContent)

  // ---- the background: no desktop notice unless switched on
  const bg = fs.readFileSync(path.join(root, 'background.js'), 'utf8')
  ok('background: a desktop notice is shown only when switched on', /meta\.notify !== true\) return/.test(bg))

  for (const x of [a, b, c, d, e, f, g]) x.w.close()
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
}
main().catch(e => { console.log('ERR', e && e.stack || e); process.exit(1) })
