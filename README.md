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

The full lead-discovery/outreach product lives in `gojocodes-all/mahoraga`.
