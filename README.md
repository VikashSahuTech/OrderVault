# OrderVault

Track your online orders in one place, on your own device. Nothing is sent to a server.

This repository holds two parts that work together:

| Folder | What it is |
| --- | --- |
| [`ordervault/`](ordervault/) | The web app (React, TypeScript, Vite). Reads order emails from your Gmail (read-only) and keeps them in your browser. |
| [`ordervault-extension/`](ordervault-extension/) | A Chrome / Edge extension. Reads your Amazon, Flipkart and Myntra order pages while you are signed in, and keeps live delivery status on your device. |

The extension can export a file that the web app imports ("Download for OrderVault" in the extension, then Import in the app).

## Privacy

- Both parts keep everything on your device. There is no server.
- Neither part ever sees your shop passwords: the extension reads pages you are already signed in to.
- The test data in this repository is invented. It is not taken from a real account.

## Getting started

Each folder has its own README with setup steps:

- Web app: [`ordervault/README.md`](ordervault/README.md)
- Extension: [`ordervault-extension/README.md`](ordervault-extension/README.md)

## Licence

MIT, see [`ordervault/LICENSE`](ordervault/LICENSE).
