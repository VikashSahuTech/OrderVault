/* What each order is (flight, app, grocery, recharge ...), the facts kept for it, return windows, and the words on its tag. */
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')
global.self = global
for (const f of ['common', 'amazon', 'flipkart', 'myntra', 'merge']) (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'lib', f + '.js'), 'utf8'))
const OV = global.OV
let fails = 0
const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + extra)) }
const NOW = new Date('2026-11-12T10:00:00+05:30').getTime()
const LIST = 'https://www.amazon.in/your-orders/orders'
const parseA = (html) => OV.amazon.parse(new JSDOM(html, { url: LIST }).window.document, LIST, NOW).orders[0]
const shell = (id, placed, total, inner) => '<html><body><div class="order-card js-order-card"><div><span>ORDER PLACED</span><span>' + placed + '</span></div><div><span>TOTAL</span><span>' + total + '</span></div>' +
  '<div><span>DELIVER TO</span><a href="#">Meera Iyer</a></div><div><span>ORDER #</span><span>' + id + '</span></div><a href="/gp/your-account/order-details?orderID=' + id + '">View order details</a>' + inner + '</div></body></html>'
const fact = (o, k) => ((o && o.facts) || []).find(f => f[0] === k)
const val = (o, k) => (fact(o, k) || [])[1]
const day = (iso) => iso && iso.slice(0, 10)

// ---- flights
const flight = parseA(shell('404-4455667-1112223', '3 May 2025', '₹7,200.00', '<div>Singapore → Phuket, 03 May 2025</div><div>Trip completed</div><div>2 passengers</div><a href="#">Book another flight</a>'))
ok('flight: kind is Flight', flight.kind === 'Flight', flight.kind)
ok('flight: named after the route, without the date', flight.product === 'Flight: Singapore → Phuket', flight.product)
ok('flight: from, to and travel date', val(flight, 'From') === 'Singapore' && val(flight, 'To') === 'Phuket' && val(flight, 'Travel date') === '3 May 2025', JSON.stringify(flight.facts))
ok('flight: passengers and trip state', val(flight, 'Passengers') === '2' && val(flight, 'Trip') === 'Trip completed', JSON.stringify(flight.facts))
ok('flight: the tag says "Trip completed"', OV.statusLabel(flight) === 'Trip completed', OV.statusLabel(flight))
ok('flight: the amount is kept', flight.amount === 7200, flight.amount)
const flight2 = parseA(shell('404-4455667-1112299', '4 Jun 2025', '₹4,100.00', '<div>Coimbatore → Hyderabad, 04 Jun 2025</div><div>Trip completed</div>'))
ok('flight: a longer city name works', val(flight2, 'From') === 'Coimbatore' && val(flight2, 'To') === 'Hyderabad', JSON.stringify(flight2.facts))

// A flight whose card also has a product link with Amazon's generic name: the route is the title, not that name
const flightLink = parseA(shell('406-7100296-7100333', '2 July 2026', '₹14,177.00', '<a class="yohtmlc-product-title" href="/dp/B0FLIGHT">Flight ticket bookings on Amazon</a><div>Jaipur → Hyderabad, 14 Jul 2026</div><div>Completed</div><a href="#">Book another flight</a>'))
ok('flight: with a generic product link on the card the route is still the title', flightLink.product === 'Flight: Jaipur → Hyderabad' && flightLink.kind === 'Flight', JSON.stringify([flightLink.product, flightLink.kind]))
ok('flight: from, to and the travel date are read', val(flightLink, 'From') === 'Jaipur' && val(flightLink, 'To') === 'Hyderabad' && val(flightLink, 'Travel date') === '14 Jul 2026', JSON.stringify(flightLink.facts))
ok('flight: it is delivered (completed), and the tag reads Trip completed', flightLink.status === 'Delivered' && OV.statusLabel(flightLink) === 'Trip completed', JSON.stringify([flightLink.status, OV.statusLabel(flightLink)]))
ok('flight: the amount and purchase date are kept', flightLink.amount === 14177 && day(flightLink.placedAt) === '2026-07-02', JSON.stringify([flightLink.amount, flightLink.placedAt]))

// ---- Fire TV / Appstore
const app = parseA(shell('D01-7100074-7100111', '25 December 2024', '₹0.00', '<a class="yohtmlc-product-title" href="/dp/B0LION">Streamly Play</a><div>Sold by: Amazon Media EU S.a.r.l.</div><div>Amazon Appstore</div><a href="#">Write a product review</a><a href="#">Your Apps &amp; Devices</a>'))
ok('app: kind is App and the tag says "Installed"', app.kind === 'App' && OV.statusLabel(app) === 'Installed', JSON.stringify([app.kind, OV.statusLabel(app)]))
ok('app: publisher, where it is installed, price', val(app, 'Publisher') === 'Amazon Media EU S.a.r.l.' && /Fire TV/.test(val(app, 'Where') || '') && /Free/.test(val(app, 'Price') || ''), JSON.stringify(app.facts))
ok('app: purchase date is kept', day(app.placedAt) === '2024-12-25', app.placedAt)
const ebook = parseA(shell('D01-1112223-3334445', '2 March 2025', '₹199.00', '<a class="yohtmlc-product-title" href="/dp/B0EB">Atomic Habits (Kindle Edition)</a><div>Kindle</div><a href="#">Write a product review</a>'))
ok('e-book: kind is E-book and the tag says "Purchased"', ebook.kind === 'E-book' && OV.statusLabel(ebook) === 'Purchased', JSON.stringify([ebook.kind, OV.statusLabel(ebook)]))

// ---- groceries
const grocery = parseA(shell('404-7100148-7100185', '28 August 2026', '₹204.00', '<div><b>Amazon Now delivery</b></div><div>Ordered on Friday, 28 August 2026</div><a href="#">Add all items to Cart</a><img src="a.jpg"><img src="b.jpg"><img src="c.jpg"><img src="now.jpg">'))
ok('grocery: kind is Grocery, delivered', grocery.kind === 'Grocery' && grocery.status === 'Delivered' && OV.statusLabel(grocery) === 'Delivered', JSON.stringify([grocery.kind, grocery.status]))
ok('grocery: service name and item count; the recipient is not kept', val(grocery, 'Service') === 'Amazon Now delivery' && /product pictures/.test(val(grocery, 'Items') || '') && !JSON.stringify(grocery.facts).includes('Meera'), JSON.stringify(grocery.facts))

// ---- recharge, bill, wallet
const jio = parseA(shell('404-1111111-2222221', '5 Oct 2026', '₹299.00', '<div>9876543210 - Jio, Maharashtra</div>'))
ok('recharge: kind, masked number and operator', jio.kind === 'Recharge' && val(jio, 'Number') === '••••3210' && val(jio, 'Operator') === 'Jio, Maharashtra', JSON.stringify([jio.kind, jio.facts]))
ok('recharge: the full phone number is never kept', !JSON.stringify(jio).includes('9876543210'), JSON.stringify(jio).slice(0, 300))
const bill = parseA(shell('404-1111111-2222222', '8 Dec 2025', '₹1,420.00', '<div>1234509876 - City Power Board ﹙CITYPOWER﹚,Maharashtra</div>'))
ok('bill: kind Bill payment, masked account, biller', bill.kind === 'Bill payment' && val(bill, 'Account') === '••••9876' && /CITYPOWER/.test(val(bill, 'Biller') || ''), JSON.stringify([bill.kind, bill.facts]))
ok('bill: the full account number is never kept', !JSON.stringify(bill).includes('1234509876'))
const wallet = parseA(shell('404-1111111-2222223', '8 Dec 2025', '₹500.00', '<div>Money added</div>'))
ok('wallet: kind is Wallet top-up and the tag says "Completed"', wallet.kind === 'Wallet top-up' && OV.statusLabel(wallet) === 'Completed', JSON.stringify([wallet.kind, OV.statusLabel(wallet)]))

// ---- subscription, service, gift card
const sub = parseA(shell('404-1111111-2222224', '3 January 2026', '₹299.00', '<a class="yohtmlc-product-title" href="/dp/B0SUB">Prime Video Channel</a><div>Subscription charged on 3 February 2026</div><a href="#">Manage your subscription</a>'))
ok('subscription: kind, "Charged", last charged date', sub.kind === 'Subscription' && OV.statusLabel(sub) === 'Charged' && val(sub, 'Last charged') === '3 Feb 2026', JSON.stringify([sub.kind, OV.statusLabel(sub), sub.facts]))
const subEnd = parseA(shell('404-1111111-2222225', '3 January 2026', '₹299.00', '<a class="yohtmlc-product-title" href="/dp/B0SUB">Prime Video Channel</a><div>Closed due to lack of payment</div><a href="#">Manage your subscription</a>'))
ok('subscription: a closed one says "Ended" and why', subEnd.status === 'Cancelled' && OV.statusLabel(subEnd) === 'Ended' && /lack of payment/.test(val(subEnd, 'Ended') || ''), JSON.stringify([subEnd.status, OV.statusLabel(subEnd), subEnd.facts]))
const svc = parseA(shell('404-1111111-2222226', '28 May 2019', '₹499.00', '<a class="yohtmlc-product-title" href="/dp/B0SVC">Wall Mount Installation</a><div>Service completed: Tuesday, 28 May 2019, 11:24 am</div><a href="#">Leave service feedback</a>'))
ok('service: kind and "Service completed"', svc.kind === 'Service' && OV.statusLabel(svc) === 'Service completed' && /Service completed/.test(val(svc, 'Service') || ''), JSON.stringify([svc.kind, svc.facts]))

// ---- a parcel: return window, seller, quantity, size, colour, delivered date
const parcel = parseA(shell('404-3333333-4444444', '30 October 2026', '₹329.00', '<div>Delivered 2 November</div><a class="yohtmlc-product-title" href="/dp/B0DRILL">Toolworks Adjustable Drill Bit Set</a><div>Sold by: Retail Hub</div><div>Qty: 2</div><div>Colour: Black</div><div>Return window closed on 2 Dec</div>'))
ok('parcel: no special kind', !parcel.kind && parcel.status === 'Delivered', JSON.stringify([parcel.kind, parcel.status]))
ok('parcel: seller, quantity, colour', val(parcel, 'Sold by') === 'Retail Hub' && val(parcel, 'Quantity') === '2' && val(parcel, 'Colour') === 'Black', JSON.stringify(parcel.facts))
ok('parcel: a closed return window with its date (2 Dec 2026), kept as data', parcel.returnState === 'closed' && day(parcel.returnBy) === '2026-12-02', JSON.stringify([parcel.returnState, parcel.returnBy]))
ok('parcel: the recipient is not kept at all (not even a first name)', !fact(parcel, 'Delivered to') && !JSON.stringify(parcel).includes('Meera') && !JSON.stringify(parcel).includes('Iyer'), JSON.stringify(parcel.facts))
const openWin = parseA(shell('404-3333333-4444445', '10 Nov 2026', '₹999.00', '<div>Delivered 11 November</div><a class="yohtmlc-product-title" href="/dp/B0X">Some Gadget Long Name</a><div>Return window open until 20 Nov 2026</div>'))
ok('parcel: an open return window with its end date', openWin.returnState === 'open' && day(openWin.returnBy) === '2026-11-20', JSON.stringify([openWin.returnState, openWin.returnBy]))
const eligible = parseA(shell('404-3333333-4444446', '10 Nov 2026', '₹999.00', '<div>Delivered 11 November</div><a class="yohtmlc-product-title" href="/dp/B0X">Some Gadget Long Name</a><div>Eligible for return until 25 Nov 2026</div>'))
ok('parcel: "Eligible for return until" is an open window', eligible.returnState === 'open' && day(eligible.returnBy) === '2026-11-25', JSON.stringify([eligible.returnState, eligible.returnBy]))
const button = parseA(shell('404-3333333-4444447', '10 Nov 2026', '₹999.00', '<div>Delivered 11 November</div><a class="yohtmlc-product-title" href="/dp/B0X">Some Gadget Long Name</a><a href="#">Return or replace items</a>'))
ok('parcel: a "Return or replace items" button means the window is open, with no date', button.returnState === 'open' && !button.returnBy, JSON.stringify([button.returnState, button.returnBy]))
const none = parseA(shell('404-3333333-4444448', '10 Nov 2026', '₹999.00', '<div>Delivered 11 November</div><a class="yohtmlc-product-title" href="/dp/B0X">Some Gadget Long Name</a>'))
ok('parcel: no window shown, none invented', !none.returnState && !none.returnBy, JSON.stringify([none.returnState, none.returnBy]))

// ---- return window parser on its own
const rw = (t) => OV.returnWindow([t], NOW)
ok('window: "Return window closed on 2 Dec"', rw('Return window closed on 2 Dec').state === 'closed' && day(rw('Return window closed on 2 Dec').date) === '2026-12-02')
ok('window: "Exchange/Return window closed on Thu; 5 Nov"', rw('Exchange/Return window closed on Thu; 5 Nov').state === 'closed' && day(rw('Exchange/Return window closed on Thu; 5 Nov').date) === '2026-11-05')
ok('window: "Return policy valid till Nov 20"', rw('Return policy valid till Nov 20').state === 'open' && day(rw('Return policy valid till Nov 20').date) === '2026-11-20')
ok('window: unrelated lines give nothing', rw('Delivered 2 November') === undefined && rw('Return to seller') === undefined)

// ---- Myntra
const MY = 'https://www.myntra.com/my/orders'
const my = OV.myntra.parse(new JSDOM('<html><body><div>' +
  '<div><div>Refund Credited</div><div>Your refund of ₹510.97 for the return has been processed successfully on Thu, 4 Sep 2025, 8:05 PM.</div><div><div>FITZO</div><div>Cuffed Sleeves Opaque Shirt Style Top</div><div>Size: L</div></div></div>' +
  '<div><div>Delivered</div><div>On Thu, 29 Oct, 1:37 PM</div><div><div>max</div><div>Printed Tunic</div><div>Size: XL</div></div><div>Exchange/Return window closed on Thu; 5 Nov</div></div>' +
  '<div><div>Exchanged</div><div>Picked up on Sat, 23 Aug</div><div><div>FITZO</div><div>Cuffed Sleeves Opaque Shirt Style Top</div><div>Size: XL</div></div></div>' +
  '</div><div>Showing 1 -3 of 9</div></body></html>', { url: MY }).window.document, MY, NOW).orders
const refunded = my.find(o => /Size L|FITZO/.test(o.product || '') && val(o, 'Size') === 'L')
ok('myntra refund: size, refund amount and credit date', refunded && val(refunded, 'Size') === 'L' && val(refunded, 'Refund') === '₹510.97' && val(refunded, 'Refund credited on') === '4 Sep 2025', JSON.stringify(refunded && refunded.facts))
ok('myntra refund: the tag says "Refunded"', refunded && OV.statusLabel(refunded) === 'Refunded', refunded && OV.statusLabel(refunded))
const delivered = my.find(o => /max/.test(o.product || ''))
ok('myntra delivered: size, and a closed return window with its date (5 Nov), kept as data', delivered && val(delivered, 'Size') === 'XL' && delivered.returnState === 'closed' && day(delivered.returnBy) === '2026-11-05', JSON.stringify(delivered && [delivered.facts, delivered.returnState, delivered.returnBy]))
const exch = my.find(o => val(o, 'Size') === 'XL' && /Exchange/.test(val(o, 'Kind') || ''))
ok('myntra exchange: the tag says "Exchanged"', exch && OV.statusLabel(exch) === 'Exchanged', JSON.stringify(exch && [OV.statusLabel(exch), exch.facts]))

// ---- the return window as a sentence for today (days left, days ago)
const TODAY = new Date('2026-11-12T10:00:00+05:30').getTime()
const ri = (state, by) => OV.returnInfo({ returnState: state, returnBy: by }, TODAY)
ok('return info: open, 8 days left', ri('open', '2026-11-20T12:00:00Z') === 'Until 20 Nov 2026 · 8 days left', ri('open', '2026-11-20T12:00:00Z'))
ok('return info: one day left, and ends today', ri('open', '2026-11-13T12:00:00Z') === 'Until 13 Nov 2026 · 1 day left' && ri('open', '2026-11-12T12:00:00Z') === 'Until 12 Nov 2026 · ends today', JSON.stringify([ri('open', '2026-11-13T12:00:00Z'), ri('open', '2026-11-12T12:00:00Z')]))
ok('return info: closed, with how long ago', ri('closed', '2026-11-05T12:00:00Z') === 'Closed on 5 Nov 2026 · 7 days ago' && ri('closed', '2026-11-11T12:00:00Z') === 'Closed on 11 Nov 2026 · 1 day ago', JSON.stringify([ri('closed', '2026-11-05T12:00:00Z'), ri('closed', '2026-11-11T12:00:00Z')]))
ok('return info: a window read as open whose date has passed is shown as closed', ri('open', '2026-10-30T12:00:00Z') === 'Closed on 30 Oct 2026 · 13 days ago', ri('open', '2026-10-30T12:00:00Z'))
ok('return info: closed with a date still ahead is still closed (the shop said so)', ri('closed', '2026-12-02T12:00:00Z') === 'Closed on 2 Dec 2026', ri('closed', '2026-12-02T12:00:00Z'))
ok('return info: no date', ri('open') === 'Open (a return is offered)' && ri('closed') === 'Closed', JSON.stringify([ri('open'), ri('closed')]))
ok('return info: nothing said, nothing shown', OV.returnInfo({}, TODAY) === null && OV.returnInfo(null, TODAY) === null && OV.returnInfo({ returnState: 'bogus' }, TODAY) === null)

// ---- the recipient is never kept: not read, and dropped from orders saved earlier
ok('recipient: a fact called Delivered to is dropped when facts are cleaned', OV.cleanFacts([['Delivered to', 'Meera'], ['Sold by', 'X']]).length === 1 && OV.cleanFacts([['delivered to', 'V']]) === undefined)
const oldSaved = OV.normalize({ id: 'Amazon:q', store: 'Amazon', orderId: 'q', status: 'Delivered', events: [], live: {}, facts: [['Delivered to', 'meera'], ['Quantity', '1']] })
const reread = OV.mergeRecord(oldSaved, OV.normalize({ id: 'Amazon:q', store: 'Amazon', orderId: 'q', status: 'Delivered', events: [], live: {} }))
ok('recipient: an order saved earlier loses it the next time it is read', !JSON.stringify(reread.facts).includes('meera') && val(reread, 'Quantity') === '1', JSON.stringify(reread.facts))

// ---- a fresh reading replaces the return window; no mention keeps the old one
const wOld = OV.normalize({ id: 'Amazon:w', store: 'Amazon', orderId: 'w', status: 'Delivered', events: [], live: {}, returnState: 'open', returnBy: '2026-11-20T12:00:00Z' })
const wNow = OV.mergeRecord(wOld, OV.normalize({ id: 'Amazon:w', store: 'Amazon', orderId: 'w', status: 'Delivered', events: [], live: {}, returnState: 'closed', returnBy: '2026-11-20T12:00:00Z' }))
const wSame = OV.mergeRecord(wOld, OV.normalize({ id: 'Amazon:w', store: 'Amazon', orderId: 'w', status: 'Delivered', events: [], live: {} }))
ok('return window: a newer reading replaces it (open can become closed)', wNow.returnState === 'closed', wNow.returnState)
ok('return window: a reading that does not mention one keeps the earlier one', wSame.returnState === 'open' && day(wSame.returnBy) === '2026-11-20', JSON.stringify([wSame.returnState, wSame.returnBy]))

// ---- facts and kind survive merging, and a fresh reading replaces a fact with the same label
const old = OV.normalize({ id: 'Amazon:x', store: 'Amazon', orderId: 'x', status: 'Delivered', kind: 'Flight', facts: [['From', 'Singapore'], ['To', 'Phuket'], ['Passengers', '2']], events: [], live: {} })
const fresh = OV.normalize({ id: 'Amazon:x', store: 'Amazon', orderId: 'x', status: 'Delivered', facts: [['Passengers', '3']], events: [], live: {} })
const merged = OV.mergeRecord(old, fresh)
ok('merge: older facts are kept, a newer value for the same label wins, kind is kept', merged.kind === 'Flight' && val(merged, 'From') === 'Singapore' && val(merged, 'Passengers') === '3', JSON.stringify([merged.kind, merged.facts]))
ok('facts: cleaned (non-text and over-long values are dropped)', JSON.stringify(OV.cleanFacts([['A', 'b'], [1, 'x'], ['C', 5], ['D', 'x'.repeat(500)], 'bad'])) === JSON.stringify([['A', 'b'], ['D', 'x'.repeat(160)]]), JSON.stringify(OV.cleanFacts([['A', 'b'], [1, 'x'], ['C', 5], ['D', 'x'.repeat(500)], 'bad'])))
ok('masking: only the last four digits are shown', OV.maskDigits('9876543210') === '••••3210' && OV.maskDigits('1234') === '1234')

// ---- the words on the tag
const lab = (o) => OV.statusLabel(o)
ok('tag: a return, a refund and an exchange', lab({ status: 'Return/refund', live: { text: 'Return started' } }) === 'Returned' && lab({ status: 'Return/refund', live: { text: 'Refund Credited' } }) === 'Refunded' && lab({ status: 'Return/refund', live: { text: 'Exchanged' } }) === 'Exchanged')
ok('tag: ordinary statuses are unchanged', lab({ status: 'Shipped' }) === 'Shipped' && lab({ status: 'Delivered' }) === 'Delivered' && lab({ status: 'Cancelled' }) === 'Cancelled' && lab({}) === 'Unknown')

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
