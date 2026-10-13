#!/usr/bin/env python3
"""Strict KO 1298 frame/parser helpers. Unknown fields are never guessed."""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import json, struct
from typing import Any

HEADER=b"\xaa\x55"; TAIL=b"\x55\xaa"; OVERHEAD=6
_catalog_cache=None

class FrameError(ValueError): pass

@dataclass(frozen=True)
class Frame:
    offset:int; payload_length:int; payload:bytes; raw:bytes
    @property
    def opcode(self): return self.payload[0] if self.payload else None

def build_frame(payload:bytes)->bytes:
    if len(payload)>0xffff: raise ValueError("payload too large")
    return HEADER+struct.pack("<H",len(payload))+payload+TAIL

def parse_frames(data:bytes, *, allow_trailing:bool=False)->list[Frame]:
    out=[]; off=0
    while off<len(data):
        rem=len(data)-off
        if rem<OVERHEAD:
            if allow_trailing: break
            raise FrameError(f"truncated frame at {off}")
        if data[off:off+2]!=HEADER: raise FrameError(f"invalid header at {off}")
        n=struct.unpack_from("<H",data,off+2)[0]; end=off+n+OVERHEAD
        if end>len(data): raise FrameError(f"truncated frame at {off}: payload={n}")
        if data[end-2:end]!=TAIL: raise FrameError(f"invalid tail at {end-2}")
        raw=data[off:end]; out.append(Frame(off,n,raw[4:-2],raw)); off=end
    return out

class R:
    def __init__(self,b:bytes): self.b=b; self.p=0
    def take(self,n):
        if self.p+n>len(self.b): raise FrameError("payload underflow")
        x=self.b[self.p:self.p+n]; self.p+=n; return x
    def u8(self): return self.take(1)[0]
    def u16(self): return struct.unpack("<H",self.take(2))[0]
    def i16(self): return struct.unpack("<h",self.take(2))[0]
    def u32(self): return struct.unpack("<I",self.take(4))[0]
    def u64(self): return struct.unpack("<Q",self.take(8))[0]
    def text(self,n):
        raw=self.take(n)
        try: return raw.decode("cp949")
        except UnicodeDecodeError: return raw.decode("latin1")
    @property
    def remaining(self): return len(self.b)-self.p

def _names(channel:str)->dict[int,str]:
    global _catalog_cache
    if _catalog_cache is None:
        p=Path(__file__).resolve().parents[2]/"protocol-lab"/"opcodes.json"
        try:
            c=json.loads(p.read_text(encoding="utf-8")); fields=c["catalog_entry_fields"]
            _catalog_cache={}
            for ch,key in (("login","login_opcodes"),("game","game_opcodes")):
                tmp={}
                for row in c[key]:
                    e=dict(zip(fields,row)); op=int(e["value"],0)
                    tmp[op]=tmp.get(op,"")+(("|" if op in tmp else "")+e["name"])
                _catalog_cache[ch]=tmp
        except (OSError,ValueError,KeyError,TypeError): _catalog_cache={"login":{},"game":{}}
    return _catalog_cache[channel]

def _credentials(r:R):
    a=r.i16();
    if a<0: raise FrameError("negative account length")
    account=r.text(a); p=r.i16()
    if p<0: raise FrameError("negative password length")
    return {"account_length":a,"account":account,"password_length":p,"password":r.text(p)}

def _login(payload:bytes,direction:str)->dict[str,Any]:
    r=R(payload); op=r.u8(); fields:Any="UNKNOWN"
    if op==0xF5:
        if direction=="C2S" or len(payload)==1: fields={"request":"server_list"}
        elif direction=="S2C":
            count=r.u8(); servers=[]
            for _ in range(count):
                il=r.i16(); ip=r.text(il); nl=r.i16(); name=r.text(nl); users=r.i16()
                servers.append({"ip":ip,"name":name,"concurrent_users":users})
            fields={"server_count":count,"servers":servers}
    elif op in (0xF3,0xF4):
        if direction=="C2S": fields=_credentials(r)
        elif direction=="S2C":
            auth=r.u8(); fields={"auth_result":auth}
            if auth==5 and r.remaining:
                n=r.i16(); fields.update(game_ip=r.text(n),game_port=r.i16())
    elif op==0xF6:
        if direction=="C2S" and len(payload)==1: fields={"request":"news"}
        elif direction=="S2C":
            n=r.u16(); label=r.text(n); m=r.u16(); fields={"label_length":n,"label":label,"content_length":m,"content":r.text(m)}
    return {"opcode":op,"name":_names("login").get(op,"UNKNOWN"),"fields":fields}

def _charlist(r:R):
    result=r.u8(); fields={"result":result}
    if result!=1: return fields
    chars=[]
    for slot in range(3):
        n=r.i16();
        if n<0: raise FrameError("negative character id length")
        c={"slot":slot,"id":r.text(n),"race":r.u8(),"class":r.i16(),"level":r.u8(),"face":r.u8(),"hair":r.u8(),"zone":r.u8()}
        for label in ("helmet","upper","cloak","right_hand","left_hand","lower","gloves","shoes"):
            c[label]={"item_id":r.u32(),"durability":r.i16()}
        chars.append(c)
    fields["characters"]=chars; return fields

def _game(payload:bytes,direction:str)->dict[str,Any]:
    r=R(payload); op=r.u8(); fields:Any="UNKNOWN"
    if op==0x2B:
        if direction=="C2S" or len(payload)==1: fields={"request":"version_check"}
        elif direction=="S2C":
            v=r.i16(); fields={"version":v}
            if r.remaining>=8:
                k=r.u64(); fields.update(public_key=k,cryption_enabled_after_response=k!=0)
            else: fields["public_key"]="UNKNOWN_TRUNCATED"
    elif op==0x01:
        if direction=="C2S": fields=_credentials(r)
        elif direction=="S2C": fields={"nation":r.u8()}
    elif op==0x05:
        fields={"nation":r.u8()} if r.remaining else "UNKNOWN"
    elif op==0x0C:
        if direction=="C2S" or len(payload)==1: fields={"request":"all_character_info"}
        elif direction=="S2C": fields=_charlist(r)
    elif op==0x04:
        if direction=="C2S":
            al=r.i16(); account=r.text(al); cl=r.i16(); char=r.text(cl)
            fields={"account_length":al,"account":account,"character_length":cl,"character":char,"zone_init":r.u8(),"zone_current_wire":r.u8()}
        elif direction=="S2C":
            ok=r.u8(); fields={"result":ok}
            if ok==1:
                z=r.u8(); x=r.u16(); zz=r.u16(); y=r.i16(); victory=r.u8()
                fields.update(zone_wire=z,zone_client_1298=z*10,x=x/10.0,z=zz/10.0,y=y/10.0,victory_nation=victory)
    elif op==0x0D:
        if direction=="C2S" and r.remaining: fields={"phase":r.u8()}
    return {"opcode":op,"name":_names("game").get(op,"UNKNOWN"),"fields":fields}

def decode_frame(frame:Frame, *, channel:str="auto", direction:str="UNKNOWN", encrypted:bool=False)->dict[str,Any]:
    direction=direction.upper()
    if channel not in {"auto","login","game"}: raise ValueError("invalid channel")
    if direction not in {"C2S","S2C","UNKNOWN"}: raise ValueError("invalid direction")
    out={"offset":frame.offset,"frame_length":len(frame.raw),"payload_length":frame.payload_length,"raw_hex":frame.raw.hex(),"payload_hex":frame.payload.hex(),"channel":channel,"direction":direction}
    if encrypted:
        out.update(opcode=None,name="UNKNOWN",fields="UNKNOWN_ENCRYPTED_BODY"); return out
    if not frame.payload:
        out.update(opcode=None,name="UNKNOWN",fields="EMPTY_PAYLOAD"); return out
    actual=channel
    if channel=="auto": actual="login" if frame.payload[0]>=0xF2 else "game"; out["channel"]=actual
    out.update(_login(frame.payload,direction) if actual=="login" else _game(frame.payload,direction)); return out
