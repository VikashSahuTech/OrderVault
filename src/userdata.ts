import type { Order, UserData } from './types'
import { DAY } from './format'

/** The fields a user can correct. Everything else on UserData is a personal addition. */
export const OVERRIDE_KEYS = ['product', 'store', 'amount', 'orderDate', 'status'] as const

/** The order as the user wants to see it: what was read from email, with their corrections on top. */
export function applyUser(o: Order, u?: UserData): Order {
  if (!u) return o
  const out: Order = { ...o }
  if (u.product) out.product = u.product
  if (u.store) out.store = u.store
  if (u.amount !== undefined) out.amount = u.amount
  if (u.orderDate) { out.orderDate = u.orderDate; out.purchaseEstimated = false }
  if (u.status) out.status = u.status
  return out
}
export const isEdited = (u?: UserData) => !!u && OVERRIDE_KEYS.some(k => u[k] !== undefined)

export interface WarrantyInfo {
  months: number
  start: string
  expiry: string
  daysLeft: number
  state: 'Active' | 'Expiring soon' | 'Expired'
}
/** Warranty runs from delivery (or from purchase when no delivery email was seen). */
export function warrantyInfo(o: Order, months?: number, now = Date.now()): WarrantyInfo | undefined {
  if (!months || months <= 0) return undefined
  const start = o.events?.find(e => e.status === 'Delivered')?.date ?? o.orderDate
  const d = new Date(start)
  const day = d.getDate()
  const exp = new Date(d)
  exp.setDate(1)
  exp.setMonth(exp.getMonth() + months)
  // 31 Jan + 1 month is 28/29 Feb, not 3 March.
  exp.setDate(Math.min(day, new Date(exp.getFullYear(), exp.getMonth() + 1, 0).getDate()))
  const daysLeft = Math.ceil((exp.getTime() - now) / DAY)
  return { months, start, expiry: exp.toISOString(), daysLeft, state: daysLeft < 0 ? 'Expired' : daysLeft <= 30 ? 'Expiring soon' : 'Active' }
}

/** Only http(s) links are ever rendered as links, so imported data can't smuggle in javascript: URLs. */
export function safeUrl(s?: string): string | undefined {
  if (!s) return undefined
  try {
    const u = new URL(s.trim())
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined
  } catch { return undefined }
}
