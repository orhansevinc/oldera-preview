import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieSession from 'cookie-session';
import rateLimit from 'express-rate-limit';
import {
  health as dbHealth, listPlayers, getCharacter, getInventory, getWarehouse,
  createBan, removeBan, audit, getAudit
} from './ko-db.js';

const app = express();
const PORT = Number(process.env.PORT || 8787);
const isProd = process.env.NODE_ENV === 'production';
const adminOrigin = process.env.ADMIN_ORIGIN || 'http://localhost:5500';

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: adminOrigin, credentials: true }));
app.use(express.json({ limit: '256kb' }));
app.use(cookieSession({
  name: 'oldko_owner',
  keys: [process.env.SESSION_SECRET || 'dev-only-change-me'],
  httpOnly: true,
  secure: isProd,
  sameSite: 'strict',
  maxAge: 1000 * 60 * 60 * 8
}));

const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 240, standardHeaders: 'draft-7', legacyHeaders: false });
app.use('/api/admin', apiLimiter);

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || '')), bb = Buffer.from(String(b || ''));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}
function traceId() { return `ADM-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function requireOwner(req, res, next) {
  if (req.session?.authority !== 'ROOT_OWNER') return res.status(401).json({ ok:false, error:'AUTH_REQUIRED' });
  next();
}
function actor(req) { return req.session?.user || 'ORHAN'; }

async function forwardGameCommand(command, payload={}) {
  const base = String(process.env.GAME_COMMAND_BRIDGE_URL || '').replace(/\/$/, '');
  if (!base) return { forwarded:false, reason:'GAME_COMMAND_BRIDGE_URL not configured' };
  const headers = { 'content-type':'application/json' };
  if (process.env.GAME_COMMAND_BRIDGE_TOKEN) headers.authorization = `Bearer ${process.env.GAME_COMMAND_BRIDGE_TOKEN}`;
  const r = await fetch(`${base}/commands`, { method:'POST', headers, body:JSON.stringify({ command, ...payload }) });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { message:text }; }
  if (!r.ok) throw Object.assign(new Error(body?.error || body?.message || `Game bridge ${r.status}`), { status:r.status });
  return { forwarded:true, result:body };
}
async function writeAudit(req, action, target, payload, result='SUCCESS', trace=traceId()) {
  try { await audit({ traceId:trace, actor:actor(req), action, target, payload, result }); } catch (e) { console.error('audit failed', e); }
  return trace;
}
async function bridgeAction(req,res,next,command,target,payload={}) {
  try {
    const trace=traceId();
    const game=await forwardGameCommand(command,{target,actor:actor(req),traceId:trace,...payload});
    await writeAudit(req,command,target,{...payload,game},game.forwarded?'SUCCESS':'STAGED',trace);
    res.json({ok:true,traceId:trace,game,staged:!game.forwarded});
  } catch(e){ next(e); }
}

app.get('/api/admin/health', async (_req,res) => {
  const db = await dbHealth();
  res.json({ ok:true, service:'OldKO Control Center API', version:'0.2.0', db:{ enabled:db.enabled, connected:db.connected }, gameBridge:Boolean(process.env.GAME_COMMAND_BRIDGE_URL) });
});

app.post('/api/admin/session/login', loginLimiter, async (req,res) => {
  const expectedUser = process.env.ROOT_OWNER_USER || 'ORHAN';
  const expectedPass = process.env.ROOT_OWNER_PASSWORD || '';
  if (!expectedPass) return res.status(503).json({ ok:false, error:'ROOT_OWNER_PASSWORD_NOT_CONFIGURED' });
  if (!safeEqual(req.body?.user, expectedUser) || !safeEqual(req.body?.password, expectedPass)) return res.status(401).json({ ok:false, error:'INVALID_CREDENTIALS' });
  req.session = { user:expectedUser, authority:'ROOT_OWNER', loginAt:Date.now() };
  await writeAudit(req, 'OWNER_LOGIN', 'Control Center', { ip:req.ip });
  res.json({ ok:true, user:expectedUser, authority:'ROOT_OWNER' });
});
app.post('/api/admin/session/logout', requireOwner, async (req,res) => {
  await writeAudit(req, 'OWNER_LOGOUT', 'Control Center', {});req.session = null;res.json({ ok:true });
});
app.get('/api/admin/session', (req,res) => {
  if (req.session?.authority !== 'ROOT_OWNER') return res.status(401).json({ ok:false, error:'AUTH_REQUIRED' });
  res.json({ ok:true, user:req.session.user, authority:req.session.authority });
});

app.use('/api/admin', requireOwner);

app.get('/api/admin/overview', async (req,res,next) => {
  try {
    const [online, all, db] = await Promise.all([listPlayers({ onlineOnly:true, limit:2000 }), listPlayers({ limit:2000 }), dbHealth()]);
    const nation = online.reduce((a,p)=>(a[p.nation]=(a[p.nation]||0)+1,a),{});
    const zone = online.reduce((a,p)=>(a[p.zone]=(a[p.zone]||0)+1,a),{});
    res.json({ ok:true, online:online.length, characters:all.length, nation, zone, services:{ api:'ONLINE', database:db.connected?'ONLINE':'OFFLINE', gameBridge:process.env.GAME_COMMAND_BRIDGE_URL?'READY':'NOT_CONFIGURED' } });
  } catch(e){ next(e); }
});

app.get('/api/admin/players', async (req,res,next) => {
  try { res.json({ ok:true, players:await listPlayers({ onlineOnly:req.query.online==='1', q:String(req.query.q||''), limit:Number(req.query.limit||1000) }) }); } catch(e){ next(e); }
});
app.get('/api/admin/characters/:name', async (req,res,next) => {
  try { const character=await getCharacter(req.params.name); if(!character)return res.status(404).json({ok:false,error:'CHARACTER_NOT_FOUND'}); res.json({ok:true,character}); } catch(e){ next(e); }
});
app.get('/api/admin/characters/:name/inventory', async (req,res,next) => {
  try { const data=await getInventory(req.params.name); if(!data)return res.status(404).json({ok:false,error:'CHARACTER_NOT_FOUND'}); res.json({ok:true,...data}); } catch(e){ next(e); }
});
app.get('/api/admin/characters/:name/inn', async (req,res,next) => {
  try { res.json({ok:true,...await getWarehouse(req.params.name)}); } catch(e){ next(e); }
});
app.patch('/api/admin/characters/:name', (req,res,next) => bridgeAction(req,res,next,'CHARACTER_EDIT',req.params.name,{changes:req.body,reason:req.body?.reason||'ROOT OWNER character edit'}));
app.patch('/api/admin/characters/:name/stats', (req,res,next) => bridgeAction(req,res,next,'STAT_EDIT',req.params.name,{changes:req.body,reason:req.body?.reason||'ROOT OWNER stat edit'}));
app.post('/api/admin/characters/:name/teleport', (req,res,next) => bridgeAction(req,res,next,'TELEPORT',req.params.name,{zone:req.body?.zone,zoneId:req.body?.zoneId,x:req.body?.x,z:req.body?.z,reason:req.body?.reason||'ROOT OWNER teleport'}));

const allowedCommands = new Set([
  'INVISIBLE','CLEAN','RAINING','SNOWING','TIME','COUNT','NOTICE','ARREST','FORBIDCONNECT',
  'FORBIDCHAT','PERMITCHAT','NOTICEALL','CUTOFF','VIEW','UNVIEW','FORBIDUSER','SUMMONUSER',
  'ATTACKDISABLE','ATTACKENABLE','PROGRAMLISTCHECK'
]);
app.post('/api/admin/commands', async (req,res,next) => {
  try {
    const command=String(req.body?.command||'').toUpperCase();
    if(!allowedCommands.has(command)) return res.status(400).json({ok:false,error:'COMMAND_NOT_ALLOWED'});
    const trace=traceId(),payload={ target:String(req.body?.target||''), arg:req.body?.arg??'', reason:String(req.body?.reason||''), actor:actor(req), traceId:trace };
    const game=await forwardGameCommand(command,payload);
    await writeAudit(req,command,payload.target||'GLOBAL',{...payload,game},game.forwarded?'SUCCESS':'STAGED',trace);
    res.json({ok:true,traceId:trace,game});
  }catch(e){next(e);}
});

app.post('/api/admin/items/:serial', (req,res,next) => {
  const serial=String(req.params.serial||'');
  bridgeAction(req,res,next,'ITEM_ADMIN_ACTION',serial,{serial,itemId:req.body?.itemId,character:req.body?.character,scope:req.body?.scope,slot:req.body?.slot,action:req.body?.action,reason:req.body?.reason||'ROOT OWNER item action'});
});

app.post('/api/admin/sanctions', async (req,res,next) => {
  try {
    const type=String(req.body?.type||'ACCOUNT').toUpperCase();
    if(!['ACCOUNT','IP'].includes(type)) return res.status(400).json({ok:false,error:'INVALID_BAN_TYPE'});
    const character=String(req.body?.character||'').trim();if(!character) return res.status(400).json({ok:false,error:'CHARACTER_REQUIRED'});
    const p=await getCharacter(character);if(!p)return res.status(404).json({ok:false,error:'CHARACTER_NOT_FOUND'});
    if(type==='IP'&&!p.ip)return res.status(409).json({ok:false,error:'PLAYER_IP_NOT_AVAILABLE'});
    const reason=String(req.body?.reason||'ROOT OWNER moderation action'),trace=traceId();
    await createBan({type,character:p.name,account:p.account||null,ip:type==='IP'?p.ip:null,reason,actor:actor(req)});
    let game;try{game=await forwardGameCommand(type==='IP'?'IP_BAN':'ACCOUNT_BAN',{target:p.name,account:p.account,ip:p.ip,reason,actor:actor(req),traceId:trace})}catch(e){game={forwarded:false,error:e.message}}
    await writeAudit(req,type==='IP'?'IP_BAN':'ACCOUNT_BAN',p.name,{account:p.account,ip:p.ip,reason,game},game.forwarded?'SUCCESS':'STAGED',trace);
    res.json({ok:true,traceId:trace,ban:{type,character:p.name,account:p.account,ip:type==='IP'?p.ip:null},game,staged:!game.forwarded});
  }catch(e){next(e);}
});
app.delete('/api/admin/sanctions/:character', async (req,res,next) => {
  try {
    const character=String(req.params.character||'').trim(),type=req.query.type?String(req.query.type).toUpperCase():null,trace=traceId();
    const db=await removeBan({character,type,actor:actor(req)});
    let game;try{game=await forwardGameCommand('BAN_REMOVE',{target:character,type,actor:actor(req),traceId:trace})}catch(e){game={forwarded:false,error:e.message}}
    await writeAudit(req,'BAN_REMOVE',character,{type,db,game},game.forwarded?'SUCCESS':'STAGED',trace);
    res.json({ok:true,traceId:trace,db,game,staged:!game.forwarded});
  }catch(e){next(e);}
});

app.post('/api/admin/server/critical', (req,res,next) => {
  const action=String(req.body?.action||'').toUpperCase();
  if(!['MAINTENANCE','RESTART_GAME','SHUTDOWN'].includes(action))return res.status(400).json({ok:false,error:'INVALID_CRITICAL_ACTION'});
  bridgeAction(req,res,next,`SERVER_${action}`,'SERVER',{reason:req.body?.reason||'ROOT OWNER critical action'});
});

app.get('/api/admin/audit', async (req,res,next) => { try { res.json({ok:true,entries:await getAudit(req.query.limit)}); } catch(e){next(e);} });

app.use((err,req,res,_next)=>{
  console.error(err);const status=Number(err.status)||500;
  res.status(status).json({ok:false,error:status===500?'INTERNAL_ERROR':err.message,detail:isProd?undefined:err.message});
});

app.listen(PORT,()=>console.log(`OldKO Control Center API listening on :${PORT}`));
