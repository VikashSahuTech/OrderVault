/* Myntra: your orders list and an order's details page. */
(function (root) {
  'use strict'
  const OV = (root.OV = root.OV || {})
  const STORE = 'Myntra'
  const HOST = /(?:^|\.)myntra\.com$/
  // Order numbers are long digit strings. Myntra puts them in the address (/my/orders/<id>), and may add
  // a second number for the item, so only the first is taken.
  const ID_IN_PATH = /\/my\/orders?\/(?:[a-z]+\/)?(\d{8,25})/i
  const LINK_RE = /\/my\/orders?\/(?:[a-z]+\/)?\d{8,25}/
  const TEXT_ID = /\b\d{14,22}\b/
  // Each shipment on the list starts with a heading such as "In Transit" or "Refund Credited". The list shows no
  // order number on the card, so these headings are what separates one shipment from the next. The wording is
  // fixed on purpose: a looser match would pick up footer text such as "Return within 30days".
  const HEADING = /^(?:in transit|shipped|delivered|out for delivery|order (?:confirmed|placed)|packed|ready to ship|cancell?ed|undelivered|rto \w+|refund (?:credited|initiated|processed|pending|completed)|return (?:initiated|requested|approved|picked up|pickup scheduled|received|completed|cancell?ed)|return rejected|exchanged|exchange (?:initiated|requested|approved|completed|picked up|in progress|delivered|rejected|cancell?ed))$/i

  function kind(url) {
    let p = ''
    try { p = new URL(url).pathname.toLowerCase().replace(/\/+$/, '') } catch (e) { return null }
    if (/^\/my\/orders?\/(?:[a-z]+\/)?\d{8,25}/.test(p)) return 'detail'
    if (/^\/my\/orders?$/.test(p)) return 'list'
    return null
  }

  /** "NOVA" + "Floral Print A-Line Midi Dress" for each "Size: XXL" line: brand and name sit just above it. */
  function sizedItems(lines) {
    const out = []
    lines.forEach((l, i) => {
      if (!/^size\s*:/i.test(l) || i < 2) return
      const name = lines[i - 1]
      const brand = lines[i - 2]
      if (HEADING.test(name) || OV.classify(name)) return
      out.push(HEADING.test(brand) || OV.classify(brand) ? name : `${brand} ${name}`)
    })
    return out
  }

  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) }

  function fromLines(card, lines, orderId, now) {
    const items = sizedItems(lines)
    const titles = items.length ? items : OV.guessTitles(lines, 2)
    // The heading and the line under it ("Arriving today", "On Thu, 29 Oct") say where the shipment is.
    const head = lines.slice(0, 2).map(OV.classify)
    const status = OV.furthest(head) || (OV.pickStatus(lines) || {}).status
    const st = OV.pickStatus(lines)
    const sub = lines[1] || ''
    const closed = status === 'Cancelled' || status === 'Return/refund'
    const rec = OV.makeRecord({
      store: STORE, orderId, product: OV.productLabel(titles), items: titles.slice(0, 3),
      amount: lines.map(OV.parseMoney).find(Boolean),
      status, statusLine: lines[0] && OV.classify(lines[0]) ? lines[0] : st && st.line,
      deliveredAt: status === 'Delivered' ? (OV.findDelivered(lines, now) || OV.parseLooseDate(sub, now, 'past')) : undefined,
      eta: status && status !== 'Delivered' && !closed ? OV.findEta(lines, now) : undefined,
      // A link to the order's own page when the card has one, otherwise the orders list (Myntra's cards carry no order number).
      trackUrl: OV.firstLink(card, 'a[href*="/my/order"]', HOST) || 'https://www.myntra.com/my/orders'
    }, now)
    // Facts the card shows: size, the return / exchange window, the refund amount and when it was credited.
    const facts = []
    const sizes = lines.filter(l => /^size\s*:/i.test(l)).map(l => l.replace(/^size\s*:\s*/i, '').trim()).filter(Boolean)
    if (sizes.length) facts.push(['Size', [...new Set(sizes)].join(', ')])
    const rw = OV.returnWindow(lines, now)
    if (rw) { rec.returnState = rw.state; rec.returnBy = rw.date }
    const refund = lines.find(l => /\brefund of\b/i.test(l))
    if (refund) {
      const amt = (refund.match(/refund of\s*(?:₹|rs\.?)?\s*([\d,]+(?:\.\d{1,2})?)/i) || [])[1]
      const when = OV.parseLooseDate(refund.split(/\bon\b/i).slice(1).join(' on '), now, 'past')
      if (amt) facts.push(['Refund', OV.fmtMoney(Number(amt.replace(/,/g, '')))])
      if (when && /credited|processed|issued/i.test(refund)) facts.push(['Refund credited on', OV.fmtDay(when)])
    }
    if (closed && /exchang/i.test(lines.slice(0, 2).join(' '))) facts.push(['Kind', 'Exchange'])
    rec.facts = OV.cleanFacts(facts)
    // No status could be read: keep the card's lines (not product names) so the popup can show what the page says.
    if (!status) rec.unread = OV.unreadLines(lines.slice(0, 14), [...titles, ...lines.filter((l, i) => /^size\s*:/i.test(lines[i + 1] || '') || /^size\s*:/i.test(lines[i + 2] || ''))])
    return rec
  }

  /** Shipment cards found by their heading. Grows outwards from each heading until the element would hold a second one. */
  function headingCards(doc) {
    const heads = []
    for (const e of doc.body.querySelectorAll('*')) {
      if (e.children.length === 0 && HEADING.test((e.textContent || '').replace(/\s+/g, ' ').trim()) && !/^(?:A|BUTTON|OPTION|LABEL)$/.test(e.tagName)) heads.push(e)
    }
    const cards = []
    for (const h of heads) {
      let el = h
      while (el.parentElement && el.parentElement !== doc.body && heads.filter(x => el.parentElement.contains(x)).length === 1) el = el.parentElement
      cards.push({ head: h, el })
    }
    return cards
  }

  /** One card per "Size:" line: grows outwards until the element would hold a second item. */
  function sizeCards(doc) {
    const leaves = [...doc.body.querySelectorAll('*')].filter(e => e.children.length === 0 && /^size\s*:/i.test((e.textContent || '').trim()))
    return leaves.map(leaf => {
      let el = leaf
      while (el.parentElement && el.parentElement !== doc.body && leaves.filter(l => el.parentElement.contains(l)).length === 1) el = el.parentElement
      return { head: leaf, el }
    })
  }

  function idFor(card, lines, seenHashes) {
    for (const a of card.querySelectorAll('a[href]')) {
      const m = (a.getAttribute('href') || '').match(ID_IN_PATH)
      if (m) return m[1]
    }
    // No order number on the card: use the item itself (brand, name, size), which does not change as the status does.
    const items = sizedItems(lines)
    const sig = items.length ? items.join('|') + '|' + lines.filter(l => /^size\s*:/i.test(l)).join('|') : lines.slice(0, 6).join('|')
    const h = hash(sig)
    const n = (seenHashes[h] = (seenHashes[h] || 0) + 1)
    return n > 1 ? `i${h}-${n}` : `i${h}`
  }

  /** Marks each order with its place in Myntra's list (0 is the newest), counting across pages: the list shows no purchase date. */
  function ranked(orders, doc, url) {
    let page = 1, size = 5
    try { page = Math.max(1, Number(new URL(url).searchParams.get('p')) || 1) } catch (e) { /* page 1 */ }
    try { const pg = pager(doc, url); if (pg.pageSize) size = pg.pageSize } catch (e) { /* five a page */ }
    orders.forEach((o, i) => { o.listRank = (page - 1) * size + i })
    return orders
  }

  function parse(doc, url, now) {
    const k = kind(url)
    if (!k) return { kind: null, orders: [] }
    if (k === 'detail') {
      let orderId
      try { const m = new URL(url).pathname.match(ID_IN_PATH); orderId = m && m[1] } catch (e) { /* ignore */ }
      if (!orderId) orderId = (doc.body.textContent.match(TEXT_ID) || [])[0]
      if (!orderId) return { kind: k, orders: [] }
      return { kind: k, orders: [fromLines(doc.body, OV.textLines(doc.body), orderId, now)] }
    }
    // Where each order links to /my/orders/<id> (or carries the number in an attribute), that number is the best identity.
    let numbered = OV.findCards(doc, LINK_RE, { idOf: (s) => (s.match(/\d{8,25}/) || [s])[0] })
    if (!numbered.size) numbered = OV.findCards(doc, TEXT_ID)
    // Every item on the list has a "Size: XL" line whatever the shipment's heading says ("In Transit", "Return Rejected",
    // ...), so cards are built around those lines. Growing outwards from a heading instead would let a page with
    // headings this reader does not know swallow its neighbours.
    const found = sizeCards(doc)
    const cardsFound = found.length ? found : headingCards(doc)
    if (cardsFound.length && cardsFound.length > numbered.size) {
      const seen = {}
      const orders = []
      const ids = new Set()
      for (const { el } of cardsFound) {
        let all = OV.textLines(el)
        // An item inside a shipment of several items does not hold the heading itself: borrow the heading lines above it.
        if (!OV.pickStatus(all.slice(0, 3))) {
          for (let up = el.parentElement, n = 0; up && up !== doc.body && n < 3; up = up.parentElement, n++) {
            const above = OV.textLines(up)
            if (OV.pickStatus(above.slice(0, 3))) { all = above.slice(0, 2).concat(all); break }
          }
        }
        const at = all.findIndex(l => HEADING.test(l))
        const lines = at > 0 ? all.slice(at) : all
        const id = idFor(el, lines, seen)
        if (ids.has(id)) continue
        ids.add(id)
        orders.push(fromLines(el, lines, id, now))
      }
      return { kind: k, orders: ranked(orders, doc, url) }
    }
    return { kind: k, orders: ranked([...numbered].map(([id, el]) => fromLines(el, OV.textLines(el), id, now)), doc, url) }
  }

  /**
   * Where the list is up to. Myntra pages are /my/orders?p=1, ?p=2 ... and say "Showing 1 -5 of 299",
   * which gives the last page without having to guess. `next` is the address of the following page.
   */
  function pager(doc, url) {
    const u = new URL(url)
    const page = Math.max(1, Number(u.searchParams.get('p')) || 1)
    const m = (doc.body.textContent || '').replace(/\s+/g, ' ').match(/showing\s+(\d+)\s*-\s*(\d+)\s+of\s+(\d+)/i)
    const from = m ? +m[1] : undefined, to = m ? +m[2] : undefined, total = m ? +m[3] : undefined
    // Page 1 is /my/orders (no number); later pages are /my/orders?p=2, ?p=3 ...
    const next = new URL(u.origin + '/my/orders')
    next.searchParams.set('p', String(page + 1))
    return {
      page, total, from, to,
      pageSize: m && to >= from ? to - from + 1 : undefined,
      done: !!m && to >= total,
      next: next.href
    }
  }

  OV.myntra = { store: STORE, hosts: HOST, kind, parse, pager }
})(typeof self !== 'undefined' ? self : this)
