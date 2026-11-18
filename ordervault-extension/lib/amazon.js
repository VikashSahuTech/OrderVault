/* Amazon India: your orders list, an order's details page, and the package tracking page. */
(function (root) {
  'use strict'
  const OV = (root.OV = root.OV || {})
  const STORE = 'Amazon'
  const HOST = /(?:^|\.)amazon\.in$/
  // 404-1581343-1642745 for physical orders; digital ones (apps on a Fire TV, videos, e-books) start with a letter: D01-8285406-1691831.
  const ID = /\b(?:\d{3}|D\d{2})-\d{7}-\d{7}\b/
  const NOT_TITLE = /^(?:buy it again|view your item|view product details|view (?:return|refund)(?:\/refund)? status|write a product review|view order details|track package|return or replace items|get product support|get help|archive order|when will i get my refund\??|how'?s your item\??)$/i

  function kind(url) {
    let p = ''
    try { p = new URL(url).pathname.toLowerCase() } catch (e) { return null }
    if (/\/progress-tracker\/|\/ship-track|\/shiptrack/.test(p)) return 'track'
    if (/order-details|\/gp\/css\/summary|\/gp\/your-account\/order-details/.test(p)) return 'detail'
    if (/\/your-orders\/|order-history|\/gp\/your-account\/your-orders/.test(p)) return 'list'
    return null
  }

  function titlesIn(card) {
    for (const sel of ['.yohtmlc-product-title', '[class*="product-title"]', 'a[href*="/dp/"]', 'a[href*="/gp/product/"]']) {
      const seen = []
      card.querySelectorAll(sel).forEach(n => {
        const t = (n.textContent || '').replace(/\s+/g, ' ').trim()
        if (t.length >= 4 && t.length <= 250 && !/^₹/.test(t) && !NOT_TITLE.test(t) && !seen.includes(t)) seen.push(t)
      })
      if (seen.length) {
        // Amazon shortens long names with "…", and the same product can appear again in full (or as its picture link):
        // keep one entry per product, preferring the longer text.
        const stem = (t) => t.replace(/(?:…|\.\.\.)$/, '').trim()
        return seen.filter((t, i) => !seen.some((o, j) => j !== i && (o.length > t.length || (o.length === t.length && j < i)) && o.startsWith(stem(t))))
      }
    }
    return []
  }

  // Amazon puts ids of exactly the order-number shape (session ids) in every page's hidden fields and scripts, so a number
  // of that shape is only an order if the page treats it as one: a link about that order, or the "Order #" label beside it.
  function isRealOrder(card, id) {
    for (const a of card.querySelectorAll('a[href]')) {
      const h = a.getAttribute('href') || ''
      if (h.includes(id) && /order|ship-?track|progress-tracker/i.test(h)) return true
    }
    const lines = OV.textLines(card)
    return lines.some((l, i) => l.includes(id) && (/\border\s*(?:#|no\b|number|id)/i.test(l) || /^order\s*(?:#|no\.?|number|id)\s*:?$/i.test(lines[i - 1] || '')))
  }

  // Headings of the recommendation strips an order-details page carries below the order itself.
  const RECOMMENDATION = /^(?:inspired by|customers who|recommended|sponsored|related|recently viewed|your browsing|frequently bought|products related|more items|buy it again|keep shopping|you may also|similar items|top picks|based on)/i

  /** Titles in the order itself: on a details page, only those that come before the first recommendation heading. */
  function mainTitles(doc) {
    const all = titlesWithNodes(doc.body)
    let boundary = null
    for (const e of doc.body.querySelectorAll('h1,h2,h3,h4,span,div')) {
      if (e.children.length > 2) continue
      const t = (e.textContent || '').replace(/\s+/g, ' ').trim()
      if (t.length < 60 && RECOMMENDATION.test(t) && !/^buy it again$/i.test(t)) { boundary = e; break }
    }
    const kept = boundary ? all.filter(x => boundary.compareDocumentPosition(x.node) & 2 /* node comes before boundary */) : all
    return [...new Set(kept.map(x => x.text))].slice(0, 12)
  }
  function titlesWithNodes(card) {
    const out = []
    for (const sel of ['.yohtmlc-product-title', '[class*="product-title"]', 'a[href*="/dp/"]', 'a[href*="/gp/product/"]']) {
      card.querySelectorAll(sel).forEach(n => {
        const t = (n.textContent || '').replace(/\s+/g, ' ').trim()
        if (t.length >= 4 && t.length <= 250 && !/^₹/.test(t) && !NOT_TITLE.test(t)) out.push({ node: n, text: t })
      })
      if (out.length) return out
    }
    return out
  }

  // Signs on a card that an item was delivered although no status line says so: Amazon only offers a review, a return or
  // a replacement for an item that has arrived.
  const IMPLIES_DELIVERED = /^(?:write a product review|return or replace items|return items|replace items|get product support|how'?s your item\??|your return window|buy it again|view your item)/i

  // Amazon Pay orders have no parcel: a balance top-up ("Money added"), or a recharge / bill payment, which the card names as
  // "<number or account> - <operator>, <state>" ("7892620652 - Jio, Maharashtra"). They are complete once they are in the list.
  const DIGITAL = /^money added$|^add(?:ed)? money\b|^\d{6,}\s*-\s*\S.*$|\b(?:recharge|bill payment|gift card (?:balance|added))\b/i
  // Lines every card has, whatever it is: they say nothing about the order's state.
  const BOILERPLATE = /^(?:order placed|total|deliver to|ship to|order\s*#|order\s*(?:no|number|id)\.?|invoice|view order details|view invoice|buy it again|view your item|write a product review|get product support|return or replace items|track package|archive order|leave seller feedback|how'?s your item\??|amazon (?:now|fresh|pharmacy) delivery|add all items to cart|your apps & devices)$/i

  // Orders that are not a parcel, and whose cards say they are finished: flights, services (installation, repair), gift cards.
  const COMPLETED = /^(?:trip|service|booking) completed\b|^book another flight$|^leave service feedback$|^manage gift card\/voucher$|^view (?:your )?(?:gift card|voucher)/i
  // A subscription that has ended: "Closed due to lack of payment", "Subscription cancelled / ended / expired".
  const ENDED_SUBSCRIPTION = /^closed due to\b|^subscription (?:was )?(?:cancell?ed|ended|expired|closed)\b|\bsubscription (?:has )?(?:ended|expired)\b/i
  // Amazon Now / Fresh deliveries: a row of pictures and "Add all items to Cart", with no status line at all.
  const GROCERY = /^amazon (?:now|fresh|pharmacy) delivery$/i

  const FLIGHT_ROUTE = /^(.{2,40}?)\s*(?:→|->|⇒|>)\s*(.{2,40}?)(?:,\s*(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}))?$/
  const DIGITAL_ID = /^D\d{2}-/   // order numbers of apps, videos and e-books start with a letter and two digits

  /** What the order is, from the card: a parcel is "" (nothing special); the rest are named. */
  function kindOf(orderId, lines) {
    if (lines.some(l => GROCERY.test(l))) return 'Grocery'
    if (lines.some(l => /^trip completed$|^book another flight$|^(?:flight|e-?ticket)\b/i.test(l)) || lines.some(l => /→|->|⇒/.test(l) && FLIGHT_ROUTE.test(l) && l.length < 90)) return 'Flight'
    if (lines.some(l => /^subscription\b|^manage your subscription$/i.test(l))) return 'Subscription'
    if (lines.some(l => /^money added$|^add(?:ed)? money\b/i.test(l))) return 'Wallet top-up'
    if (lines.some(l => /^\d{6,}\s*-\s*\S/.test(l) && /electric|water|gas|power|broadband|dth|bill/i.test(l))) return 'Bill payment'
    if (lines.some(l => /^\d{6,}\s*-\s*\S/.test(l) || /\brecharge\b/i.test(l))) return 'Recharge'
    if (lines.some(l => /gift card|voucher/i.test(l) && /manage|balance|redeem/i.test(l))) return 'Gift card'
    if (lines.some(l => /^service (?:completed|location)|^leave service feedback$/i.test(l))) return 'Service'
    if (DIGITAL_ID.test(orderId)) {
      if (lines.some(l => /amazon appstore|^your apps\s*&\s*devices$/i.test(l))) return 'App'
      if (lines.some(l => /kindle|e-?book|audible/i.test(l))) return 'E-book'
      if (lines.some(l => /prime video|rent|season|episode|movie/i.test(l))) return 'Video'
      return 'Digital'
    }
    return ''
  }

  /** Facts for the card, by kind. Only what the page actually shows. */
  function factsFor(kind, lines, now, extra) {
    const f = []
    const find = (re) => { for (const l of lines) { const m = l.match(re); if (m) return m } return null }
    if (kind === 'Flight') {
      const route = lines.find(l => /→|->|⇒/.test(l) && FLIGHT_ROUTE.test(l) && l.length < 90)
      const m = route && route.match(FLIGHT_ROUTE)
      if (m) {
        f.push(['From', m[1].trim()], ['To', m[2].trim()])
        if (m[3]) { const d = OV.parseLooseDate(m[3], now, 'past'); if (d) f.push(['Travel date', OV.fmtDay(d)]) }
      }
      const pnr = find(/^(?:pnr|booking (?:id|reference)|reference)\s*[:#]?\s*([A-Z0-9]{5,8})$/i)
      if (pnr) f.push(['Booking reference', pnr[1].toUpperCase()])
      const air = find(/^(?:airline|operated by)\s*[:\-]?\s*(.+)$/i)
      if (air) f.push(['Airline', air[1].trim()])
      const pax = find(/^(\d+)\s+(?:passengers?|travell?ers?|adults?)\b/i)
      if (pax) f.push(['Passengers', pax[1]])
      const trip = lines.find(l => /^trip (?:completed|cancell?ed|upcoming)\b/i.test(l))
      if (trip) f.push(['Trip', trip.replace(/\s+/g, ' ')])
    } else if (kind === 'App') {
      const by = find(/^sold by\s*[:\-]?\s*(.+)$/i)
      if (by) f.push(['Publisher', by[1].trim()])
      f.push(['Where', 'Amazon Appstore (installed on your Fire TV or device)'])
    } else if (kind === 'Grocery') {
      f.push(['Service', lines.find(l => GROCERY.test(l)) || 'Amazon Now delivery'])
      if (extra.pictures) f.push(['Items', extra.pictures + ' product pictures'])
    } else if (kind === 'Subscription') {
      const ch = find(/^subscription (?:charged|renews?|will renew)(?: on)?\s*[:\-]?\s*(.+)$/i)
      if (ch) { const d = OV.parseLooseDate(ch[1], now, 'past'); f.push([/renew/i.test(ch[0]) ? 'Renews' : 'Last charged', d ? OV.fmtDay(d) : ch[1]]) }
      const end = lines.find(l => ENDED_SUBSCRIPTION.test(l))
      if (end) f.push(['Ended', end])
    } else if (kind === 'Recharge' || kind === 'Bill payment') {
      const m = find(/^(\d{6,})\s*-\s*(.+)$/)
      if (m) f.push([kind === 'Recharge' ? 'Number' : 'Account', OV.maskDigits(m[1])], [kind === 'Recharge' ? 'Operator' : 'Biller', m[2].trim()])
    } else if (kind === 'Service') {
      const done = lines.find(l => /^service completed/i.test(l))
      if (done) f.push(['Service', done.replace(/\s+/g, ' ')])
    }
    return f
  }

  function fromCard(card, orderId, now, isDetail) {
    const lines = OV.textLines(card)
    let titles = isDetail ? mainTitles(card.ownerDocument) : titlesIn(card)
    // Cards with no product link still say what they are: the grocery heading, or a flight's route.
    if (!titles.length) {
      const g = lines.find(l => GROCERY.test(l))
      const route = lines.find(l => /\S\s*(?:→|->|⇒)\s*\S/.test(l) && l.length < 80)
      if (g) titles = [g]
      else if (route) titles = ['Flight: ' + route.replace(/,\s*\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}$/, '')]
    }
    const placed = OV.labelValue(lines, /^order placed$/i) || OV.inline(lines, /^order placed\s*[:\-]?\s*(.+)$/i) || OV.inline(lines, /^ordered on\s*[:\-]?\s*(.+)$/i)
    const placedAt = OV.parseLooseDate(placed, now, 'past')
    let st = OV.pickStatus(lines, new Set(titles))
    // Subscriptions (Prime Video channels, memberships) have no parcel: one that was closed is over, one that was charged is done.
    if (!st && lines.some(l => ENDED_SUBSCRIPTION.test(l))) st = { status: 'Cancelled', line: lines.find(l => ENDED_SUBSCRIPTION.test(l)) }
    if (!st && lines.some(l => /^subscription charged\b/i.test(l))) st = { status: 'Delivered', line: lines.find(l => /^subscription charged\b/i.test(l)) }
    if (!st && lines.some(l => IMPLIES_DELIVERED.test(l))) st = { status: 'Delivered' }
    if (!st && lines.some(l => DIGITAL.test(l) && !titles.includes(l))) st = { status: 'Delivered' }
    if (!st && lines.some(l => COMPLETED.test(l))) st = { status: 'Delivered' }
    // A grocery delivery is over within hours; one older than a day that shows no other status is complete.
    if (!st && lines.some(l => GROCERY.test(l)) && placedAt && now - new Date(placedAt).getTime() > 36 * 3600 * 1000) st = { status: 'Delivered' }
    const total = OV.labelValue(lines, /^total$/i) || OV.inline(lines, /^total\s*[:\-]?\s*(.+)$/i)
    const status = st && st.status
    const kind = kindOf(orderId, lines)
    if (kind === 'Flight') {
      const routeLine = lines.find(l => /→|->|⇒/.test(l) && FLIGHT_ROUTE.test(l) && l.length < 90)
      const rm = routeLine && routeLine.match(FLIGHT_ROUTE)
      if (rm) titles = ['Flight: ' + rm[1].trim() + ' → ' + rm[2].trim()]
    }
    // A card with no "Total" line (an app, an e-book) shows the item's price next to it: a ₹0 line on an app is "Free".
    const priceLine = lines.find(l => /^₹\s*0(?:\.00)?$/.test(l))
    const pictures = card.querySelectorAll ? card.querySelectorAll('img').length : 0
    const facts = factsFor(kind, lines, now, { pictures: kind === 'Grocery' ? Math.max(0, pictures - 1) : 0 })
    // What a parcel's card can say beyond the status: the return window (kept as data, shown with the days left), seller, quantity,
    // size and colour. Who it was delivered to is not kept: on one's own account it says nothing.
    let rw
    if (!kind || kind === 'Grocery') {
      facts.push(...OV.commonFacts(lines))
      rw = OV.returnWindow(lines, now)
    }
    // A total of ₹0 (apps and free videos): parseMoney gives nothing for zero, so the text is looked at directly.
    const totalIsZero = /^\s*(?:₹|rs\.?)?\s*0+(?:\.0+)?\s*$/i.test(String(total || ''))
    if (kind && (totalIsZero || (priceLine && !total)) && !facts.some(f => f[0] === 'Price')) facts.push(['Price', 'Free (₹0)'])
    const rec = OV.makeRecord({
      store: STORE, orderId,
      product: OV.productLabel(titles), items: titles,
      amount: OV.parseMoney(total),
      kind: kind || undefined, facts,
      placedAt,
      status, statusLine: st && st.line,
      deliveredAt: status === 'Delivered' ? OV.findDelivered(lines, now) : undefined,
      eta: status && status !== 'Delivered' && status !== 'Cancelled' && status !== 'Return/refund' ? OV.findEta(lines, now) : undefined,
      // The tracking page while the order is travelling; for every other order (delivered, cancelled, returned, a flight, an app)
      // the order's own details page, so there is a link on each one. Only addresses on amazon.in are ever kept.
      trackUrl: OV.firstLink(card, 'a[href*="ship-track"], a[href*="progress-tracker"], a[href*="shiptrack"]', HOST) ||
        OV.firstLink(card, 'a[href*="order-details"], a[href*="orderID"], a[href*="orderId"], a[href*="/gp/css/summary"]', HOST) ||
        (/^[A-Z0-9]{3}-\d{7}-\d{7}$/.test(orderId) ? 'https://www.amazon.in/gp/your-account/order-details?orderID=' + encodeURIComponent(orderId) : undefined)
    }, now)
    if (rw) { rec.returnState = rw.state; rec.returnBy = rw.date }
    // No status could be read: keep the short lines of the card (product names left out) so the popup can show what the
    // page says. The background worker collects these into a tally and removes them from the saved order.
    // Boilerplate, dates, amounts and lines holding an order number are left out; they are on every card and tell nothing.
    if (!status) {
      const DATE_ONLY = /^(?:(?:mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)[a-z]*,?\s+)?\d{1,2}\s+[a-z]{3,9}(?:\s+\d{4})?$/i
      // The line under "Deliver to" / "Ship to" / "Recipient" is a person's name: never kept.
      const OWNER = /^(?:deliver to|ship to|recipient|sold by|gift(?:ed)? to)$/i
      rec.unread = [...new Set(lines.filter((l, i) => l.length >= 4 && l.length <= 90 && !titles.includes(l) && !/^[\d\s,.₹]+$/.test(l) &&
        !OWNER.test(lines[i - 1] || '') && !/^ordered on\b/i.test(l) &&
        !BOILERPLATE.test(l) && !DATE_ONLY.test(l) && !ID.test(l) && !/^₹/.test(l) && !/^order placed\s*\d/i.test(l)))].slice(0, 14)
    }
    return rec
  }

  // "Wednesday, 5 November" style headings and "10:15 AM" scan lines on the tracking page.
  const TIME = /^(\d{1,2}):(\d{2})\s?([ap]m)?\b\s*[-–:]?\s*(.*)$/i
  function trackEvents(lines, now) {
    const events = []
    let day
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      const t = l.match(TIME)
      if (!t) { const d = OV.parseLooseDate(l, now, 'past'); if (d && l.length < 60 && !OV.classify(l)) day = d; continue }
      if (!day) continue
      let desc = t[4] || lines[i + 1] || ''
      if (!t[4]) i += 1
      desc = desc.trim()
      if (!desc) continue
      let h = +t[1]; const min = +t[2]
      if (t[3]) { const pm = /p/i.test(t[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0 }
      const when = new Date(day); when.setHours(h, min, 0, 0)
      events.push({ key: `t:${when.getTime()}:${desc.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24)}`, date: when.toISOString(), status: OV.classify(desc) || 'Shipped', text: desc.slice(0, 160) })
    }
    return events
  }

  function parseTrack(doc, url, now) {
    const lines = OV.textLines(doc.body)
    const text = lines.join('\n')
    const orderId = OV.idFromUrl(url, ID) || (text.match(ID) || [])[0]
    if (!orderId) return []
    const st = OV.pickStatus(lines.slice(0, 60))
    const tracking = text.match(/tracking id\s*[:#]?\s*\n?\s*([A-Z0-9]{6,})/i)
    const carrier = text.match(/(?:delivery by|shipped with|carrier|delivered by)\s*[:\-]?\s*([A-Za-z][A-Za-z0-9 &.]{2,30})/i)
    const status = st && st.status
    const events = trackEvents(lines, now).map(e => ({ ...e, key: `${STORE}:${orderId}:${e.key}` }))
    return [OV.makeRecord({
      store: STORE, orderId, status, statusLine: st && st.line,
      deliveredAt: status === 'Delivered' ? OV.findDelivered(lines, now) : undefined,
      eta: status && status !== 'Delivered' && status !== 'Cancelled' && status !== 'Return/refund' ? OV.findEta(lines, now) : undefined,
      trackingId: tracking && tracking[1], carrier: carrier && carrier[1].trim(), trackUrl: OV.safeLink(url, HOST), events
    }, now)]
  }

  function parse(doc, url, now) {
    const k = kind(url)
    if (!k) return { kind: null, orders: [] }
    if (k === 'track') return { kind: k, orders: parseTrack(doc, url, now) }
    if (k === 'detail') {
      const id = OV.idFromUrl(url, ID) || (doc.body.textContent.match(ID) || [])[0]
      return { kind: k, orders: id ? [fromCard(doc.body, id, now, true)] : [] }
    }
    const cards = OV.findCards(doc, ID, { selectors: ['.order-card', '.js-order-card', '[class*="order-card"]'] })
    return { kind: k, orders: [...cards].filter(([id, el]) => isRealOrder(el, id)).map(([id, el]) => fromCard(el, id, now)) }
  }

  OV.amazon = { store: STORE, hosts: HOST, kind, parse }
})(typeof self !== 'undefined' ? self : this)
