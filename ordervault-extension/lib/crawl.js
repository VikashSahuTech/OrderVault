/*
 * "Read all pages" for Myntra. Driven from the background worker, not from the page.
 *
 * Page 1 is read in your own tab and says how many pages the list has ("Showing 1 -5 of 299"). The rest
 * are then shared between up to three extra background tabs, which open on their own, take the next page
 * from a shared list, and close themselves when none are left. The reader is injected on every step, so
 * it does not matter whether a tab was open before the extension was reloaded.
 *
 * It only runs after the popup's button is pressed, and stops when every page is read, when a page that
 * should have orders stays empty, if Myntra sends the tab to a sign-in page, or on Stop.
 */
(function (root) {
  'use strict'
  const OV = (root.OV = root.OV || {})
  const FIRST = 'https://www.myntra.com/my/orders'
  const MAX_PAGES = 300
  const pageUrl = (p) => (p <= 1 ? FIRST : `${FIRST}?p=${p}`)
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) }

  // ---- Runs inside the Myntra page (injected). Must stay self-contained: it is serialised and sent to the tab.

  async function probe() {
    const OV = self.OV
    const sleep = (ms) => new Promise(r => setTimeout(r, ms))
    let res, prev = '', stable = 0
    // Wait until the list has drawn and stopped changing (checked twice a second, for up to 30 s).
    for (let i = 0; i < 60 && stable < 1; i++) {
      try { res = OV.myntra.parse(document, location.href, Date.now()) } catch (e) { res = { orders: [] } }
      const k = JSON.stringify(res.orders.map(o => [o.id, o.status]))
      stable = res.orders.length && k === prev ? stable + 1 : 0
      prev = k
      if (stable < 1) await sleep(500)
    }
    let orders = (res && res.orders) || []
    let pager = OV.myntra.pager(document, location.href)
    // The page says how many orders it holds ("Showing 6 -10 of 299"). If fewer than that are drawn, the rest are still
    // coming: give them a few more moments instead of saving a short page.
    for (let j = 0; j < 8 && pager.pageSize && orders.length < pager.pageSize; j++) {
      await sleep(500)
      try { res = OV.myntra.parse(document, location.href, Date.now()) } catch (e) { break }
      orders = res.orders || orders
      prev = JSON.stringify(orders.map(o => [o.id, o.status]))
      pager = OV.myntra.pager(document, location.href)
    }
    return { url: location.href, orders, key: prev, pager, outline: orders.length ? undefined : OV.outline(document, 400) }
  }

  /** Small bar at the bottom of the page while a crawl runs. Empty text removes it. */
  function banner(text) {
    let b = document.getElementById('ov-crawl-banner')
    if (!text) { if (b) b.remove(); return }
    if (!b) {
      if (!document.body) return
      b = document.createElement('div')
      b.id = 'ov-crawl-banner'
      b.style.cssText = 'position:fixed;z-index:2147483647;left:50%;bottom:16px;transform:translateX(-50%);background:#1b1640;color:#fff;font:13px system-ui,sans-serif;padding:10px 14px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.5);display:flex;gap:12px;align-items:center'
      const t = document.createElement('span')
      const s = document.createElement('button')
      s.textContent = 'Stop'
      s.style.cssText = 'background:#3a202b;color:#ffb0b8;border:1px solid #75404c;border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit'
      s.addEventListener('click', () => { try { chrome.runtime.sendMessage({ type: 'ov:crawl-stop' }) } catch (e) { /* ignore */ } b.remove() })
      b.append(t, s)
      document.body.append(b)
    }
    b.firstChild.textContent = text
  }

  /** Injected into an Amazon / Flipkart page: waits for the list to draw, then returns what it found. */
  async function probeShop(name, opts) {
    opts = opts || {}
    const OV = self.OV
    const T = opts.tick || 1
    const sleep = (ms) => new Promise(r => setTimeout(r, ms * T))
    const r = OV[name]
    if (!r.kind(location.href)) return { url: location.href, kind: null, orders: [] }
    // The page the tab had before it was sent elsewhere was marked on the way out; a new page never carries the mark.
    if (opts.old && document.body && document.body.hasAttribute('data-ov-old')) return { stale: true, url: location.href, marked: true }
    // A tab that was just told to open another address can still be showing the previous page for a moment. The page
    // names its own period ("23 orders placed in 2025"); if that is not the one asked for, it is the old page: not read.
    const periodOf = () => {
      const ls = OV.textLines(document.body)
      for (let i = 0; i < ls.length; i++) {
        const m = ls[i].match(/^\d[\d,]*\s+orders?\s+placed\s+in\b\s*(.*)$/i)
        if (!m) continue
        const label = (m[1] || ls[i + 1] || '').trim().toLowerCase()
        const y = label.match(/\b((?:19|20)\d\d)\b/)
        return y ? y[1] : (/past 3 months/.test(label) ? 'recent' : (/last 30 days/.test(label) ? 'last30' : null))
      }
      return null
    }
    if (opts.expect) {
      const shown = periodOf()
      if (shown && shown !== opts.expect) return { stale: true, url: location.href, shown }
    }
    const bar = (text) => {
      let b = document.getElementById('ov-crawl-banner')
      if (!text) { if (b) b.remove(); return }
      if (!b && document.body) {
        b = document.createElement('div')
        b.id = 'ov-crawl-banner'
        b.style.cssText = 'position:fixed;z-index:2147483647;left:50%;bottom:16px;transform:translateX(-50%);background:#1b1640;color:#fff;font:13px system-ui,sans-serif;padding:10px 14px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.5)'
        document.body.append(b)
      }
      if (b) b.textContent = text
    }
    // Lists that load more as you scroll, and then behind a "Show More Orders" button. Scroll to the bottom and press
    // that one button (matched by its exact text) until nothing new appears. Nothing else on the page is clicked.
    if (opts.expand) {
      const idRe = new RegExp(opts.idSrc, 'g')
      const count = () => new Set(document.body.innerHTML.match(idRe) || []).size
      const MORE = /^\s*show\s+more(?:\s+orders)?\s*$/i
      // The innermost element whose whole text is the button label, or the button/link around it. Clicking it bubbles
      // up to whatever handler the page attached.
      const findMore = () => {
        const hits = []
        for (const e of document.querySelectorAll('button, a, [role="button"], div, span')) {
          if (e.hasAttribute('hidden') || e.getAttribute('aria-hidden') === 'true' || e.getAttribute('aria-disabled') === 'true' || e.disabled) continue
          if (MORE.test(e.textContent || '')) hits.push(e)
        }
        const inner = hits.filter(e => !hits.some(o => o !== e && e.contains(o)))
        return inner.length ? (inner[0].closest('button, a, [role="button"]') || inner[0]) : null
      }
      const started = Date.now()
      let last = -1, idle = 0, clicks = 0
      while (Date.now() - started < (opts.maxMs || 300000)) {
        window.scrollTo(0, document.documentElement.scrollHeight)
        window.dispatchEvent(new Event('scroll'))
        const more = findMore()
        if (more) { more.click(); clicks++ }
        // Give the list time to grow; a pressed button can take longer than a plain scroll.
        const patience = more ? 7000 : 2500
        let grew = false
        for (let waited = 0; waited < patience; waited += 400) {
          await sleep(400)
          if (count() > last) { grew = true; break }
        }
        const n = count()
        bar('OrderVault: loading your orders… ' + n + ' so far' + (clicks ? ' (pressed "Show More Orders" ' + clicks + '×)' : ''))
        if (n > last) { last = n; idle = 0 } else if (grew) idle = 0
        else idle++
        // Finished: no button left and nothing new for a few rounds. With a button still showing, keep trying longer.
        if (idle >= (more ? 5 : 3)) break
      }
      window.scrollTo(0, 0)
      bar('')
    }
    let res, prev = '', stable = 0
    // Checked twice a second, for up to 30 s. emptyAfter counts those checks.
    for (let i = 0; i < 60 && stable < 1; i++) {
      try { res = r.parse(document, location.href, Date.now()) } catch (e) { res = { orders: [], error: String((e && e.message) || e) } }
      const k = JSON.stringify(res.orders.map(o => [o.id, o.status]))
      stable = res.orders.length && k === prev ? stable + 1 : 0
      prev = k
      if (stable < 1) {
        // A page that has shown nothing for a few seconds is an empty one (a year with no orders), not a slow one.
        if (!res.orders.length && i >= (opts.emptyAfter || 58)) break
        await sleep(500)
      }
    }
    let orders = (res && res.orders) || []
    // Amazon states how many orders a section holds ("47 orders placed in 2025"), which gives the number of pages.
    // Read line by line: the year dropdown ("2023") sits right before this sentence, and run together they look like one number.
    const lines = OV.textLines(document.body)
    let total
    for (const l of lines) {
      const tm = l.match(/^(\d[\d,]*)\s+orders?\s+placed\s+in\b/i)
      if (tm) { total = Number(tm[1].replace(/,/g, '')); break }
    }
    // A page that says outright that there is nothing is an empty one, not a slow one.
    const empty = lines.some(l => /^you have not placed any orders|^0\s+orders?\s+placed\b|did not place an order/i.test(l))
    // A page that says it holds no orders holds none: anything else on it that looks like an order (a "buy again" or
    // recommendation strip, say) is not one of yours for this period.
    if (empty || total === 0) { orders = []; total = 0 }
    // Links on the page that look like an order or a booking but carry no order number this reader knows (a Minutes order, a
    // flight booking, a travel ticket). Only the shape of the address is kept (long ids and numbers replaced), with a count.
    let unmatched
    if (opts.idSrc) {
      const idRe = new RegExp(opts.idSrc)
      const shapes = {}
      for (const a of document.querySelectorAll('a[href]')) {
        let u
        try { u = new URL(a.href) } catch (e) { continue }
        if (!/(?:^|\.)flipkart\.com$/.test(u.hostname)) continue
        const h = u.pathname + u.search
        if (idRe.test(h) || !/order|booking|trip|flight|ticket|minutes|travel/i.test(h)) continue
        const keys = [...u.searchParams.keys()].sort().join('&')
        const shape = u.pathname.replace(/[A-Za-z0-9_-]{8,}/g, '<id>').replace(/\d+/g, '#')
        // A details link names one order: an id in the path, or a query field called ...id. List and menu links do not.
        if (!shape.includes('<id>') && !/(?:^|&)[a-z_]*id(?:&|$)/i.test(keys)) continue
        const key = shape + (keys ? '?' + keys : '')
        shapes[key] = (shapes[key] || 0) + 1
      }
      unmatched = Object.entries(shapes).sort((a, b) => b[1] - a[1]).slice(0, 10)
    }
    // The time filters the page offers ("2026", "2025", ...), read from the dropdown.
    let years
    if (opts.years) {
      const found = (document.documentElement.innerHTML.match(/year-(\d{4})/g) || []).map(s => s.slice(5))
        .concat(Array.from(document.querySelectorAll('select option')).map(o => (o.textContent || '').trim()).filter(t => /^(?:19|20)\d\d$/.test(t)))
      years = [...new Set(found)]
    }
    return { url: location.href, kind: r.kind(location.href), orders, years, total, empty, unmatched, key: prev, error: res && res.error, outline: orders.length ? undefined : OV.outline(document, 400) }
  }

  // expand: the list grows as you scroll and behind a "Show More Orders" button, so it is scrolled to the end first.
  const SHOPS = {
    Flipkart: { url: 'https://www.flipkart.com/account/orders?link=home_orders', files: ['lib/common.js', 'lib/flipkart.js'], expand: true, idSrc: '\\bOD\\d{15,20}\\b' }
  }

  // ---- Background side

  /**
   * The saved crawl state, shared by the crawls. Every change goes through one lock, because several tabs report at once.
   * `store` keeps one shop's crawl from reading or changing another's.
   */
  function state(api, store) {
    let chain = Promise.resolve()
    const locked = (fn) => { const r = chain.then(fn); chain = r.then(() => {}, () => {}); return r }
    const get = async () => { const c = (await api.storage.local.get('crawl')).crawl; return c && c.store === store ? c : null }
    const put = (c) => api.storage.local.set({ crawl: c })
    /** Changes the running crawl; fn gets the current state and returns the fields to change. Null when it is not running. */
    const update = (fn) => locked(async () => {
      const c = await get()
      if (!c || !c.running) return null
      const n = { ...c, ...fn(c), updatedAt: Date.now() }
      await put(n)
      return n
    })
    // A short trail of what the crawl did, shown in the popup, so a silent stop can be diagnosed without any console.
    const trace = (text) => update(c => ({ trace: [...(c.trace || []).slice(-14), `${new Date().toTimeString().slice(0, 8)} ${text}`] })).catch(() => {})
    const say = async (tabId, text) => { try { await api.scripting.executeScript({ target: { tabId }, func: banner, args: [text] }) } catch (e) { /* tab gone */ } }
    // Pictures, video and fonts are most of a page's load time and the reader only needs text, so tabs the crawl opened
    // itself load without them. The rule is for that one tab only (never one you are browsing in), is removed when the tab
    // is closed or the crawl ends, and if it cannot be set the pages simply load in full.
    const blockAssets = async (tabId) => {
      try {
        if (!api.declarativeNetRequest) return
        await api.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [tabId],
          addRules: [{ id: tabId, priority: 1, action: { type: 'block' }, condition: { tabIds: [tabId], resourceTypes: ['image', 'media', 'font'] } }]
        })
      } catch (e) { /* pages load in full */ }
    }
    const allowAssets = async (ids) => {
      try { if (api.declarativeNetRequest && ids && ids.length) await api.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids }) } catch (e) { /* nothing to remove */ }
    }
    const closeTab = async (id) => {
      try { await api.tabs.remove(id) } catch (e) { /* already closed */ }
      await allowAssets([id])
    }
    // While a read lasts, a short alarm wakes the background process if Chrome has put it to sleep.
    const keepAlive = (on) => { try { if (!api.alarms) return; if (on) api.alarms.create('ov-crawl', { periodInMinutes: 0.5 }); else api.alarms.clear('ov-crawl') } catch (e) { /* no alarms */ } }
    return { locked, get, put, update, trace, say, closeTab, blockAssets, allowAssets, keepAlive }
  }

  /** Tells the caller (the background script) that a read ended, so it can show a notice and keep the history. */
  function report(deps, store, message, count, startedAt) {
    try {
      if (!deps.done) return
      const m = String(message || '')
      const ms = startedAt ? Math.max(0, Date.now() - startedAt) : undefined
      deps.done({ store, count, ms, message: m, ok: /^Done/.test(m) && !/Pages not read|Not fully read|Fewer than expected/.test(m) })
    } catch (e) { /* a notice must never break a read */ }
  }

  /**
   * How many tabs work at once and how long each waits between pages, by the speed chosen in the popup. More tabs is
   * faster but looks more like a burst of traffic to the shop, so the default is the middle one.
   */
  OV.SPEEDS = {
    careful: { limit: 2, pace: [2500, 4000] },
    normal: { limit: 4, pace: [1000, 2000] },
    fast: { limit: 6, pace: [400, 900] }
  }
  const limitOf = (deps, c) => deps.workers || (c && c.cfg && c.cfg.limit) || 3
  const paceOf = (c) => (c && c.cfg && c.cfg.pace) || [1500, 3000]

  /** deps: api (the chrome object), ingest(msg) saves orders, pause(ms) waits, workers = extra tabs (default 3). */
  OV.crawl = function (deps) {
    const api = deps.api
    const pause = deps.pause || ((ms) => new Promise(r => setTimeout(r, ms)))
    const SETTLE = deps.settleMs == null ? 10000 : deps.settleMs   // how long a tab may still show its old page before that counts as a redirect

    const { locked, get, put, update, trace, say, closeTab, blockAssets, keepAlive } = state(api, 'Myntra')
    const busy = new Set()
    let live = false
    const STALE_MS = deps.staleCrawlMs || 15 * 60 * 1000   // a crawl untouched for this long is abandoned, not resumed
    // The page-loaded event can be missed, so each navigation is also followed up later. Reading the same address
    // twice is prevented by `last`.
    const kick = (tabId) => {
      const later = deps.later || setTimeout
      const t = deps.kickAfter == null ? 7000 : deps.kickAfter
      later(() => step(tabId).catch(() => {}), t)
      later(() => step(tabId).catch(() => {}), t * 2.4)
    }
    const markNav = (tabId) => update(c => ({ nav: { ...(c.nav || {}), [tabId]: Date.now() } }))

    // Closes every tab the crawl opened. keepTab stays open and comes to the front: the one that needs you (a sign-in page).
    const finish = (message, keepTab) => locked(async () => {
      const c = await get()
      if (!c || !c.running) return
      const ids = Object.keys(c.workers || {}).map(Number)
      if (c.own && !ids.includes(c.tabId)) ids.push(c.tabId)
      await put({ ...c, running: false, message, workers: {}, todo: [], updatedAt: Date.now() })
      live = false
      keepAlive(false)
      for (const id of ids) if (id !== keepTab) await closeTab(id)
      if (keepTab != null) { try { await api.tabs.update(keepTab, { active: true }) } catch (e) { /* gone */ } } else await say(c.tabId, '')
      report(deps, 'Myntra', message, c.orders || 0, c.startedAt)
    })

    function summary(c) {
      const have = new Set(c.done || [])
      const pages = c.pages || have.size
      const missing = []
      for (let p = 1; p <= pages; p++) if (!have.has(p)) missing.push(p)
      let m = `Done: ${have.size}${c.pages ? ' of ' + pages : ''} page${have.size === 1 ? '' : 's'}, ${c.orders || 0} orders${c.total ? ` (Myntra lists ${c.total})` : ''}.`
      if (missing.length) m += ` Pages not read: ${missing.slice(0, 15).join(', ')}${missing.length > 15 ? ', …' : ''}.`
      if (c.short && c.short.length) m += ` Fewer than expected on: ${c.short.slice(0, 12).join(', ')}${c.short.length > 12 ? ', …' : ''}.`
      return m
    }
    async function maybeFinish() {
      const c = await get()
      if (!c || !c.running) return
      if ((c.done || []).includes(1) && !(c.todo || []).length && !Object.keys(c.workers || {}).length) await finish(summary(c))
    }

    /** Takes the next page from the shared list into a new background tab. */
    const openWorker = () => locked(async () => {
      const c = await get()
      if (!c || !c.running || !(c.todo || []).length) return null
      const todo = [...c.todo]
      const page = todo.shift()
      const t = await api.tabs.create({ url: pageUrl(page), active: false })
      await blockAssets(t.id)
      await put({ ...c, todo, workers: { ...(c.workers || {}), [t.id]: page }, nav: { ...(c.nav || {}), [t.id]: Date.now() }, updatedAt: Date.now() })
      kick(t.id)
      return t.id
    })
    /** A worker tab is free: gives it the next page, or closes it when none are left. */
    const nextFor = (tabId) => locked(async () => {
      const c = await get()
      if (!c || !c.running) { await closeTab(tabId); return { stop: true } }
      const workers = { ...(c.workers || {}) }
      const todo = [...(c.todo || [])]
      if (!todo.length) { delete workers[tabId]; await put({ ...c, workers, updatedAt: Date.now() }); await closeTab(tabId); return { closed: true } }
      const page = todo.shift()
      workers[tabId] = page
      await put({ ...c, workers, todo, nav: { ...(c.nav || {}), [tabId]: Date.now() }, updatedAt: Date.now() })
      return { page }
    })
    async function advance(tabId) {
      const n = await nextFor(tabId)
      if (n.page) {
        const [lo, hi] = paceOf(await get())
        await pause(lo + Math.random() * (hi - lo))   // a gentle pace
        const c = await get()
        if (!c || !c.running) { await closeTab(tabId); return }
        await api.tabs.update(tabId, { url: pageUrl(n.page) })
        kick(tabId)
      } else if (n.closed) await maybeFinish()
    }

    async function step(tabId) {
      if (busy.has(tabId)) return
      busy.add(tabId)
      try {
        let c = await get()
        if (!c || !c.running) return
        const main = tabId === c.tabId
        const want = main ? 1 : (c.workers || {})[tabId]
        if (!want) return
        let tab
        try { tab = await api.tabs.get(tabId) } catch (e) { return }
        const url = (tab && tab.url) || ''
        let host = '', shown = 1
        try { const u = new URL(url); host = u.hostname; shown = Number(u.searchParams.get('p')) || 1 } catch (e) { /* blank or internal page */ }
        if (!/(?:^|\.)myntra\.com$/.test(host)) { await trace(`tab ${tabId}: not on myntra.com yet`); return }
        if ((c.last || {})[tabId] === url) return   // already read
        if (OV.myntra.kind(url) !== 'list') {
          // The tab may still be showing the page it had before; only a page that stays away from the list is a redirect.
          if (Date.now() - ((c.nav || {})[tabId] || 0) < SETTLE) return
          return finish(`Stopped: Myntra opened ${new URL(url).pathname} instead of your orders list. Sign in to Myntra in the tab that is now open, then press the Myntra button again.`, tabId)
        }
        if (shown !== want) return   // still showing the previous page

        await trace(`tab ${tabId}: reading page ${want}`)
        await api.scripting.executeScript({ target: { tabId }, files: ['lib/common.js', 'lib/myntra.js'] })
        const out = await api.scripting.executeScript({ target: { tabId }, func: probe })
        const r = out && out[0] && out[0].result
        if (!r) throw new Error('the page could not be read')
        c = await get()
        if (!c || !c.running) { if (!main) await closeTab(tabId); return }
        const pg = r.pager
        const orders = r.orders || []
        const key = hash(r.key || '')
        const known = c.pages   // known once page 1 has been read

        const repeat = orders.length && Object.entries(c.keys || {}).some(([p, k]) => k === key && Number(p) !== want)
        if (!orders.length || repeat) {
          if (main) {
            await deps.ingest({ type: 'ov:orders', store: 'Myntra', kind: 'list', url: r.url, count: 0, orders: [], outline: r.outline })
            return finish('No orders were recognised on page 1. Open "A page was not recognised" below.')
          }
          if (known && want <= known) {
            // The list should have this page. Try it once more later; if it fails again, say which page.
            const why = repeat ? 'repeat' : 'empty'
            await update(c0 => (c0.tries || {})[want]
              ? { short: [...(c0.short || []), `p${want}: ${why}`].slice(-40) }
              : { tries: { ...(c0.tries || {}), [want]: 1 }, todo: [...(c0.todo || []), want] })
          }   // otherwise this is just past the end of a list whose length was not known
          await advance(tabId)
          return
        }

        await deps.ingest({ type: 'ov:orders', store: 'Myntra', kind: 'list', url: r.url, count: orders.length, orders })
        const pages = main ? (pg.total && pg.pageSize ? Math.min(MAX_PAGES, Math.ceil(pg.total / pg.pageSize)) : undefined) : known
        const n = await update(c0 => {
          const done = [...new Set([...(c0.done || []), want])]
          const short = (c0.short || []).slice(-40)
          if (pg.pageSize && orders.length < pg.pageSize && want !== pages) short.push(`p${want}: ${orders.length}/${pg.pageSize}`)
          const patch = {
            done, short, orders: (c0.orders || 0) + orders.length, total: pg.total || c0.total,
            keys: { ...(c0.keys || {}), [want]: key }, last: { ...(c0.last || {}), [tabId]: r.url },
            message: `Read ${done.length}${pages || c0.pages ? ' of ' + (pages || c0.pages) : ''} pages`
          }
          if (main) {
            patch.pages = pages
            // With the length known, every other page is shared out now. Otherwise pages are tried one after another.
            patch.todo = pages ? Array.from({ length: pages - 1 }, (_, i) => i + 2) : [2]
          } else if (!c0.pages && !pg.done && want < MAX_PAGES) {
            patch.todo = [...(c0.todo || []), want + 1]
          }
          return patch
        })
        if (!n) { if (!main) await closeTab(tabId); return }
        await say(n.tabId, `OrderVault: read ${n.done.length}${n.pages ? ' of ' + n.pages : ''} pages · ${n.orders} orders${n.pages && n.done.length < n.pages ? '. Other pages are opening in tabs that close by themselves.' : ''}`)

        if (main) {
          const extra = Math.min(limitOf(deps, n), (n.todo || []).length)
          for (let i = 0; i < extra; i++) { await openWorker(); if (i < extra - 1) await pause(600) }
          await maybeFinish()
        } else {
          await advance(tabId)
        }
      } catch (e) {
        try { await finish('Stopped: ' + String((e && e.message) || e)) } catch (e2) { /* ignore */ }
      } finally { busy.delete(tabId) }
    }

    return {
      /** Starts from page 1 in the given tab (or a new tab). */
      async start(tabId, speed) {
        const now = Date.now()
        const cfg = OV.SPEEDS[speed] || OV.SPEEDS.normal
        live = true
        keepAlive(true)
        const c = { cfg, speed: speed || 'normal', running: true, store: 'Myntra', startedAt: now, updatedAt: now, orders: 0, message: 'Opening page 1', trace: [], done: [], todo: [], workers: {}, keys: {}, last: {}, short: [], tries: {}, nav: {} }
        if (tabId == null) {
          const t = await api.tabs.create({ url: FIRST, active: false })
          await blockAssets(t.id)
          await put({ ...c, tabId: t.id, own: true, nav: { [t.id]: now } })
          await trace('started in a new tab')
          kick(t.id)
        } else {
          await put({ ...c, tabId, nav: { [tabId]: now } })
          await trace('started in tab ' + tabId)
          await api.tabs.update(tabId, { url: FIRST })
          kick(tabId)
        }
      },
      async stop() {
        await locked(async () => {
          const c = await get()
          if (!c || !c.running) return
          const ids = Object.keys(c.workers || {}).map(Number)
          if (c.own && !ids.includes(c.tabId)) ids.push(c.tabId)
          await put({ ...c, running: false, workers: {}, todo: [], message: `Stopped. ${c.orders || 0} orders read so far are saved.`, updatedAt: Date.now() })
          live = false
          keepAlive(false)
          for (const id of ids) await closeTab(id)
          await say(c.tabId, '')
        })
      },
      /**
       * Picks up a crawl whose loops are gone (the background process restarted): the worker tabs are closed and their pages go
       * back on the list. Does nothing while the crawl is actually running here.
       */
      async resume() {
        if (live) return false
        const c = await get()
        if (!c || !c.running) return false
        if (Date.now() - (c.updatedAt || 0) > STALE_MS) {
          await finish(`Stopped: the extension was restarted part-way and this read was left too long to carry on. ${c.orders || 0} orders read so far are saved. Press the Myntra button to read again.`)
          return false
        }
        live = true
        keepAlive(true)
        const back = []
        for (const [id, page] of Object.entries(c.workers || {})) { await closeTab(Number(id)); if (page && !(c.done || []).includes(page)) back.push(page) }
        const todo = [...new Set([...back, ...(c.todo || [])])].filter(p => !(c.done || []).includes(p)).sort((a, b) => a - b)
        await put({ ...c, workers: {}, todo, updatedAt: Date.now(), message: 'Carrying on after the extension restarted' })
        await trace('carried on after a restart: ' + todo.length + ' page(s) left')
        if (!(c.done || []).includes(1)) {
          // Page 1 was not read yet: start again in the tab that was open for it.
          try { await api.tabs.update(c.tabId, { url: FIRST }); kick(c.tabId) } catch (e) { await finish('Stopped: the first page could not be reopened.') }
          return true
        }
        const n = Math.min(limitOf(deps, c), todo.length)
        for (let i = 0; i < n; i++) await openWorker()
        await maybeFinish()
        return true
      },
      /** Called when any tab finishes loading; only the crawl's own tabs matter. */
      onLoaded(tabId) { return step(tabId) },
      listen() {
        api.tabs.onUpdated.addListener((id, info) => { if (info && info.status === 'complete') step(id).catch(() => {}) })
        // Closing a crawl tab by hand: the main tab ends the crawl; a worker's page goes back on the list.
        if (api.tabs.onRemoved) api.tabs.onRemoved.addListener(async (id) => {
          const c = await get()
          if (!c || !c.running) return
          if (id === c.tabId) return finish(`Stopped: the Myntra tab was closed. ${c.orders || 0} orders read so far are saved.`)
          const page = (c.workers || {})[id]
          if (!page) return
          await update(c0 => { const w = { ...c0.workers }; delete w[id]; return { workers: w, todo: [...(c0.todo || []), page] } })
          await openWorker()
        })
      }
    }
  }
  /**
   * One-page shops (Amazon, Flipkart): opens the orders page in a background tab, reads it, saves it and closes
   * the tab. A tab is only left open, and brought to the front, when it needs you (a sign-in page).
   */
  OV.readShop = function (deps) {
    const api = deps.api
    const pause = deps.pause || ((ms) => new Promise(r => setTimeout(r, ms)))
    const close = async (id) => { try { await api.tabs.remove(id) } catch (e) { /* already closed */ } }
    return async function read(store) {
      const t0 = Date.now()
      const res = await readOne(store)
      return { ...res, ms: Date.now() - t0 }
    }
    async function readOne(store) {
      const shop = SHOPS[store]
      if (!shop) return { ok: false, message: 'Unknown shop.' }
      let tab
      // A list that has to be scrolled is opened in the foreground: Chrome slows or pauses scrolling and timers in tabs
      // you cannot see, and the shop would then never load more orders. Pages that just load can stay in the background.
      try { tab = await api.tabs.create({ url: shop.url, active: !!shop.expand }) } catch (e) { return { ok: false, message: 'Could not open the page: ' + String((e && e.message) || e) } }
      try {
        // Wait for the page itself to finish loading (the list is waited for after that).
        for (let i = 0; i < 60; i++) {
          let t; try { t = await api.tabs.get(tab.id) } catch (e) { return { ok: false, message: 'The tab was closed before it could be read.' } }
          if (t && t.status === 'complete') break
          await pause(500)
        }
        await api.scripting.executeScript({ target: { tabId: tab.id }, files: shop.files })
        const out = await api.scripting.executeScript({ target: { tabId: tab.id }, func: probeShop, args: [store.toLowerCase(), { expand: !!shop.expand, idSrc: shop.idSrc, tick: deps.tick, maxMs: deps.maxMs }] })
        const r = out && out[0] && out[0].result
        if (!r) throw new Error('the page could not be read')
        if (!r.kind) {
          try { await api.tabs.update(tab.id, { active: true }) } catch (e) { /* gone */ }
          return { ok: false, message: store + ' did not show your orders (it may want you to sign in). The tab is open: sign in there, then press the ' + store + ' button again.' }
        }
        await deps.ingest({ type: 'ov:orders', store, kind: r.kind, url: r.url, count: r.orders.length, orders: r.orders, outline: r.outline, error: r.error, unmatched: r.unmatched })
        await close(tab.id)
        if (!r.orders.length) return { ok: false, message: store + ': the page was read but no orders were recognised. See "A page was not recognised" below.' }
        const skipped = (r.unmatched || []).reduce((n, s) => n + s[1], 0)
        return {
          ok: true, count: r.orders.length,
          message: 'Read ' + r.orders.length + ' order' + (r.orders.length === 1 ? '' : 's') + ' from ' + store + '.' +
            (skipped ? ` ${skipped} other order-like link${skipped === 1 ? '' : 's'} on the page (Minutes orders or bookings, perhaps) were not recognised: see "Links not recognised" below.` : '')
        }
      } catch (e) {
        await close(tab.id)
        return { ok: false, message: store + ': ' + String((e && e.message) || e) }
      }
    }
  }
  // ------------------------------------------------------------ Amazon
  //
  // Amazon splits the list by time filter: "past 3 months" (no filter in the address), then one filter per year
  // (timeFilter=year-2025), and each has its own pages (&page=2). One filter is read start to finish in one tab,
  // page after page, and up to three tabs each take a filter, so the years are read side by side.

  const AMZ = 'https://www.amazon.in/your-orders/orders'
  const amazonUrl = (sec, page) => {
    const q = []
    if (sec !== 'recent') q.push('timeFilter=' + sec)
    if (page > 1) q.push('page=' + page)
    return AMZ + (q.length ? '?' + q.join('&') : '')
  }
  const secLabel = (sec) => (sec === 'recent' ? 'past 3 months' : sec.replace('year-', ''))
  const isListPath = (p) => /^\/your-orders\//.test(p) || /order-history/.test(p) || /\/gp\/your-account\/your-orders/.test(p)

  /** deps: api (the chrome object), ingest(msg) saves orders, pause(ms) waits, workers = tabs at once (default 3). */
  OV.crawlAmazon = function (deps) {
    const api = deps.api
    const pause = deps.pause || ((ms) => new Promise(r => setTimeout(r, ms)))
    const { locked, get, put, update, trace, closeTab, blockAssets, keepAlive } = state(api, 'Amazon')
    const pace = async () => { const [lo, hi] = paceOf(await get()); await pause(lo + Math.random() * (hi - lo)) }   // a gentle pace between pages
    // The crawl's loops live in memory. If the background process restarts (the extension is reloaded, or Chrome stops it
    // for being idle) they are gone while the saved state still says "running"; `live` tells the two apart.
    let live = false
    const STALE_MS = deps.staleCrawlMs || 15 * 60 * 1000   // a crawl untouched for this long is abandoned, not resumed

    /** Ends the crawl and closes every tab it opened; keepTab stays open and comes to the front (a sign-in page). */
    const finish = (message, keepTab) => locked(async () => {
      const c = await get()
      if (!c || !c.running) return
      const ids = Object.keys(c.workers || {}).map(Number)
      await put({ ...c, running: false, message, workers: {}, todo: [], updatedAt: Date.now() })
      live = false
      keepAlive(false)
      for (const id of ids) if (id !== keepTab) await closeTab(id)
      if (keepTab != null) { try { await api.tabs.update(keepTab, { active: true }) } catch (e) { /* gone */ } }
      report(deps, 'Amazon', message, (c.ids || []).length, c.startedAt)
    })

    function summary(c) {
      const secs = Object.keys(c.counts || {}).filter(s => c.counts[s] > 0)
      const n = (c.ids || []).length
      // "past 3 months" is this year. The sentence names the span of years; the count for each period is kept in the crawl data.
      const years = secs.map(s => (s === 'recent' ? new Date().getFullYear() : Number(s.replace('year-', '')))).filter(Number.isFinite)
      const first = years.length ? Math.min(...years) : null
      const last = years.length ? Math.max(...years) : null
      let m = `Done: ${n} order${n === 1 ? '' : 's'} read${first ? (first === last ? ', all from ' + first : ', from ' + first + ' to ' + last) : ''}.`
      if (c.short && c.short.length) m += ` Not fully read: ${c.short.slice(0, 8).join('; ')}${c.short.length > 8 ? '; …' : ''}.`
      return m
    }
    async function maybeFinish() {
      const c = await get()
      if (!c || !c.running) return
      if (!Object.keys(c.workers || {}).length && !(c.todo || []).length) {
        if (!(c.ids || []).length && c.outline !== undefined) {
          // Nothing at all was recognised: keep the page outline so the reader can be fixed.
          await deps.ingest({ type: 'ov:orders', store: 'Amazon', kind: 'list', url: c.outlineUrl || AMZ, count: 0, orders: [], outline: c.outline })
          return finish('No orders were recognised. Open "A page was not recognised" below.')
        }
        let msg = summary(c)
        // Only a complete read may clear leftovers: if any page failed, an order could be missing for that reason alone.
        const complete = !(c.short && c.short.length) && (c.ids || []).length > 0
        if (complete && deps.prune) {
          try {
            const gone = await deps.prune('Amazon', c.ids || [])   // ids already read "Amazon:<number>"
            if (gone) msg += ` Removed ${gone} saved entr${gone === 1 ? 'y' : 'ies'} that this read did not find (left over from earlier wrong readings).`
          } catch (e) { /* leftovers stay; harmless */ }
        }
        await finish(msg)
      }
    }

    /** Next filter for a tab that has finished one, or null (and the tab leaves the list of workers). */
    const take = (tabId) => locked(async () => {
      const c = await get()
      if (!c || !c.running) return null
      const todo = [...(c.todo || [])]
      const task = todo.shift()
      const workers = { ...(c.workers || {}) }
      if (task) workers[tabId] = task; else delete workers[tabId]
      await put({ ...c, todo, workers, updatedAt: Date.now() })
      return task || null
    })
    /** A tab that was closed by hand: its filter goes back on the list for another tab. */
    const requeue = async (tabId, task) => {
      await update(c => { const w = { ...(c.workers || {}) }; delete w[tabId]; return { workers: w, todo: [task, ...(c.todo || [])] } })
      await openWorkers()
    }
    const note = (text) => update(c => ({ short: [...(c.short || []), text].slice(-30) }))
    const alive = async (tabId) => { try { await api.tabs.get(tabId); return true } catch (e) { return false } }
    /** Marks the page a tab is about to leave, so that if it is still on screen after the new address is set, it is not read as the new one. */
    const markOld = async (tabId) => { try { await api.scripting.executeScript({ target: { tabId }, func: () => { try { document.body.setAttribute('data-ov-old', '1') } catch (e) { /* no body yet */ } } }) } catch (e) { /* tab gone or not scriptable */ } }

    /** Waits until the tab shows the wanted address, fully loaded. Returns ok | redirect | timeout | closed. */
    async function waitReady(tabId, sec, page) {
      const t0 = Date.now()
      while (Date.now() - t0 < (deps.loadMs || 60000)) {
        let t
        try { t = await api.tabs.get(tabId) } catch (e) { return 'closed' }
        let u = null
        try { u = new URL((t && t.url) || '') } catch (e) { u = null }
        if (t && t.status === 'complete' && u && /(?:^|\.)amazon\.in$/.test(u.hostname)) {
          // Something other than the list (sign-in, a robot check). The page this tab showed before is a list page, so it is not mistaken for this.
          if (!isListPath(u.pathname)) return 'redirect'
          const tf = u.searchParams.get('timeFilter') || ''
          const pg = Number(u.searchParams.get('page')) || 1
          if ((sec === 'recent' ? !/^year-/.test(tf) : tf === sec) && pg === page) return 'ok'
        }
        await pause(400)
      }
      return 'timeout'
    }

    /** Reads one filter's pages, in order, until they run out. Returns done | closed | stopped. */
    async function runSection(tabId, task, fresh) {
      const sec = task.sec
      let page = task.page
      let navigated = !!fresh   // a new tab was just opened at this address
      let retried = false
      const expect = sec === 'recent' ? 'recent' : sec.slice(5)   // the period the page itself should name
      for (;;) {
        const c = await get()
        if (!c || !c.running) return 'stopped'
        if (!navigated) {
          await pace()
          await markOld(tabId)
          try { await api.tabs.update(tabId, { url: amazonUrl(sec, page) }) } catch (e) { await requeue(tabId, { sec, page }); return 'closed' }
        }
        navigated = false
        const ready = await waitReady(tabId, sec, page)
        if (ready === 'closed') { await requeue(tabId, { sec, page }); return 'closed' }
        if (ready === 'redirect') {
          await finish('Stopped: Amazon opened a page other than your orders list (usually the sign-in page). Sign in, or finish any check it shows, in the tab that is now open, then press the Amazon button again.', tabId)
          return 'stopped'
        }
        if (ready === 'timeout') { await note(`${secLabel(sec)} page ${page}: did not load`); return 'done' }

        let r
        let errors = 0
        const tProbe = Date.now()
        for (;;) {
          try {
            await api.scripting.executeScript({ target: { tabId }, files: ['lib/common.js', 'lib/amazon.js'] })
            // After a while the check is dropped: by then whatever is showing is surely the page that was asked for.
            const out = await api.scripting.executeScript({ target: { tabId }, func: probeShop, args: ['amazon', { years: sec === 'recent' && page === 1, emptyAfter: 6, tick: deps.tick, expect: Date.now() - tProbe > (deps.staleMs || 20000) ? null : expect, old: Date.now() - tProbe <= (deps.staleMs || 20000) }] })
            r = out && out[0] && out[0].result
          } catch (e) {
            if (!(await alive(tabId))) { await requeue(tabId, { sec, page }); return 'closed' }
            // The page can navigate away while it is being read; look again a few times before giving up on it.
            if (++errors >= 4) { await note(`${secLabel(sec)} page ${page}: ${String((e && e.message) || e).slice(0, 60)}`); return 'done' }
            r = { stale: true }
          }
          if (!(r && r.stale)) break
          await new Promise(res => setTimeout(res, 150))
        }
        if (!r || !r.kind) {
          await finish('Stopped: Amazon opened a page other than your orders list. Sign in in the tab that is now open, then press the Amazon button again.', tabId)
          return 'stopped'
        }
        let orders = r.orders || []
        // A year page lists only orders placed in that year. One placed in another year came from something else on the
        // page (or from the page that was showing before), and does not belong to this period.
        if (/^year-\d{4}$/.test(sec)) {
          const y = Number(sec.slice(5))
          const before = orders.length
          orders = orders.filter(o => !o.placedAt || new Date(o.placedAt).getFullYear() === y)
          if (orders.length < before) await note(`${secLabel(sec)} page ${page}: ${before - orders.length} order(s) from other years ignored`)
        }
        if (!orders.length) {
          if (sec === 'recent' && page === 1 && !r.empty) await update(c0 => (c0.outline === undefined ? { outline: r.outline || '', outlineUrl: r.url } : {}))
          // A blank page might just be slow: look once more, unless the page says outright that there is nothing.
          if (!retried && !r.empty) {
            retried = true
            await pause(4000)
            await markOld(tabId)
            try { await (api.tabs.reload ? api.tabs.reload(tabId) : api.tabs.update(tabId, { url: amazonUrl(sec, page) })) } catch (e) { await requeue(tabId, { sec, page }); return 'closed' }
            navigated = true
            continue
          }
          if (sec === 'recent' && page === 1) await discover(r)   // the filters are known even if the last 3 months are empty
          return 'done'
        }
        retried = false
        const key = hash(r.key || '')
        if (((c.keys || {})[sec] || []).includes(key)) return 'done'   // the same page again: past the last one

        await deps.ingest({ type: 'ov:orders', store: 'Amazon', kind: 'list', url: r.url, count: orders.length, orders })
        const n = await update(c0 => {
          const ids = new Set(c0.ids || [])
          orders.forEach(o => ids.add(o.id))
          return {
            // where this period is up to, so a restarted crawl carries on from the next page and not from the start
            progress: { ...(c0.progress || {}), [sec]: page + 1 },
            ids: [...ids], orders: ids.size,
            counts: { ...(c0.counts || {}), [sec]: ((c0.counts || {})[sec] || 0) + orders.length },
            totals: r.total != null ? { ...(c0.totals || {}), [sec]: r.total } : (c0.totals || {}),
            keys: { ...(c0.keys || {}), [sec]: [...((c0.keys || {})[sec] || []), key] },
            message: `Reading Amazon: ${secLabel(sec)}, page ${page} · ${ids.size} orders so far`
          }
        })
        if (!n) return 'stopped'
        if (sec === 'recent' && page === 1) await discover(r)
        // The page says how many orders the filter holds; once they are all read there is no need to ask for an empty page.
        const total = (n.totals || {})[sec]
        if (total && n.counts[sec] >= total) return 'done'
        page++
      }
    }

    /** From the first page: which years exist. Each becomes a filter to read, and more tabs open for them. */
    async function discover(r) {
      let years = (r.years || []).map(y => 'year-' + y)
      if (!years.length) { const y = new Date().getFullYear(); years = Array.from({ length: y - 2011 }, (_, i) => 'year-' + (y - i)) }
      years = [...new Set(years)].sort().reverse()
      const n = await update(c => (c.discovered ? {} : { discovered: true, todo: [...(c.todo || []), ...years.map(sec => ({ sec, page: 1 }))] }))
      if (n) await openWorkers()
    }

    /** Opens tabs for waiting filters, up to the limit. */
    async function openWorkers() {
      const started = await locked(async () => {
        const c = await get()
        if (!c || !c.running) return []
        const todo = [...(c.todo || [])]
        const workers = { ...(c.workers || {}) }
        const out = []
        while (todo.length && Object.keys(workers).length < limitOf(deps, c)) {
          const task = todo.shift()
          let t
          try { t = await api.tabs.create({ url: amazonUrl(task.sec, task.page), active: false }) } catch (e) { todo.unshift(task); break }
          await blockAssets(t.id)
          workers[t.id] = task
          out.push({ id: t.id, task })
        }
        await put({ ...c, todo, workers, updatedAt: Date.now() })
        return out
      })
      for (const s of started) work(s.id, s.task).catch(() => {})
    }

    /** One tab's life: read a filter, take the next, and close when none are left. */
    async function work(tabId, task) {
      let fresh = true
      try {
        for (;;) {
          const res = await runSection(tabId, task, fresh)
          fresh = false
          if (res !== 'done') return
          task = await take(tabId)
          if (!task) break
        }
        await closeTab(tabId)
        await maybeFinish()
      } catch (e) {
        try { await finish('Stopped: ' + String((e && e.message) || e)) } catch (e2) { /* ignore */ }
      }
    }

    return {
      async start(speed) {
        const now = Date.now()
        const cfg = OV.SPEEDS[speed] || OV.SPEEDS.normal
        await put({ cfg, speed: speed || 'normal', running: true, store: 'Amazon', startedAt: now, updatedAt: now, orders: 0, message: 'Opening your Amazon orders', trace: [], todo: [{ sec: 'recent', page: 1 }], workers: {}, ids: [], counts: {}, totals: {}, keys: {}, short: [], progress: {} })
        live = true
        keepAlive(true)
        await openWorkers()
      },
      /**
       * Picks up a crawl whose loops are gone (the background process restarted). The tabs it had open are closed, and each
       * period they were reading carries on from its next page. Does nothing while the crawl is actually running here.
       */
      async resume() {
        if (live) return false
        const c = await get()
        if (!c || !c.running) return false
        if (Date.now() - (c.updatedAt || 0) > STALE_MS) {
          await finish(`Stopped: the extension was restarted part-way and this read was left too long to carry on. ${(c.ids || []).length} orders read so far are saved. Press the Amazon button to read again.`)
          return false
        }
        live = true
        keepAlive(true)
        const back = []
        for (const [id, t] of Object.entries(c.workers || {})) {
          await closeTab(Number(id))
          if (t && t.sec && !back.some(b => b.sec === t.sec)) back.push({ sec: t.sec, page: (c.progress || {})[t.sec] || t.page || 1 })
        }
        const queued = (c.todo || []).filter(t => !back.some(b => b.sec === t.sec))
        await put({ ...c, workers: {}, todo: [...back, ...queued], updatedAt: Date.now(), message: 'Carrying on after the extension restarted' })
        await trace(`carried on after a restart: ${back.length} period(s) were in progress, ${queued.length} waiting`)
        if (back.length || queued.length) await openWorkers()
        else await maybeFinish()
        return true
      },
      async stop() {
        await locked(async () => {
          const c = await get()
          if (!c || !c.running) return
          const ids = Object.keys(c.workers || {}).map(Number)
          await put({ ...c, running: false, workers: {}, todo: [], message: `Stopped. ${(c.ids || []).length} orders read so far are saved.`, updatedAt: Date.now() })
          live = false
          keepAlive(false)
          for (const id of ids) await closeTab(id)
        })
      }
    }
  }
  OV.crawlFirstPage = FIRST
})(typeof self !== 'undefined' ? self : this)
