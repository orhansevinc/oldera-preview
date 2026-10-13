'use strict';
class SessionRepository{authenticate(){throw Error('not implemented')} getNation(){throw Error('not implemented')} setNation(){throw Error('not implemented')}}
class MemoryRepository extends SessionRepository{constructor(){super();this.accounts=new Map([['osevinc',{password:'osevinc',nation:0}]])}authenticate(u,p){const a=this.accounts.get(u);return !!a&&a.password===p}getNation(u){return this.accounts.get(u)?.nation??0}setNation(u,n){const a=this.accounts.get(u);if(!a)return false;a.nation=n;return true}}
module.exports={SessionRepository,MemoryRepository};
