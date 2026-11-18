import { useState } from 'react'
import { X } from 'lucide-react'
import { STATUS_LIST } from '../types'
import type { Order, Status } from '../types'
import { fromYmd, ymd } from '../format'

export interface FormValues {
  store: string
  product: string
  orderId: string
  /** ISO timestamp. */
  orderDate: string
  amount?: number
  status: Status
}
interface Props {
  mode: 'add' | 'edit'
  /** Current values when editing. */
  initial?: Order
  stores: string[]
  onCancel: () => void
  onSubmit: (v: FormValues) => void
}

export default function OrderForm({ mode, initial, stores, onCancel, onSubmit }: Props) {
  const [store, setStore] = useState(initial?.store ?? '')
  const [product, setProduct] = useState(initial?.product ?? '')
  const [orderId, setOrderId] = useState(initial?.orderId ?? '')
  const [day, setDay] = useState(ymd(initial?.orderDate ?? new Date().toISOString()))
  const [amount, setAmount] = useState(initial?.amount !== undefined ? String(initial.amount) : '')
  const [status, setStatus] = useState<Status>(initial?.status ?? 'Ordered')
  const [error, setError] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const shop = store.trim()
    const name = product.trim()
    if (!shop) return setError('Enter the shop name.')
    if (!name) return setError('Enter what you bought.')
    if (!day || Number.isNaN(new Date(`${day}T12:00:00`).getTime())) return setError('Choose the purchase date.')
    let value: number | undefined
    if (amount.trim() !== '') {
      value = Number(amount.replace(/[,₹\s]/g, ''))
      if (!Number.isFinite(value) || value < 0 || value >= 1e9) return setError('Amount must be a number, e.g. 1499 or 1,499.50.')
    }
    onSubmit({ store: shop, product: name, orderId: orderId.trim(), orderDate: fromYmd(day), amount: value, status })
  }

  return <div className="modal-backdrop" onClick={onCancel}>
    <form className="modal order-form" onSubmit={submit} onClick={e => e.stopPropagation()} noValidate>
      <div className="modal-head">
        <div><h2>{mode === 'add' ? 'Add an order' : 'Edit order details'}</h2>
          <p>{mode === 'add' ? 'For purchases that are not in Gmail, such as a shop that emails nothing.' : 'Your changes replace what was read from the emails, and survive the next sync. Reset edits brings the originals back.'}</p></div>
        <button type="button" className="icon-btn" onClick={onCancel} aria-label="Close"><X size={18} /></button>
      </div>
      <div className="form-grid">
        <label className="field"><span className="field-label">Shop *</span>
          <input list="shop-names" value={store} onChange={e => setStore(e.target.value)} placeholder="e.g. Croma" autoFocus />
          <datalist id="shop-names">{stores.map(s => <option key={s} value={s} />)}</datalist></label>
        <label className="field"><span className="field-label">Purchase date *</span>
          <input type="date" value={day} max={ymd(new Date().toISOString())} onChange={e => setDay(e.target.value)} /></label>
        <label className="field wide"><span className="field-label">Item *</span>
          <input value={product} onChange={e => setProduct(e.target.value)} placeholder="e.g. Sony soundbar HT-S40R" /></label>
        {mode === 'add' && <label className="field"><span className="field-label">Order number</span>
          <input value={orderId} onChange={e => setOrderId(e.target.value)} placeholder="optional" /></label>}
        <label className="field"><span className="field-label">Amount paid (₹)</span>
          <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder={mode === 'edit' ? 'leave to keep the email amount' : 'optional'} /></label>
        <label className="field"><span className="field-label">Status</span>
          <select value={status} onChange={e => setStatus(e.target.value as Status)}>{STATUS_LIST.map(s => <option key={s}>{s}</option>)}</select></label>
      </div>
      {error && <div className="notice error" role="alert"><span>{error}</span></div>}
      <div className="row-buttons end">
        <button type="button" className="soft-btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary">{mode === 'add' ? 'Add order' : 'Save changes'}</button>
      </div>
    </form>
  </div>
}
