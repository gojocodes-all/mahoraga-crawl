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
    try {
      const config = await configNormalizer(req.body || {});
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
      };

      jobs.set(id, job);

      void Promise.resolve()
        .then(() =>
          crawler(config, {
            onController: controller => {
              job.controller = controller;
              if (job.stopRequested) {
                void Promise.resolve(controller.stop?.()).catch(error => {
                  job.status = 'failed';
                  const message = String(error?.message || error || 'Unknown error').slice(
                    0,
                    400,
                  );
                  job.errors.push(`Could not stop crawl: ${message}`);
                  job.updatedAt = new Date().toISOString();
                });
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
          job.status = result.stopped ? 'stopped' : 'completed';
          job.leads = result.leads;
          job.pages = result.pages;
          job.errors = result.errors;
          job.updatedAt = new Date().toISOString();
        })
        .catch(error => {
          job.status = 'failed';
          job.errors.push(error.message);
          job.updatedAt = new Date().toISOString();
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

    job.stopRequested = true;
    job.status = 'stopping';
    job.updatedAt = new Date().toISOString();
    await job.controller?.stop?.();
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

  app.locals.dispose = () => clearInterval(cleanupTimer);
  return app;
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
