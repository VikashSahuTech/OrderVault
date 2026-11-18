/* Flipkart: your orders list and an order's details page. */
(function (root) {
  'use strict'
  const OV = (root.OV = root.OV || {})
  const STORE = 'Flipkart'
  const HOST = /(?:^|\.)flipkart\.com$/
  // Order ids look like OD123456789012345678 (OD + 15-20 digits). The "-0" style suffix some pages add is dropped.
  const ID = /\bOD\d{15,20}\b/

  function kind(url) {
    let u
    try { u = new URL(url) } catch (e) { return null }
    const p = u.pathname.toLowerCase()
    if (/\/order_details|\/order-details/.test(p) || u.searchParams.has('order_id')) return 'detail'
    if (/\/account\/orders|\/rv\/orders|\/orders\b/.test(p)) return 'list'
    return null
  }

  function fromCard(card, orderId, now) {
    const lines = OV.textLines(card)
    const st = OV.pickStatus(lines)
    const titles = OV.guessTitles(lines, 3)
    const status = st && st.status
    const money = lines.map(OV.parseMoney).find(Boolean)
    const detailLink = OV.firstLink(card, `a[href*="${orderId}"], a[href*="order_details"]`, HOST)
    const rec = OV.makeRecord({
      store: STORE, orderId, product: OV.productLabel(titles), items: titles.slice(0, 1), amount: money,
      status, statusLine: st && st.line,
      deliveredAt: status === 'Delivered' ? OV.findDelivered(lines, now) : undefined,
      eta: status && status !== 'Delivered' && status !== 'Cancelled' && status !== 'Return/refund' ? OV.findEta(lines, now) : undefined,
      // The details link on the card, otherwise the details page built from the order number (so every order has one).
      trackUrl: detailLink || ('https://www.flipkart.com/order_details?order_id=' + encodeURIComponent(orderId))
    }, now)
    // Facts the card shows: the return / replacement window, the colour and variant line, the seller.
    const facts = [...OV.commonFacts(lines)]
    const rw = OV.returnWindow(lines, now)
    if (rw) { rec.returnState = rw.state; rec.returnBy = rw.date }
    const variant = titles.length ? lines[lines.indexOf(titles[0]) + 1] : ''
    if (variant && variant.length < 60 && !/₹|\d{4}/.test(variant) && !OV.classify(variant) && !facts.some(f => f[0] === 'Colour')) facts.push(['Variant', variant])
    rec.facts = OV.cleanFacts(facts)
    // No status could be read: keep the card's lines (not product names) so the popup can show what the page says.
    if (!status) rec.unread = OV.unreadLines(lines.slice(0, 16), titles)
    return rec
  }

  // The order-details page shows a vertical tracker: each step is a status line with a date under or beside it.
  function trackerEvents(lines, orderId, now) {
    const events = []
    for (let i = 0; i < lines.length; i++) {
      const status = OV.classify(lines[i])
      if (!status || lines[i].length > 60) continue
      const near = [lines[i], lines[i + 1], lines[i + 2]].filter(Boolean)
      const date = near.map(t => OV.parseLooseDate(t, now, 'past')).find(Boolean)
      if (!date) continue
      events.push({ key: `${STORE}:${orderId}:t:${status}:${date.slice(0, 10)}`, date, status, text: lines[i].slice(0, 160) })
    }
    return events
  }

  function parse(doc, url, now) {
    const k = kind(url)
    if (!k) return { kind: null, orders: [] }
    if (k === 'detail') {
      const lines = OV.textLines(doc.body)
      const orderId = OV.idFromUrl(url, ID) || (lines.join(' ').match(ID) || [])[0]
      if (!orderId) return { kind: k, orders: [] }
      const rec = fromCard(doc.body, orderId, now)
      const events = trackerEvents(lines, orderId, now)
      // The tracker lists every step; the order is at the furthest one, not the first line that mentions a status.
      const status = events.length ? OV.furthest(events.map(e => e.status)) : rec.status
      const last = [...events].reverse().find(e => e.status === status)
      const live = { ...rec.live, ...(last ? { text: last.text } : {}) }
      if (status === 'Delivered') { delete live.eta; live.deliveredAt = (last && last.date) || live.deliveredAt }
      const merged = OV.normalize({ ...rec, status, live, events: [...events, ...(rec.events || [])] })
      return { kind: k, orders: [merged] }
    }
    const cards = OV.findCards(doc, ID)
    const orders = [...cards].map(([id, el]) => fromCard(el, id, now))
    // Flipkart lists newest first and shows no purchase date on the list: the place in the list is what orders them.
    orders.forEach((o, i) => { o.listRank = i })
    return { kind: k, orders }
  }

  OV.flipkart = { store: STORE, hosts: HOST, kind, parse }
})(typeof self !== 'undefined' ? self : this)
