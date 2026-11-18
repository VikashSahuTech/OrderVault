import { REFUND_STAGES, STATUS_LIST } from './types'
import type { Order, OrderEvent, OrderItem, RefundStage, Status, UserData } from './types'
import { safeUrl } from './userdata'

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max = 2000) => typeof v === 'string' ? v.slice(0, max) : undefined
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e9 ? v : undefined
const validDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(new Date(v).getTime())
const status = (v: unknown): Status | undefined => STATUS_LIST.includes(v as Status) ? v as Status : undefined
const stage = (v: unknown): RefundStage | undefined => REFUND_STAGES.includes(v as RefundStage) ? v as RefundStage : undefined

function cleanEvent(e: unknown): OrderEvent | undefined {
  if (!isObj(e) || !validDate(e.date)) return undefined
  const st = status(e.status)
  if (!st || typeof e.emailId !== 'string') return undefined
  return { emailId: e.emailId.slice(0, 64), date: e.date, status: st, stage: stage(e.stage), subject: str(e.subject, 300) ?? '', snippet: str(e.snippet, 400) ?? '' }
}
function cleanItem(i: unknown): OrderItem | undefined {
  if (!isObj(i) || typeof i.name !== 'string' || !i.name) return undefined
  return { brand: str(i.brand, 100), name: i.name.slice(0, 300), size: str(i.size, 50), qty: Math.max(1, Math.floor(num(i.qty) ?? 1)), price: num(i.price) }
}
function cleanOrder(o: unknown): Order | undefined {
  if (!isObj(o) || typeof o.id !== 'string' || !o.id || typeof o.store !== 'string' || typeof o.product !== 'string') return undefined
  const st = status(o.status)
  if (!st || !validDate(o.orderDate) || !validDate(o.emailDate)) return undefined
  return {
    id: o.id.slice(0, 300), store: o.store.slice(0, 60), orderId: str(o.orderId, 100) ?? '', product: o.product.slice(0, 300),
    amount: num(o.amount), currency: str(o.currency, 8) ?? 'INR', orderDate: o.orderDate, purchaseEstimated: o.purchaseEstimated === true,
    status: st, subject: str(o.subject, 300) ?? '', sender: str(o.sender, 300) ?? '', emailDate: o.emailDate,
    gmailMessageId: str(o.gmailMessageId, 64) ?? '', snippet: str(o.snippet, 400) ?? '', sourceCount: Math.floor(num(o.sourceCount) ?? 0),
    events: Array.isArray(o.events) ? o.events.map(cleanEvent).filter((e): e is OrderEvent => !!e) : undefined,
    items: Array.isArray(o.items) ? o.items.map(cleanItem).filter((i): i is OrderItem => !!i) : undefined,
    returnStage: stage(o.returnStage), refundAmount: num(o.refundAmount), manual: o.manual === true,
    parserVersion: num(o.parserVersion)
  }
}
function cleanUser(u: unknown): UserData | undefined {
  if (!isObj(u) || typeof u.id !== 'string' || !u.id) return undefined
  const months = num(u.warrantyMonths)
  return {
    id: u.id.slice(0, 300), notes: str(u.notes, 5000), invoiceUrl: safeUrl(str(u.invoiceUrl, 1000)), productUrl: safeUrl(str(u.productUrl, 1000)),
    warrantyMonths: months && months <= 120 ? Math.floor(months) : undefined, serialNumber: str(u.serialNumber, 100),
    product: str(u.product, 300), store: str(u.store, 60), amount: num(u.amount), orderDate: validDate(u.orderDate) ? u.orderDate : undefined,
    status: status(u.status), updatedAt: validDate(u.updatedAt) ? u.updatedAt : new Date().toISOString()
  }
}

/** Reads a backup file, keeping only well-formed records and dropping unknown fields. */
export function parseBackup(text: string): { orders: Order[]; userData: UserData[]; skipped: number } {
  let data: unknown
  try { data = JSON.parse(text) } catch { throw new Error('That file is not valid JSON.') }
  if (!isObj(data) || !Array.isArray(data.orders)) throw new Error('Invalid backup file: no orders found.')
  const orders = data.orders.map(cleanOrder).filter((o): o is Order => !!o)
  const userData = Array.isArray(data.userData) ? data.userData.map(cleanUser).filter((u): u is UserData => !!u) : []
  return { orders, userData, skipped: data.orders.length - orders.length }
}
