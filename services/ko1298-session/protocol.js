'use strict';
const FRAME_HEAD=Buffer.from([0xaa,0x55]);
const FRAME_TAIL=Buffer.from([0x55,0xaa]);
const LOGIN={SERVER_LIST:0xF5,LOGIN_REQ:0xF3,NEWS:0xF6};
const GAME={LOGIN:0x01,NEW_CHAR:0x02,SEL_CHAR:0x04,SEL_NATION:0x05,ALLCHAR_INFO_REQ:0x0C,GAMESTART:0x0D,VERSION_CHECK:0x2B};
class Reader{constructor(buf){this.b=buf;this.o=0} u8(){if(this.o+1>this.b.length)throw Error('truncated u8');return this.b[this.o++]} i16(){if(this.o+2>this.b.length)throw Error('truncated i16');const v=this.b.readInt16LE(this.o);this.o+=2;return v} str16(max=255){const n=this.i16();if(n<0||n>max||this.o+n>this.b.length)throw Error('invalid str16');const s=this.b.subarray(this.o,this.o+n).toString('latin1');this.o+=n;return s}}
class Writer{constructor(){this.p=[]}u8(v){this.p.push(Buffer.from([v&255]));return this}i16(v){const b=Buffer.alloc(2);b.writeInt16LE(v);this.p.push(b);return this}str16(s){const b=Buffer.from(s,'latin1');this.i16(b.length);this.p.push(b);return this}raw(b){this.p.push(Buffer.from(b));return this}done(){return Buffer.concat(this.p)}}
function frame(payload){const n=Buffer.alloc(2);n.writeUInt16LE(payload.length);return Buffer.concat([FRAME_HEAD,n,payload,FRAME_TAIL])}
class FrameDecoder{constructor(max=8192){this.pending=Buffer.alloc(0);this.max=max}push(chunk){this.pending=Buffer.concat([this.pending,chunk]);const out=[];for(;;){if(this.pending.length<6)break;if(this.pending[0]!==0xaa||this.pending[1]!==0x55)throw Error('bad frame header');const n=this.pending.readUInt16LE(2);if(n<1||n>this.max)throw Error('bad frame length');const total=n+6;if(this.pending.length<total)break;if(this.pending[n+4]!==0x55||this.pending[n+5]!==0xaa)throw Error('bad frame tail');out.push(this.pending.subarray(4,4+n));this.pending=this.pending.subarray(total)}return out}}
function parseCredentials(payload,opcode){const r=new Reader(payload);if(r.u8()!==opcode)throw Error('opcode mismatch');return {username:r.str16(20),password:r.str16(12)}}
module.exports={LOGIN,GAME,Reader,Writer,frame,FrameDecoder,parseCredentials};
