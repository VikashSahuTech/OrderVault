/* Guards against text being mangled on its way to the screen (a lost backslash in a pattern once removed every "s" from the status line). */
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')
const root = path.join(__dirname, '..')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let fails = 0
const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + extra)) }

function open(orders) {
  const html = fs.readFileSync(path.join(root, 'popup', 'popup.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '')
  const w = new JSDOM(html, { url: 'chrome-extension://abc/popup/popup.html', runScripts: 'outside-only', pretendToBeVisual: true }).window
  const store = { orders, meta: {} }
  w.chrome = { storage: { local: { get: async (k) => { const r = {}; for (const key of [].concat(k)) if (key in store) r[key] = JSON.parse(JSON.stringify(store[key])); return r }, set: async () => {}, remove: async () => {} }, onChanged: { addListener: () => {} } },
    tabs: { query: async () => [], sendMessage: async () => ({}) }, runtime: { sendMessage: async () => ({ ok: true }) }, action: { setBadgeText: async () => {} } }
  for (const f of ['lib/common.js', 'lib/merge.js', 'lib/search.js', 'popup/popup.js']) w.eval(fs.readFileSync(path.join(root, f), 'utf8'))
  return w
}
const o = (id, extra) => ({ id: 'Amazon:' + id, store: 'Amazon', orderId: id, product: 'Item ' + id, status: 'Shipped', events: [], live: { checkedAt: new Date().toISOString() }, ...(extra || {}) })

async function main() {
  // Words with every letter the shop's status lines use: if any pattern eats letters, one of these changes.
  const lines = ['Arriving Tuesday', 'In Transit', 'Out for delivery', 'Delivered 2 November', 'Your return is in transit. Your refund has been issued.', 'Subscription charged on 3 February 2026', 'Closed due to lack of payment', 'Package was handed to the resident', 'Sessions: assess the surest substitutes']
  const w = open(Object.fromEntries(lines.map((t, i) => [`Amazon:s${i}`, o('s' + i, { live: { text: t, checkedAt: new Date().toISOString() }, status: 'Shipped' })])))
  await sleep(150)
  const all = [...w.document.querySelectorAll('#tabs button')].find(b => /^All/.test(b.textContent))
  all.click()
  const shown = [...w.document.querySelectorAll('#list .item .said')].map(n => n.textContent)
  for (const t of lines) ok('text: "' + t + '" reaches the screen unchanged', shown.includes(t) || w.document.body.textContent.includes(t), JSON.stringify(shown))

  // The extension's own bracketed notes are removed, and only those
  const w2 = open({ 'Amazon:n1': o('n1', { status: 'Delivered', live: { text: 'Delivered (not stated: the card offers a review or return)', checkedAt: new Date().toISOString() } }), 'Amazon:n2': o('n2', { status: 'Shipped', live: { text: 'Arriving (Tuesday) by courier', checkedAt: new Date().toISOString() } }) })
  await sleep(150)
  ;[...w2.document.querySelectorAll('#tabs button')].find(b => /^All/.test(b.textContent)).click()
  const body = w2.document.body.textContent
  ok('text: the extension note in brackets is dropped', !/not stated|offers a review/.test(body), body.slice(0, 200))
  ok('text: brackets that are part of what the shop said are kept', /Arriving \(Tuesday\) by courier/.test(body), body.slice(0, 300))

  // Every regular expression written in the popup and the libraries must start with a real pattern, not a stray letter where a
  // backslash was lost: a few known-bad shapes are looked for in the source.
  const bad = []
  for (const f of ['popup/popup.js', 'lib/common.js', 'lib/amazon.js', 'lib/myntra.js', 'lib/flipkart.js', 'lib/merge.js', 'lib/search.js', 'lib/crawl.js', 'background.js']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8')
    src.split('\n').forEach((line, i) => { if (/\.replace\(\/s[+*]|\.match\(\/d[{+]|\.test\(\/b[a-z]|\.replace\(\/s\*\(|\/d\{\d/.test(line.replace(/\/\/.*$/, ''))) bad.push(f + ':' + (i + 1)) })
  }
  ok('source: no pattern has lost its backslash (\s, \d or \b written as a bare letter)', bad.length === 0, bad.join(', '))

  w.close(); w2.close()
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
}
main().catch(e => { console.log('ERR', e && e.stack || e); process.exit(1) })
