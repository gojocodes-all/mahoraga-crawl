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
  await app.locals.dispose();
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

test('stopping a completed crawl preserves its terminal status', async () => {
  const response = await fetch(`${baseUrl}/api/crawls/test-crawl-id/stop`, {
    method: 'POST',
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'completed');
});

test('an early stop request is forwarded when the controller becomes available', async () => {
  let finishCrawl;
  let exposeController;
  const crawlResult = new Promise(resolve => {
    finishCrawl = resolve;
  });
  const controllerGate = new Promise(resolve => {
    exposeController = resolve;
  });
  const stoppableApp = createApp({
    configNormalizer: async () => testConfig,
    idFactory: () => 'stoppable-crawl-id',
    crawler: async (_config, hooks) => {
      await controllerGate;
      hooks.onController?.({
        stop: async () => {
          finishCrawl({
            config: testConfig,
            pages: [],
            leads: [],
            errors: [],
            stopped: true,
          });
        },
      });
      return crawlResult;
    },
  });
  const stoppableServer = stoppableApp.listen(0, '127.0.0.1');

  try {
    await once(stoppableServer, 'listening');
    const address = stoppableServer.address();
    const stoppableBaseUrl = `http://127.0.0.1:${address.port}`;

    await fetch(`${stoppableBaseUrl}/api/crawls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startUrls: ['https://example.com'] }),
    });
    const stopResponse = await fetch(
      `${stoppableBaseUrl}/api/crawls/stoppable-crawl-id/stop`,
      { method: 'POST' },
    );
    const stopping = await stopResponse.json();

    assert.equal(stopResponse.status, 200);
    assert.equal(stopping.status, 'stopping');

    exposeController();
    await new Promise(resolve => setImmediate(resolve));
    const statusResponse = await fetch(
      `${stoppableBaseUrl}/api/crawls/stoppable-crawl-id`,
    );
    const stopped = await statusResponse.json();

    assert.equal(stopped.status, 'stopped');
  } finally {
    finishCrawl({
      config: testConfig,
      pages: [],
      leads: [],
      errors: [],
      stopped: true,
    });
    await stoppableApp.locals.dispose();
    stoppableServer.closeAllConnections?.();
    await new Promise((resolve, reject) => {
      stoppableServer.close(error => (error ? reject(error) : resolve()));
    });
  }
});

test('application disposal stops active crawls and waits for them to settle', async () => {
  let exposeController;
  let finishCrawl;
  let stopCalls = 0;
  const controllerGate = new Promise(resolve => {
    exposeController = resolve;
  });
  const crawlResult = new Promise(resolve => {
    finishCrawl = resolve;
  });
  const disposableApp = createApp({
    configNormalizer: async () => testConfig,
    idFactory: () => 'shutdown-crawl-id',
    crawler: async (_config, hooks) => {
      await controllerGate;
      hooks.onController?.({
        stop: async () => {
          stopCalls += 1;
          finishCrawl({
            config: testConfig,
            pages: [],
            leads: [],
            errors: [],
            stopped: true,
          });
        },
      });
      return crawlResult;
    },
  });
  const disposableServer = disposableApp.listen(0, '127.0.0.1');

  try {
    await once(disposableServer, 'listening');
    const address = disposableServer.address();
    const disposableBaseUrl = `http://127.0.0.1:${address.port}`;

    await fetch(`${disposableBaseUrl}/api/crawls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startUrls: ['https://example.com'] }),
    });

    const firstDisposal = disposableApp.locals.dispose();
    const repeatedDisposal = disposableApp.locals.dispose();
    assert.equal(repeatedDisposal, firstDisposal);

    const lateCreateResponse = await fetch(`${disposableBaseUrl}/api/crawls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startUrls: ['https://example.com'] }),
    });
    assert.equal(lateCreateResponse.status, 503);
    assert.deepEqual(await lateCreateResponse.json(), {
      error: 'Service is shutting down.',
    });

    let disposalSettled = false;
    void firstDisposal.then(() => {
      disposalSettled = true;
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(disposalSettled, false);

    exposeController();
    await firstDisposal;

    assert.equal(stopCalls, 1);
    const statusResponse = await fetch(
      `${disposableBaseUrl}/api/crawls/shutdown-crawl-id`,
    );
    const stopped = await statusResponse.json();
    assert.equal(stopped.status, 'stopped');
  } finally {
    exposeController();
    finishCrawl({
      config: testConfig,
      pages: [],
      leads: [],
      errors: [],
      stopped: true,
    });
    await disposableApp.locals.dispose();
    disposableServer.closeAllConnections?.();
    await new Promise((resolve, reject) => {
      disposableServer.close(error => (error ? reject(error) : resolve()));
    });
  }
});

test('a stop-controller failure becomes a visible terminal job state', async () => {
  let finishCrawl;
  const crawlResult = new Promise(resolve => {
    finishCrawl = resolve;
  });
  const failingApp = createApp({
    configNormalizer: async () => testConfig,
    idFactory: () => 'stop-failure-id',
    crawler: async (_config, hooks) => {
      hooks.onController?.({
        stop: async () => {
          throw new Error('controller unavailable');
        },
      });
      return crawlResult;
    },
  });
  const failingServer = failingApp.listen(0, '127.0.0.1');

  try {
    await once(failingServer, 'listening');
    const address = failingServer.address();
    const failingBaseUrl = `http://127.0.0.1:${address.port}`;

    await fetch(`${failingBaseUrl}/api/crawls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startUrls: ['https://example.com'] }),
    });
    await new Promise(resolve => setImmediate(resolve));

    const stopResponse = await fetch(
      `${failingBaseUrl}/api/crawls/stop-failure-id/stop`,
      { method: 'POST' },
    );
    const failed = await stopResponse.json();

    assert.equal(stopResponse.status, 500);
    assert.equal(failed.status, 'failed');
    assert.deepEqual(failed.errors, [
      'Could not stop crawl: controller unavailable',
    ]);

    finishCrawl({
      config: testConfig,
      pages: [],
      leads: [],
      errors: [],
      stopped: true,
    });
    await new Promise(resolve => setImmediate(resolve));

    const statusResponse = await fetch(
      `${failingBaseUrl}/api/crawls/stop-failure-id`,
    );
    const stored = await statusResponse.json();

    assert.equal(stored.status, 'failed');
    assert.equal(stored.stats.errors, 1);
  } finally {
    finishCrawl({
      config: testConfig,
      pages: [],
      leads: [],
      errors: [],
      stopped: true,
    });
    await failingApp.locals.dispose();
    failingServer.closeAllConnections?.();
    await new Promise((resolve, reject) => {
      failingServer.close(error => (error ? reject(error) : resolve()));
    });
  }
});
