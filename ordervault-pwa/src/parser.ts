import { REFUND_STAGES } from './types'
import type { Order, OrderEvent, OrderItem, RefundStage, Store, Status } from './types'
import type { RawEmail } from './gmail'
import { parseMyntraItems } from './myntra'

/** Bump when parsing/grouping changes, so records built by an older parser are rebuilt on the next sync. */
export const PARSER_VERSION = 3

// ---------------------------------------------------------------- store

// Shops we can name nicely. Anything else gets a name derived from the sender.
const KNOWN_STORES: [RegExp, string][] = [
  [/amazon/, 'Amazon'], [/flipkart/, 'Flipkart'], [/myntra/, 'Myntra'], [/ajio/, 'Ajio'], [/nykaa/, 'Nykaa'],
  [/meesho/, 'Meesho'], [/swiggy/, 'Swiggy'], [/zomato/, 'Zomato'], [/bigbasket/, 'BigBasket'],
  [/blinkit|grofers/, 'Blinkit'], [/zepto/, 'Zepto'], [/tatacliq|tata cliq/, 'Tata CLiQ'], [/croma/, 'Croma'],
  [/jiomart/, 'JioMart'], [/snapdeal/, 'Snapdeal'], [/decathlon/, 'Decathlon'], [/\b1mg\b/, '1mg'],
  [/pharmeasy/, 'PharmEasy'], [/lenskart/, 'Lenskart'], [/firstcry/, 'FirstCry'], [/boat-lifestyle|boat lifestyle/, 'boAt'],
  [/\bikea\b/, 'IKEA'], [/\bapple\b/, 'Apple'], [/\bdell\b/, 'Dell'], [/\bsamsung\b/, 'Samsung'], [/\boneplus\b/, 'OnePlus']
]
// Senders that never sell anything to the user.
const NON_SHOP_DOMAIN = /(?:^|\.)(?:gmail|googlemail|google|youtube|linkedin|facebookmail|facebook|twitter|github|gitlab|slack|zoom|microsoft|outlook|office365|dropbox|notion|figma|atlassian|anthropic|openai)\.com$/
// Bulk-mail providers: their domain says nothing about the shop, so the display name is used instead.
const MAILER_ROOT = /^(?:amazonses|sendgrid|mailchimp|mandrillapp|mailgun|sparkpost\w*|rsgsv|cmail\d+|mcsv|mcdlv|klaviyo\w*|shopifyemail|mailer|bounce\w*|emails?|mail|e|em|mg|send|smtp\w*|postmark\w*|sailthru|exacttarget|salesforce|zohomail|zoho|freshdesk|msgfocus|netcore\w*|pepipost|sendinblue|brevo|clevertap\w*|webengage|moengage|mailjet|elasticemail|customeriomail)$/
const NAME_NOISE = /\b(?:no[- ]?reply|do[- ]?not[- ]?reply|noreply|orders?|order updates?|shipping|shipment|tracking|team|support|customer (?:care|service)|care|notifications?|updates?|alerts?|official|india|mail|info|help|hello|sales|billing|invoices?|receipts?|delivery)\b/gi

function parseSender(from: string) {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/)
  const name = (m ? m[1] : '').trim()
  const addr = (m ? m[2] : from).trim().toLowerCase()
  const domain = addr.split('@')[1] || ''
  const labels = domain.split('.').filter(Boolean)
  const tld = labels.length >= 3 && /^(?:co|com|org|net|gov|ac|edu)$/.test(labels[labels.length - 2]) ? 3 : 2
  const root = labels.length >= tld ? labels[labels.length - tld] : labels[0] || ''
  return { name, domain, root }
}
const titleCase = (s: string) => s.replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase())
function deriveStoreName(name: string, root: string): string {
  let display = name.replace(NAME_NOISE, ' ').replace(/[^a-z0-9&'.+ -]/gi, ' ').replace(/\s+/g, ' ').trim()
  if (display === display.toLowerCase()) display = titleCase(display)
  const flat = display.toLowerCase().replace(/[^a-z0-9]/g, '')
  const usableRoot = root && !MAILER_ROOT.test(root)
  if (display.length >= 2 && (!usableRoot || flat.includes(root) || root.includes(flat))) return display.slice(0, 28)
  if (usableRoot) return titleCase(root).slice(0, 28)
  return display.length >= 2 ? display.slice(0, 28) : 'Other'
}
/** Store name for a sender, or 'Other' when the sender is clearly not a shop. */
export function detectStore(from: string, subject: string): Store {
  const sender = parseSender(from)
  // Match the sender's name and registrable domain, but not bulk-mail providers (a shop sending via
  // amazonses.com is not Amazon).
  const fromText = `${sender.name} ${MAILER_ROOT.test(sender.root) ? '' : sender.root}`.toLowerCase()
  for (const [re, name] of KNOWN_STORES) if (re.test(fromText)) return name
  if (!sender.domain || NON_SHOP_DOMAIN.test(sender.domain)) return 'Other'
  const subjectText = subject.toLowerCase()
  for (const [re, name] of KNOWN_STORES) if (re.test(subjectText)) return name
  return deriveStoreName(sender.name, sender.root)
}
const isKnownStore = (store: string) => KNOWN_STORES.some(([, name]) => name === store)

// ---------------------------------------------------------------- status

// The subject is the most reliable signal ("Delivered: ..."), so it is checked first.
// Quoted product titles are removed so a product called "... Replacement ..." can't set the status.
function statusFromSubject(subject: string): Status {
  const s = subject.replace(/["“][^"”]*["”]/g, ' ').toLowerCase()
  if (/\brefund|\breturn (?:pickup|request|received|initiated|approved|scheduled|label)|\breplacement\b|\breturn\b.*\bpick-?up|\bpick-?up\b.*\breturn\b/.test(s)) return 'Return/refund'
  if (/cancel/.test(s)) return 'Cancelled'
  if (/out for delivery|arriving today|delivery attempt|delivery agent/.test(s)) return 'Out for delivery'
  if (/will be delivered|to be delivered/.test(s)) return 'Shipped'
  if (/\bdelivered\b|delivery completed/.test(s)) return 'Delivered'
  if (/shipped|dispatched|on (?:its|the) way|in transit|shipment|arriving/.test(s)) return 'Shipped'
  if (/^\s*ordered\b|order (?:(?:has been|is|was) )?(?:confirmed|placed|received)|order (?:confirmation|summary|receipt)|thanks for your order|thank you for (?:your )?(?:order|purchase)|purchase confirmation|your receipt/.test(s)) return 'Ordered'
  return 'Unknown'
}
// Fallback when the subject says nothing: only the opening of the email, and only full phrases,
// because footers are full of boilerplate like "easy returns" or "if your order is cancelled".
function statusFromBody(snippet: string, body: string): Status {
  const s = `${snippet} ${body.slice(0, 500)}`.toLowerCase()
  if (/refund (?:has been |is |was )?(?:initiated|processed|issued)/.test(s)) return 'Return/refund'
  if (/(?:has been|was|is) cancell?ed/.test(s)) return 'Cancelled'
  if (/out for delivery/.test(s)) return 'Out for delivery'
  if (/(?:has been|was|is) delivered|delivered (?:on|successfully)/.test(s)) return 'Delivered'
  if (/(?:has been |was |is )?(?:shipped|dispatched)|on its way|in transit/.test(s)) return 'Shipped'
  if (/order (?:confirmed|placed|has been (?:placed|received|confirmed))|thanks for your order/.test(s)) return 'Ordered'
  return 'Unknown'
}
function detectStatus(subject: string, snippet: string, body: string): Status {
  const fromSubject = statusFromSubject(subject)
  return fromSubject !== 'Unknown' ? fromSubject : statusFromBody(snippet, body)
}

// ---------------------------------------------------------------- order id / amount

function findOrderId(text: string): string | undefined {
  // Marketplace formats first: Amazon 404-1234567-1234567, Flipkart OD123...
  const known = text.match(/\b(OD[0-9]{10,}|[0-9]{3}-[0-9]{7}-[0-9]{7})\b/i)
  if (known) return known[1]
  // Generic "Order ID: XYZ123": the token must contain a digit, so ordinary words don't count.
  for (const m of text.matchAll(/order\s*(?:(?:id|number|no)\b\.?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{5,})/gi)) {
    if (/\d/.test(m[1])) return m[1]
  }
  return undefined
}

interface AmountHit { value: number; labeled: boolean }
const CUR = String.raw`(?:₹|INR|\bRs\.?)\s*`
const NUM = String.raw`([\d,]+(?:\.\d{1,2})?)`
const LABELED = new RegExp(String.raw`\b(?:order total|grand total|total payable|amount payable|total amount|amount paid|you paid|total)\s*(?:\([^)]{0,40}\))?\s*[:\-]?\s*${CUR}${NUM}`, 'i')
const ANY = new RegExp(`${CUR}${NUM}`, 'i')
const validAmount = (n: number) => Number.isFinite(n) && n > 0 && n < 10000000
// A figure next to "Total" is the order value. A bare first ₹ is only a fallback, and only
// from the top of the email so footer promos ("free delivery above ₹499") are ignored.
function findAmount(text: string): AmountHit | undefined {
  const labeled = text.match(LABELED)
  if (labeled) {
    const value = Number(labeled[1].replace(/,/g, ''))
    if (validAmount(value)) return { value, labeled: true }
  }
  const any = text.slice(0, 2000).match(ANY)
  if (any) {
    const value = Number(any[1].replace(/,/g, ''))
    if (validAmount(value)) return { value, labeled: false }
  }
  return undefined
}

// ---------------------------------------------------------------- product / title

// Words that mean a piece of subject text is about the order, not the item.
const NOT_A_PRODUCT = /\b(?:update|refund\w*|order\w*|shipment|package|parcel|delivery|delivered|shipped|return\w*|cancel\w*|your|has|have|been|was|were|is|are|payment|invoice|receipt|confirm\w*|thank\w*|placed|received|dispatched|arriv\w*|tracking|status|reminder|feedback|review|rate|rating|summary|details|issue\w*|processed|initiated|credited|gift card|balance|account|offer|sale|deal)\b/i
const STATUS_PREFIX = /^\s*(?:(?:re|fwd?):\s*)*(?:ordered|shipped|out for delivery|delivered|arriving|dispatched|cancell?ed|refund|return|your order|order|shipment|delivery|update)\b[^:"]{0,40}:\s*/i

function cleanTitle(raw: string): string {
  let s = raw.replace(/^[\s*•·\-–>]+/, '').replace(/\s+/g, ' ').replace(/\s*[x×]\s*\d+$/i, '').replace(/[\s,;:|\-–]+$/, '').trim()
  if (s.length > 110) s = s.slice(0, 110).replace(/\s+\S*$/, '') + '…'
  return s.replace(/\.{3}$/, '…')
}
const moreItems = (subject: string) => Number(subject.match(/\band\s+(\d+)\s+more\s+items?/i)?.[1] || 0)

/** The explicit product name in a subject, or undefined when the subject only describes the order. */
function productFromSubject(subject: string): string | undefined {
  const quoted = subject.match(/["“]([^"”]{3,})["”]/)
  if (quoted) return cleanTitle(quoted[1])
  const forMatch = subject.match(/\b(?:order|shipment|package|parcel|delivery|refund|return)\s+(?:for|of)\s+(.{4,}?)(?:\s+(?:has|have|is|was|will|been|from|on|at)\b|[.!?]|$)/i)
  if (forMatch && !NOT_A_PRODUCT.test(forMatch[1])) return cleanTitle(forMatch[1])
  const rest = subject.replace(STATUS_PREFIX, '').trim()
  if (rest.length > 5 && !NOT_A_PRODUCT.test(rest)) return cleanTitle(rest)
  return undefined
}
const LABEL_PATTERNS = [
  /refund of\s+(?:₹|Rs\.?|INR)\s*[\d,.]+\s+for\s+([^\n|.]{3,80}?)\s+(?:is|has|was|will)\b/i,
  /(?:^|\n)\s*(?:item|items|product|you ordered|order contains|package contains|description)\s*[:\-]\s*([^\n|]{5,120})/i,
  /(?:your|the) order for\s+([^\n|.]{5,100})/i
]
const BOILERPLATE = /^(?:order|item|qty|quantity|price|total|subtotal|sold by|seller|shipping|delivery|ship to|arriving|payment|invoice|₹|rs\b|inr\b)/i
const splitCells = (line: string) => line.split(' | ').map(s => s.trim()).filter(Boolean)
const plausible = (s?: string) => !!s && s.length >= 6 && s.length <= 160 && !/^[\d\s.,₹:/-]*$/.test(s) && !BOILERPLATE.test(s)

function productFromText(text: string): string | undefined {
  for (const p of LABEL_PATTERNS) {
    const m = text.match(p)
    if (m?.[1] && plausible(m[1])) return cleanTitle(m[1])
  }
  // Order confirmations list each item with its quantity right after the name.
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const cells = splitCells(lines[i])
    const q = cells.findIndex(c => /^(?:qty|quantity)\b/i.test(c))
    if (q < 0) continue
    const prev = q > 0 ? cells[q - 1] : splitCells(lines[i - 1] || '').pop()
    if (plausible(prev)) return cleanTitle(prev as string)
  }
  return undefined
}
/** Subjects cut long names short ("Toolworks Adjustable Drill..."); the email body usually has the full line. */
function expandName(name: string, body: string): string {
  const m = name.match(/^(.*?)\s*(?:…|\.{3})$/)
  if (!m || m[1].length < 8) return name
  const prefix = m[1].toLowerCase()
  for (const line of body.split('\n')) {
    for (const cell of splitCells(line)) {
      const t = cell.replace(/^[\s*•·\-–>]+/, '')
      if (t.length > m[1].length && t.toLowerCase().startsWith(prefix)) return cleanTitle(t)
    }
  }
  return name
}
function findProduct(subject: string, snippet: string, body: string): string | undefined {
  const name = productFromSubject(subject) ?? productFromText(`${subject}\n${snippet}\n${body}`)
  return name ? expandName(name, body) : undefined
}
const isTruncated = (s: string) => s.endsWith('…')

// ---------------------------------------------------------------- grouping

function parseDate(value: string) {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

const PROGRESS: Status[] = ['Ordered', 'Shipped', 'Out for delivery', 'Delivered']
// Current status of an order, from its events (oldest first). Order does not decide it:
// a late "Ordered" email can't undo "Delivered", and a cancellation or refund ends the story.
export function currentStatus(events: OrderEvent[]): Status {
  const known = events.filter(e => e.status !== 'Unknown')
  if (!known.length) return 'Unknown'
  const terminal = known.filter(e => e.status === 'Cancelled' || e.status === 'Return/refund')
  if (terminal.length) {
    const last = terminal[terminal.length - 1].status
    // A refund for an order that was cancelled before delivery is still just a cancellation.
    const cancelled = terminal.some(e => e.status === 'Cancelled')
    const delivered = known.some(e => e.status === 'Delivered')
    return last === 'Return/refund' && cancelled && !delivered ? 'Cancelled' : last
  }
  return known.reduce<Status>((best, e) => PROGRESS.indexOf(e.status) > PROGRESS.indexOf(best) ? e.status : best, known[0].status)
}

// ---------------------------------------------------------------- return / refund stage

// Only what an email actually says: "processed" is not "credited", and nothing here infers a later stage.
// Most advanced wording first, so "refund processed and credited" reads as credited.
const STAGE_RULES: [RegExp, RefundStage][] = [
  [/refund[^.\n]{0,60}\b(?:credited|completed)\b|\bcredited to your|refund (?:success(?:ful(?:ly)?)?)\b/, 'Refund credited'],
  [/refund[^.\n]{0,40}\bprocessed\b|\bprocessed (?:your )?refund/, 'Refund processed'],
  [/refund[^.\n]{0,40}\b(?:initiated|issued|raised|on its way)\b|\binitiated (?:a |your |the )?refund|\bissued (?:a |your )?refund/, 'Refund initiated'],
  [/return[^.\n]{0,40}\b(?:received|delivered to|reached)\b|received your return|return (?:has been )?(?:picked up and )?received/, 'Return received'],
  [/\b(?:picked up|pick-?up (?:is )?(?:done|completed))\b/, 'Picked up'],
  [/pick-?up[^.\n]{0,40}\b(?:scheduled|arranged|booked|confirmed)\b|will (?:pick up|collect)/, 'Pickup scheduled'],
  [/return[^.\n]{0,40}\b(?:request|requested|initiated|approved|accepted|created|registered)\b|return label|replacement (?:request|initiated)/, 'Return requested']
]
function detectStage(subject: string, snippet: string, body: string): RefundStage | undefined {
  // Subject (with quoted product names removed) and the opening of the email are both read, and the
  // furthest stage either states wins: "Refund processed" over a body saying "credited to your bank".
  const texts = [subject.replace(/["“][^"”]*["”]/g, ' ').toLowerCase(), `${snippet} ${body.slice(0, 600)}`.toLowerCase()]
  let best: RefundStage | undefined
  for (const text of texts) {
    // Rules are ordered most advanced first, so the first hit per text is that text's furthest stage.
    const hit = STAGE_RULES.find(([re]) => re.test(text))?.[1]
    if (hit && (!best || REFUND_STAGES.indexOf(hit) > REFUND_STAGES.indexOf(best))) best = hit
  }
  return best
}
const REFUND_AMOUNT = new RegExp(String.raw`\brefund(?:ed)?\b[^\n₹]{0,50}?${CUR}${NUM}`, 'i')
function findRefundAmount(text: string): number | undefined {
  const m = text.slice(0, 1500).match(REFUND_AMOUNT)
  const n = m ? Number(m[1].replace(/,/g, '')) : NaN
  return validAmount(n) ? n : undefined
}

// Newsletters and offers: ignored unless the email carries an order number.
const PROMO = /\b(?:\d+%\s*off|flat\s+\d+|up\s?to|sale|deals?|offers?|coupons?|discounts?|cashback|newsletter|recommend\w*|we miss you|survey|webinar|otp|verification code|password|sign[- ]?in|statement|due date|invit\w*|subscribe|wishlist|price drop|back in stock|restock\w*|bestsellers?)\b/i
// Small shops have no recognisable name or format, so their subject must clearly be about an order.
const ORDER_WORDS = /\b(?:order|shipment|shipped|package|parcel|purchase|delivered|delivery|dispatched|invoice|receipt)\b/i

interface Item {
  email: RawEmail
  date: string
  status: Status
  product?: string
  extra: number
  amount?: AmountHit
  stage?: RefundStage
  refund?: number
  lines: OrderItem[]
}
const itemTitle = (it: OrderItem) => (it.brand && !it.name.toLowerCase().startsWith(it.brand.toLowerCase()) ? `${it.brand} - ${it.name}` : it.name).slice(0, 110)

export function parseEmails(emails: RawEmail[]): Order[] {
  const groups = new Map<string, { store: Store; orderId?: string; items: Item[] }>()
  for (const email of emails) {
    const store = detectStore(email.from, email.subject)
    if (store === 'Other') continue
    const status = detectStatus(email.subject, email.snippet, email.body)
    const text = `${email.subject} ${email.body}`
    const orderId = findOrderId(text)
    // Without an order number there must at least be a clear order event.
    if (!orderId && status === 'Unknown') continue
    if (!orderId && (PROMO.test(email.subject) || /\bgift card\b|\b(?:pay|wallet) balance\b/i.test(email.subject))) continue
    if (!isKnownStore(store) && !orderId && !ORDER_WORDS.test(email.subject)) continue
    const product = findProduct(email.subject, email.snippet, email.body)
    const amount = findAmount(text)
    const lines = store === 'Myntra' && email.html ? parseMyntraItems(email.html) : []
    const isReturn = status === 'Return/refund'
    const stage = isReturn ? detectStage(email.subject, email.snippet, email.body) : undefined
    const refund = isReturn ? findRefundAmount(`${email.snippet} ${email.body}`) : undefined
    // Without an order number, group by product so one order's emails still land together.
    const key = orderId
      ? `${store}:${orderId}`
      : `${store}:~${product ? product.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40) : email.id}`
    const group = groups.get(key) || { store, orderId, items: [] }
    group.items.push({ email, date: parseDate(email.date), status, product, extra: moreItems(email.subject), amount, stage, refund, lines })
    groups.set(key, group)
  }

  const orders: Order[] = []
  for (const [key, { store, orderId, items }] of groups) {
    items.sort((a, b) => a.date.localeCompare(b.date))
    const events: OrderEvent[] = items.map(i => ({
      emailId: i.email.id, date: i.date, status: i.status, stage: i.stage, subject: i.email.subject || '(no subject)', snippet: i.email.snippet
    }))
    const first = items[0]
    const latest = items[items.length - 1]
    const status = currentStatus(events)

    // Prefer a complete name over one that a subject line cut short, then the longer of two.
    const names = items.map(i => i.product).filter((p): p is string => !!p)
    const best = names.reduce<string | undefined>((b, n) =>
      !b || (isTruncated(b) && !isTruncated(n)) || (isTruncated(b) === isTruncated(n) && n.length > b.length) ? n : b, undefined)
    // Line items: the email that lists the most of them (normally the order confirmation) wins.
    const lines = items.reduce<OrderItem[]>((b, i) => i.lines.length > b.length ? i.lines : b, [])
    const extra = Math.max(...items.map(i => i.extra), lines.length > 1 ? lines.length - 1 : 0)
    const head = lines.length ? itemTitle(lines[0]) : best
    const product = head
      ? (extra ? `${head} + ${extra} more` : head)
      : status === 'Return/refund' ? `${store} refund`
      : orderId ? `${store} order · ${orderId.slice(-7)}` : `${store} order`

    // Refund and cancellation emails quote the refunded sum, not what the order cost.
    const priced = items.filter(i => i.amount && i.status !== 'Return/refund' && i.status !== 'Cancelled')
    const labeled = priced.find(i => i.amount!.labeled)?.amount?.value
    const lineSum = lines.reduce((s, l) => s + (l.price ?? 0), 0)
    const amount = labeled ?? (lineSum > 0 ? lineSum : priced[0]?.amount?.value)

    // Furthest return/refund stage any email reports, and the amount the latest refund email quotes.
    const stages = items.map(i => i.stage).filter((s): s is RefundStage => !!s)
    const returnStage = stages.reduce<RefundStage | undefined>((b, s) => !b || REFUND_STAGES.indexOf(s) > REFUND_STAGES.indexOf(b) ? s : b, undefined)
    const refundAmount = [...items].reverse().find(i => i.refund)?.refund

    // Purchase date is the "Ordered" email; if that one wasn't scanned, the earliest email is the best guess.
    const ordered = items.find(i => i.status === 'Ordered')
    orders.push({
      id: key,
      store,
      orderId: orderId || '',
      product,
      amount,
      currency: 'INR',
      orderDate: (ordered ?? first).date,
      purchaseEstimated: !ordered,
      status,
      subject: latest.email.subject || '(no subject)',
      sender: latest.email.from,
      emailDate: latest.date,
      gmailMessageId: latest.email.id,
      snippet: latest.email.snippet,
      sourceCount: items.length,
      events,
      items: lines.length ? lines : undefined,
      returnStage,
      refundAmount,
      parserVersion: PARSER_VERSION
    })
  }
  return orders
}

const GENERIC_TITLE_END = /\b(?:order(?: · \S+)?|refund)$/
/**
 * Combines a freshly parsed order with the copy already saved, so a sync over a short date range
 * (which only sees the newest emails) adds to an order's history instead of replacing it.
 */
export function mergeOrder(old: Order, fresh: Order): Order {
  const byId = new Map<string, OrderEvent>()
  for (const e of old.events ?? []) byId.set(e.emailId, e)
  for (const e of fresh.events ?? []) byId.set(e.emailId, e)
  const events = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date))
  if (!events.length) return fresh
  const ordered = events.find(e => e.status === 'Ordered')
  const stages = events.map(e => e.stage).filter((s): s is RefundStage => !!s)
  const latest = events[events.length - 1]
  return {
    ...fresh,
    product: GENERIC_TITLE_END.test(fresh.product) && !GENERIC_TITLE_END.test(old.product) ? old.product : fresh.product,
    amount: fresh.amount ?? old.amount,
    items: fresh.items ?? old.items,
    refundAmount: fresh.refundAmount ?? old.refundAmount,
    returnStage: stages.reduce<RefundStage | undefined>((b, s) => !b || REFUND_STAGES.indexOf(s) > REFUND_STAGES.indexOf(b) ? s : b, undefined),
    events,
    status: currentStatus(events),
    orderDate: (ordered ?? events[0]).date,
    purchaseEstimated: !ordered,
    emailDate: latest.date,
    gmailMessageId: latest.emailId,
    subject: latest.subject,
    snippet: latest.snippet,
    sender: fresh.emailDate >= old.emailDate ? fresh.sender : old.sender,
    sourceCount: events.length
  }
}
