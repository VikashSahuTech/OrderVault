import type { OrderItem } from './types'

const clean = (s?: string | null) => (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
const rupees = (s: string) => {
  const m = s.match(/([\d,]+(?:\.\d{1,2})?)/)
  const n = m ? Number(m[1].replace(/,/g, '')) : NaN
  return Number.isFinite(n) && n > 0 && n < 10000000 ? n : undefined
}

/**
 * Line items from a Myntra order email. Myntra's markup gives each item an <li> whose class
 * contains "productListContainer" with brand, name, size, quantity and total in id-tagged
 * elements (selectors taken from the Tracker_app reference project). Returns [] for any
 * email in a different layout, so callers fall back to the subject-based title.
 */
export function parseMyntraItems(html: string): OrderItem[] {
  // DOMParser builds an inert document: no scripts run and no images are fetched.
  if (!html || typeof DOMParser === 'undefined') return []
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const items: OrderItem[] = []
    for (const li of Array.from(doc.querySelectorAll('li'))) {
      if (!/productListContainer/.test(li.className || '')) continue
      const text = (sel: string) => clean(li.querySelector(sel)?.textContent)
      const brand = text('[id*="ItemProductBrandName"]') || text('.brandName')
      const name = text('[id*="ItemProductName"]') || text('.solidGrey')
      if (!brand && !name) continue
      const qty = Number(text('[id*="ItemQuantity"]').match(/\d+/)?.[0]) || 1
      const size = text('[id*="ItemSize"]').replace(/^size\s*:?\s*/i, '')
      items.push({
        brand: brand || undefined,
        name: name || brand,
        size: size || undefined,
        qty,
        price: rupees(text('[id*="ItemTotal"]'))
      })
    }
    return items
  } catch {
    return []
  }
}
