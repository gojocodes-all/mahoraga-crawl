import { createApp } from './app.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;
const port = Number(process.env.PORT || 3000);
const app = createApp();
const server = app.listen(port, () => {
  console.log(`Mahoraga Crawl listening on :${port}`);
});
let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`${signal} received; closing Mahoraga Crawl.`);

  const forcedExit = setTimeout(() => {
    console.error('Graceful shutdown exceeded 10 seconds; forcing exit.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  const outcomes = await Promise.allSettled([
    app.locals.dispose(),
    closeHttpServer(server),
  ]);
  clearTimeout(forcedExit);

  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') {
      console.error('Could not shut down cleanly.', outcome.reason);
      process.exitCode = 1;
    }
  }
}

function closeHttpServer(httpServer) {
  return new Promise((resolve, reject) => {
    httpServer.close(error => (error ? reject(error) : resolve()));
  });
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
