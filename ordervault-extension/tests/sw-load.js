/* Loads background.js the way Chrome's service worker does, with a fake chrome, to catch start-up errors. */
const fs = require('fs'), path = require('path'), vm = require('vm')
const root = path.join(__dirname, '..')
const listeners = {}
const mk = () => ({ addListener: (fn) => { mk.last = fn } })
const chrome = {
  storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
  runtime: { onMessage: mk(), onInstalled: mk(), onStartup: mk() },
  alarms: { create() {}, onAlarm: mk() },
  notifications: { create() {} },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  tabs: { onUpdated: mk(), get: async () => ({}), update: async () => {}, create: async () => ({ id: 1 }) },
  scripting: { executeScript: async () => [] }
}
const ctx = { chrome, console, setTimeout, clearTimeout, URL, Promise, JSON, Date, Math }
ctx.self = ctx
ctx.importScripts = (...fs_) => { for (const f of fs_) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }) }
vm.createContext(ctx)
try {
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), ctx, { filename: 'background.js' })
  console.log('PASS service worker starts without errors; crawl api:', typeof ctx.OV.crawl)
} catch (e) { console.log('FAIL service worker start-up:', e && e.stack || e); process.exit(1) }
