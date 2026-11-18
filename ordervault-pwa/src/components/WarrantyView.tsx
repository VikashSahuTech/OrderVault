import { useMemo, useState } from 'react'
import { Plus, ShieldCheck } from 'lucide-react'
import type { Order, UserData } from '../types'
import { date, storeStyle } from '../format'
import { warrantyInfo } from '../userdata'

interface Props {
  orders: Order[]
  users: Map<string, UserData>
  onOpen: (id: string) => void
  onSetMonths: (id: string, months: number) => void
}

export default function WarrantyView({ orders, users, onOpen, onSetMonths }: Props) {
  const rows = useMemo(() => orders
    .map(o => ({ o, w: warrantyInfo(o, users.get(o.id)?.warrantyMonths), serial: users.get(o.id)?.serialNumber }))
    .filter((r): r is typeof r & { w: NonNullable<typeof r.w> } => !!r.w)
    .sort((a, b) => a.w.expiry.localeCompare(b.w.expiry)), [orders, users])
  const available = useMemo(() => orders.filter(o => !users.get(o.id)?.warrantyMonths && o.status !== 'Cancelled')
    .sort((a, b) => b.orderDate.localeCompare(a.orderDate)), [orders, users])
  const [pick, setPick] = useState('')
  const [months, setMonths] = useState('12')

  const count = (s: string) => rows.filter(r => r.w.state === s).length
  const n = Math.floor(Number(months))
  const canAdd = !!pick && Number.isFinite(n) && n > 0

  return <section className="orders-panel" id="orders">
    <div className="panel-heading"><div><h2>Warranty tracker</h2><p>{rows.length ? `${rows.length} warrant${rows.length === 1 ? 'y' : 'ies'} · soonest to expire first` : 'Add a warranty length to an order to track when it ends'}</p></div></div>
    <div className="warranty-add">
      <label className="field grow"><span className="field-label">Order</span>
        <select value={pick} onChange={e => setPick(e.target.value)}>
          <option value="">Choose an order…</option>
          {available.map(o => <option key={o.id} value={o.id}>{o.store} · {o.product.slice(0, 60)} · {date(o.orderDate)}</option>)}
        </select></label>
      <label className="field"><span className="field-label">Months</span>
        <input type="number" min="1" max="120" inputMode="numeric" value={months} onChange={e => setMonths(e.target.value)} /></label>
      <button className="primary" disabled={!canAdd} onClick={() => { onSetMonths(pick, Math.min(n, 120)); setPick('') }}><Plus size={15} /> Add warranty</button>
    </div>
    {rows.length > 0 && <div className="warranty-stats">
      <span className="stat-pill active">{count('Active')} active</span>
      <span className="stat-pill expiring-soon">{count('Expiring soon')} expiring within 30 days</span>
      <span className="stat-pill expired">{count('Expired')} expired</span>
    </div>}
    {rows.length ? <div className="table-wrap"><table><thead><tr><th>ITEM</th><th>SHOP</th><th>STARTS</th><th>ENDS</th><th>LENGTH</th><th>STATE</th></tr></thead><tbody>
      {rows.map(({ o, w, serial }) => {
        const st = storeStyle(o.store)
        return <tr key={o.id} className="order-row" tabIndex={0} onClick={() => onOpen(o.id)} onKeyDown={e => { if (e.key === 'Enter') onOpen(o.id) }}>
          <td><div className="product-name" title={o.product}>{o.product}</div>{serial && <div className="muted">Serial {serial}</div>}</td>
          <td><span className={`store-tag ${st.className}`} style={st.style}>{o.store}</span></td>
          <td>{date(w.start)}</td>
          <td><div>{date(w.expiry)}</div><div className="muted">{w.daysLeft >= 0 ? `${w.daysLeft} days left` : `${-w.daysLeft} days ago`}</div></td>
          <td>{w.months} mo</td>
          <td><span className={`warranty-tag ${w.state.toLowerCase().replace(/\s+/g, '-')}`}>{w.state}</span></td>
        </tr>
      })}
    </tbody></table></div>
    : <div className="empty"><div className="empty-icon"><ShieldCheck size={27} /></div><h3>No warranties yet</h3><p>Pick an order above and enter how many months of warranty it came with. The warranty starts on the delivery date when an email confirms it, otherwise on the purchase date.</p></div>}
  </section>
}
