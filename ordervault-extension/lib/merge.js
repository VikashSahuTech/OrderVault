/*
 * Combines what the readers saw into the saved list of orders.
 * Each pass over a page is a snapshot of one moment, so history is only ever added to, and a
 * status that has been reached is never walked back by a page that no longer mentions it.
 */
(function (root) {
  'use strict'
  const OV = (root.OV = root.OV || {})
  const PROGRESS = ['Ordered', 'Shipped', 'Out for delivery', 'Delivered']
  const TERMINAL = ['Cancelled', 'Return/refund']
  const rank = (s) => PROGRESS.indexOf(s)

  function mergeStatus(oldS, newS) {
    if (!newS || newS === 'Unknown') return oldS
    if (!oldS || oldS === 'Unknown') return newS
    // A cancellation or return, once seen, is the end of the story; a later state only replaces another terminal one.
    if (TERMINAL.includes(newS)) return newS
    if (TERMINAL.includes(oldS)) return oldS
    return rank(newS) >= rank(oldS) ? newS : oldS
  }

  /** `old` is what is saved (or undefined), `fresh` is what the page just showed. */
  OV.mergeRecord = function (old, fresh) {
    if (!old) return OV.normalize({ ...fresh })
    const status = mergeStatus(old.status, fresh.status)
    const newer = status === fresh.status && fresh.status !== old.status
    const live = { ...(old.live || {}), ...(fresh.live || {}) }
    // Delivery date and ETA belong to whichever snapshot states the current status.
    if (!newer && fresh.status !== old.status) { live.text = (old.live || {}).text; live.eta = (old.live || {}).eta }
    if (status === 'Delivered') delete live.eta
    let items = fresh.items && fresh.items.length ? fresh.items : old.items
    // Some pages shorten a long name ("Mini Hand Blender…"). That must not replace the full name read earlier.
    const cut = (t) => /(?:…|\.\.\.)$/.test(String(t || ''))
    const stem = (t) => String(t || '').replace(/(?:…|\.\.\.)$/, '').trim()
    let product = fresh.product || old.product
    if (old.items && old.items.length && fresh.items && fresh.items.length && cut(fresh.items[0]) && !cut(old.items[0]) && String(old.items[0]).startsWith(stem(fresh.items[0]))) {
      items = old.items
      product = old.product || product
    }
    const placedAt = old.placedAt && fresh.placedAt ? (old.placedAt < fresh.placedAt ? old.placedAt : fresh.placedAt) : (old.placedAt || fresh.placedAt)
    const events = [...(old.events || []), ...(fresh.events || [])]
    // Facts are kept by label; a fresh reading replaces the same label, and facts it did not show stay.
    const facts = OV.cleanFacts([...(old.facts || []), ...(fresh.facts || [])].map(f => [f[0], f[1]]).reduceRight((acc, f) => (acc.some(a => a[0] === f[0]) ? acc : [f, ...acc]), []))
    // The return window is what the shop said last: a fresh reading that mentions one replaces it (open can become closed).
    const returnState = fresh.returnState || old.returnState
    const returnBy = fresh.returnState ? fresh.returnBy : old.returnBy
    return OV.normalize({
      ...old, ...fresh, status, live, facts, kind: fresh.kind || old.kind, returnState, returnBy,
      listRank: typeof fresh.listRank === 'number' ? fresh.listRank : old.listRank,
      product, items, amount: fresh.amount ?? old.amount, placedAt, events
    })
  }

  /** Merges a batch of fresh records into a map of saved ones (by id). Returns { map, added, changed }. */
  OV.mergeAll = function (saved, freshList) {
    const map = { ...saved }
    let added = 0
    let changed = 0
    for (const f of freshList) {
      const old = map[f.id]
      const next = OV.mergeRecord(old, f)
      if (!old) added += 1
      else if (old.status !== next.status || (old.live || {}).text !== (next.live || {}).text || (old.live || {}).eta !== (next.live || {}).eta) changed += 1
      map[f.id] = next
    }
    return { map, added, changed }
  }

  /**
   * The words shown on an order's tag. The stored status stays one of a few fixed values (so merging and the tabs work); what
   * the order is decides how it is put: an app is "Installed", a flight "Trip completed", a refund "Refunded".
   */
  OV.statusLabel = function (o) {
    const st = o.status || 'Unknown'
    const text = String((o.live && o.live.text) || '').toLowerCase()
    const kind = o.kind
    // An exchange or replacement that is not (or not only) a return says where it is. Its words come from the status line, or from
    // the history when the current line no longer says it.
    if (st !== 'Return/refund' && st !== 'Cancelled' && OV.isReplacement(o)) {
      const said = text + ' ' + (o.events || []).map(e => String(e.text || '').toLowerCase()).join(' ')
      const word = /exchang|swap|size change/.test(said) ? 'Exchange' : 'Replacement'
      if (st === 'Delivered') return word + ' delivered'
      if (st === 'Shipped' || st === 'Out for delivery') return word + ' on the way'
      if (st === 'Ordered') return word + ' requested'
    }
    if (st === 'Delivered') {
      if (kind === 'App') return 'Installed'
      if (kind === 'Flight') return 'Trip completed'
      if (kind === 'Service') return 'Service completed'
      if (kind === 'Recharge' || kind === 'Bill payment' || kind === 'Wallet top-up' || kind === 'Gift card') return 'Completed'
      if (kind === 'Subscription') return 'Charged'
      if (kind === 'E-book' || kind === 'Video') return 'Purchased'
      return 'Delivered'
    }
    if (st === 'Ordered' && kind === 'Flight') return 'Upcoming trip'
    if (st === 'Cancelled' && kind === 'Subscription') return 'Ended'
    if (st === 'Return/refund') return /exchang|swap/.test(text) ? 'Exchanged' : /replac/.test(text) ? 'Replacement' : /refund/.test(text) ? 'Refunded' : 'Returned'
    return st
  }

  /**
   * Does the shop's own status wording mention a replacement or an exchange? Only the status lines are looked at (the live text
   * and the history), never button or policy text such as "Return or replace items".
   */
  // An exchange or a replacement, in whatever words the shop uses: "Exchange initiated", "Exchange picked up", "Size exchange
  // requested", "Replacement shipped", "Replacement delivered", "Item swapped", "A new item will be sent".
  const EXCHANGE_WORDS = /\breplacement\b|\breplaced\b|\bexchang(?:e|ed|ing)\b|\bswap(?:ped)?\b|\breship(?:ped|ment)?\b|\bsize change\b|\bnew (?:item|product|piece|pair|one) (?:will be|is being|has been|was) (?:sent|shipped|dispatched|delivered)\b|\bsent (?:a )?replacement\b/
  // Button, policy and eligibility text that mentions the same words without anything having happened.
  const NOT_AN_EXCHANGE = /\b(?:window|policy|eligible|eligibility|valid (?:till|until)|replace items|return or replace|return\/replace|exchange\/return|returns? or exchanges?|how to|want to|request (?:a|an) (?:return|replacement|exchange)|exchange offer|exchange (?:your|old)|trade-?in)\b/
  OV.isReplacement = function (o) {
    const lines = [(o.live && o.live.text) || '', ...((o.events || []).map(e => e.text || ''))]
    return lines.some(l => { const s = String(l).toLowerCase(); return EXCHANGE_WORDS.test(s) && !NOT_AN_EXCHANGE.test(s) })
  }

  /**
   * The tabs of the popup. Every order belongs to exactly one, so the counts add up; "all" is the whole list. The popup shows
   * a tab only when at least one of the orders being looked at belongs to it.
   */
  OV.TABS = [
    ['active', 'On the way'], ['Delivered', 'Delivered'], ['Installed', 'Installed'], ['Trips', 'Trips'], ['Digital', 'Digital'],
    ['Payments', 'Payments & services'], ['Replacement', 'Exchanged'], ['Cancelled', 'Cancelled'], ['Returned', 'Returned'],
    ['Unknown', 'No status'], ['all', 'All']
  ]
  OV.tabOf = function (o) {
    const st = o.status
    if (st === 'Cancelled') return 'Cancelled'
    // Anything that is an exchange or a replacement is one, whether it is still on its way, was delivered, or is being returned.
    if (OV.isReplacement(o)) return 'Replacement'
    if (st === 'Return/refund') return 'Returned'
    if (o.kind === 'Flight') return 'Trips'
    if (OV.isActive(o)) return 'active'
    if (st === 'Delivered') {
      const k = o.kind
      if (k === 'App') return 'Installed'
      if (k === 'E-book' || k === 'Video' || k === 'Digital') return 'Digital'
      if (k === 'Recharge' || k === 'Bill payment' || k === 'Wallet top-up' || k === 'Gift card' || k === 'Subscription' || k === 'Service') return 'Payments'
      return 'Delivered'
    }
    return 'Unknown'
  }
  OV.inTab = function (id, o) { return id === 'all' || OV.tabOf(o) === id }

  /**
   * The best date for where an order belongs in time, as a number (or NaN): the purchase date when the shop gives one, otherwise
   * the delivery date, the day a refund was credited, or the expected date. None of these is "when it was last read".
   */
  OV.orderDate = function (o) {
    const live = o.live || {}
    const refund = ((o.facts || []).find(f => f[0] === 'Refund credited on') || [])[1]
    for (const v of [o.placedAt, live.deliveredAt, refund, live.eta]) {
      const t = v ? new Date(v).getTime() : NaN
      if (!Number.isNaN(t)) return t
    }
    return NaN
  }

  /**
   * Newest purchase first, across every shop. An order with no date of its own (Myntra and Flipkart cards show none) takes its
   * place from where the shop listed it: shops list newest first, so it goes just below the nearest listed order above it that
   * has a date. An order with nothing to go by goes last. Returns a new array.
   */
  OV.sortOrders = function (list) {
    const when = new Map()
    const byShop = {}
    for (const o of list) (byShop[o.store] = byShop[o.store] || []).push(o)
    for (const group of Object.values(byShop)) {
      const ranked = group.filter(o => typeof o.listRank === 'number').sort((a, b) => a.listRank - b.listRank)
      const own = ranked.map(o => OV.orderDate(o))
      // The nearest dated order above (newer in the list) and below (older in the list) each one.
      const above = [], below = []
      let d = NaN
      for (let i = 0; i < ranked.length; i++) { if (!Number.isNaN(own[i])) d = own[i]; above[i] = d }
      d = NaN
      for (let i = ranked.length - 1; i >= 0; i--) { if (!Number.isNaN(own[i])) d = own[i]; below[i] = d }
      ranked.forEach((o, i) => {
        if (!Number.isNaN(own[i])) { when.set(o, own[i]); return }
        // No date of its own. Under a dated order it goes just below that one; with none above it, just above the first dated one
        // below it; the position in the list keeps the undated ones in the shop's own order. (A millisecond is far below the
        // gap between any two real dates.)
        if (!Number.isNaN(above[i])) when.set(o, above[i] - 1 - o.listRank / 1e6)
        else if (!Number.isNaN(below[i])) when.set(o, below[i] + 1 + (1e6 - o.listRank) / 1e6)
        else when.set(o, NaN)
      })
      for (const o of group) if (!when.has(o)) when.set(o, OV.orderDate(o))
    }
    const key = (o) => { const t = when.get(o); return Number.isNaN(t) ? -Infinity : t }
    return [...list].sort((a, b) => key(b) - key(a) ||
      (a.store === b.store && typeof a.listRank === 'number' && typeof b.listRank === 'number' ? a.listRank - b.listRank : 0) ||
      String((b.live || {}).checkedAt || '').localeCompare(String((a.live || {}).checkedAt || '')))
  }

  /** Records still on their way: worth opening again to refresh. */
  OV.isActive = function (rec) { return rec.status === 'Ordered' || rec.status === 'Shipped' || rec.status === 'Out for delivery' }
})(typeof self !== 'undefined' ? self : this)
