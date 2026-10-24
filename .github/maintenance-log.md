# Maintenance log

## 2026-10-24 — Keep directory businesses distinct

### Rationale

When a page contained multiple JSON-LD businesses, the extractor copied the
page-wide phone number and email address onto every record. Lead deduplication
prioritizes phone numbers, so otherwise distinct directory entries could
collapse into one lead. Page-level contacts now supplement structured data only
when the page describes one business; multi-business pages require each record
to provide its own contact details.

### Files changed

- `src/index.js` — limit page-contact fallback to single-business structured
  pages.
- `test/extraction.test.js` — reproduce the multi-business collapse and
  preserve the single-business fallback contract with local HTML fixtures.
- `package.json` — declare the Cheerio test fixture dependency and include the
  new test in syntax validation.
- `README.md` — document extraction regression coverage.
- `.github/maintenance-log.md` — record this maintenance work.

### Validation

- `npm run check`
- `npm test`
- `git diff --check`
- Reviewed the complete diff for extraction accuracy, backward compatibility,
  dependency scope, security, and repository conventions.

### Risk

Low. Single-business pages retain their page-level contact fallback. On pages
with multiple structured businesses, only explicitly associated phone numbers
and emails are attached, preventing unrelated directory contacts from merging
records. Crawl limits, network policy, API shapes, and exports are unchanged.

### Rollback

Revert this pull request's squash commit to restore page-wide contact fallback
for every structured record.

## 2026-10-18 — Stop active crawls during application shutdown

### Rationale

The process signal handlers closed the HTTP server and cleanup timer, but the
application disposer did not request cancellation of running crawl jobs. Active
Crawlee work could therefore outlive shutdown initiation and delay a deployment
until the process was killed externally.

### Files changed

- `src/app.js` — centralize idempotent job-stop handling, reject new crawls once
  disposal begins, stop active jobs, and wait for their completion.
- `src/server.js` — await HTTP and application shutdown together, with a bounded
  10-second graceful-shutdown deadline.
- `test/app.test.js` — cover disposal before a crawler controller is available,
  repeated disposal, new-work rejection, and final stopped state.
- `README.md` — document the shutdown contract and lifecycle test coverage.
- `.github/maintenance-log.md` — record this maintenance work.

### Validation

- `npm run check`
- `npm test`
- `git diff --check`
- Reviewed the complete diff for API compatibility, shutdown races, error
  handling, security, dependencies, and repository conventions.

### Risk

Low. Normal crawl creation, polling, export, and explicit stop behavior retain
their existing response shapes. The new HTTP 503 response is limited to crawl
creation after application disposal has begun, when the process cannot safely
accept durable work.

### Rollback

Revert this pull request's squash commit to restore timer-only disposal and the
previous process shutdown behavior.

## 2026-10-12 — Preserve failure state when stopping a crawl

### Rationale

If a crawler controller rejected its stop request, the API left the job in the
non-terminal `stopping` state and Express returned its generic error response.
The job could never recover, and a later crawler result could overwrite the
failure, hiding the shutdown problem from API clients.

### Files changed

- `src/app.js` — centralize job failure recording, return a stable failed job
  response when stopping fails, and prevent a late crawler result from
  overwriting that failure.
- `test/app.test.js` — cover the rejected stop request, JSON response, stored
  error, and late-result race.
- `.github/maintenance-log.md` — record this maintenance work.

### Validation

- `npm run check`
- `npm test`
- `git diff --check`
- Reviewed the complete diff for API compatibility, lifecycle races, error
  disclosure, dependencies, and repository conventions.

### Risk

Low. Successful stops and requests for terminal jobs retain their existing
behavior. Only rejected controller stops now return HTTP 500 with the existing
public job shape and settle the job as `failed` instead of leaving it stuck.

### Rollback

Revert this pull request's squash commit to restore the previous stop-error
behavior.

## 2026-10-05 — Document the crawler's complete operating contract

### Rationale

The README named the crawler's main features but did not explain the web/API
workflow, accepted limits, returned data, memory-only job lifecycle, or safe
deployment boundary. A contributor or operator therefore had to reverse-engineer
the implementation before using the service responsibly.

### Files changed

- `README.md` — document requirements, web and package usage, exact crawl
  options, hooks, API routes, lead fields, job retention, project structure,
  security boundaries, validation, and contribution guidance.
- `.gitignore` — exclude local dependencies, environment files, npm debug logs,
  and operating-system metadata while allowing a future safe `.env.example`.
- `.github/maintenance-log.md` — record this maintenance work.

### Validation

- `npm install --ignore-scripts`
- `npm run check`
- `npm test`
- Verified every documented command, path, option range, route, response limit,
  and lifecycle claim against the implementation and tests.
- `git diff --check`
- Reviewed the complete diff for accuracy, security guidance, backward
  compatibility, repository conventions, and accidental behavioral changes.

### Risk

Low. The change adds documentation and local ignore rules only. Runtime code,
dependencies, package exports, API behavior, and tracked configuration are
unchanged.

### Rollback

Revert the pull request's squash commit to restore the previous README and
ignore-file state.

## 2026-09-29 — Preserve terminal crawl states during stop requests

### Rationale

The stop route accepted requests before the crawler had supplied its controller,
but then discarded the stop intent and allowed the crawl to continue. A late
stop request could also change an already completed job back to `stopping`.

### Files changed

- `src/app.js` — record stop intent before awaiting shutdown, forward an early
  request when the controller becomes available, and preserve terminal states.
- `test/app.test.js` — cover completed-job idempotency and early stop requests.
- `.github/maintenance-log.md` — record this maintenance work.

### Validation

- `npm run check`
- `npm test`
- `git diff --check`
- Reviewed the complete diff for API compatibility, cleanup behavior, error
  handling, security, and unintended dependency changes.

### Risk

Low. Successful stop requests keep the existing response shape. The change is
limited to job-state ordering and makes stop requests on terminal jobs
idempotent instead of regressing their status.

### Rollback

Revert the pull request's squash commit to restore the previous stop-state
ordering.

## 2026-09-21 — Testable HTTP application boundary

### Rationale

The Express routes, in-memory job lifecycle, cleanup timer, and process startup
were all defined in `src/server.js`. Importing the server therefore opened a
network port immediately, preventing isolated route tests and making future
embedding or controlled startup difficult.

### Files changed

- `src/app.js` — owns application construction, routes, job state, and cleanup,
  and exposes injected crawler/configuration boundaries for deterministic tests.
- `src/server.js` — reduced to process startup and graceful shutdown handling.
- `test/app.test.js` — adds built-in test-runner coverage for health, crawl
  lifecycle, and missing-job behavior with a stub crawler.
- `package.json` — adds the test command and includes the new files in syntax
  validation.
- `README.md` — documents the application boundary and contributor checks.
- `.github/maintenance-log.md` — records this maintenance work.

### Validation

- `npm run check`
- `npm test`
- Reviewed the final diff for route compatibility, cleanup behavior, accidental
  dependency changes, secrets, and process-lifecycle regressions.

### Risk

Low. Routes, response shapes, crawler configuration, dependencies, and public
package exports are unchanged. The server now delegates application creation to
an importable factory and closes its cleanup timer during graceful shutdown.

### Rollback

Revert the pull request's squash commit to restore the single-file server.
