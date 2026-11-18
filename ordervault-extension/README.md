# OrderVault Tracker (browser extension)

Reads the order and tracking pages of **Amazon India, Flipkart and Myntra** while you are signed in and
browsing them, and keeps the live delivery status on your device. Separate project from the OrderVault app.

## Install (Chrome or Edge)

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose this `ordervault-extension` folder.
4. Pin the extension. Click it, then press **Amazon orders**, **Flipkart orders** or **Myntra orders**.
   Stay signed in as normal: the extension never sees your password.

Each button opens that shop's orders page in a tab, reads it, saves it and **closes the tab again**:

- **Myntra** reads every page of the list (`?p=1`, `?p=2`, ...) using up to three background tabs at once.
- **Flipkart** scrolls to the end of the list and presses **Show More Orders** until none are left. It runs in a visible
  tab, because Chrome pauses scrolling in tabs you cannot see.
- **Amazon** reads "past 3 months" and then every year the page offers (`timeFilter=year-2026`, `year-2025`, ...), page after
  page within each, with up to three tabs working on different years at once.
- If a shop shows a sign-in page instead, that one tab stays open and comes to the front so you can sign in; press the button again.

You can also open an orders page (or a "Track package" page) yourself and wait a couple of seconds, or press
**Read this page now**. The orders appear in the popup. The badge on the icon is the number of orders still on the way.

## What it does and does not do

- Runs only when you press a shop button, or when you open a shop's orders page yourself. It does not log in, submit forms or enter anything.
  The one thing it presses on a page is Flipkart's **Show More Orders** button, and only while you have asked it to read Flipkart.
- Stores everything in `chrome.storage.local` on this device. It makes no network requests of its own and has no server.
- Permissions: `storage` (save orders), `scripting` (to read the page in the tab it opened), `alarms` + `notifications` (one reminder a day when orders are still on the way and have not been refreshed), and access to the three shops' sites only.
- **It only refreshes when you press a button or open a shop page.** There is no background polling, so "live" means as live as the last time you looked.
- Status is whatever the shop's page says. Amazon's own courier has no public tracking, so nothing is looked up from anywhere else.

## Getting orders into the OrderVault app

Popup -> **Download for OrderVault**, then in the app choose **Import** and pick the file.
Imported orders are marked "added by hand", so a Gmail sync never deletes them, and have their own ids (`ext:...`),
so they do not overwrite Gmail-derived orders. The same purchase can therefore appear twice (once from Gmail, once from here).

## When a page is not recognised

Shops change their pages. If an orders page is read but nothing is found, the popup shows
**"A page was not recognised"** with an outline of the page's structure (tags and class names only, none of your text).
Send that outline to update the reader for that page.

## Tests

```
npm install
npm test
```

The tests run the readers against **synthetic** pages in `tests/fixtures/` that imitate each shop's layout.
They are not captures of real accounts, so passing them shows the logic works, not that the live sites match.

## Layout

```
lib/common.js    text, dates, status wording, finding order cards
lib/amazon.js    Amazon India readers (orders list, order details, package tracking)
lib/flipkart.js  Flipkart readers (orders list, order details)
lib/myntra.js    Myntra readers (orders list, order details)
lib/merge.js     adds new readings to saved orders without losing history
content/reader.js  runs on the shop pages
background.js    saves orders, badge, daily reminder
popup/           the popup window
```

## Terms of use

Reading your own orders from pages you opened yourself is not scraping at scale, but the shops' terms still apply to
automated tools. Use it for your own account, and do not point it at other people's.
