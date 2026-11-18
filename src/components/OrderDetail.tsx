import { useEffect, useRef, useState } from 'react'
import { ExternalLink, FileText, Link2, Pencil, RotateCcw, ShieldCheck, Trash2, X } from 'lucide-react'
import { REFUND_STAGES } from '../types'
import type { Order, UserData } from '../types'
import { ago, date, dateTime, money, statusClass, storeStyle } from '../format'
import { isEdited, safeUrl, warrantyInfo } from '../userdata'

interface Props {
  order: Order
  user?: UserData
  onClose: () => void
  onSave: (patch: Partial<UserData>) => void
  onEdit: () => void
  onResetEdits: () => void
  onDelete: () => void
}

function LinkField({ label, icon, value, onCommit }: { label: string; icon: React.ReactNode; value?: string; onCommit: (v?: string) => void }) {
  const [v, setV] = useState(value ?? '')
  const [err, setErr] = useState('')
  function commit() {
    const t = v.trim()
    if (t === (value ?? '')) { setErr(''); return }
    if (t && !safeUrl(t)) { setErr('Enter a full link starting with http:// or https://'); return }
    setErr(''); onCommit(t || undefined)
  }
  const href = safeUrl(value)
  return <label className="field">
    <span className="field-label">{icon} {label}</span>
    <div className="field-row">
      <input value={v} onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} placeholder="https://…" inputMode="url" />
      {href && <a className="icon-link" href={href} target="_blank" rel="noreferrer noopener" title={`Open ${label.toLowerCase()}`}><ExternalLink size={14} /></a>}
    </div>
    {err && <span className="field-err">{err}</span>}
  </label>
}

export default function OrderDetail({ order, user, onClose, onSave, onEdit, onResetEdits, onDelete }: Props) {
  // Notes save as you type (after a short pause), when you leave the box, and when the panel closes.
  const [notes, setNotes] = useState(user?.notes ?? '')
  const saved = user?.notes ?? ''
  const latest = useRef({ notes, saved, onSave })
  latest.current = { notes, saved, onSave }
  useEffect(() => {
    const t = setTimeout(() => { if (notes !== saved) onSave({ notes: notes || undefined }) }, 700)
    return () => clearTimeout(t)
  }, [notes])
  useEffect(() => () => {
    const l = latest.current
    if (l.notes !== l.saved) l.onSave({ notes: l.notes || undefined })
  }, [])

  const [months, setMonths] = useState(user?.warrantyMonths ? String(user.warrantyMonths) : '')
  const [serial, setSerial] = useState(user?.serialNumber ?? '')
  function commitMonths() {
    const n = Math.floor(Number(months))
    const next = months.trim() === '' || !Number.isFinite(n) || n <= 0 ? undefined : Math.min(n, 120)
    setMonths(next ? String(next) : '')
    if (next !== user?.warrantyMonths) onSave({ warrantyMonths: next })
  }
  const warranty = warrantyInfo(order, user?.warrantyMonths)

  const events = order.events || []
  const seen = new Set(events.map(e => e.stage).filter(Boolean))
  const showReturn = order.status === 'Return/refund' || seen.size > 0 || order.refundAmount !== undefined
  const st = storeStyle(order.store)

  return <div className="drawer-backdrop" onClick={onClose}>
    <aside className="drawer" role="dialog" aria-label="Order details" onClick={e => e.stopPropagation()}>
      <header className="drawer-head">
        <div>
          <div className="drawer-tags">
            <span className={`store-tag ${st.className}`} style={st.style}>{order.store}</span>
            <span className={`status ${statusClass(order.status)}`}>{order.status}</span>
            {order.manual && <span className="mini-tag">added by hand</span>}
            {isEdited(user) && <span className="mini-tag">edited</span>}
          </div>
          <h2>{order.product}</h2>
          {order.orderId && <div className="muted">Order #{order.orderId}</div>}
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>

      <div className="drawer-body">
        <dl className="facts">
          <div><dt>Purchased</dt><dd>{order.purchaseEstimated ? '~ ' : ''}{date(order.orderDate)}{order.purchaseEstimated && <small> estimated</small>}</dd></div>
          <div><dt>Last update</dt><dd>{date(order.emailDate)} <small>{ago(order.emailDate)}</small></dd></div>
          <div><dt>Amount</dt><dd>{money(order.amount)}</dd></div>
          <div><dt>Emails</dt><dd>{order.sourceCount || '—'}</dd></div>
        </dl>

        {order.items && order.items.length > 0 && <section className="d-section">
          <h3>Items</h3>
          <ul className="items">{order.items.map((it, i) => <li key={i}>
            <div><b>{it.brand ? `${it.brand} · ` : ''}{it.name}</b><small>{[it.size && `Size ${it.size}`, `Qty ${it.qty}`].filter(Boolean).join(' · ')}</small></div>
            <span>{money(it.price)}</span>
          </li>)}</ul>
        </section>}

        {showReturn && <section className="d-section">
          <h3>Return &amp; refund</h3>
          <div className="stages">{REFUND_STAGES.map(s => <span key={s} className={`stage ${seen.has(s) ? 'seen' : ''} ${order.returnStage === s ? 'current' : ''}`}>{s}</span>)}</div>
          <p className="muted note">{seen.size
            ? `Highlighted stages were stated in your emails${order.returnStage ? `; the furthest is “${order.returnStage}”` : ''}. A stage is never assumed.`
            : 'No return or refund stage was stated in the emails yet.'}
            {order.refundAmount !== undefined && <> Refund amount quoted: <b>{money(order.refundAmount)}</b>.</>}</p>
        </section>}

        <section className="d-section">
          <h3>Timeline</h3>
          {events.length ? <ol className="timeline">{events.map(e => <li key={e.emailId} className={statusClass(e.status)}>
            <span className="tl-dot" />
            <div className="tl-body">
              <div className="tl-head">
                <span className={`status ${statusClass(e.status)}`}>{e.status}</span>
                {e.stage && <span className="stage seen">{e.stage}</span>}
                <span className="tl-date">{dateTime(e.date)}</span>
                <a className="tl-link" href={`https://mail.google.com/mail/#all/${encodeURIComponent(e.emailId)}`} target="_blank" rel="noreferrer noopener" title="Open this email in Gmail"><ExternalLink size={12} /> Gmail</a>
              </div>
              <div className="tl-subject">{e.subject}</div>
            </div>
          </li>)}</ol> : <p className="muted">{order.manual ? 'Added by hand, so there are no emails to show.' : 'No timeline saved for this order. Sync Gmail again to rebuild it.'}</p>}
        </section>

        <section className="d-section">
          <h3>Your notes</h3>
          <textarea className="notes" rows={4} value={notes} onChange={e => setNotes(e.target.value)} onBlur={() => { if (notes !== saved) onSave({ notes: notes || undefined }) }} placeholder="Refund queries, vendor contacts, coupon codes, where the box is…" />
          <div className="muted">Saved on this device only{notes !== saved ? ' · saving…' : ''}</div>
        </section>

        <section className="d-section">
          <h3>Links</h3>
          <LinkField key={`i${user?.invoiceUrl ?? ''}`} label="Invoice" icon={<FileText size={13} />} value={user?.invoiceUrl} onCommit={v => onSave({ invoiceUrl: v })} />
          <LinkField key={`p${user?.productUrl ?? ''}`} label="Product page" icon={<Link2 size={13} />} value={user?.productUrl} onCommit={v => onSave({ productUrl: v })} />
        </section>

        <section className="d-section">
          <h3><ShieldCheck size={14} /> Warranty</h3>
          <div className="two-col">
            <label className="field"><span className="field-label">Length (months)</span>
              <input type="number" min="0" max="120" inputMode="numeric" value={months} onChange={e => setMonths(e.target.value)} onBlur={commitMonths} placeholder="none" /></label>
            <label className="field"><span className="field-label">Serial number</span>
              <input value={serial} onChange={e => setSerial(e.target.value)} onBlur={() => { const t = serial.trim(); if (t !== (user?.serialNumber ?? '')) onSave({ serialNumber: t || undefined }) }} placeholder="optional" /></label>
          </div>
          {warranty
            ? <p className={`warranty-line ${warranty.state.toLowerCase().replace(/\s+/g, '-')}`}>
                {warranty.state === 'Expired' ? 'Expired' : warranty.state === 'Expiring soon' ? 'Expires soon' : 'Active'} · until <b>{date(warranty.expiry)}</b>
                {warranty.daysLeft >= 0 ? ` (${warranty.daysLeft} days left)` : ` (${-warranty.daysLeft} days ago)`}
                <small> Counted from {order.events?.some(e => e.status === 'Delivered') ? 'delivery' : 'purchase'} on {date(warranty.start)}.</small>
              </p>
            : <p className="muted">Enter a length to track when this warranty ends.</p>}
        </section>
      </div>

      <footer className="drawer-foot">
        <button className="soft-btn" onClick={onEdit}><Pencil size={14} /> Edit details</button>
        {isEdited(user) && <button className="soft-btn" onClick={onResetEdits} title="Go back to what the emails say"><RotateCcw size={14} /> Reset edits</button>}
        {order.manual && <button className="danger-btn" onClick={onDelete}><Trash2 size={14} /> Delete order</button>}
      </footer>
    </aside>
  </div>
}
