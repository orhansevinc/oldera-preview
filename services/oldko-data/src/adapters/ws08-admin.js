import { withTransaction } from '../index.js';
import * as read from './ws08-admin-read.js';
import * as write from './ws08-admin-write.js';
import * as extra from './ws08-admin-extra.js';

export const WS08_REQUIRED_METHODS = Object.freeze([
  'transaction','overview','listPlayers','getCharacter','updateCharacter','updateStats','updateSkills','getInventory','getInn','getTransactions','getSanctions','searchItems','itemHistory','itemAction','findDuplicateSerials','createSanction','removeSanction','appendAudit','listAudit','enqueueCommand',
]);

export class PgWs08AdminRepository {
  constructor(db,{rootPool=db,inTransaction=false,runtimeAuthority=null,now=()=>Date.now()}={}){if(!db||typeof db.query!=='function') throw new TypeError('PostgreSQL pool/client is required'); this.db=db; this.rootPool=rootPool; this.inTransaction=inTransaction; this.runtimeAuthority=runtimeAuthority; this.now=now;}
  async transaction(work){if(typeof work!=='function') throw new TypeError('transaction work must be a function'); if(this.inTransaction) return work(this); return withTransaction(this.rootPool,client=>work(new PgWs08AdminRepository(client,{rootPool:this.rootPool,inTransaction:true,runtimeAuthority:this.runtimeAuthority,now:this.now})),{isolationLevel:'SERIALIZABLE',maxRetries:3});}
  overview(input){return read.overview(this,input);} listPlayers(input){return read.listPlayers(this,input);} getCharacter(name){return read.getCharacter(this,name);} getInventory(name){return read.getInventory(this,name);} getInn(name){return read.getInn(this,name);} getTransactions(name){return read.getTransactions(this,name);} getSanctions(name){return read.getSanctions(this,name);} searchItems(q){return read.searchItems(this,q);} itemHistory(serial){return read.itemHistory(this,serial);} findDuplicateSerials(){return read.findDuplicateSerials(this);}
  updateCharacter(name,patch){return write.updateCharacter(this,name,patch);} updateStats(name,patch){return write.updateStats(this,name,patch);} updateSkills(name,patch){return write.updateSkills(this,name,patch);} itemAction(serial,action){return write.itemAction(this,serial,action);} createSanction(input){return write.createSanction(this,input);} removeSanction(input){return write.removeSanction(this,input);} appendAudit(entry){return write.appendAudit(this,entry);} listAudit(limit){return write.listAudit(this,limit);} enqueueCommand(command){return write.enqueueCommand(this,command);}
  upsertAdminActor(input){return extra.upsertAdminActor(this,input);} getAdminActorByUsername(name){return extra.getAdminActorByUsername(this,name);} createAdminSession(input){return extra.createAdminSession(this,input);} getAdminSessionByTokenHash(hash){return extra.getAdminSessionByTokenHash(this,hash);} revokeAdminSession(id){return extra.revokeAdminSession(this,id);} reserveAdminOperation(input){return extra.reserveAdminOperation(this,input);} completeAdminOperation(input){return extra.completeAdminOperation(this,input);} claimCommands(input){return extra.claimCommands(this,input);} completeCommand(input){return extra.completeCommand(this,input);}
}
