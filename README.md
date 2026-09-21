# Mahoraga Crawl

Reusable Crawlee-powered business crawler by GOJO.DEV.

## What it does
- Crawls public HTTP/HTTPS sites with Crawlee 3.17 CheerioCrawler.
- Respects robots.txt.
- Keeps recursive link following on the same hostname.
- Blocks localhost/private-network targets.
- Extracts JSON-LD organisations/local businesses plus page fallback data.
- Finds phone numbers, emails, addresses, categories and social links.
- Exports JSON/CSV.
- Exposes `crawlSites()` as a package API for the full Mahoraga app.

## Run

```bash
npm install
npm start
```

## Library
```js
import { crawlSites } from '@gojodev/mahoraga-crawl';
const result = await crawlSites({ startUrls:['https://example.com'], maxPages:20 });
```

## Development

The HTTP application is created in `src/app.js`; `src/server.js` only starts and
stops the process. This boundary allows API routes to be tested without launching
a real crawl or binding to the production port.

```bash
npm run check
npm test
```

The full lead-discovery/outreach product lives in `gojocodes-all/mahoraga`.
