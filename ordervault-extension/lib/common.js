/*
 * Shared helpers for the page readers. Plain script (no modules) so the same file runs as a
 * content script, in the background worker, in the popup and in the tests.
 * Nothing here touches the network.
 */
(function (root) {
  'use strict'
  const OV = (root.OV = root.OV || {})
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
  const MON = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec'
  const DAY = 86400000

  // ------------------------------------------------------------ text

  const BLOCK = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL'])
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'HEAD'])
  // Links and buttons are separate controls ("Arriving tomorrow" + "Track package"), never one phrase.
  const CONTROLS = new Set(['A', 'BUTTON', 'SELECT', 'OPTION', 'LABEL', 'INPUT'])

  /**
   * Visible text of an element as trimmed, non-empty lines. Block elements, links and buttons start a
   * new line, and so do flex/grid children and inline-blocks (read from the page's real styles), which
   * is how pages lay out "9:15 AM" next to "Out for delivery" without any space between them.
   */
  OV.textLines = function (el) {
    const out = []
    let cur = ''
    const view = el.ownerDocument && el.ownerDocument.defaultView
    let styleBudget = 8000
    const display = (n) => {
      if (!view || styleBudget <= 0) return ''
      styleBudget -= 1
      try { return view.getComputedStyle(n).display || '' } catch (e) { return '' }
    }
    const flush = () => { const t = cur.replace(/\s+/g, ' ').trim(); if (t) out.push(t); cur = '' }
    ;(function walk(n, parentDisplay) {
      if (n.nodeType === 3) { cur += n.nodeValue; return }
      if (n.nodeType !== 1) return
      const tag = String(n.tagName).toUpperCase()
      if (SKIP.has(tag) || n.hasAttribute('hidden') || n.getAttribute('aria-hidden') === 'true') return
      if (n.style && n.style.display === 'none') return
      // The element's real display decides both whether it starts a line and how its children are laid out.
      const d = display(n)
      if (d === 'none') return
      const block = BLOCK.has(tag) || CONTROLS.has(tag) || (!!d && d !== 'inline' && d !== 'contents') || /flex|grid/.test(parentDisplay || '')
      if (block) flush()
      const own = d || (BLOCK.has(tag) ? 'block' : '')
      for (let c = n.firstChild; c; c = c.nextSibling) walk(c, own)
      if (block) flush()
    })(el, '')
    flush()
    return out
  }

  // ------------------------------------------------------------ dates found on other lines

  const ETA_WORDS = /\b(?:arriv(?:ing|es)|expected|delivery by|delivered by|get it by|will be delivered|estimated delivery)\b/i
  /** Expected delivery: the first "Arriving / Expected / Delivery by" line that carries a date. */
  OV.findEta = function (lines, now) {
    for (const l of lines.slice(0, 80)) {
      if (l.length > 120 || !ETA_WORDS.test(l)) continue
      const d = OV.parseLooseDate(l, now, 'future')
      if (d) return d
    }
    return undefined
  }
  /** When it was delivered: the first "Delivered ..." line that carries a date. */
  OV.findDelivered = function (lines, now) {
    for (const l of lines.slice(0, 80)) {
      if (l.length > 120 || !/\bdelivered\b/i.test(l) || /\b(?:by|will be|to be|expected)\b/i.test(l)) continue
      const d = OV.parseLooseDate(l, now, 'past')
      if (d) return d
    }
    return undefined
  }
  const PROGRESS_ORDER = ['Ordered', 'Shipped', 'Out for delivery', 'Delivered']
  /** The status an order has reached, from a list of statuses it passed through. */
  OV.furthest = function (statuses) {
    const known = statuses.filter(Boolean)
    const end = known.filter(s => s === 'Cancelled' || s === 'Return/refund')
    if (end.length) return end[end.length - 1]
    return known.reduce((b, s) => PROGRESS_ORDER.indexOf(s) > PROGRESS_ORDER.indexOf(b) ? s : b, known[0])
  }

  OV.parseMoney = function (s) {
    if (!s) return undefined
    const m = String(s).match(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i) || String(s).match(/^\s*([\d,]+(?:\.\d{1,2})?)\s*$/)
    const n = m ? Number(m[1].replace(/,/g, '')) : NaN
    return Number.isFinite(n) && n > 0 && n < 1e7 ? n : undefined
  }

  // ------------------------------------------------------------ dates

  const iso = (d) => d.toISOString()
  const addDays = (d, n) => new Date(d.getTime() + n * DAY)
  const DAY_NAMES = new Set(['sun', 'sunday', 'mon', 'monday', 'tue', 'tues', 'tuesday', 'wed', 'wednesday', 'thu', 'thur', 'thurs', 'thursday', 'fri', 'friday', 'sat', 'saturday'])
  /**
   * "Arriving Tuesday": the day of the week alone, with no date. 'future' = the next such day (today counts), 'past' = the most
   * recent one. Only used when the caller says which way to look, so a product called "Friday Night Lights" is never a date.
   */
  function weekdayDate(t, today, hint) {
    if (hint !== 'future' && hint !== 'past') return undefined
    const word = (t.match(/\b[a-z]+\b/g) || []).find(w => DAY_NAMES.has(w))
    if (!word) return undefined
    const idx = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(word.slice(0, 3))
    const cur = today.getDay()
    return iso(addDays(today, hint === 'future' ? (idx - cur + 7) % 7 : -((cur - idx + 7) % 7)))
  }
  /**
   * First date mentioned in a sentence ("Delivered 5 Nov", "Arriving Sat, 15 Nov", "tomorrow").
   * With no year given, `hint` picks the year: 'past' = the latest such date not in the future,
   * 'future' = the earliest not in the past. Returns an ISO string at local noon, or undefined.
   */
  OV.parseLooseDate = function (text, now, hint) {
    if (!text) return undefined
    const t = String(text).toLowerCase()
    const today = new Date(now); today.setHours(12, 0, 0, 0)
    if (/\btoday\b/.test(t)) return iso(today)
    if (/\btomorrow\b/.test(t)) return iso(addDays(today, 1))
    if (/\byesterday\b/.test(t)) return iso(addDays(today, -1))
    let d, mo, y
    let m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MON})[a-z]*\\.?,?(?:\\s+(\\d{4}))?`))
    if (m) { d = +m[1]; mo = MONTHS[m[2]]; y = m[3] ? +m[3] : undefined } else {
      m = t.match(new RegExp(`\\b(${MON})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`))
      if (!m) return weekdayDate(t, today, hint)
      mo = MONTHS[m[1]]; d = +m[2]; y = m[3] ? +m[3] : undefined
    }
    if (d < 1 || d > 31) return undefined
    const mk = (yy) => new Date(yy, mo, d, 12, 0, 0)
    const ok = (x) => x.getMonth() === mo && x.getDate() === d
    if (y) { const x = mk(y); return ok(x) ? iso(x) : undefined }
    const yr = today.getFullYear()
    const cands = [mk(yr - 1), mk(yr), mk(yr + 1)].filter(ok)
    if (!cands.length) return undefined
    const slack = 2 * DAY
    let pick
    if (hint === 'past') pick = cands.filter(c => c.getTime() <= today.getTime() + slack).pop()
    else if (hint === 'future') pick = cands.find(c => c.getTime() >= today.getTime() - slack)
    pick = pick || cands.reduce((b, c) => Math.abs(c - today) < Math.abs(b - today) ? c : b)
    return iso(pick)
  }

  // ------------------------------------------------------------ status wording

  // Button and policy text that looks like a status but is not one ("Return window closed", "Cancel items").
  const NOT_STATUS = /\b(?:window|policy|eligible|rate|review|feedback|help|support|archive|share|download|invoice|problem|exchange)\b|replace items|return items|return or replace|before you|buy it again|track package|view (?:order|invoice|your)|cancel (?:item|items|order)|request cancellation|add to cart/
  /** Maps one line of page text to an order status, or null when the line is not a status. */
  OV.classify = function (line) {
    if (!line || line.length > 110) return null
    const s = line.toLowerCase().replace(/\s+/g, ' ').trim()
    // An exchange is the item going back and another coming: it belongs with returns. This is checked before the
    // button/policy filter below, which rightly ignores "Exchange/Return window closed".
    if (/^exchange(?:d|\s+(?:initiated|requested|approved|completed|picked up|in progress|delivered|rejected|cancell?ed))\b/.test(s)) return 'Return/refund'
    if (NOT_STATUS.test(s)) return null
    if (/\bcancell?ed\b/.test(s)) return 'Cancelled'
    if (/^(?:return|refund|replacement)\b|\b(?:return|refund|replacement)\s+(?:started|initiated|requested|approved|complete|completed|received|issued|processed|credited|picked up|pickup)\b/.test(s)) return 'Return/refund'
    // "Refunded", "Your return is in transit. Your refund has been issued.", "Item returned": the order is on its way back
    // or already paid back, so these must be caught before "in transit" makes them look like a parcel on its way to you.
    if (/^(?:refunded|returned|item returned|return (?:complete|completed|received|in progress|in transit))\b|\byour (?:return|refund)\b|\brefund (?:has been|was|is|will be|of)\b|\b(?:return|refund) is\b|\bitem (?:was |has been )?returned\b|\breturn(?:ed)? (?:to|by) (?:seller|you)\b/.test(s)) return 'Return/refund'
    if (/out for delivery|arriving today|arrives today|delivery (?:is )?expected today|will be delivered today|expected today/.test(s)) return 'Out for delivery'
    if (/not yet shipped|preparing|being prepared|\bprocessing\b|payment pending|awaiting|\bpacked\b|ready to ship|order confirmed|\bconfirmed\b/.test(s)) return 'Ordered'
    if (/not delivered|undelivered|delivery attempt|couldn.?t be delivered|delivery failed/.test(s)) return 'Shipped'
    if ((/\bdelivered\b/.test(s) && !/will be|to be|expected|delivered by/.test(s)) || /\bpackage (?:was )?(?:handed|left)\b|\bhanded (?:over )?to (?:the )?(?:resident|customer|you|security|neighbou?r)|\bleft (?:with|near|at|in) (?:the |your )?(?:front door|door|porch|reception|security|neighbou?r|mailbox|guard)/.test(s)) return 'Delivered'
    if (/\barriving\b|\barrives\b|\bexpected\b|delivery by|will be delivered|to be delivered|\bshipped\b|dispatched|on the way|in transit|shipping (?:soon|now)|\breached\b|out for pickup|picked up|left (?:the )?(?:seller|warehouse)/.test(s)) return 'Shipped'
    return null
  }
  /** First line that states a status, skipping the given lines (product names can contain status words). */
  OV.pickStatus = function (lines, exclude) {
    for (const line of lines) {
      if (exclude && exclude.has(line)) continue
      const status = OV.classify(line)
      if (status) return { status, line }
    }
    return null
  }

  // ------------------------------------------------------------ finding order cards

  /**
   * Splits an orders page into one element per order, by growing outwards from every place an
   * order id appears (in text or in a link) until the element would contain a second order.
   * This depends on the id format, not on the shop's CSS class names, so it survives restyling.
   */
  OV.findCards = function (doc, idRe, opts) {
    opts = opts || {}
    // Flags are kept (an "i" matters); "g" is added for counting and never shared with the single test.
    const flags = (idRe.flags || '').replace(/[gy]/g, '')
    const re = new RegExp(idRe.source, flags + 'g')
    const test = new RegExp(idRe.source, flags)
    const idOf = opts.idOf || ((m) => m)
    const memo = new WeakMap()
    const distinct = (el) => {
      if (memo.has(el)) return memo.get(el)
      const set = new Set((el.outerHTML.match(re) || []).map(idOf))
      memo.set(el, set)
      return set
    }
    const cards = new Map()
    const consider = (el) => { const s = distinct(el); if (s.size === 1) { const id = [...s][0]; if (!cards.has(id)) cards.set(id, el) } }
    for (const sel of opts.selectors || []) {
      try { doc.querySelectorAll(sel).forEach(consider) } catch (e) { /* bad selector: ignore */ }
      if (cards.size) return cards
    }
    const seeds = []
    const walker = doc.createTreeWalker(doc.body, 4)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const v = n.nodeValue
      if (!/\S/.test(v) || !n.parentElement) continue
      // Text inside scripts and styles is code, not something the page shows (shops keep session ids in there).
      if (/^(?:SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(n.parentElement.tagName)) continue
      if (test.test(v)) seeds.push(n.parentElement)
    }
    doc.querySelectorAll('a[href]').forEach(a => { if (test.test(a.getAttribute('href'))) seeds.push(a) })
    // Cards that are not links often carry the id in a data attribute instead (data-orderid="...").
    // The attribute's name is tested with its value, so a pattern can insist on an "order id" name.
    let seen = 0
    for (const e of doc.body.querySelectorAll('*')) {
      if (++seen > 20000) break
      for (const a of e.attributes) if (a.name !== 'href' && a.value.length < 300 && test.test(a.name + '="' + a.value + '"')) { seeds.push(e); break }
    }
    for (const seed of seeds) {
      let el = seed
      if (distinct(el).size !== 1) continue
      while (el.parentElement && el.parentElement !== doc.documentElement && distinct(el.parentElement).size === 1) el = el.parentElement
      const id = [...distinct(el)][0]
      if (!cards.has(id)) cards.set(id, el)
    }
    return cards
  }

  /** Absolute http(s) link on an allowed host, or undefined. */
  OV.safeLink = function (href, hostRe) {
    try {
      const u = new URL(href)
      return (u.protocol === 'https:' && hostRe.test(u.hostname)) ? u.href : undefined
    } catch (e) { return undefined }
  }
  OV.firstLink = function (card, selector, hostRe) {
    for (const a of card.querySelectorAll(selector)) { const l = OV.safeLink(a.href, hostRe); if (l) return l }
    return undefined
  }
  /**
   * What a card shows when no status could be read: its short lines, without anything that is part of a product name, a
   * price, a date or a size. Shown in the popup so the missing wording can be found without anyone opening a console.
   */
  OV.unreadLines = function (lines, titles) {
    const DATE_ONLY = /^(?:(?:mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)[a-z]*,?\s+)?\d{1,2}\s+[a-z]{3,9}(?:\s+\d{4})?$/i
    return [...new Set(lines.filter(l => l.length >= 3 && l.length <= 90 && !/^[\d\s,.₹]+$/.test(l) && !/^₹|^size\s*:/i.test(l) &&
      !DATE_ONLY.test(l) && !(titles || []).some(t => t.includes(l))))].slice(0, 12)
  }
  /** A page that says outright that this period holds no orders ("0 orders placed in 2020"): empty, not unrecognised. */
  OV.saysEmpty = function (doc) {
    return OV.textLines(doc.body).some(l => /^you have not placed any orders|^0\s+orders?\s+placed\b|did not place an order/i.test(l))
  }
  OV.labelValue = function (lines, re) {
    const i = lines.findIndex(l => re.test(l))
    return i >= 0 ? lines[i + 1] : undefined
  }
  OV.inline = function (lines, re) {
    for (const l of lines) { const m = l.match(re); if (m) return m[1] }
    return undefined
  }


  // ------------------------------------------------------------ product titles

  const LABELISH = /^(?:order|ordered|qty|quantity|size|colou?r|seller|sold by|rating|rate|write|view|track|need help|help|return|exchange|cancel|invoice|download|arriving|delivered|delivery|total|price|free|shipping|payment|paid|ship to|deliver to|address|status|item|items|sku|offer|coupon|you saved|add|buy|share|more)\b/i
  const PRICEISH = /^(?:₹|rs\.?|inr)?\s*[\d,.\s]+$/i
  /** Lines of a card that look like product names: not a status, price, date or label. */
  OV.guessTitles = function (lines, max) {
    const out = []
    for (const l of lines) {
      if (out.length >= (max || 1)) break
      if (l.length < 6 || l.length > 180) continue
      if (OV.classify(l) || LABELISH.test(l) || PRICEISH.test(l) || /^(?:₹|rs\.?\s|inr\s)/i.test(l)) continue
      if (l.length < 40 && OV.parseLooseDate(l, Date.now())) continue
      if (!/[a-z]/i.test(l)) continue
      out.push(l)
    }
    return out
  }

  // ------------------------------------------------------------ records

  const clean = (o) => { const r = {}; for (const k of Object.keys(o)) if (o[k] !== undefined && o[k] !== null && o[k] !== '') r[k] = o[k]; return r }
  OV.clean = clean

  /** Fills in the history for a record: when it was placed, and when each status was first seen. Keeps the first sighting. */
  OV.normalize = function (rec) {
    const seen = new Map()
    const add = (e) => { if (e && e.key && !seen.has(e.key)) seen.set(e.key, e) }
    if (rec.placedAt) add({ key: `${rec.id}:s:Ordered`, date: rec.placedAt, status: 'Ordered', text: 'Order placed' })
    for (const e of rec.events || []) add(e)
    if (rec.status && rec.status !== 'Unknown') {
      const live = rec.live || {}
      add({ key: `${rec.id}:s:${rec.status}`, date: (rec.status === 'Delivered' && live.deliveredAt) || live.checkedAt || new Date().toISOString(), status: rec.status, text: live.text || rec.status })
    }
    rec.events = [...seen.values()].sort((a, b) => a.date.localeCompare(b.date))
    return rec
  }

  /** One order as the readers hand it on. `f` holds whatever the page showed; missing things stay missing. */
  OV.makeRecord = function (f, now) {
    const checkedAt = new Date(now).toISOString()
    const live = clean({ text: f.statusLine, eta: f.eta, deliveredAt: f.deliveredAt, carrier: f.carrier, trackingId: f.trackingId, trackUrl: f.trackUrl, checkedAt })
    return OV.normalize(clean({
      id: `${f.store}:${f.orderId}`, store: f.store, orderId: f.orderId, product: f.product,
      items: f.items && f.items.length ? f.items : undefined, amount: f.amount, placedAt: f.placedAt,
      status: f.status, live, events: f.events,
      kind: typeof f.kind === 'string' ? f.kind.slice(0, 24) : undefined, facts: OV.cleanFacts(f.facts)
    }))
  }
  // ------------------------------------------------------------ facts about an order

  const MON_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  /** "5 Nov 2026" from an ISO date. */
  OV.fmtDay = function (iso) {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : `${d.getDate()} ${MON_NAMES[d.getMonth()]} ${d.getFullYear()}`
  }
  /** "₹1,001" or "₹204.50". */
  OV.fmtMoney = function (n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return ''
    return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
  }
  /** "••••0652": all but the last four digits of a phone or account number, so the popup never shows the whole number. */
  OV.maskDigits = function (s) {
    const d = String(s || '').replace(/\D/g, '')
    return d.length > 4 ? '••••' + d.slice(-4) : d
  }
  // Facts that are no longer kept or shown (a name is personal and, on one's own account, says nothing). Dropped on the way in and
  // on the way out, so orders saved before this was decided lose it the next time they are read.
  const DROPPED_FACTS = new Set(['delivered to'])
  /** Facts are [label, value] pairs of short text. Anything else, and anything too long, is dropped. */
  OV.cleanFacts = function (facts) {
    if (!Array.isArray(facts)) return undefined
    const out = []
    for (const f of facts) {
      if (!Array.isArray(f) || typeof f[0] !== 'string' || typeof f[1] !== 'string') continue
      const k = f[0].replace(/\s+/g, ' ').trim().slice(0, 40), v = f[1].replace(/\s+/g, ' ').trim().slice(0, 160)
      if (DROPPED_FACTS.has(k.toLowerCase())) continue
      if (k && v && !out.some(x => x[0] === k)) out.push([k, v])
      if (out.length >= 16) break
    }
    return out.length ? out : undefined
  }

  /**
   * The return / exchange window from a card's lines: { state: 'open' | 'closed', date?: ISO } or undefined.
   * "Return window closed on 2 Dec", "Eligible for return until 5 Dec", "Return policy valid till Nov 10",
   * "Exchange/Return window closed on Thu; 5 Nov". A card that offers a "Return or replace items" button is open.
   */
  OV.returnWindow = function (lines, now) {
    const CLOSED = /\b(?:closed|ended|expired|is over|has passed)\b/
    const OPEN = /\b(?:closes|ends|expires|valid (?:till|until|through|upto|up to)|open (?:till|until)|eligible (?:for [a-z\/ ]+ )?(?:till|until|through|by)|till|until|through)\b/
    for (const l of lines) {
      if (l.length > 140) continue
      const s = l.toLowerCase()
      if (!/\b(?:return|exchange|replacement|replace)/.test(s) || !/\b(?:window|policy|period|eligible)\b/.test(s)) continue
      const closed = CLOSED.test(s)
      if (!closed && !OPEN.test(s)) continue
      // A window runs for days or weeks around the delivery, so a date without a year is the occurrence nearest to now, either
      // side ("closed on 2 Dec" read in November is 2 Dec this year, a few weeks away; "closed on 5 Nov" is a week ago).
      return { state: closed ? 'closed' : 'open', date: OV.parseLooseDate(l, now) }
    }
    if (lines.some(l => /^(?:return or replace items|return items|replace items|return or exchange items)$/i.test(l))) return { state: 'open' }
    return undefined
  }
  /**
   * The return window of a saved order as a short sentence, worked out for today: "Until 20 Nov 2026 · 5 days left",
   * "Closed on 2 Dec 2026 · 7 days ago". The order holds only what the shop said (returnState: open | closed, returnBy: the date
   * it gave), so the count of days stays right however long ago the order was read. A window that was open but whose date has
   * passed is shown as closed. Null when the shop said nothing about one.
   */
  OV.returnInfo = function (o, now) {
    if (!o || (o.returnState !== 'open' && o.returnState !== 'closed')) return null
    const day0 = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }
    const hasDate = !!o.returnBy && !Number.isNaN(new Date(o.returnBy).getTime())
    const left = hasDate ? Math.round((day0(o.returnBy) - day0(now)) / 86400000) : null
    const closed = o.returnState === 'closed' || (hasDate && left < 0)
    if (!hasDate) return closed ? 'Closed' : 'Open (a return is offered)'
    const when = OV.fmtDay(o.returnBy)
    if (closed) return left < 0 ? 'Closed on ' + when + ' · ' + (-left) + ' day' + (left === -1 ? '' : 's') + ' ago' : 'Closed on ' + when
    return 'Until ' + when + ' · ' + (left === 0 ? 'ends today' : left === 1 ? '1 day left' : left + ' days left')
  }
  OV.windowFact = function (w) {
    if (!w) return null
    if (w.state === 'closed') return ['Return window', w.date ? 'Closed on ' + OV.fmtDay(w.date) : 'Closed']
    return ['Return window', w.date ? 'Open until ' + OV.fmtDay(w.date) : 'Open (a return is offered)']
  }
  /** Facts most cards share: seller, quantity, size, colour. */
  OV.commonFacts = function (lines) {
    const out = []
    const grab = (re, label) => { for (const l of lines) { const m = l.match(re); if (m && m[1].trim().length < 80) { out.push([label, m[1].trim()]); return } } }
    grab(/^(?:sold by|seller)\s*[:\-]\s*(.+)$/i, 'Sold by')
    grab(/^(?:qty|quantity)\s*[:\-]?\s*(\d+)$/i, 'Quantity')
    grab(/^size\s*[:\-]\s*(.+)$/i, 'Size')
    grab(/^colou?r\s*[:\-]\s*(.+)$/i, 'Colour')
    return out
  }

  OV.productLabel = function (titles) {
    if (!titles || !titles.length) return undefined
    return titles.length > 1 ? `${titles[0]} + ${titles.length - 1} more` : titles[0]
  }

  /** Order id from the page address (query string or path), before falling back to page text. */
  OV.idFromUrl = function (url, idRe) {
    try {
      const u = new URL(url)
      const m = (u.search + ' ' + decodeURIComponent(u.pathname)).match(idRe)
      return m ? m[0] : undefined
    } catch (e) { return undefined }
  }

  /**
   * Tag-and-class skeleton of the page with no text and no attribute values other than class names.
   * Safe to share when a page layout is not recognised: it shows structure, never your orders.
   */
  OV.outline = function (doc, maxNodes) {
    maxNodes = maxNodes || 600
    const out = []
    ;(function walk(el, depth) {
      if (out.length >= maxNodes || depth > 16) return
      const tag = el.tagName.toLowerCase()
      if (['script', 'style', 'noscript', 'svg', 'head', 'link', 'meta', 'path', 'header', 'nav', 'footer'].includes(tag)) return
      // The shop's own menu bars (Amazon's alone is hundreds of elements) say nothing about the orders.
      if (depth > 0 && /(?:^|[\s_-])(?:nav|navbar|navigation|rufus|megamenu)(?:$|[\s_-])|^nav-/.test((el.getAttribute('id') || '') + ' ' + (el.getAttribute('class') || ''))) return
      const cls = (el.getAttribute('class') || '').split(/\s+/).filter(c => c && c.length < 40 && !/\d{4,}/.test(c)).slice(0, 4)
      out.push(`${'  '.repeat(depth)}${tag}${cls.length ? '.' + cls.join('.') : ''}`)
      for (const c of el.children) walk(c, depth + 1)
    })(doc.body, 0)
    return out.join('\n')
  }
})(typeof self !== 'undefined' ? self : this)
