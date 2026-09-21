import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';

const testConfig = {
  startUrls: ['https://example.com'],
  label: 'smoke test',
  maxPages: 1,
  maxDepth: 0,
  concurrency: 1,
  delaySecs: 1,
  followLinks: false,
};

let app;
let server;
let baseUrl;

before(async () => {
  app = createApp({
    configNormalizer: async () => testConfig,
    idFactory: () => 'test-crawl-id',
    crawler: async (_config, hooks) => {
      const page = {
        url: 'https://example.com',
        statusCode: 200,
        title: 'Example',
        records: [],
      };
      hooks.onController?.({ stop: async () => {} });
      await hooks.onPage?.({ page, leads: [] });
      return { config: testConfig, pages: [page], leads: [], errors: [], stopped: false };
    },
  });

  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  app.locals.dispose();
  server.closeAllConnections?.();
  await new Promise((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
});

test('health endpoint exposes service status without framework metadata', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.has('x-powered-by'), false);
  assert.equal(body.ok, true);
  assert.equal(body.name, 'Mahoraga Crawl');
});

test('crawl lifecycle can be exercised without a real network crawl', async () => {
  const createResponse = await fetch(`${baseUrl}/api/crawls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ startUrls: ['https://example.com'] }),
  });
  const created = await createResponse.json();

  assert.equal(createResponse.status, 202);
  assert.equal(created.id, 'test-crawl-id');
  assert.equal(created.status, 'running');

  await new Promise(resolve => setImmediate(resolve));
  const statusResponse = await fetch(`${baseUrl}/api/crawls/test-crawl-id`);
  const completed = await statusResponse.json();

  assert.equal(statusResponse.status, 200);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.stats.pages, 1);
});

test('unknown crawl IDs return a stable JSON error', async () => {
  const response = await fetch(`${baseUrl}/api/crawls/missing`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.deepEqual(body, { error: 'Crawl not found or expired.' });
});
