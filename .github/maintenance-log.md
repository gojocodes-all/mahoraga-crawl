# Maintenance log

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
