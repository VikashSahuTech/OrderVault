import type { Status } from './types'

export const DAY = 86400000
export const money = (n?: number) => {
  if (n == null) return '—'
  const digits = Number.isInteger(n) ? 0 : 2
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n)
}
export const date = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
export const dateTime = (s: string) => new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
export const statusClass = (s: Status) => s.toLowerCase().replace(/[^a-z]+/g, '-')
/** ISO timestamp -> local "YYYY-MM-DD" for <input type="date">. */
export function ymd(iso: string) {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
/** "YYYY-MM-DD" -> ISO timestamp at local noon, so the day can't shift across time zones. */
export const fromYmd = (s: string) => new Date(`${s}T12:00:00`).toISOString()
export function ago(s: string) {
  const days = Math.floor((Date.now() - new Date(s).getTime()) / DAY)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  if (days < 365) return `${Math.floor(days / 30)} mo ago`
  return `${Math.floor(days / 365)} yr ago`
}
// Known marketplaces keep their brand colours; any other shop gets a stable colour from its name.
const BRAND = new Set(['amazon', 'flipkart', 'myntra'])
export function storeStyle(store: string): { className: string; style?: { background: string; color: string } } {
  if (BRAND.has(store.toLowerCase())) return { className: store.toLowerCase() }
  let h = 0
  for (const c of store) h = (h * 31 + c.charCodeAt(0)) % 360
  return { className: 'custom', style: { background: `hsl(${h} 38% 20%)`, color: `hsl(${h} 80% 78%)` } }
}
