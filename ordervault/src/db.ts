import type { Order, UserData } from './types'
const DB_NAME = 'ordervault-local'
const ORDERS = 'orders'
const USER = 'user'
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // v2 adds the 'user' store (notes, corrections, warranty); the orders store is untouched.
    const req = indexedDB.open(DB_NAME, 2)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(ORDERS)) db.createObjectStore(ORDERS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(USER)) db.createObjectStore(USER, { keyPath: 'id' })
    }
    req.onsuccess = () => {
      // Let a newer tab upgrade the database instead of being blocked by this one.
      req.result.onversionchange = () => req.result.close()
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
  })
}
async function getAll<T>(store: string): Promise<T[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll()
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
  })
}
async function putAll<T>(store: string, items: T[]) {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    const os = tx.objectStore(store)
    items.forEach(item => os.put(item))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
async function removeOne(store: string, id: string) {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getOrders(): Promise<Order[]> {
  return (await getAll<Order>(ORDERS)).sort((a, b) => b.emailDate.localeCompare(a.emailDate))
}
export const putOrders = (items: Order[]) => putAll(ORDERS, items)
export const deleteOrder = (id: string) => removeOne(ORDERS, id)

export const getUserData = () => getAll<UserData>(USER)
export const putUser = (u: UserData) => putAll(USER, [u])
export const putUsers = (items: UserData[]) => putAll(USER, items)
export const deleteUser = (id: string) => removeOne(USER, id)

// Records built by an older parser were grouped and titled differently, so they would sit next to
// the regrouped ones as duplicates. Drop them before saving a fresh sync. Hand-added orders stay.
export async function deleteStaleOrders(currentVersion: number) {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ORDERS, 'readwrite')
    const req = tx.objectStore(ORDERS).openCursor()
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) return
      const o = cursor.value as Order
      if (!o.manual && o.parserVersion !== currentVersion) cursor.delete()
      cursor.continue()
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
/** Deletes every order together with the notes, corrections and warranties attached to them. */
export async function clearOrders() {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([ORDERS, USER], 'readwrite')
    tx.objectStore(ORDERS).clear()
    tx.objectStore(USER).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
