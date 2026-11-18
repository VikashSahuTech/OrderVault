/*
 * Searching the saved orders. Plain functions, no page access: the popup uses them, and so do the tests.
 */
(function (root) {
  'use strict'
  const OV = (root.OV = root.OV || {})
  const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const MONTHS_LONG = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
  const compact = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')

  /** A date written the ways people search for it: "15 jan 2023", "15 january 2023", "2023-01-15". */
  function dateWords(iso) {
    const d = new Date(iso)
    if (!iso || Number.isNaN(d.getTime())) return ''
    const day = d.getDate(), m = d.getMonth(), y = d.getFullYear()
    const pad = (n) => String(n).padStart(2, '0')
    return `${day} ${MONTHS_SHORT[m]} ${y} ${day} ${MONTHS_LONG[m]} ${y} ${y}-${pad(m + 1)}-${pad(day)} ${MONTHS_LONG[m]} ${y}`
  }

  /** Everything about an order that is worth searching, in one lower-case string. */
  OV.searchText = function (o) {
    const live = o.live || {}
    // Myntra's list shows no order number, so its ids are made up from the item (they start with "i"): nobody searches for those.
    const madeUp = o.store === 'Myntra' && /^i[a-z0-9]+(?:-\d+)?$/.test(String(o.orderId || ''))
    const status = o.status || 'Unknown'
    const words = [
      o.store, o.product, ...(o.items || []), madeUp ? '' : o.orderId, status,
      // the words people use for a state, as well as the stored one
      status === 'Return/refund' ? 'returned refund refunded return' : '',
      OV.isReplacement && OV.isReplacement(o) ? 'exchange exchanged replacement replaced swap' : '',
      status === 'Cancelled' ? 'canceled cancelled' : '',
      OV.isActive && OV.isActive(o) ? 'on the way in transit active' : '',
      status === 'Unknown' ? 'no status' : '',
      live.text, live.carrier, live.trackingId,
      dateWords(o.placedAt), dateWords(live.eta), dateWords(live.deliveredAt),
      o.amount != null ? String(o.amount) : '', o.notes
    ]
    return words.filter(Boolean).join(' \n ').toLowerCase()
  }

  /**
   * Does the order match what was typed? Every word must be found (in any order), so "myntra jacket refund" narrows down.
   * Letters and digits are also compared with punctuation removed, so an order number can be typed without its dashes.
   */
  OV.matchesOrder = function (o, query) {
    const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
    if (!tokens.length) return true
    const hay = OV.searchText(o)
    const flat = compact(hay)
    return tokens.every(t => hay.includes(t) || (compact(t).length >= 3 && flat.includes(compact(t))))
  }
})(typeof self !== 'undefined' ? self : this)
