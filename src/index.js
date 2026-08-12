import dns from 'node:dns/promises';
import net from 'node:net';
import { CheerioCrawler, EnqueueStrategy, log } from 'crawlee';

log.setLevel(log.LEVELS.WARNING);

export async function crawlSites(input = {}, hooks = {}) {
  const config = await normalizeConfig(input);
  const allowedHosts = new Set(config.startUrls.map(u => new URL(u).hostname.toLowerCase()));
  const seen = new Map();
  const pages = [];
  const errors = [];
  let stopRequested = false;

  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: config.maxPages,
    maxCrawlDepth: config.maxDepth,
    maxConcurrency: config.concurrency,
    minConcurrency: 1,
    sameDomainDelaySecs: config.delaySecs,
    requestHandlerTimeoutSecs: 30,
    navigationTimeoutSecs: 25,
    maxRequestRetries: 1,
    retryOnBlocked: false,
    respectRobotsTxtFile: true,
    preNavigationHooks: [async ({ request }) => {
      await assertPublicUrl(request.url);
      const host = new URL(request.url).hostname.toLowerCase();
      if (!allowedHosts.has(host)) throw new Error(`Cross-host navigation blocked: ${host}`);
    }],
    async requestHandler({ request, $, response, enqueueLinks }) {
      if (stopRequested) return;
      const url = request.loadedUrl || request.url;
      const records = extractBusinessRecords($, url, response?.statusCode || 200);
      const page = { url, statusCode: response?.statusCode || 200, title: clean($('title').first().text()), records };
      pages.push(page);
      for (const record of records) {
        const key = leadKey(record);
        seen.set(key, seen.has(key) ? mergeLead(seen.get(key), record) : record);
      }
      await hooks.onPage?.({ page, leads: [...seen.values()] });

      if (config.followLinks && !stopRequested) {
        await enqueueLinks({
          strategy: EnqueueStrategy.SameHostname,
          limit: Math.max(0, config.maxPages - pages.length),
          transformRequestFunction: req => {
            try {
              const u = new URL(req.url);
              if (!['http:', 'https:'].includes(u.protocol) || isProbablyAsset(u.pathname)) return false;
              return req;
            } catch { return false; }
          }
        });
      }
    },
    failedRequestHandler({ request, error }) {
      const message = `${request.url}: ${cleanError(error)}`;
      errors.push(message);
      hooks.onError?.(message);
    }
  });

  const controller = {
    stop: async () => {
      stopRequested = true;
      try { await crawler.stop('Stopped by caller'); } catch {}
    }
  };
  hooks.onController?.(controller);
  await crawler.run(config.startUrls);
  return { config, pages, leads: [...seen.values()], errors, stopped: stopRequested };
}

export function extractBusinessRecords($, url, statusCode = 200) {
  const pageTitle = clean($('title').first().text());
  const h1 = clean($('h1').first().text());
  const description = clean($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '');
  const siteName = clean($('meta[property="og:site_name"]').attr('content') || '');
  const bodyText = clean($('body').text()).slice(0, 140000);
  const jsonLd = collectJsonLd($);
  const orgs = jsonLd.filter(isBusinessishJsonLd);
  const phonesOnPage = unique([
    ...$('a[href^="tel:"]').map((_, el) => clean($(el).attr('href')?.replace(/^tel:/i, ''))).get(),
    ...extractPhones(bodyText)
  ]).slice(0, 12);
  const emailsOnPage = unique([
    ...$('a[href^="mailto:"]').map((_, el) => clean($(el).attr('href')?.replace(/^mailto:/i, '').split('?')[0])).get(),
    ...extractEmails(bodyText)
  ]).slice(0, 12);
  const socials = collectSocials($, url);
  const source = new URL(url);

  const fromJsonLd = orgs.map(obj => {
    const address = normalizeAddress(obj.address);
    const phones = unique([...(Array.isArray(obj.telephone) ? obj.telephone : [obj.telephone]), ...phonesOnPage].filter(Boolean).map(clean));
    const emails = unique([...(Array.isArray(obj.email) ? obj.email : [obj.email]), ...emailsOnPage].filter(Boolean).map(clean));
    const website = clean(obj.url || obj.sameAs?.find?.(v => isStandaloneUrl(v)) || source.origin);
    return {
      title: clean(obj.name || siteName || h1 || simplifyTitle(pageTitle) || source.hostname),
      categoryName: clean(jsonLdType(obj) || inferCategoryFromPage(pageTitle, h1, description)),
      address: address.full,
      city: address.city,
      state: address.state,
      countryCode: address.country,
      phone: phones[0] || '',
      phoneUnformatted: normalizePhone(phones[0] || ''),
      emails,
      email: emails[0] || '',
      website,
      url,
      description: clean(obj.description || description),
      pageTitle,
      socialLinks: unique([...socials, ...(Array.isArray(obj.sameAs) ? obj.sameAs.filter(isSocialUrl) : [])]),
      crawlMeta: { statusCode, crawledAt: new Date().toISOString(), source: 'json-ld' }
    };
  });

  if (fromJsonLd.length) return dedupeLeads(fromJsonLd);

  const fallback = {
    title: siteName || h1 || simplifyTitle(pageTitle) || source.hostname,
    categoryName: inferCategoryFromPage(pageTitle, h1, description),
    address: clean($('address').first().text() || $('[itemprop="address"]').first().text()),
    city: '', state: '', countryCode: '',
    phone: phonesOnPage[0] || '',
    phoneUnformatted: normalizePhone(phonesOnPage[0] || ''),
    emails: emailsOnPage,
    email: emailsOnPage[0] || '',
    website: source.origin,
    url,
    description,
    pageTitle,
    socialLinks: socials,
    crawlMeta: { statusCode, crawledAt: new Date().toISOString(), source: 'page' }
  };
  return [fallback];
}

export async function assertPublicUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw badRequest(`Invalid URL: ${value}`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw badRequest('Only http:// and https:// URLs are allowed.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw badRequest('Local/private targets are blocked.');
  if (net.isIP(host) && isPrivateIp(host)) throw badRequest('Local/private targets are blocked.');
  let addresses;
  try { addresses = await dns.lookup(host, { all: true }); } catch { throw badRequest(`Could not resolve ${host}.`); }
  if (!addresses.length || addresses.some(x => isPrivateIp(x.address))) throw badRequest('Local/private targets are blocked.');
  return url.href;
}

export async function normalizeConfig(body = {}) {
  const raw = Array.isArray(body.startUrls) ? body.startUrls : String(body.startUrls || '').split(/[\n,]+/);
  const startUrls = unique(raw.map(v => String(v).trim()).filter(Boolean)).slice(0, 8);
  if (!startUrls.length) throw badRequest('Enter at least one start URL.');
  for (const url of startUrls) await assertPublicUrl(url);
  return {
    startUrls,
    label: clean(body.label || '').slice(0, 120),
    maxPages: clampInt(body.maxPages, 1, 150, 30),
    maxDepth: clampInt(body.maxDepth, 0, 4, 1),
    concurrency: clampInt(body.concurrency, 1, 6, 2),
    delaySecs: clampNumber(body.delaySecs, 0.5, 12, 1),
    followLinks: body.followLinks !== false
  };
}

export function toCsv(rows) {
  if (!rows.length) return '';
  const headers = [...new Set(rows.flatMap(Object.keys))];
  return [headers.join(','), ...rows.map(r => headers.map(h => csvCell(r[h])).join(','))].join('\r\n');
}

function collectJsonLd($) {
  const out = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try { flattenJsonLd(JSON.parse($(el).text()), out); } catch {}
  });
  return out;
}
function flattenJsonLd(v, out) {
  if (!v) return;
  if (Array.isArray(v)) return v.forEach(x => flattenJsonLd(x, out));
  if (typeof v !== 'object') return;
  if (Array.isArray(v['@graph'])) v['@graph'].forEach(x => flattenJsonLd(x, out));
  if (v['@type'] || v.name || v.telephone || v.email || v.address) out.push(v);
}
function isBusinessishJsonLd(obj) {
  const type = jsonLdType(obj).toLowerCase();
  return /business|organization|organisation|school|college|university|restaurant|store|shop|clinic|hospital|hotel|lodging|professionalservice|realestate|localbusiness|corporation|ngo|church|dentist|pharmacy|salon|beauty/.test(type) || Boolean(obj.telephone || obj.address);
}
function jsonLdType(obj) { const t = obj?.['@type']; return Array.isArray(t) ? t.join(' | ') : clean(t || ''); }
function normalizeAddress(a) {
  if (!a) return { full:'', city:'', state:'', country:'' };
  if (typeof a === 'string') return { full: clean(a), city:'', state:'', country:'' };
  return {
    full: [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry].filter(Boolean).join(', '),
    city: clean(a.addressLocality || ''), state: clean(a.addressRegion || ''), country: clean(a.addressCountry || '')
  };
}
function collectSocials($, baseUrl) {
  return unique($('a[href]').map((_, el) => {
    try { const u = new URL($(el).attr('href'), baseUrl); return isSocialUrl(u.href) ? u.href.split('#')[0] : ''; } catch { return ''; }
  }).get().filter(Boolean)).slice(0, 12);
}
function extractEmails(text) { return unique((String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).filter(e => !/\.(png|jpe?g|gif|webp)$/i.test(e))); }
function extractPhones(text) {
  return unique((String(text).match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || []).map(clean).filter(v => { const d = v.replace(/\D/g, ''); return d.length >= 8 && d.length <= 15; }));
}
function isSocialUrl(v) { try { return /(^|\.)(facebook\.com|instagram\.com|linkedin\.com|tiktok\.com|youtube\.com|youtu\.be|x\.com|twitter\.com)$/i.test(new URL(v).hostname); } catch { return false; } }
function isStandaloneUrl(v) { try { const u = new URL(v); return ['http:','https:'].includes(u.protocol) && !isSocialUrl(v); } catch { return false; } }
function inferCategoryFromPage(...parts) {
  const t = parts.join(' ').toLowerCase();
  const rules = [['School / education',/school|academy|college|university|education|training/],['Real estate',/real estate|property|realtor|estate agent|housing/],['Healthcare',/clinic|hospital|medical|dental|pharmacy|health/],['Food & dining',/restaurant|cafe|bakery|catering|food/],['Beauty & grooming',/salon|barber|beauty|spa|hair/],['Retail',/store|shop|boutique|retail|supermarket/],['Hotel / hospitality',/hotel|resort|guest house|lodging/]];
  return rules.find(([,re]) => re.test(t))?.[0] || '';
}
function dedupeLeads(leads) { const m = new Map(); for (const l of leads) { const k = leadKey(l); m.set(k, m.has(k) ? mergeLead(m.get(k), l) : l); } return [...m.values()]; }
function leadKey(l) { const p = normalizePhone(l.phone); if (p) return `p:${p}`; if (l.email) return `e:${l.email.toLowerCase()}`; return `w:${clean(l.website)}:${clean(l.title).toLowerCase()}`; }
function mergeLead(a,b) { const r={...a}; for (const k of ['title','categoryName','address','city','state','countryCode','phone','phoneUnformatted','description','website']) if (clean(b[k]).length>clean(r[k]).length) r[k]=b[k]; r.emails=unique([...(a.emails||[]),...(b.emails||[])]); r.email=r.emails[0]||r.email||''; r.socialLinks=unique([...(a.socialLinks||[]),...(b.socialLinks||[])]); return r; }
function normalizePhone(v){ return String(v||'').replace(/\D/g,''); }
function simplifyTitle(v){ return clean(String(v||'').split(/[|–—]/)[0]); }
function isProbablyAsset(p){ return /\.(?:jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|rar|7z|mp3|mp4|avi|mov|css|js|xml|json|woff2?|ttf|eot)(?:$|\?)/i.test(p); }
function isPrivateIp(ip){ if (ip==='::1'||ip==='0:0:0:0:0:0:0:1'||ip.startsWith('fc')||ip.startsWith('fd')||ip.startsWith('fe80:')) return true; const mapped=ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1]; if(mapped) return isPrivateIp(mapped); if(!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false; const[a,b]=ip.split('.').map(Number); return a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19)); }
function unique(v){ return [...new Set(v.filter(Boolean).map(x=>typeof x==='string'?x.trim():x))]; }
function clean(v){ return String(v??'').replace(/\s+/g,' ').trim(); }
function cleanError(e){ return clean(e?.message||e||'Unknown error').slice(0,400); }
function clampInt(v,min,max,f){ const n=Number.parseInt(v,10); return Number.isFinite(n)?Math.max(min,Math.min(max,n)):f; }
function clampNumber(v,min,max,f){ const n=Number(v); return Number.isFinite(n)?Math.max(min,Math.min(max,n)):f; }
function badRequest(m){ const e=new Error(m); e.statusCode=400; return e; }
function csvCell(v){ const s=Array.isArray(v)?v.join(' | '):typeof v==='object'&&v?JSON.stringify(v):String(v??''); return /[",\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }
