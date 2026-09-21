# Maintenance log

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
