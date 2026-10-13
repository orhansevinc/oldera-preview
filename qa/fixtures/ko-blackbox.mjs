import net from 'node:net';
import { WebSocketServer } from 'ws';

const u16 = n => { const b=Buffer.allocUnsafe(2); b.writeUInt16LE(n & 0xffff,0); return b; };
const s2 = s => { const b=Buffer.from(s,'latin1'); return Buffer.concat([u16(b.length),b]); };
const frame = payload => Buffer.concat([Buffer.from([0xaa,0x55]),u16(payload.length),payload,Buffer.from([0x55,0xaa])]);
const parseLogin = payload => {
  let off=1; if (off+2>payload.length) return null;
  const il=payload.readUInt16LE(off); off+=2; if(off+il+2>payload.length)return null;
  const id=payload.subarray(off,off+il).toString('latin1'); off+=il;
  const pl=payload.readUInt16LE(off); off+=2; if(off+pl>payload.length)return null;
  return {id,pw:payload.subarray(off,off+pl).toString('latin1')};
};

function framedServer(port, onPacket, state) {
  const server=net.createServer(socket=>{
    state.connections=(state.connections||0)+1;
    let rx=Buffer.alloc(0);
    socket.on('data',chunk=>{
      rx=Buffer.concat([rx,chunk]);
      while(rx.length>=6){
        const start=rx.indexOf(Buffer.from([0xaa,0x55]));
        if(start<0){rx=Buffer.alloc(0);return;} if(start>0)rx=rx.subarray(start);
        if(rx.length<6)return; const len=rx.readUInt16LE(2), total=len+6; if(rx.length<total)return;
        const packet=rx.subarray(0,total); rx=rx.subarray(total);
        if(packet[total-2]!==0x55||packet[total-1]!==0xaa)continue;
        onPacket(packet.subarray(4,4+len),socket,state);
      }
    });
  });
  return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>resolve(server));});
}

function gateway(port,targetPort,state){
  const wss=new WebSocketServer({host:'127.0.0.1',port});
  wss.on('connection',ws=>{
    state.wsConnections=(state.wsConnections||0)+1;
    const tcp=net.connect(targetPort,'127.0.0.1');
    ws.on('message',(d,isBinary)=>{if(isBinary||Buffer.isBuffer(d))tcp.write(Buffer.from(d));});
    tcp.on('data',d=>{if(ws.readyState===1)ws.send(d);});
    const stop=()=>tcp.destroy(); ws.on('close',stop); ws.on('error',stop); tcp.on('error',()=>{try{ws.close();}catch{}});
  });
  return wss;
}

export async function startBlackbox({id='qauser',pw='qapass',nation=2}={}) {
  const state={auth:{},game:{}};
  const auth=await framedServer(16100,(p,s,st)=>{
    const op=p[0];
    if(op===0xf5){st.serverListReq=true;s.write(frame(Buffer.concat([Buffer.from([0xf5,0x01]),s2('127.0.0.1'),s2('OldKO'),u16(7)])));st.serverListResp=true;}
    if(op===0xf3){st.authReq=true;const q=parseLogin(p);st.authMatched=!!q&&q.id===id&&q.pw===pw;if(st.authMatched){s.write(frame(Buffer.from([0xf3,0x01,0xff,0xff])));st.authResp=true;}}
    if(op===0xf6&&st.authMatched){s.write(frame(Buffer.concat([Buffer.from([0xf6]),s2('QA'),s2(' ')])));st.newsResp=true;}
  },state.auth);
  const empty=()=>Buffer.alloc(57);
  const game=await framedServer(16101,(p,s,st)=>{
    const op=p[0];
    if(op===0x2b){st.versionReq=true;s.write(frame(Buffer.concat([Buffer.from([0x2b]),u16(1298)])));st.versionResp=1298;}
    if(op===0x01){st.loginReq=true;const q=parseLogin(p);st.loginMatched=!!q&&q.id===id&&q.pw===pw;if(st.loginMatched){s.write(frame(Buffer.from([0x01,0x00])));st.loginResp=true;}}
    if(op===0x05){st.nationReq=p[1];if(p[1]===nation){s.write(frame(Buffer.from([0x05,nation])));st.nationResp=nation;}}
    if(op===0x0c&&st.nationResp){st.allCharReq=true;s.write(frame(Buffer.concat([Buffer.from([0x0c,0x01]),empty(),empty(),empty()])));st.allCharResp=true;}
  },state.game);
  const ga=gateway(15100,16100,state.auth), gg=gateway(15001,16101,state.game);
  return {state,close:async()=>{await Promise.all([new Promise(r=>ga.close(r)),new Promise(r=>gg.close(r)),new Promise(r=>auth.close(r)),new Promise(r=>game.close(r))]);}};
}
