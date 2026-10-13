'use strict';
const net=require('node:net');const {FrameDecoder,frame}=require('./protocol');const {MemoryRepository}=require('./repository');const {AuthSession,GameSession}=require('./session');
const repo=new MemoryRepository();
function listen(port,make,name){const s=net.createServer(sock=>{const d=new FrameDecoder();const sess=make();sock.on('data',chunk=>{try{for(const p of d.push(chunk))for(const q of sess.handle(p))sock.write(frame(q))}catch(e){sock.destroy(e)}})});s.listen(port,()=>console.log(`${name} listening on ${port}`));return s}
listen(Number(process.env.AUTH_PORT||15100),()=>new AuthSession(repo,{gameHost:process.env.GAME_HOST||'127.0.0.1',gameName:'OldKO'}),'auth');
listen(Number(process.env.GAME_PORT||15001),()=>new GameSession(repo),'game');
