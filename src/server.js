import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crawlSites, normalizeConfig, toCsv } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const jobs = new Map();

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc:["'self'"], styleSrc:["'self'"], scriptSrc:["'self'"], imgSrc:["'self'",'data:'], connectSrc:["'self'"], objectSrc:["'none'"], frameAncestors:["'none'"] } }, crossOriginEmbedderPolicy:false }));
app.use(express.json({ limit:'64kb' }));
app.use(express.static(path.join(__dirname,'..','public'), { extensions:['html'] }));

app.get('/api/health', (_req,res)=>res.json({ok:true,name:'Mahoraga Crawl',engine:'Crawlee 3.17.0 / CheerioCrawler',version:'1.1.0'}));
app.post('/api/crawls', async (req,res)=>{
  try {
    const config = await normalizeConfig(req.body || {});
    const id = crypto.randomUUID();
    const job = { id,status:'running',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),config,leads:[],pages:[],errors:[],controller:null };
    jobs.set(id,job);
    crawlSites(config, {
      onController:c=>job.controller=c,
      onPage:({page,leads})=>{ job.pages.push(page); job.leads=leads; job.updatedAt=new Date().toISOString(); },
      onError:e=>{ job.errors.push(e); job.updatedAt=new Date().toISOString(); }
    }).then(result=>{ job.status=result.stopped?'stopped':'completed'; job.leads=result.leads; job.pages=result.pages; job.errors=result.errors; job.updatedAt=new Date().toISOString(); }).catch(err=>{ job.status='failed'; job.errors.push(err.message); job.updatedAt=new Date().toISOString(); });
    res.status(202).json(publicJob(job));
  } catch(err) { res.status(err.statusCode||400).json({error:err.message}); }
});
app.get('/api/crawls/:id',(req,res)=>{const j=jobs.get(req.params.id); if(!j)return res.status(404).json({error:'Crawl not found or expired.'}); res.json(publicJob(j));});
app.post('/api/crawls/:id/stop',async(req,res)=>{const j=jobs.get(req.params.id);if(!j)return res.status(404).json({error:'Crawl not found or expired.'});await j.controller?.stop?.();j.status='stopping';res.json(publicJob(j));});
app.get('/api/crawls/:id/export.json',(req,res)=>{const j=jobs.get(req.params.id);if(!j)return res.status(404).end();res.setHeader('Content-Disposition',`attachment; filename="mahoraga-crawl-${j.id.slice(0,8)}.json"`);res.json(j.leads);});
app.get('/api/crawls/:id/export.csv',(req,res)=>{const j=jobs.get(req.params.id);if(!j)return res.status(404).end();res.type('text/csv');res.setHeader('Content-Disposition',`attachment; filename="mahoraga-crawl-${j.id.slice(0,8)}.csv"`);res.send(toCsv(j.leads));});
app.listen(PORT,()=>console.log(`Mahoraga Crawl listening on :${PORT}`));

function publicJob(j){return{id:j.id,status:j.status,createdAt:j.createdAt,updatedAt:j.updatedAt,config:j.config,stats:{pages:j.pages.length,leads:j.leads.length,errors:j.errors.length},leads:j.leads.slice(-300),errors:j.errors.slice(-20)}}
setInterval(()=>{const cut=Date.now()-60*60*1000;for(const[id,j]of jobs)if(new Date(j.updatedAt).getTime()<cut&&!['running','stopping'].includes(j.status))jobs.delete(id)},10*60*1000).unref();
