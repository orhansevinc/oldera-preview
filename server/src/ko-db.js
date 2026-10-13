import sql from 'mssql';

const env = process.env;
const tableNames = {
  user: safeIdent(env.KO_USERDATA_TABLE || 'USERDATA'),
  current: safeIdent(env.KO_CURRENTUSER_TABLE || 'CURRENTUSER'),
  warehouse: safeIdent(env.KO_WAREHOUSE_TABLE || 'WAREHOUSE'),
  accountChar: safeIdent(env.KO_ACCOUNT_CHAR_TABLE || 'ACCOUNT_CHAR')
};

let poolPromise = null;
const columnCache = new Map();
let adminTablesReady = false;

function safeIdent(value) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return value;
}
function qi(value) { return `[${safeIdent(value)}]`; }
function hasDb() { return String(env.KO_DB_ENABLED || '').toLowerCase() === 'true'; }

export async function pool() {
  if (!hasDb()) throw Object.assign(new Error('KO database is disabled'), { code: 'DB_DISABLED' });
  if (!poolPromise) {
    const config = {
      server: env.KO_DB_HOST || '127.0.0.1',
      port: Number(env.KO_DB_PORT || 1433),
      database: env.KO_DB_NAME || 'KN_online',
      user: env.KO_DB_USER,
      password: env.KO_DB_PASSWORD,
      options: {
        encrypt: String(env.KO_DB_ENCRYPT || 'false').toLowerCase() === 'true',
        trustServerCertificate: String(env.KO_DB_TRUST_CERT || 'true').toLowerCase() === 'true'
      },
      pool: { min: 0, max: 10, idleTimeoutMillis: 30000 },
      requestTimeout: 12000,
      connectionTimeout: 8000
    };
    poolPromise = sql.connect(config).catch(err => { poolPromise = null; throw err; });
  }
  return poolPromise;
}

async function columns(table) {
  if (columnCache.has(table)) return columnCache.get(table);
  const p = await pool();
  const r = await p.request().input('table', sql.NVarChar(128), table)
    .query('SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME=@table');
  const map = new Map(r.recordset.map(x => [String(x.COLUMN_NAME).toLowerCase(), x.COLUMN_NAME]));
  columnCache.set(table, map);
  return map;
}
function pick(map, ...names) {
  for (const n of names) { const hit = map.get(String(n).toLowerCase()); if (hit) return hit; }
  return null;
}
function sel(col, alias, fallback='NULL') { return col ? `${qi(col)} AS ${qi(alias)}` : `${fallback} AS ${qi(alias)}`; }

export async function health() {
  if (!hasDb()) return { enabled: false, connected: false, reason: 'KO_DB_ENABLED=false' };
  try {
    const p = await pool();
    const r = await p.request().query('SELECT DB_NAME() AS dbName, @@SERVERNAME AS serverName');
    return { enabled: true, connected: true, ...r.recordset[0] };
  } catch (err) {
    return { enabled: true, connected: false, reason: err.message };
  }
}

export async function ensureAdminTables() {
  if (adminTablesReady || !hasDb()) return;
  const p = await pool();
  await p.request().query(`
IF OBJECT_ID('dbo.OLDKO_ADMIN_BANS','U') IS NULL
BEGIN
  CREATE TABLE dbo.OLDKO_ADMIN_BANS(
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    ban_type VARCHAR(16) NOT NULL,
    character_name VARCHAR(64) NULL,
    account_id VARCHAR(64) NULL,
    ip_address VARCHAR(64) NULL,
    reason NVARCHAR(500) NULL,
    created_by VARCHAR(64) NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    revoked_at DATETIME2 NULL,
    revoked_by VARCHAR(64) NULL
  );
  CREATE INDEX IX_OLDKO_ADMIN_BANS_ACTIVE ON dbo.OLDKO_ADMIN_BANS(character_name, account_id, ip_address, revoked_at);
END;
IF OBJECT_ID('dbo.OLDKO_ADMIN_AUDIT','U') IS NULL
BEGIN
  CREATE TABLE dbo.OLDKO_ADMIN_AUDIT(
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    trace_id VARCHAR(40) NOT NULL,
    actor VARCHAR(64) NOT NULL,
    action VARCHAR(80) NOT NULL,
    target NVARCHAR(160) NULL,
    payload NVARCHAR(MAX) NULL,
    result VARCHAR(24) NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_OLDKO_ADMIN_AUDIT_CREATED ON dbo.OLDKO_ADMIN_AUDIT(created_at DESC);
END;`);
  adminTablesReady = true;
}

function className(id) {
  const n = Number(id || 0), last = n % 100;
  if ([1,5,6].includes(last)) return 'Warrior';
  if ([2,7,8].includes(last)) return 'Rogue';
  if ([3,9,10].includes(last)) return 'Mage';
  if ([4,11,12].includes(last)) return 'Priest';
  return `Class ${n}`;
}
function nationName(n) { return Number(n) === 1 ? 'Karus' : Number(n) === 2 ? 'El Morad' : `Nation ${n ?? '?'}`; }
function zoneName(z) {
  const id = Number(z || 0);
  const known = { 1:'Luferson', 2:'El Morad Castle', 21:'Moradon', 30:'Delos', 101:'Colony Zone' };
  return known[id] || `Zone ${id}`;
}
function normalizePlayer(r) {
  return {
    name: String(r.name || '').trim(),
    account: r.account ? String(r.account).trim() : '',
    nation: nationName(r.nation), nationId: Number(r.nation || 0),
    race: Number(r.race || 0),
    className: className(r.classId), classId: Number(r.classId || 0),
    level: Number(r.level || 0), np: Number(r.np || 0), coin: Number(r.coin || 0), exp: Number(r.exp || 0),
    zone: zoneName(r.zoneId), zoneId: Number(r.zoneId || 0),
    x: Number(r.x || 0) / 100, z: Number(r.z || 0) / 100, y: Number(r.y || 0) / 100,
    authority: Number(r.authority || 0), online: Boolean(r.online), ip: r.ip ? String(r.ip).trim() : '',
    banned: Boolean(r.banned), ipBanned: Boolean(r.ipBanned), banType: r.ipBanned ? 'IP' : r.banned ? 'ACCOUNT' : null,
    last: r.online ? 'Şimdi' : 'Offline', initial: String(r.name || '?').trim().slice(0,1).toUpperCase()
  };
}

async function schema() {
  const [u,c] = await Promise.all([columns(tableNames.user), columns(tableNames.current).catch(()=>new Map())]);
  return {
    u, c,
    un: pick(u,'strUserID','strUserId','CharID','CharacterName'),
    nation: pick(u,'Nation'), race: pick(u,'Race'), cls: pick(u,'Class'), level: pick(u,'Level'), exp: pick(u,'Exp'),
    loyalty: pick(u,'Loyalty'), gold: pick(u,'Gold'), zone: pick(u,'Zone'), px: pick(u,'PX'), pz: pick(u,'PZ'), py: pick(u,'PY'),
    authority: pick(u,'Authority'), item: pick(u,'Item'), serial: pick(u,'Serial'), face: pick(u,'Face'), hair: pick(u,'HairColor'),
    curChar: pick(c,'strCharID','strCharId'), curAccount: pick(c,'strAccountID','strAccountId'), curIp: pick(c,'strClientIP','strClientIp')
  };
}

export async function listPlayers({ onlineOnly=false, q='', limit=500 }={}) {
  await ensureAdminTables();
  const s = await schema();
  if (!s.un) throw new Error(`${tableNames.user}.strUserID compatible column not found`);
  const joinCurrent = s.curChar ? `LEFT JOIN ${qi(tableNames.current)} c ON c.${qi(s.curChar)} = u.${qi(s.un)}` : '';
  const accountExpr = s.curAccount ? `c.${qi(s.curAccount)}` : 'NULL';
  const ipExpr = s.curIp ? `c.${qi(s.curIp)}` : 'NULL';
  const onlineExpr = s.curChar ? `CASE WHEN c.${qi(s.curChar)} IS NULL THEN 0 ELSE 1 END` : '0';
  const where = [];
  if (onlineOnly && s.curChar) where.push(`c.${qi(s.curChar)} IS NOT NULL`);
  if (q) where.push(`(u.${qi(s.un)} LIKE @q${s.curAccount ? ` OR c.${qi(s.curAccount)} LIKE @q` : ''})`);
  const sqlText = `SELECT TOP (@limit)
    ${sel(s.un,'name')}, ${accountExpr} AS account,
    ${sel(s.nation,'nation','0')}, ${sel(s.race,'race','0')}, ${sel(s.cls,'classId','0')}, ${sel(s.level,'level','0')},
    ${sel(s.exp,'exp','0')}, ${sel(s.loyalty,'np','0')}, ${sel(s.gold,'coin','0')}, ${sel(s.zone,'zoneId','0')},
    ${sel(s.px,'x','0')}, ${sel(s.pz,'z','0')}, ${sel(s.py,'y','0')}, ${sel(s.authority,'authority','0')},
    ${onlineExpr} AS online, ${ipExpr} AS ip,
    CASE WHEN EXISTS(SELECT 1 FROM dbo.OLDKO_ADMIN_BANS b WHERE b.revoked_at IS NULL AND (b.character_name=u.${qi(s.un)} ${s.curAccount ? `OR b.account_id=c.${qi(s.curAccount)}` : ''})) THEN 1 ELSE 0 END AS banned,
    CASE WHEN ${s.curIp ? `EXISTS(SELECT 1 FROM dbo.OLDKO_ADMIN_BANS b WHERE b.revoked_at IS NULL AND b.ban_type='IP' AND b.ip_address=c.${qi(s.curIp)})` : '1=0'} THEN 1 ELSE 0 END AS ipBanned
  FROM ${qi(tableNames.user)} u ${joinCurrent}
  ${where.length ? 'WHERE '+where.join(' AND ') : ''}
  ORDER BY ${s.loyalty ? `u.${qi(s.loyalty)} DESC` : `u.${qi(s.un)} ASC`}`;
  const req = (await pool()).request().input('limit', sql.Int, Math.min(Math.max(Number(limit)||500,1),2000));
  if (q) req.input('q', sql.NVarChar(128), `%${q}%`);
  const r = await req.query(sqlText);
  return r.recordset.map(normalizePlayer);
}

export async function getCharacter(name) {
  const list = await listPlayers({ q:name, limit:50 });
  return list.find(x => x.name.toLowerCase() === String(name).toLowerCase()) || null;
}

function parseSlots(items, serials, maxSlots) {
  const ib = Buffer.isBuffer(items) ? items : items ? Buffer.from(items) : Buffer.alloc(0);
  const sb = Buffer.isBuffer(serials) ? serials : serials ? Buffer.from(serials) : Buffer.alloc(0);
  const n = Math.min(maxSlots, Math.floor(ib.length / 8), Math.floor(sb.length / 8));
  const out = [];
  for (let i=0;i<n;i++) {
    const o=i*8, itemId=ib.readInt32LE(o), duration=ib.readInt16LE(o+4), count=ib.readInt16LE(o+6);
    const serial = sb.readBigInt64LE(o).toString();
    out.push({ slot:i, itemId, duration, count, serial, empty:itemId<=0 });
  }
  return out;
}

export async function getInventory(name) {
  const s = await schema();
  if (!s.un || !s.item || !s.serial) throw new Error('USERDATA item/serial columns could not be detected');
  const r = await (await pool()).request().input('name', sql.VarChar(64), name)
    .query(`SELECT ${qi(s.item)} AS items, ${qi(s.serial)} AS serials FROM ${qi(tableNames.user)} WHERE ${qi(s.un)}=@name`);
  if (!r.recordset[0]) return null;
  const slots = parseSlots(r.recordset[0].items, r.recordset[0].serials, 42);
  return { equipment: slots.slice(0,14), inventory: slots.slice(14,42).map((x,i)=>({...x,slot:i})) };
}

async function findAccount(name) {
  const s = await schema();
  if (s.curChar && s.curAccount) {
    const r = await (await pool()).request().input('name',sql.VarChar(64),name)
      .query(`SELECT TOP 1 ${qi(s.curAccount)} AS account FROM ${qi(tableNames.current)} WHERE ${qi(s.curChar)}=@name`);
    if (r.recordset[0]?.account) return String(r.recordset[0].account).trim();
  }
  const ac = await columns(tableNames.accountChar).catch(()=>new Map());
  const a = pick(ac,'strAccountID','strAccountId');
  const chars = [pick(ac,'strCharID1'),pick(ac,'strCharID2'),pick(ac,'strCharID3')].filter(Boolean);
  if (a && chars.length) {
    const where = chars.map(c=>`${qi(c)}=@name`).join(' OR ');
    const r = await (await pool()).request().input('name',sql.VarChar(64),name)
      .query(`SELECT TOP 1 ${qi(a)} AS account FROM ${qi(tableNames.accountChar)} WHERE ${where}`);
    if (r.recordset[0]?.account) return String(r.recordset[0].account).trim();
  }
  return null;
}

export async function getWarehouse(name) {
  const account = await findAccount(name);
  if (!account) return { account:null, money:0, slots:[] };
  const wc = await columns(tableNames.warehouse);
  const accountCol = pick(wc,'strAccountID','strAccountId');
  const dataCol = pick(wc,'WarehouseData');
  const serialCol = pick(wc,'strSerial','Serial');
  const moneyCol = pick(wc,'nMoney','Money');
  if (!accountCol || !dataCol || !serialCol) throw new Error('WAREHOUSE columns could not be detected');
  const r = await (await pool()).request().input('account',sql.VarChar(64),account)
    .query(`SELECT ${qi(dataCol)} AS items, ${qi(serialCol)} AS serials, ${moneyCol?qi(moneyCol):'0'} AS money FROM ${qi(tableNames.warehouse)} WHERE ${qi(accountCol)}=@account`);
  const row=r.recordset[0];
  if (!row) return { account,money:0,slots:[] };
  return { account, money:Number(row.money||0), slots:parseSlots(row.items,row.serials,192) };
}

export async function createBan({ type='ACCOUNT', character, account=null, ip=null, reason='', actor='ORHAN' }) {
  await ensureAdminTables();
  const p=await pool();
  await p.request()
    .input('type',sql.VarChar(16),type).input('character',sql.VarChar(64),character||null)
    .input('account',sql.VarChar(64),account||null).input('ip',sql.VarChar(64),ip||null)
    .input('reason',sql.NVarChar(500),reason||'').input('actor',sql.VarChar(64),actor)
    .query(`INSERT INTO dbo.OLDKO_ADMIN_BANS(ban_type,character_name,account_id,ip_address,reason,created_by)
            VALUES(@type,@character,@account,@ip,@reason,@actor)`);
  return { ok:true };
}

export async function removeBan({ character, type=null, actor='ORHAN' }) {
  await ensureAdminTables();
  const req=(await pool()).request().input('character',sql.VarChar(64),character).input('actor',sql.VarChar(64),actor);
  let typeClause=''; if(type){req.input('type',sql.VarChar(16),type);typeClause=' AND ban_type=@type';}
  const r=await req.query(`UPDATE dbo.OLDKO_ADMIN_BANS SET revoked_at=SYSUTCDATETIME(), revoked_by=@actor
    WHERE revoked_at IS NULL AND character_name=@character${typeClause}; SELECT @@ROWCOUNT AS changed;`);
  return { ok:true, changed:Number(r.recordset?.[0]?.changed||0) };
}

export async function audit({ traceId, actor, action, target='', payload=null, result='SUCCESS' }) {
  await ensureAdminTables();
  await (await pool()).request().input('trace',sql.VarChar(40),traceId).input('actor',sql.VarChar(64),actor)
    .input('action',sql.VarChar(80),action).input('target',sql.NVarChar(160),target)
    .input('payload',sql.NVarChar(sql.MAX),payload?JSON.stringify(payload):null).input('result',sql.VarChar(24),result)
    .query('INSERT INTO dbo.OLDKO_ADMIN_AUDIT(trace_id,actor,action,target,payload,result) VALUES(@trace,@actor,@action,@target,@payload,@result)');
}

export async function getAudit(limit=100) {
  await ensureAdminTables();
  const r=await (await pool()).request().input('limit',sql.Int,Math.min(Math.max(Number(limit)||100,1),500))
    .query('SELECT TOP (@limit) trace_id AS traceId, actor, action, target, result, created_at AS createdAt FROM dbo.OLDKO_ADMIN_AUDIT ORDER BY id DESC');
  return r.recordset;
}

export const dbInfo = { hasDb, tableNames, className, nationName, zoneName };
