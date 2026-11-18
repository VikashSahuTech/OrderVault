(function () {
  'use strict'
  const OV = self.OV
  const $ = (id) => document.getElementById(id)
  const PAGES = [
    ['Amazon', 'https://www.amazon.in/gp/your-account/order-history'],
    ['Flipkart', 'https://www.flipkart.com/account/orders'],
    ['Myntra', 'https://www.myntra.com/my/orders']
  ]
  const inTabId = (id, o) => OV.inTab(id, o)
  const takenText = (ms) => {
    const s = Math.max(1, Math.round(ms / 1000))
    if (s < 60) return s + ' s'
    const m = Math.floor(s / 60)
    return m < 60 ? m + ' min ' + String(s % 60).padStart(2, '0') + ' s' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min'
  }
  const madeUpId = (o) => o.store === 'Myntra' && /^i[a-z0-9]+(?:-\d+)?$/.test(String(o.orderId || ''))
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z]+/g, '-')
  const fmt = (iso, withTime) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return withTime
      ? d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  const ago = (iso) => {
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
    if (!(m >= 0)) return ''
    if (m < 2) return 'just now'
    if (m < 60) return `${m} min ago`
    if (m < 1440) return `${Math.floor(m / 60)} h ago`
    return `${Math.floor(m / 1440)} d ago`
  }
  function el(tag, props, ...kids) {
    const n = document.createElement(tag)
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue
      if (k === 'class') n.className = v
      else if (k === 'text') n.textContent = v
      else n.setAttribute(k, v)
    }
    for (const k of kids.flat()) if (k) n.append(k)
    return n
  }

  let orders = {}
  let meta = {}
  let tab = 'active'
  let query = ''          // what is typed in the search box
  const PAGE = 60         // orders drawn at a time; a few hundred at once would make the popup slow
  let limit = PAGE

  // The tab being looked at. It is the one that was picked if it has anything in it, otherwise "All": a tab with nothing in it
  // is not shown at all, so there is never an empty one to land on.
  let shownTab = 'active'
  const inTab = (o) => inTabId(shownTab, o)

  const SHOP_HOST = { Amazon: /(?:^|\.)amazon\.in$/, Flipkart: /(?:^|\.)flipkart\.com$/, Myntra: /(?:^|\.)myntra\.com$/ }
  /** The shop page for an order, or '' when there is none that can be trusted. */
  function shopLink(o) {
    const u = (o.live && o.live.trackUrl) || ''
    try { const x = new URL(u); return x.protocol === 'https:' && SHOP_HOST[o.store] && SHOP_HOST[o.store].test(x.hostname) ? x.href : '' } catch (e) { return '' }
  }

  /** A status line as the shop said it: the extension's own bracketed notes ("Delivered (not stated: ...)") are dropped. */
  const cleanLine = (t) => String(t || '').replace(/\s*\((?:not stated|no delivery|grocery order)[^)]*\)\s*$/i, '').replace(/\s+/g, ' ').trim()

  /** "More details": everything known about the order, as label / value rows (text only, never markup). */
  // The card's own lines already show the order number, the purchase date, the expected or delivered date, the carrier and
  // tracking number, when it was checked, and the kind (the badge). "More details" holds only what those do not, and each
  // thing appears once: the same label, or the same value under another label, is dropped.
  // 'delivered to' is a name: on one's own account it says nothing, so it is never shown (orders saved before this still carry it).
  const SHOWN_ON_CARD = new Set(['type', 'kind', 'order type', 'order number', 'purchased', 'placed', 'expected', 'delivered', 'delivered on', 'carrier', 'tracking number', 'last checked', 'delivered to', 'travel date'])
  function detailsOf(o) {
    const rows = []
    const seenLabel = new Set()
    const seenValue = new Set()
    const live = o.live || {}
    const add = (k, v) => {
      if (v === undefined || v === null || String(v).trim() === '') return
      const key = String(k).toLowerCase(), val = String(v).trim()
      if (SHOWN_ON_CARD.has(key) || seenLabel.has(key)) return
      // the same words under a different label ("Trip: Trip completed" next to the tag) are not worth a second row
      if (seenValue.has(val.toLowerCase()) || val.toLowerCase() === String(o.kind || '').toLowerCase() || val.toLowerCase() === OV.statusLabel(o).toLowerCase()) return
      seenLabel.add(key); seenValue.add(val.toLowerCase())
      rows.push([k, val])
    }
    // Until when it can be returned, and how many days are left, worked out for today.
    add('Return window', OV.returnInfo(o, Date.now()))
    for (const [k, v] of o.facts || []) add(k, v)
    if (typeof o.amount === 'number') add('Amount', OV.fmtMoney(o.amount))
    // How long it took from ordering to arriving. ("Ordered 3 years ago" is not shown: the purchase date is already on the card.)
    if (o.status === 'Delivered' && o.placedAt && live.deliveredAt) {
      const days = Math.round((new Date(live.deliveredAt) - new Date(o.placedAt)) / 86400000)
      if (days >= 0 && days < 400) add('Delivery took', days === 0 ? 'Same day' : days === 1 ? '1 day' : days + ' days')
    }
    const items = (o.items || []).filter(t => t && t !== o.product)
    if (items.length > 1) add('Items', items.slice(0, 8).join(' · '))
    if (!rows.length) return null
    const d = el('details', { class: 'more-details' }, el('summary', { text: 'More details' }))
    const g = el('dl', { class: 'facts' })
    for (const [k, v] of rows) g.append(el('dt', { text: k }), el('dd', { text: v }))
    d.append(g)
    return d
  }

  function note(text, ok) {
    const n = $('note')
    n.hidden = !text
    n.textContent = text || ''
    n.className = 'note' + (ok ? ' ok' : '')
  }

  function render() {
    const everything = Object.values(orders)
    // The search narrows every tab at once, so the counts on the tabs are the matches in each.
    const all = query ? everything.filter(o => OV.matchesOrder(o, query)) : everything
    const list = $('list')
    list.textContent = ''
    $('tabs').textContent = ''
    // Only tabs that have at least one order among the ones being looked at (all of them, or the search matches).
    const counts = {}
    for (const o of all) counts[OV.tabOf(o)] = (counts[OV.tabOf(o)] || 0) + 1
    const present = OV.TABS.filter(([id]) => id === 'all' ? all.length > 0 : counts[id] > 0)
    shownTab = present.some(([id]) => id === tab) ? tab : 'all'
    for (const [id, label] of present) {
      const count = id === 'all' ? all.length : counts[id]
      const b = el('button', { class: id === shownTab ? 'on' : '', type: 'button' }, label, el('em', { text: String(count) }))
      b.addEventListener('click', () => { tab = id; limit = PAGE; render() })
      $('tabs').append(b)
    }
    // Newest purchase first across all shops, whatever the order in which they were read.
    const rows = OV.sortOrders(all.filter(inTab))
    $('empty').hidden = rows.length > 0
    $('q-count').hidden = !query
    if (query) $('q-count').textContent = all.length ? `${all.length} of ${everything.length} orders match${rows.length < all.length ? ` · ${rows.length} in this tab` : ''}` : `No orders match “${query}”`
    if (!rows.length) {
      $('empty').textContent = !everything.length
        ? 'No orders read yet. Pick a shop above (stay signed in) and your orders appear here. Everything stays on this device.'
        : query
          ? 'Try fewer words, or a different spelling.'
          : 'Nothing in this view.'
    }
    for (const o of rows.slice(0, limit)) {
      const live = o.live || {}
      // A link on every order: the shop's own page for it. Only https addresses on the shop's own site are used, whatever was saved.
      const link = shopLink(o) ? el('a', { href: shopLink(o), target: '_blank', rel: 'noopener noreferrer', text: OV.isActive(o) ? 'Track on ' + o.store : 'Open on ' + o.store }) : null
      const status = o.status || 'Unknown'
      const label = OV.statusLabel(o)
      // What the shop says right now, once: not when it only repeats the tag ("Refunded" under "Refunded"), and without
      // the extension's own notes in brackets ("Delivered (not stated: ...)").
      const said = cleanLine(live.text)
      const showSaid = said && said.toLowerCase() !== label.toLowerCase() && said.toLowerCase() !== status.toLowerCase()
      // One line for the dates and one for the carrier, each thing once.
      const bits = []
      const when = []
      if (live.eta && OV.isActive(o)) when.push(['Expected', fmt(live.eta)])
      if (status === 'Delivered' && live.deliveredAt) when.push(['Delivered', fmt(live.deliveredAt)])
      const trip = o.kind === 'Flight' ? (o.facts || []).find(f => f[0] === 'Travel date') : null
      const tripAt = trip ? new Date(trip[1]) : null
      if (tripAt && !Number.isNaN(tripAt.getTime())) when.unshift([tripAt.getTime() < Date.now() ? 'Travelled' : 'Travel', fmt(tripAt.toISOString())])
      if (o.placedAt) when.push(['Purchased', fmt(o.placedAt)])
      if (when.length) {
        const line = el('div', { class: 'dates' })
        when.forEach(([k, v], i) => { if (i) line.append(el('span', { class: 'dot', text: ' · ' })); line.append(document.createTextNode(k + ' '), el('b', { text: v })) })
        bits.push(line)
      }
      if (live.carrier || live.trackingId) bits.push(el('div', { text: [live.carrier, live.trackingId && '#' + live.trackingId].filter(Boolean).join(' · ') }))
      // The history is worth showing when it has more than the first and the last step: a one-step history and the
      // "Order placed" line next to the status are already said by the card.
      // The "Order placed" step is the purchase date, already on the dates line; the current step is the tag. What is left is the
      // path in between (shipped, out for delivery, ...), and a history of one step says nothing the card does not.
      // The step recorded for the current status is dated with the day the extension first read it, which for an order found
      // today is today: that is not when it happened, and the tag already says it, so it is left out.
      const evs = (o.events || [])
        .filter(e => !(e.status === o.status && String(e.key || '').endsWith(':s:' + o.status)))
        .filter(e => e.status !== 'Ordered' && cleanLine(e.text || e.status).toLowerCase() !== label.toLowerCase() && cleanLine(e.text || e.status).toLowerCase() !== status.toLowerCase())
        .slice(-4).reverse()
        .filter((e, i, a) => a.findIndex(x => cleanLine(x.text || x.status) === cleanLine(e.text || e.status)) === i)
      list.append(el('li', { class: 'item' },
        el('div', { class: 'top' },
          el('div', { class: 'name' }, el('span', { class: 'shop', text: o.store }), o.kind ? el('span', { class: 'kind', text: o.kind }) : null, o.product || (madeUpId(o) ? 'Myntra item' : 'Order ' + o.orderId)),
          el('span', { class: 'tag ' + slug(status), text: label })),
        showSaid ? el('div', { class: 'live said', text: said }) : null,
        bits.length ? el('div', { class: 'live' }, bits) : null,
        // The order number once, then when it was last checked. Myntra's list shows no order number (its ids are made up).
        // Myntra's list shows no order number, so its ids are made up: there is nothing to show instead (the card says Myntra already).
        el('div', { class: 'meta' }, madeUpId(o) ? '' : `#${o.orderId}`, live.checkedAt ? `${madeUpId(o) ? '' : ' · '}checked ${ago(live.checkedAt)}` : '', link ? ' · ' : '', link),
        evs.length ? el('ul', { class: 'events' }, evs.map(e => el('li', {}, el('time', { text: fmt(e.date, true) }), cleanLine(e.text || e.status)))) : null,
        detailsOf(o)))
    }
    if (rows.length > limit) {
      const more = el('button', { type: 'button', text: `Show ${Math.min(PAGE, rows.length - limit)} more (${rows.length - limit} not shown)` })
      more.addEventListener('click', () => { limit += PAGE; render() })
      list.append(el('li', { class: 'more' }, more))
    }

    const reads = meta.lastRead || {}
    const last = Object.entries(reads).sort((a, b) => b[1].at.localeCompare(a[1].at))[0]
    $('sub').textContent = all.length
      ? `${all.length} order${all.length === 1 ? '' : 's'} saved on this device${last ? ` · last read ${last[0]} ${ago(last[1].at)}` : ''}`
      : 'Nothing read yet'
    // What each shop's reader last did, so "nothing happened" can be told apart from "read, found nothing".
    const rd = $('reads')
    rd.textContent = ''
    for (const [name] of PAGES) {
      const r = reads[name]
      // The number saved for the shop, not the size of the last page read (a long list is read page by page, several at once).
      const saved = all.filter(o => o.store === name).length
      rd.append(el('div', {}, el('b', { text: name }), r ? ` · ${saved} order${saved === 1 ? '' : 's'} saved · last read ${ago(r.at)}` : (saved ? ` · ${saved} saved` : ' · not read yet')))
    }
    // Order-like links that were not turned into orders (shapes of the addresses only).
    const um = Object.entries(meta.unmatched || {}).filter(([, v]) => v && v.shapes && v.shapes.length)
    $('unmatched-note').hidden = !um.length
    if (um.length) $('unmatched-text').value = um.map(([shop, v]) => `${shop}:\n` + v.shapes.map(([s, n]) => `  ${n}× ${s}`).join('\n')).join('\n\n')
    // What each finished read found, and when: "Myntra · 299 orders read at 11:14 am".
    const hist = meta.history || []
    $('history-note').hidden = !hist.length
    const hl = $('history-list')
    hl.textContent = ''
    for (const h of hist.slice(0, 12)) {
      const d = new Date(h.at)
      const when = Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
      // The time the read took comes first; the clock time is only there to tell one read from another.
      const took = typeof h.ms === 'number' ? takenText(h.ms) : ''
      hl.append(el('li', { class: h.ok ? '' : 'bad' },
        el('b', { text: h.store }), h.ok ? ` · ${h.read} order${h.read === 1 ? '' : 's'} read${took ? ' in ' + took : ''} · ${h.saved} saved` : ` · did not finish${took ? ' after ' + took : ''}`,
        el('small', { text: `${when}${h.text ? ' · ' + h.text : ''}` })))
    }
    $('notify').checked = meta.notify === true
    // Orders whose status could not be read: the lines their cards show, most common first, so the wording can be added.
    const noStatus = all.filter(o => !o.status || o.status === 'Unknown')
    const un = $('unread-note')
    un.hidden = !noStatus.length
    if (noStatus.length) {
      const parts = []
      const shops = [...new Set(noStatus.map(o => o.store))]
      for (const shop of shops) {
        const mine = noStatus.filter(o => o.store === shop)
        const saved = (meta.unread || {})[shop] || {}
        const tally = {}
        let withLines = 0
        for (const o of mine) {
          const ls = saved[o.id]
          if (!ls || !ls.length) continue
          withLines++
          for (const l of ls) tally[l] = (tally[l] || 0) + 1
        }
        const rows = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 30)
        parts.push(`${shop}: ${mine.length} order${mine.length === 1 ? '' : 's'} with no status` +
          (rows.length ? ` (lines shown by ${withLines} of them):\n` + rows.map(([l, n]) => `  ${n}× ${l}`).join('\n') : '. No lines were kept for these: press the shop button again and they will be listed.'))
      }
      $('unread-text').textContent = parts.join('\n\n')
    }
    const bad = Object.entries(meta.unrecognised || {})
    $('help').hidden = !bad.length
    if (bad.length) $('outline').value = bad.map(([s, v]) => `# ${s} ${v.url}${v.error ? ' ERROR: ' + v.error : ''}\n${v.outline || '(no outline)'}`).join('\n\n')
    $('export').disabled = !all.length
    $('clear').disabled = !all.length
    // With Developer off the diagnostic lists are hidden, so a page the reader could not understand, or an order with no status,
    // is still pointed out in one line.
    const att = []
    if (bad.length) att.push(`${bad.map(([s]) => s).join(' and ')}: a page was read but not understood.`)
    if (noStatus.length) att.push(`${noStatus.length} order${noStatus.length === 1 ? ' has' : 's have'} no status yet.`)
    if (um.length) att.push('Some order-like links were not recognised.')
    $('attention').hidden = !att.length
    $('attention').textContent = att.length ? att.join(' ') + ' Turn on Developer (top right) for the details.' : ''
    renderCrawl()
  }

  async function reload() {
    const got = await chrome.storage.local.get(['orders', 'meta', 'crawl'])
    orders = got.orders || {}
    meta = got.meta || {}
    crawl = got.crawl || null
    render()
  }

  // ------------------------------------------------------------ read all pages (Myntra)

  let crawl = null
  // A crawl that has not reported for a while (tab closed, computer slept) is treated as stopped.
  const crawlLive = () => !!(crawl && crawl.running && Date.now() - (crawl.updatedAt || crawl.startedAt || 0) < 90000)
  function renderCrawl() {
    const live = crawlLive()
    $('crawl-stop').hidden = !live
    let text = ''
    if (crawl) {
      if (live) {
        // The count once: some progress messages already end with it ("... · 461 orders so far"), some do not ("Read 20 of 60 pages").
        const msg = crawl.message || 'Starting…'
        const hasCount = /\borders? so far\b/i.test(msg)
        text = msg + (crawl.orders && !hasCount ? ` · ${crawl.orders} orders so far` : '') + `. The ${crawl.store || 'shop'} tabs close by themselves when it is done.`
      }
      else if (crawl.running) text = `No news from the ${crawl.store || 'shop'} read for a while: the extension may have been reloaded, or the computer slept. It carries on by itself if the extension is still running; otherwise press the ${crawl.store || 'shop'} button again. Orders already read are kept.`
      else text = crawl.message || ''
    }
    // The last few steps the crawl took, so a stop can be explained without opening any console (Developer only).
    const dev = document.body.classList.contains('dev')
    const trail = dev && crawl && crawl.trace && crawl.trace.length ? '\n\nSteps:\n' + crawl.trace.slice(-6).join('\n') : ''
    // Without Developer the progress is not shown, but a read that stopped or lost track of itself always says so (a sign-in is
    // needed, a page would not load): hiding that would leave nobody knowing what to do.
    const problem = !!text && !live && !/^Done/.test(text)
    const showText = dev || problem
    // How many orders came from each period (Amazon), newest first and in full, so nothing is cut off with "…".
    const byPeriod = dev && crawl && crawl.store === 'Amazon' && !live && crawl.counts
      ? '\n\nBy period: ' + Object.entries(crawl.counts).filter(([, n]) => n > 0)
          .sort((a, b) => (a[0] === 'recent' ? 1 : 0) - (b[0] === 'recent' ? 1 : 0) || b[0].localeCompare(a[0]))
          .map(([s, n]) => (s === 'recent' ? 'past 3 months' : s.replace('year-', '')) + ' ' + n).join(' · ')
      : ''
    $('crawl-msg').textContent = showText ? text + byPeriod + trail : ''
    $('crawl-msg').hidden = !showText
    $('crawl-msg').style.whiteSpace = 'pre-wrap'
  }
  $('crawl-stop').addEventListener('click', async () => {
    try { await chrome.runtime.sendMessage({ type: 'ov:crawl-stop' }) } catch (e) { /* ignore */ }
  })
  setInterval(() => { if (crawl && crawl.running) renderCrawl() }, 5000)

  // Which of the three shops is open in the current tab?
  async function currentShop() {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!t || !t.url) return null
    try { const h = new URL(t.url).hostname; return PAGES.find(([, u]) => h.endsWith(new URL(u).hostname.replace(/^www\./, '')))?.[0] && t } catch (e) { return null }
  }

  $('read').addEventListener('click', async () => {
    const t = await currentShop()
    if (!t) return note('Open your orders page on Amazon, Flipkart or Myntra in this window first, then press this again.')
    try {
      const res = await chrome.tabs.sendMessage(t.id, { type: 'ov:read-now' })
      if (res && res.ok === false) return note(res.reason)
      note('Reading the page…', true)
      setTimeout(async () => {
        await reload()
        const u = (meta.unrecognised || {})
        note(Object.keys(u).length ? 'This page was read but no orders were recognised. See "A page was not recognised" below.' : 'Done.', !Object.keys(u).length)
      }, 900)
    } catch (e) {
      note('This page has not loaded the reader yet. Reload the page and try again.')
    }
  })

  // Search as you type. Escape clears it. The box is not rebuilt when the list is, so typing is never interrupted.
  $('q').addEventListener('input', () => { query = $('q').value.trim(); limit = PAGE; render() })
  $('q').addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('q').value) { e.preventDefault(); $('q').value = ''; query = ''; limit = PAGE; render() } })

  // Developer switch (top right): off by default, and remembered. It is its own saved setting, so "Clear all" does not reset it.
  function setDev(on) { document.body.classList.toggle('dev', !!on); $('dev').checked = !!on; renderCrawl() }
  $('dev').addEventListener('change', () => { setDev($('dev').checked); try { chrome.storage.local.set({ dev: $('dev').checked }) } catch (e) { /* not remembered */ } })
  try { chrome.storage.local.get('dev').then(g => setDev(g.dev === true)).catch(() => {}) } catch (e) { /* stays off */ }

  // The notice switch lives with the rest of the saved settings.
  $('notify').addEventListener('change', async () => {
    const got = await chrome.storage.local.get('meta')
    await chrome.storage.local.set({ meta: { ...(got.meta || {}), notify: $('notify').checked } })
  })
  // The chosen speed is remembered.
  try { chrome.storage.local.get('speed').then(g => { if (g.speed && ['careful', 'normal', 'fast'].includes(g.speed)) $('speed').value = g.speed }) } catch (e) { /* default */ }
  $('speed').addEventListener('change', () => { try { chrome.storage.local.set({ speed: $('speed').value }) } catch (e) { /* ignore */ } })

  // One button per shop. Each opens that shop's orders page in a background tab, reads it (every page, for Myntra) and
  // closes the tab again; a tab is only left open when it needs you, such as a sign-in page.
  const shopButtons = []
  for (const [name] of PAGES) {
    const b = el('button', { class: 'shop-btn', type: 'button', text: name + ' orders' })
    b.addEventListener('click', async () => {
      shopButtons.forEach(x => { x.disabled = true })
      note(name === 'Flipkart' ? 'Reading Flipkart… this tab opens in front for a minute or so, then closes by itself.' : `Starting ${name}…`, true)
      try {
        const res = await chrome.runtime.sendMessage({ type: 'ov:read-shop', store: name, speed: $('speed').value })
        if (!res) note('The extension did not answer. Reload it on the extensions page and try again.')
        else note(res.message || (res.ok ? 'Done.' : 'Could not read.'), !!res.ok)
      } catch (e) {
        note('The extension did not answer. Reload it on the extensions page and try again.')
      } finally { shopButtons.forEach(x => { x.disabled = false }); reload() }
    })
    shopButtons.push(b)
    $('open-row').append(b)
  }

  // Export in the shape the OrderVault app imports. Ids are prefixed so nothing already in the app is overwritten,
  // and they are marked as hand-added so a Gmail sync does not clear them.
  function toAppOrder(o) {
    const live = o.live || {}
    const when = live.checkedAt || new Date().toISOString()
    return {
      id: `ext:${o.id}`, store: o.store, orderId: o.orderId, product: o.product || `${o.store} order`,
      amount: o.amount, currency: 'INR', orderDate: o.placedAt || (o.events && o.events[0] && o.events[0].date) || when,
      purchaseEstimated: !o.placedAt, status: o.status || 'Unknown', subject: live.text || o.product || '', sender: 'OrderVault Tracker',
      emailDate: when, gmailMessageId: '', snippet: [live.carrier, live.trackingId && '#' + live.trackingId].filter(Boolean).join(' '),
      sourceCount: (o.events || []).length,
      events: (o.events || []).map(e => ({ emailId: String(e.key).slice(0, 60), date: e.date, status: e.status, subject: e.text || e.status, snippet: '' })),
      manual: true, parserVersion: 3
    }
  }
  $('export').addEventListener('click', () => {
    const list = Object.values(orders).map(toAppOrder)
    const blob = new Blob([JSON.stringify({ app: 'OrderVault', version: 2, exportedAt: new Date().toISOString(), orders: list, userData: [] }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `ordervault-tracker-${new Date().toISOString().slice(0, 10)}.json`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    note(`Saved ${list.length} orders. In OrderVault choose Import and pick that file.`, true)
  })
  // "Clear all" deletes everything, so it says exactly what will go before it does. A single shop can be cleared on its own
  // with the shop's own link under the history, which leaves the other shops' orders alone.
  $('clear').addEventListener('click', async () => {
    const counts = {}
    for (const o of Object.values(orders)) counts[o.store] = (counts[o.store] || 0) + 1
    const parts = Object.entries(counts).map(([s, n]) => `${n} ${s}`)
    if (!confirm(`Delete ALL saved orders (${parts.join(', ') || 'none'}) from every shop? This cannot be undone. Your shop accounts are not affected.\n\nTo remove just one shop, use "Clear one shop" instead.`)) return
    await chrome.storage.local.remove(['orders', 'meta', 'crawl'])
    await chrome.action.setBadgeText({ text: '' })
    note('Cleared.', true)
    reload()
  })
  $('clear-shop').addEventListener('change', async () => {
    const shop = $('clear-shop').value
    $('clear-shop').value = ''
    if (!shop) return
    const got = await chrome.storage.local.get(['orders', 'meta'])
    const all = got.orders || {}
    const mine = Object.keys(all).filter(id => all[id].store === shop)
    if (!mine.length) return note(`No ${shop} orders are saved.`)
    if (!confirm(`Delete the ${mine.length} saved ${shop} orders? Orders from the other shops stay. This cannot be undone.`)) return
    const keep = {}
    for (const id of Object.keys(all)) if (all[id].store !== shop) keep[id] = all[id]
    const m = { ...(got.meta || {}) }
    for (const key of ['lastRead', 'unread', 'unmatched', 'unrecognised']) if (m[key] && typeof m[key] === 'object') { m[key] = { ...m[key] }; delete m[key][shop] }
    await chrome.storage.local.set({ orders: keep, meta: m })
    note(`Removed ${mine.length} ${shop} orders. The other shops are untouched.`, true)
    reload()
  })
  $('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('outline').value); note('Copied.', true) } catch (e) { $('outline').select() }
  })

  chrome.storage.onChanged.addListener((_c, area) => { if (area === 'local') reload() })
  reload()
  // With orders saved, the cursor is ready in the search box as soon as the popup opens.
  chrome.storage.local.get('orders').then(g => { if (Object.keys(g.orders || {}).length) $('q').focus() }).catch(() => {})
})()
