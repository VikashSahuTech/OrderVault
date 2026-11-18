/* Single-page navigation: the reader must notice the address changing without a page reload. */
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')
const lib = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let fails = 0
const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + extra)) }

async function main() {
  const dom = new JSDOM('<html><body><div id="app"><h1>Home</h1></div></body></html>', { url: 'https://www.myntra.com/', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window
  const sent = []
  let listener
  w.chrome = { runtime: { id: 'test', sendMessage: (m) => { sent.push(m); return Promise.resolve({}) }, onMessage: { addListener: (fn) => { listener = fn } } } }
  for (const f of ['lib/common.js', 'lib/amazon.js', 'lib/flipkart.js', 'lib/myntra.js', 'content/reader.js']) w.eval(lib(f))

  // 1. Landing on the home page reads nothing, and a manual read says why.
  await sleep(2200)
  ok('home page: nothing sent', sent.length === 0, sent.length)
  let resp
  listener({ type: 'ov:read-now' }, null, (r) => { resp = r })
  ok('home page: manual read answers "not an orders page"', resp && resp.ok === false && /not a Myntra orders page/.test(resp.reason), JSON.stringify(resp))

  // 2. Click "Orders": the address changes with no reload and the list is drawn in afterwards.
  w.history.pushState({}, '', '/my/orders')
  w.document.getElementById('app').innerHTML = `
    <div class="o"><a href="/my/orders/2384729384729384"><div>Levis</div><div>Women Solid Slim Fit Pink T-Shirt</div><div>Shipped</div><div>Arriving by Sat, 15 Nov</div><div>₹1,199</div></a></div>
    <div class="o"><a href="/my/orders/2384700000000000099"><div>Vero Moda</div><div>Women Floral Printed Casual Shirt</div><div>Delivered</div><div>Delivered on 4 Nov 2026</div></a></div>`
  await sleep(3500)
  const m = sent.find(s => s.type === 'ov:orders')
  ok('after in-app navigation: the list is read', !!m && m.store === 'Myntra' && m.kind === 'list' && m.count === 2, JSON.stringify(m && [m.store, m.kind, m.count]))

  // 3. Orders whose ids are only in a data attribute (not in any link) are still found.
  w.history.pushState({}, '', '/my/orders')
  w.document.getElementById('app').innerHTML = `
    <div class="o" data-orderid="2384711111111111111"><div>Puma</div><div>Classic Suede Low-Top Sneakers</div><div>Out for delivery</div><div>₹3,499</div></div>
    <div class="o" data-orderid="2384722222222222222"><div>Nike</div><div>Air Zoom Running Shoes</div><div>Delivered on 1 Nov 2026</div></div>`
  w.history.pushState({}, '', '/my/orders?x=1')
  await sleep(3500)
  const last = [...sent].reverse().find(s => s.type === 'ov:orders')
  ok('ids in data attributes (no links): found', last && last.count === 2 && last.orders.some(o => o.status === 'Out for delivery'), JSON.stringify(last && [last.count, last.orders.map(o => o.status)]))

  // 4. Leaving for a product page stops reading; a manual read says so.
  const before = sent.length
  w.history.pushState({}, '', '/some-product/buy')
  await sleep(2500)
  ok('product page: nothing more sent', sent.length === before, sent.length - before)

  // 5. Detail page with the id in the address.
  w.history.pushState({}, '', '/my/orders/2384729384729384/5551234')
  w.document.getElementById('app').innerHTML = '<div><div>Women Solid Slim Fit Pink T-Shirt</div><div>Out for delivery</div><div>₹1,199</div></div>'
  await sleep(3500)
  const d = [...sent].reverse().find(s => s.type === 'ov:orders' && s.kind === 'detail')
  ok('detail page: order id from the address', d && d.count === 1 && d.orders[0].orderId === '2384729384729384' && d.orders[0].status === 'Out for delivery', JSON.stringify(d && d.orders.map(o => [o.orderId, o.status])))

  w.close()

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
}
main()
