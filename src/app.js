import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { crawlSites, normalizeConfig, toCsv } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_JOB_TTL_MS = 60 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const ACTIVE_JOB_STATUSES = new Set(['running', 'stopping']);

export function createApp({
  crawler = crawlSites,
  configNormalizer = normalizeConfig,
  idFactory = randomUUID,
  jobTtlMs = DEFAULT_JOB_TTL_MS,
  cleanupIntervalMs = DEFAULT_CLEANUP_INTERVAL_MS,
} = {}) {
  const app = express();
  const jobs = new Map();
  let isDisposing = false;
  let disposePromise;

  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: '64kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      name: 'Mahoraga Crawl',
      engine: 'Crawlee 3.17.0 / CheerioCrawler',
      version: '1.1.0',
    });
  });

  app.post('/api/crawls', async (req, res) => {
    if (isDisposing) {
      return res.status(503).json({ error: 'Service is shutting down.' });
    }

    try {
      const config = await configNormalizer(req.body || {});
      if (isDisposing) {
        return res.status(503).json({ error: 'Service is shutting down.' });
      }

      const id = idFactory();
      const timestamp = new Date().toISOString();
      const job = {
        id,
        status: 'running',
        createdAt: timestamp,
        updatedAt: timestamp,
        config,
        leads: [],
        pages: [],
        errors: [],
        controller: null,
        stopRequested: false,
        stopPromise: null,
        completion: null,
      };

      jobs.set(id, job);

      job.completion = Promise.resolve()
        .then(() =>
          crawler(config, {
            onController: controller => {
              job.controller = controller;
              if (job.stopRequested) {
                void stopJobController(job).catch(() => {});
              }
            },
            onPage: ({ page, leads }) => {
              job.pages.push(page);
              job.leads = leads;
              job.updatedAt = new Date().toISOString();
            },
            onError: error => {
              job.errors.push(error);
              job.updatedAt = new Date().toISOString();
            },
          }),
        )
        .then(result => {
          if (job.status === 'failed') return;
          job.status = result.stopped ? 'stopped' : 'completed';
          job.leads = result.leads;
          job.pages = result.pages;
          job.errors = result.errors;
          job.updatedAt = new Date().toISOString();
        })
        .catch(error => {
          if (job.status === 'failed') return;
          markJobFailed(job, cleanError(error));
        });

      res.status(202).json(publicJob(job));
    } catch (error) {
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  });

  app.get('/api/crawls/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Crawl not found or expired.' });
    return res.json(publicJob(job));
  });

  app.post('/api/crawls/:id/stop', async (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Crawl not found or expired.' });
    if (!ACTIVE_JOB_STATUSES.has(job.status)) return res.json(publicJob(job));

    try {
      await requestJobStop(job);
    } catch {
      return res.status(500).json(publicJob(job));
    }
    return res.json(publicJob(job));
  });

  app.get('/api/crawls/:id/export.json', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).end();

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="mahoraga-crawl-${job.id.slice(0, 8)}.json"`,
    );
    return res.json(job.leads);
  });

  app.get('/api/crawls/:id/export.csv', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).end();

    res.type('text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="mahoraga-crawl-${job.id.slice(0, 8)}.csv"`,
    );
    return res.send(toCsv(job.leads));
  });

  const cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - jobTtlMs;
    for (const [id, job] of jobs) {
      const updatedAt = new Date(job.updatedAt).getTime();
      if (updatedAt < cutoff && !ACTIVE_JOB_STATUSES.has(job.status)) jobs.delete(id);
    }
  }, cleanupIntervalMs);
  cleanupTimer.unref();

  app.locals.dispose = () => {
    if (disposePromise) return disposePromise;

    isDisposing = true;
    clearInterval(cleanupTimer);
    const activeJobs = [...jobs.values()].filter(job =>
      ACTIVE_JOB_STATUSES.has(job.status),
    );

    disposePromise = Promise.allSettled(
      activeJobs.map(async job => {
        await requestJobStop(job).catch(() => {});
        await job.completion;
      }),
    ).then(() => undefined);

    return disposePromise;
  };
  return app;
}

async function requestJobStop(job) {
  if (!ACTIVE_JOB_STATUSES.has(job.status)) return;

  job.stopRequested = true;
  job.status = 'stopping';
  job.updatedAt = new Date().toISOString();
  await stopJobController(job);
}

function stopJobController(job) {
  if (!job.controller?.stop) return Promise.resolve();
  if (job.stopPromise) return job.stopPromise;

  job.stopPromise = Promise.resolve()
    .then(() => job.controller.stop())
    .catch(error => {
      markJobFailed(job, `Could not stop crawl: ${cleanError(error)}`);
      throw error;
    });
  return job.stopPromise;
}

function markJobFailed(job, message) {
  job.status = 'failed';
  job.errors.push(message);
  job.updatedAt = new Date().toISOString();
}

function cleanError(error) {
  return String(error?.message || error || 'Unknown error').slice(0, 400);
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    config: job.config,
    stats: {
      pages: job.pages.length,
      leads: job.leads.length,
      errors: job.errors.length,
    },
    leads: job.leads.slice(-300),
    errors: job.errors.slice(-20),
  };
}
