import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Archive, ArrowDownToLine, ArrowUpFromLine, CheckCircle2, ChevronDown, CircleHelp, Filter, Inbox, Package, Plus, RefreshCw, Search, ShieldCheck, ShoppingBag, Sparkles, Truck, Wallet, X } from 'lucide-react'
import { getOrders, getUserData, putOrders, putUser, putUsers, deleteOrder, deleteUser, clearOrders, deleteStaleOrders } from './db'
import { fetchOrderEmails, getClientId, getStoredClientId, isConfigured, isValidClientId, requestGmailToken, saveClientId } from './gmail'
import type { Logger } from './gmail'
import { PARSER_VERSION, detectStore, mergeOrder, parseEmails } from './parser'
import { parseBackup } from './backup'
import { DAY, ago, date, money, statusClass, storeStyle, ymd } from './format'
import { OVERRIDE_KEYS, applyUser } from './userdata'
import type { Order, Status, UserData } from './types'
import OrderDetail from './components/OrderDetail'
import OrderForm from './components/OrderForm'
import type { FormValues } from './components/OrderForm'
import WarrantyView from './components/WarrantyView'
import SyncLog from './components/SyncLog'
import type { LogLine } from './components/SyncLog'

type Tab = Status | 'All' | 'In progress'
const ACTIVE: Status[] = ['Ordered','Shipped','Out for delivery']
const TABS: Tab[] = ['All','In progress','Ordered','Shipped','Out for delivery','Delivered','Cancelled','Return/refund','Unknown']
const matchesTab = (o:Order, t:Tab) => t==='All' || (t==='In progress' ? ACTIVE.includes(o.status) : o.status===t)

type Period = 'all'|'30'|'90'|'180'|'365'|'custom'
const PERIODS: [Period,string][] = [['all','Any time'],['30','Last 30 days'],['90','Last 90 days'],['180','Last 6 months'],['365','Last year'],['custom','Custom range…']]
type Sort = 'updated'|'purchased-new'|'purchased-old'|'amount-high'|'amount-low'|'name'
const SORTS: [Sort,string][] = [['updated','Last updated'],['purchased-new','Purchase date · newest'],['purchased-old','Purchase date · oldest'],['amount-high','Amount · high to low'],['amount-low','Amount · low to high'],['name','Name A–Z']]
const RANGES: [string,string][] = [['90','Last 90 days'],['180','Last 6 months'],['365','Last year'],['0','All time']]

function readPref(key:string, fallback:string) { try { return localStorage.getItem(key) || fallback } catch { return fallback } }
const newId = () => `manual:${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)}`

type FormState = { mode: 'add' } | { mode: 'edit'; id: string } | null

function App() {
  const [orders,setOrders] = useState<Order[]>([])
  const [users,setUsers] = useState<Map<string,UserData>>(new Map())
  const usersRef = useRef(users)
  const [view,setView] = useState<'orders'|'warranty'>('orders')
  const [selectedId,setSelectedId] = useState<string|null>(null)
  const [form,setForm] = useState<FormState>(null)
  const [tab,setTab] = useState<Tab>('All')
  const [store,setStore] = useState('All')
  const [search,setSearch] = useState('')
  const [period,setPeriod] = useState<Period>('all')
  const [from,setFrom] = useState('')
  const [to,setTo] = useState('')
  const [minAmt,setMinAmt] = useState('')
  const [maxAmt,setMaxAmt] = useState('')
  const [sort,setSort] = useState<Sort>('updated')
  const [scanRange,setScanRange] = useState(()=>readPref('ov-scan-range','0'))
  const [busy,setBusy] = useState(false)
  const [progress,setProgress] = useState({done:0,total:0})
  const [message,setMessage] = useState('')
  const [error,setError] = useState('')
  const [lastSync,setLastSync] = useState(()=>readPref('ov-last-sync',''))
  const [showSettings,setShowSettings] = useState(false)
  const [clientId,setClientId] = useState(()=>getClientId())
  const [configOk,setConfigOk] = useState(()=>isConfigured())
  const [clientIdNote,setClientIdNote] = useState('')
  function applyClientId(forget=false) {
    const value = forget ? '' : clientId.trim()
    if (value && !isValidClientId(value)) { setClientIdNote('That does not look like a Client ID. It should end with .apps.googleusercontent.com'); return }
    saveClientId(value)
    setClientId(getClientId())
    setConfigOk(isConfigured())
    setClientIdNote(value ? 'Saved in this browser. You can now connect Gmail.' : 'Removed. The value from .env (if any) is used again.')
  }
  const [logLines,setLogLines] = useState<LogLine[]>([])
  const [logOpen,setLogOpen] = useState(false)

  const log: Logger = (level,msg) => setLogLines(l => [...l.slice(-499), { t: new Date().toLocaleTimeString(), level, msg }])
  function setUserMap(m: Map<string,UserData>) { usersRef.current = m; setUsers(m) }

  async function reload() {
    const [o,u] = await Promise.all([getOrders(), getUserData()])
    setOrders(o); setUserMap(new Map(u.map(x=>[x.id,x])))
  }
  useEffect(()=>{ reload().catch(e=>setError(String(e))) },[])

  // Orders as the user sees them: what the emails say, with their own corrections applied.
  const effective = useMemo(()=>orders.map(o=>applyUser(o,users.get(o.id))),[orders,users])
  const selected = selectedId ? effective.find(o=>o.id===selectedId) : undefined
  const editing = form?.mode==='edit' ? effective.find(o=>o.id===form.id) : undefined

  useEffect(()=>{
    const onKey = (e:KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (form) setForm(null)
      else if (showSettings) setShowSettings(false)
      else if (selectedId) setSelectedId(null)
    }
    window.addEventListener('keydown',onKey)
    return ()=>window.removeEventListener('keydown',onKey)
  },[form,showSettings,selectedId])

  const storeCounts = useMemo(()=>{
    const m = new Map<string,number>()
    for (const o of effective) m.set(o.store,(m.get(o.store)||0)+1)
    return [...m.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
  },[effective])

  // Everything except the status tab, so the tab counts always match what each tab would show.
  const scoped = useMemo(()=>{
    const now = Date.now()
    const fromMs = period==='custom' ? (from ? new Date(from).getTime() : -Infinity) : period==='all' ? -Infinity : now - Number(period)*DAY
    const toMs = period==='custom' && to ? new Date(to).getTime() + DAY - 1 : Infinity
    const min = minAmt ? Number(minAmt) : -Infinity
    const max = maxAmt ? Number(maxAmt) : Infinity
    const q = search.trim().toLowerCase()
    return effective.filter(o => {
      if (store!=='All' && o.store!==store) return false
      const t = new Date(o.orderDate).getTime()
      if (t < fromMs || t > toMs) return false
      if (min!==-Infinity || max!==Infinity) { if (o.amount==null || o.amount<min || o.amount>max) return false }
      return !q || `${o.product} ${o.orderId} ${o.store} ${o.subject} ${users.get(o.id)?.notes ?? ''}`.toLowerCase().includes(q)
    })
  },[effective,users,store,search,period,from,to,minAmt,maxAmt])
  const tabCounts = useMemo(()=>Object.fromEntries(TABS.map(t=>[t,scoped.filter(o=>matchesTab(o,t)).length])) as Record<Tab,number>,[scoped])
  // Totals for the sidebar, which ignores the filters.
  const totals = useMemo(()=>({
    progress: effective.filter(o=>matchesTab(o,'In progress')).length,
    delivered: effective.filter(o=>o.status==='Delivered').length,
    refunds: effective.filter(o=>o.status==='Return/refund').length,
    warranties: effective.filter(o=>users.get(o.id)?.warrantyMonths).length
  }),[effective,users])

  const filtered = useMemo(()=>{
    const list = scoped.filter(o=>matchesTab(o,tab))
    const by: Record<Sort,(a:Order,b:Order)=>number> = {
      'updated': (a,b)=>b.emailDate.localeCompare(a.emailDate),
      'purchased-new': (a,b)=>b.orderDate.localeCompare(a.orderDate),
      'purchased-old': (a,b)=>a.orderDate.localeCompare(b.orderDate),
      'amount-high': (a,b)=>(b.amount??-1)-(a.amount??-1),
      'amount-low': (a,b)=>(a.amount??Infinity)-(b.amount??Infinity),
      'name': (a,b)=>a.product.localeCompare(b.product)
    }
    return [...list].sort(by[sort])
  },[scoped,tab,sort])

  const stale = orders.some(o=>!o.manual && o.parserVersion!==PARSER_VERSION)
  const filtersActive = tab!=='All' || store!=='All' || !!search || period!=='all' || !!minAmt || !!maxAmt
  function clearFilters() { setTab('All'); setStore('All'); setSearch(''); setPeriod('all'); setFrom(''); setTo(''); setMinAmt(''); setMaxAmt('') }

  const totalSpend = effective.reduce((sum,o)=>sum+(o.amount||0),0)
  const shownSpend = filtered.reduce((sum,o)=>sum+(o.amount||0),0)

  // ---- notes, links, warranty and corrections: stored apart from orders so a sync never erases them
  async function saveUser(id:string, patch:Partial<UserData>) {
    const next = { ...(usersRef.current.get(id) ?? { id }), ...patch, id, updatedAt: new Date().toISOString() } as UserData
    const rec = next as unknown as Record<string,unknown>
    for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k]
    const empty = Object.keys(rec).every(k=>k==='id'||k==='updatedAt')
    const m = new Map(usersRef.current)
    if (empty) m.delete(id); else m.set(id,next)
    setUserMap(m)
    try { await (empty ? deleteUser(id) : putUser(next)) } catch(e:any) { setError(`Could not save: ${e?.message || e}`) }
  }
  function resetEdits(id:string) {
    const patch: Record<string,undefined> = {}
    for (const k of OVERRIDE_KEYS) patch[k] = undefined
    void saveUser(id, patch as Partial<UserData>)
  }
  async function submitForm(v:FormValues) {
    try {
      if (form?.mode==='add') {
        const now = new Date().toISOString()
        const order: Order = {
          id: newId(), store: v.store, orderId: v.orderId, product: v.product, amount: v.amount, currency: 'INR',
          orderDate: v.orderDate, status: v.status, subject: v.product, sender: 'added by hand', emailDate: now,
          gmailMessageId: '', snippet: '', sourceCount: 0, events: [], manual: true, parserVersion: PARSER_VERSION
        }
        await putOrders([order]); await reload()
        setMessage(`Added “${v.product}”.`); setSelectedId(order.id)
      } else if (form?.mode==='edit') {
        const raw = orders.find(o=>o.id===form.id)
        if (!raw) return
        if (raw.manual) {
          // A hand-added order has no emails to correct, so the change goes straight onto it.
          await putOrders([{ ...raw, store: v.store, product: v.product, amount: v.amount, orderDate: v.orderDate, status: v.status, emailDate: new Date().toISOString(), purchaseEstimated: false }])
          await reload()
        } else {
          await saveUser(raw.id, {
            product: v.product!==raw.product ? v.product : undefined,
            store: v.store!==raw.store ? v.store : undefined,
            amount: v.amount!==undefined && v.amount!==raw.amount ? v.amount : undefined,
            orderDate: ymd(v.orderDate)!==ymd(raw.orderDate) ? v.orderDate : undefined,
            status: v.status!==raw.status ? v.status : undefined
          })
        }
      }
      setForm(null)
    } catch(e:any) { setError(`Could not save: ${e?.message || e}`) }
  }
  async function removeManual(id:string) {
    if (!confirm('Delete this order and its notes? This cannot be undone.')) return
    await deleteOrder(id); await deleteUser(id); setSelectedId(null); await reload(); setMessage('Order deleted.')
  }

  async function syncGmail() {
    if (!isConfigured()) {
      setConfigOk(false); setClientId(getClientId()); setError(''); setMessage('')
      setClientIdNote('')
      setShowSettings(true)
      return
    }
    setBusy(true); setError(''); setMessage('Connecting to Google…'); setLogLines([]); setLogOpen(true)
    log('INFO','Asking Google for read-only Gmail access…')
    try {
      const token = await requestGmailToken()
      log('SUCCESS','Signed in. OrderVault can read mail but not send, change or delete it.')
      setMessage('Searching Gmail for order emails…')
      const emails = await fetchOrderEmails(token,(done,total)=>setProgress({done,total}),{days:Number(scanRange)||undefined,log})
      log('INFO',`Reading ${emails.length} emails for orders…`)
      const parsed = parseEmails(emails)
      // Diagnostics: which senders were fetched but not treated as a shop.
      const skipped = new Map<string, number>()
      for (const e of emails) {
        if (detectStore(e.from, e.subject) === 'Other') {
          const sender = (e.from.match(/<([^>]+)>/)?.[1] || e.from).toLowerCase()
          skipped.set(sender, (skipped.get(sender) || 0) + 1)
        }
      }
      const topSkipped = [...skipped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      console.log('[OrderVault] fetched', emails.length, 'emails; parsed', parsed.length, 'orders; skipped senders:', topSkipped)
      log(parsed.length ? 'SUCCESS' : 'WARN', `Found ${parsed.length} orders across ${new Set(parsed.map(p=>p.store)).size} shops.`)
      if (topSkipped.length) log('INFO', `Ignored senders that are not shops: ${topSkipped.map(([s,n])=>`${s} (${n})`).join(', ')}`)
      if (parsed.length) {
        // Orders already saved by this parser keep their older emails, so a short scan only adds to them.
        const existing = new Map((await getOrders()).map(o=>[o.id,o]))
        const merged = parsed.map(p => { const old = existing.get(p.id); return old && !old.manual && old.parserVersion===PARSER_VERSION ? mergeOrder(old,p) : p })
        await deleteStaleOrders(PARSER_VERSION)
        await putOrders(merged)
        log('SUCCESS',`Saved ${merged.length} orders on this device.`)
      }
      await reload()
      const stamp = new Date().toISOString()
      try { localStorage.setItem('ov-last-sync',stamp) } catch { /* private mode */ }
      setLastSync(stamp)
      setMessage(`Finished. Scanned ${emails.length} emails and found ${parsed.length} orders.`)
      if (!parsed.length) {
        const detail = !emails.length
          ? 'Gmail search returned 0 emails. Check that you signed in with the account that receives your order emails.'
          : `Emails were fetched but none looked like shop orders. Top skipped senders: ${topSkipped.map(([s, n]) => `${s} (${n})`).join(', ') || 'none'}.`
        setError(`No orders detected. ${detail}`)
      }
    } catch(e:any) { log('ERROR', e?.message || 'Sync failed.'); setError(e?.message || 'Sync failed.'); setMessage('') }
    finally { setBusy(false); setProgress({done:0,total:0}) }
  }
  function exportData() {
    const blob = new Blob([JSON.stringify({app:'OrderVault',version:2,exportedAt:new Date().toISOString(),orders,userData:[...users.values()]},null,2)],{type:'application/json'})
    const url = URL.createObjectURL(blob); const a=document.createElement('a')
    a.href=url; a.download=`ordervault-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url)
  }
  function importData(file?:File) {
    if(!file) return
    const reader=new FileReader()
    reader.onload=async()=>{
      try {
        const { orders:o, userData, skipped } = parseBackup(String(reader.result))
        await putOrders(o); await putUsers(userData); await reload()
        setMessage(`Imported ${o.length} orders${userData.length?` and ${userData.length} sets of notes/edits`:''}${skipped?` (${skipped} unreadable records skipped)`:''}.`)
      } catch(e:any) { setError(e.message) }
    }
    reader.readAsText(file)
  }
  async function wipe() {
    if(!confirm('Delete all locally stored OrderVault data from this browser: orders, notes, links, warranties and corrections? This cannot be undone.')) return
    await clearOrders(); setSelectedId(null); await reload(); setMessage('Local order database cleared.')
  }
  // Sidebar shortcuts show the whole list for that status, so they reset the other filters.
  const goTab = (t:Tab) => { clearFilters(); setTab(t); setView('orders'); document.getElementById('orders')?.scrollIntoView({behavior:'smooth'}) }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Archive size={20}/></div><span>Order<span className="brand-accent">Vault</span></span></div>
      <div className="side-label">WORKSPACE</div>
      <button className={`nav ${view==='orders'&&tab==='All'?'active':''}`} onClick={()=>goTab('All')}><Inbox size={17}/> All orders <span className="nav-count">{orders.length}</span></button>
      <button className={`nav ${view==='orders'&&tab==='In progress'?'active':''}`} onClick={()=>goTab('In progress')}><Truck size={17}/> In progress <span className="nav-count">{totals.progress}</span></button>
      <button className={`nav ${view==='orders'&&tab==='Delivered'?'active':''}`} onClick={()=>goTab('Delivered')}><CheckCircle2 size={17}/> Delivered <span className="nav-count">{totals.delivered}</span></button>
      <button className={`nav ${view==='orders'&&tab==='Return/refund'?'active':''}`} onClick={()=>goTab('Return/refund')}><RefreshCw size={17}/> Returns & refunds <span className="nav-count">{totals.refunds}</span></button>
      <button className={`nav ${view==='warranty'?'active':''}`} onClick={()=>{setView('warranty')}}><ShieldCheck size={17}/> Warranty <span className="nav-count">{totals.warranties}</span></button>
      <div className="side-bottom">
        <div className="privacy-card"><ShieldCheck size={18}/><b>Your data stays here</b><p>Emails are read in your browser. Order records are saved in this browser only.</p></div>
        <button className="nav" onClick={()=>setShowSettings(true)}><CircleHelp size={17}/> Setup & privacy</button>
      </div>
    </aside>

    <main className="main">
      <header className="topbar"><div className="mobile-brand"><Archive size={19}/> OrderVault</div><div className="top-right"><span className="local-pill"><span/> Local storage</span><button className="icon-btn" title="Setup & privacy" onClick={()=>setShowSettings(true)}><ShieldCheck size={18}/></button></div></header>
      <section className="welcome"><div><div className="eyebrow"><Sparkles size={14}/> YOUR PERSONAL SHOPPING HUB</div><h1>Your orders,<br/><em>all in one place.</em></h1><p>Bring purchases from every shop together without handing your inbox to another tracking service.</p></div>
        <div className="welcome-actions">
          <div className="sync-row">
            <label className="range-pick" title="How far back to scan your mailbox"><span>Scan</span><select value={scanRange} onChange={e=>{setScanRange(e.target.value); try{localStorage.setItem('ov-scan-range',e.target.value)}catch{/* private mode */}}} disabled={busy}>{RANGES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
            <button className="primary" onClick={syncGmail} disabled={busy}><RefreshCw size={17} className={busy?'spin':''}/>{busy?'Syncing Gmail…':'Connect / sync Gmail'}</button>
          </div>
          <div className="tiny-note">{configOk?'Read-only Gmail access':'Google OAuth setup required'}</div>
        </div>
      </section>

      {stale&&!busy&&<div className="notice warn"><span>Your saved orders were built by an older version. Click <b>Connect / sync Gmail</b> to rebuild them with the latest titles, dates and return/refund stages. Your notes and edits are kept.</span></div>}
      {(message||error)&&<div className={`notice ${error?'error':''}`}><span>{error||message}</span><button onClick={()=>{setMessage('');setError('')}} aria-label="Dismiss"><X size={16}/></button></div>}
      {busy&&progress.total>0&&<div className="progress-wrap"><div style={{width:`${Math.round(progress.done/progress.total*100)}%`}}/></div>}
      {(logLines.length>0||busy)&&<SyncLog lines={logLines} busy={busy} open={logOpen} onToggle={()=>setLogOpen(o=>!o)} onClear={()=>{setLogLines([]);setLogOpen(false)}}/>}

      <section className="stats">
        <div className="stat-card"><div className="stat-top"><span>Total orders</span><ShoppingBag size={17}/></div><strong>{orders.length}</strong><small>{storeCounts.length} {storeCounts.length===1?'shop':'shops'}</small></div>
        <div className="stat-card"><div className="stat-top"><span>In progress</span><Activity size={17}/></div><strong>{totals.progress}</strong><small>Ordered or on the way</small></div>
        <div className="stat-card"><div className="stat-top"><span>Delivered</span><CheckCircle2 size={17}/></div><strong>{totals.delivered}</strong><small>Marked delivered by email</small></div>
        <div className="stat-card"><div className="stat-top"><span>Tracked spend</span><Wallet size={17}/></div><strong>{money(totalSpend)}</strong><small>Amounts detected in emails</small></div>
      </section>

      <div className="view-switch" role="tablist" aria-label="View">
        <button role="tab" aria-selected={view==='orders'} className={view==='orders'?'selected':''} onClick={()=>setView('orders')}><Inbox size={14}/> Orders</button>
        <button role="tab" aria-selected={view==='warranty'} className={view==='warranty'?'selected':''} onClick={()=>setView('warranty')}><ShieldCheck size={14}/> Warranty{totals.warranties>0&&<em>{totals.warranties}</em>}</button>
      </div>

      {view==='warranty' ? <WarrantyView orders={effective} users={users} onOpen={setSelectedId} onSetMonths={(id,m)=>void saveUser(id,{warrantyMonths:m})}/> :
      <section className="orders-panel" id="orders">
        <div className="panel-heading"><div><h2>Order history</h2><p>{orders.length?`${filtered.length} of ${orders.length} orders${filtersActive?' match your filters':''}`:'Connect Gmail to discover your purchases'}</p></div><div className="panel-actions"><button className="soft-btn" onClick={()=>setForm({mode:'add'})}><Plus size={16}/> Add order</button><button className="soft-btn" onClick={exportData} disabled={!orders.length}><ArrowDownToLine size={16}/> Export</button><label className="soft-btn file-btn"><ArrowUpFromLine size={16}/> Import<input type="file" accept="application/json" onChange={e=>{importData(e.target.files?.[0]); e.target.value=''}}/></label></div></div>
        <div className="filters">
          <div className="searchbox"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search product, shop, order ID, notes…"/>{search&&<button className="clear-x" onClick={()=>setSearch('')} aria-label="Clear search"><X size={14}/></button>}</div>
          <div className="select-wrap"><Filter size={15}/><select value={store} onChange={e=>setStore(e.target.value)} aria-label="Shop"><option value="All">All shops</option>{storeCounts.map(([s,n])=><option key={s} value={s}>{s} ({n})</option>)}</select><ChevronDown size={14}/></div>
          <div className="select-wrap"><span className="sel-label">Purchased</span><select value={period} onChange={e=>setPeriod(e.target.value as Period)} aria-label="Purchase date">{PERIODS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><ChevronDown size={14}/></div>
          <div className="select-wrap"><span className="sel-label">Sort</span><select value={sort} onChange={e=>setSort(e.target.value as Sort)} aria-label="Sort by">{SORTS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><ChevronDown size={14}/></div>
        </div>
        <div className="filters sub">
          {period==='custom'&&<><label className="mini-field"><span>From</span><input type="date" value={from} max={to||undefined} onChange={e=>setFrom(e.target.value)}/></label><label className="mini-field"><span>To</span><input type="date" value={to} min={from||undefined} onChange={e=>setTo(e.target.value)}/></label></>}
          <label className="mini-field"><span>Min ₹</span><input type="number" min="0" inputMode="numeric" value={minAmt} onChange={e=>setMinAmt(e.target.value)} placeholder="0"/></label>
          <label className="mini-field"><span>Max ₹</span><input type="number" min="0" inputMode="numeric" value={maxAmt} onChange={e=>setMaxAmt(e.target.value)} placeholder="any"/></label>
          {filtersActive&&<button className="link-btn" onClick={clearFilters}>Clear all filters</button>}
        </div>
        <div className="tabs">{TABS.map(s=><button key={s} className={tab===s?'selected':''} onClick={()=>setTab(s)}>{s}<em>{tabCounts[s]}</em></button>)}</div>
        {filtered.length ? <div className="table-wrap"><table><thead><tr><th>ITEM / ORDER</th><th>SHOP</th><th>PURCHASED</th><th>LAST UPDATE</th><th>STATUS</th><th className="num">AMOUNT</th></tr></thead><tbody>{filtered.map(o=>{
            const st = storeStyle(o.store)
            const u = users.get(o.id)
            const open = () => setSelectedId(o.id)
            return <tr key={o.id} className={`order-row ${selectedId===o.id?'open':''}`} tabIndex={0} onClick={open} onKeyDown={e=>{if(e.key==='Enter')open()}} aria-label={`Open details for ${o.product}`}>
                <td><div className="product-name" title={o.product}>{o.product}</div><div className="muted">{o.orderId?`#${o.orderId} · `:''}{o.manual?'added by hand':`${o.sourceCount} ${o.sourceCount===1?'email':'emails'}`}{u?.notes?' · has notes':''}{u?.warrantyMonths?` · ${u.warrantyMonths} mo warranty`:''}</div></td>
                <td><span className={`store-tag ${st.className}`} style={st.style}>{o.store}</span></td>
                <td><div>{o.purchaseEstimated?'~ ':''}{date(o.orderDate)}</div>{o.purchaseEstimated&&<div className="muted" title="No order-confirmation email was found, so this is the earliest email seen">estimated</div>}</td>
                <td><div>{date(o.emailDate)}</div><div className="muted">{ago(o.emailDate)}</div></td>
                <td><span className={`status ${statusClass(o.status)}`}>{o.status}</span>{o.status==='Return/refund'&&o.returnStage&&<div className="muted">{o.returnStage}</div>}</td>
                <td className="amount num">{money(o.amount)}{o.status==='Return/refund'&&o.refundAmount!==undefined&&<div className="muted">refund {money(o.refundAmount)}</div>}</td>
              </tr>})}</tbody></table></div> :
          <div className="empty"><div className="empty-icon"><Package size={27}/></div><h3>{orders.length?'No matching orders':'Your order vault is empty'}</h3><p>{orders.length?'Try changing your search or filters.':'Connect Gmail to scan your purchase emails, or add an order by hand. Your messages are processed in this browser and are not uploaded to an OrderVault server.'}</p>{orders.length?<button className="primary" onClick={clearFilters}>Clear all filters</button>:<button className="primary" onClick={syncGmail} disabled={busy}><RefreshCw size={16}/> Start Gmail sync</button>}</div>}
        <div className="panel-foot"><span>Showing {filtered.length} of {orders.length}{filtered.length?` · ${money(shownSpend)}`:''}</span><span>{lastSync?`Last sync ${new Date(lastSync).toLocaleString()}`:'Not synced yet'}</span></div>
      </section>}
      <footer>OrderVault · Local-first · Gmail read-only · No OrderVault backend</footer>
    </main>

    {selected&&<OrderDetail key={selected.id} order={selected} user={users.get(selected.id)} onClose={()=>setSelectedId(null)}
      onSave={patch=>void saveUser(selected.id,patch)} onEdit={()=>setForm({mode:'edit',id:selected.id})}
      onResetEdits={()=>resetEdits(selected.id)} onDelete={()=>void removeManual(selected.id)}/>}
    {form&&(form.mode==='add'||editing)&&<OrderForm mode={form.mode} initial={editing} stores={storeCounts.map(([s])=>s)} onCancel={()=>setForm(null)} onSubmit={v=>void submitForm(v)}/>}

    {showSettings&&<div className="modal-backdrop" onClick={()=>setShowSettings(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><h2>Setup & privacy</h2><p>Configure Gmail access and manage local data.</p></div><button className="icon-btn" onClick={()=>setShowSettings(false)} aria-label="Close"><X size={18}/></button></div>
      <div className="setting-block"><h3>Google OAuth Client ID</h3><p>Create a Web application OAuth client in Google Cloud, add this site's address under Authorized JavaScript origins, then paste its Client ID here. It is saved only in this browser, and it is not a secret.</p><input className="client-input" value={clientId} onChange={e=>{setClientId(e.target.value); setClientIdNote('')}} onKeyDown={e=>{ if(e.key==='Enter') applyClientId() }} placeholder="xxxxx.apps.googleusercontent.com" autoFocus={!configOk} spellCheck={false} autoComplete="off" aria-label="Google OAuth Client ID"/><div className="row-buttons"><button className="soft-btn" onClick={()=>applyClientId()}>Save Client ID</button>{getStoredClientId()&&<button className="soft-btn" onClick={()=>{setClientId(''); applyClientId(true)}}>Forget</button>}</div>{clientIdNote&&<p className="hint" role="status">{clientIdNote}</p>}<p className="hint">Developers can also set <code>VITE_GOOGLE_CLIENT_ID</code> in <code>.env</code>. A value saved here takes priority.</p></div>
      <div className="setting-block"><h3>Data controls</h3><p>Orders, notes and warranties are stored in IndexedDB on this browser profile. Clearing browser site data may delete them. Export a backup before clearing.</p><div className="row-buttons"><button className="soft-btn" onClick={exportData}><ArrowDownToLine size={15}/> Export backup</button><button className="danger-btn" onClick={wipe}>Delete local data</button></div></div>
      <div className="setting-block"><h3>Access scope</h3><div className="scope-line"><ShieldCheck size={18}/><div><b>Gmail read-only</b><p>OrderVault requests gmail.readonly. It cannot send, modify or delete messages.</p></div></div></div>
      <button className="primary full" onClick={()=>setShowSettings(false)}>Done</button>
    </div></div>}
  </div>
}
export default App
