# Mahoraga Crawl

Mahoraga Crawl is a reusable Node.js crawler for extracting business and contact
information from public websites. It can run as a small web application with an
HTTP API or be imported as the crawler engine used by
[`gojocodes-all/mahoraga`](https://github.com/gojocodes-all/mahoraga).

The crawler uses Crawlee's `CheerioCrawler`, so it processes server-rendered HTML;
it does not launch a browser or execute client-side JavaScript.

## Capabilities and boundaries

- Crawls public HTTP and HTTPS URLs while respecting `robots.txt`.
- Follows links only on the hostname of each supplied start URL.
- Blocks localhost, private-network, link-local, carrier-grade NAT, and local DNS
  targets before requests are made.
- Extracts business-like JSON-LD records and falls back to page metadata and
  visible contact information.
- Collects names, categories, addresses, phone numbers, email addresses,
  websites, descriptions, and supported social links.
- Deduplicates records and exports the current lead set as JSON or CSV.
- Keeps crawl jobs in process memory; it does not include a database, user
  accounts, or durable job storage.

Use the crawler only on sites you are permitted to access. Its technical limits
do not replace a site's terms, privacy requirements, or applicable law.

## Requirements

- Node.js 20 or newer
- npm
- Network and DNS access to the public sites being crawled

## Run the web application

```bash
git clone https://github.com/gojocodes-all/mahoraga-crawl.git
cd mahoraga-crawl
npm install
npm start
```

Open `http://localhost:3000`. Set `PORT` to use another port:

```bash
PORT=8080 npm start
```

The form starts a crawl, polls its progress, lets the user request a stop, and
exposes JSON and CSV downloads. Jobs are stored only in the running Node.js
process. Finished, failed, or stopped jobs are removed after about one hour, and
all jobs disappear when the process restarts.

## Library API

The package exports `crawlSites`, `extractBusinessRecords`, `assertPublicUrl`,
`normalizeConfig`, and `toCsv` from `src/index.js`.

```js
import { crawlSites } from '@gojodev/mahoraga-crawl';

const result = await crawlSites(
  {
    startUrls: ['https://example.com'],
    label: 'Example crawl',
    maxPages: 20,
    maxDepth: 1,
    concurrency: 2,
    delaySecs: 1,
    followLinks: true,
  },
  {
    onPage: ({ page, leads }) => {
      console.log(page.url, leads.length);
    },
    onError: message => console.error(message),
  },
);

console.log(result.pages, result.leads, result.errors, result.stopped);
```

### Crawl options

| Option | Type | Default | Accepted values |
| --- | --- | --- | --- |
| `startUrls` | string array or comma/newline-separated string | required | 1–8 unique public HTTP(S) URLs |
| `label` | string | `""` | up to 120 characters |
| `maxPages` | integer | `30` | 1–150 |
| `maxDepth` | integer | `1` | 0–4 |
| `concurrency` | integer | `2` | 1–6 |
| `delaySecs` | number | `1` | 0.5–12 seconds per hostname |
| `followLinks` | boolean | `true` | set to `false` to crawl only start URLs |

Numeric values outside these ranges are clamped. Invalid or blocked start URLs
reject configuration with a status-bearing error.

`crawlSites()` accepts optional `onPage`, `onError`, and `onController` hooks.
The controller exposes an asynchronous `stop()` method. The result contains the
normalized `config`, visited `pages`, deduplicated `leads`, crawl `errors`, and a
`stopped` boolean.

## HTTP API

Every endpoint is served by the same process as the web interface.

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | Return service name, version, and crawler engine details. |
| `POST /api/crawls` | Validate options, create an asynchronous job, and return HTTP 202 with its current state. |
| `GET /api/crawls/:id` | Return the latest job status, counters, recent leads, and recent errors. |
| `POST /api/crawls/:id/stop` | Request that a running job stop. Calling it for a completed job is safe. |
| `GET /api/crawls/:id/export.json` | Download all leads currently held for the job. |
| `GET /api/crawls/:id/export.csv` | Download all leads currently held for the job. |

Start a crawl:

```bash
curl --request POST http://localhost:3000/api/crawls \
  --header 'content-type: application/json' \
  --data '{"startUrls":["https://example.com"],"maxPages":10,"maxDepth":1}'
```

The create response includes an `id`. Poll `/api/crawls/:id` until `status` is
`completed`, `failed`, or `stopped`. Status responses expose at most the 300 most
recent leads and 20 most recent errors; export endpoints use the full in-memory
lead set.

The service is designed for controlled use. It does not provide authentication
or rate limiting, so do not expose it directly to untrusted public traffic
without an authenticated gateway and deployment-level request controls.

## Lead shape

Depending on the source page, a lead may contain:

- `title`, `categoryName`, and `description`
- `address`, `city`, `state`, and `countryCode`
- `phone`, digits-only `phoneUnformatted`, `email`, and `emails`
- `website`, source `url`, `pageTitle`, and `socialLinks`
- `crawlMeta` with the response status, crawl time, and extraction source

Fields that cannot be found are left empty rather than inferred from fabricated
data. JSON-LD records identify their source as `json-ld`; fallback records use
`page`.

## Project structure

```text
public/                 Browser interface and styles
src/index.js            Crawl configuration, extraction, deduplication, exports
src/app.js              Express app, API routes, and in-memory job lifecycle
src/server.js           Port binding and graceful process shutdown
test/app.test.js        HTTP lifecycle regression tests with a stub crawler
.github/maintenance-log.md
                        Maintenance decisions and validation history
```

## Development

Install dependencies, then run the syntax and test suites:

```bash
npm install
npm run check
npm test
```

The HTTP tests do not crawl external sites. They create the Express application
with injected test doubles and bind it to an ephemeral loopback port.

When contributing:

1. Keep public package exports and API response shapes backward-compatible, or
   document and test an intentional breaking change.
2. Add focused tests for route, job-state, or validation changes.
3. Preserve the public-network checks, same-host policy, robots handling, and
   security headers.
4. Run both validation commands and review the complete diff before opening a
   pull request.
