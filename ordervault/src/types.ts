/** Store name: a well-known marketplace, or a name derived from the sender for any other shop. */
export type Store = string
export type Status = 'Ordered' | 'Shipped' | 'Out for delivery' | 'Delivered' | 'Cancelled' | 'Return/refund' | 'Unknown'
export const STATUS_LIST: Status[] = ['Ordered', 'Shipped', 'Out for delivery', 'Delivered', 'Cancelled', 'Return/refund', 'Unknown']
/** Where a return/refund has got to, as stated by the emails (never guessed). */
export type RefundStage = 'Return requested' | 'Pickup scheduled' | 'Picked up' | 'Return received' | 'Refund initiated' | 'Refund processed' | 'Refund credited'
export const REFUND_STAGES: RefundStage[] = ['Return requested', 'Pickup scheduled', 'Picked up', 'Return received', 'Refund initiated', 'Refund processed', 'Refund credited']
export interface OrderEvent {
  emailId: string
  date: string
  status: Status
  /** Finer return/refund stage for this email, when it states one. */
  stage?: RefundStage
  subject: string
  snippet: string
}
export interface OrderItem {
  brand?: string
  name: string
  size?: string
  qty: number
  /** Line total in rupees. */
  price?: number
}
export interface Order {
  id: string
  store: Store
  orderId: string
  /** Display title of the order (product name where one could be found). */
  product: string
  amount?: number
  currency: string
  /** Purchase date: the "Ordered" email, or the earliest email seen when that one wasn't scanned. */
  orderDate: string
  /** True when no "Ordered" email was found, so orderDate is only the earliest email seen. */
  purchaseEstimated?: boolean
  status: Status
  tracking?: string
  subject: string
  sender: string
  /** Date of the latest email about this order (last update). */
  emailDate: string
  gmailMessageId: string
  snippet: string
  sourceCount: number
  /** Every email seen for this order, oldest first. Missing on records saved by older versions. */
  events?: OrderEvent[]
  /** Line items, when the email lists them (currently Myntra). */
  items?: OrderItem[]
  /** Furthest return/refund stage any email reports. */
  returnStage?: RefundStage
  /** Refund amount quoted in the latest refund email. */
  refundAmount?: number
  /** Added by hand rather than found in Gmail; never removed by a sync. */
  manual?: boolean
  /** Parser version that produced this record; older records are rebuilt on the next sync. */
  parserVersion?: number
}
/**
 * Things the user typed. Kept apart from Order so a Gmail re-sync, which rewrites orders,
 * can never wipe notes or corrections.
 */
export interface UserData {
  /** Id of the order this belongs to. */
  id: string
  notes?: string
  invoiceUrl?: string
  productUrl?: string
  warrantyMonths?: number
  serialNumber?: string
  // Corrections that replace what was read from the emails.
  product?: string
  store?: string
  amount?: number
  orderDate?: string
  status?: Status
  updatedAt: string
}
