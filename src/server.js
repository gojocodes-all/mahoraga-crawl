import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const app = createApp();
const server = app.listen(port, () => {
  console.log(`Mahoraga Crawl listening on :${port}`);
});
let isShuttingDown = false;

function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`${signal} received; closing Mahoraga Crawl.`);
  app.locals.dispose();
  server.close(error => {
    if (error) {
      console.error('Could not close the HTTP server cleanly.', error);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
