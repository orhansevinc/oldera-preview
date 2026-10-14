#!/usr/bin/env python3
from __future__ import annotations
import struct

class VisibilityProtocolError(ValueError):
    pass

def _need(data: bytes, off: int, n: int, label: str):
    if off + n > len(data): raise VisibilityProtocolError(f"truncated {label}")
def _i16(data, off): _need(data,off,2,"i16"); return struct.unpack_from("<h",data,off)[0]
def _u16(data, off): _need(data,off,2,"u16"); return struct.unpack_from("<H",data,off)[0]
def _u32(data, off): _need(data,off,4,"u32"); return struct.unpack_from("<I",data,off)[0]
def _pack_i16(v,label):
    if not isinstance(v,int) or not -32768 <= v <= 32767: raise VisibilityProtocolError(f"{label} out of i16 range")
    return struct.pack("<h",v)
def _pack_u16(v,label):
    if not isinstance(v,int) or not 0 <= v <= 65535: raise VisibilityProtocolError(f"{label} out of u16 range")
    return struct.pack("<H",v)
def _pack_u32(v,label):
    if not isinstance(v,int) or not 0 <= v <= 0xffffffff: raise VisibilityProtocolError(f"{label} out of u32 range")
    return struct.pack("<I",v)

def decode_npc_record(data: bytes, off: int = 0):
    start=off; _need(data,off,20,"npc record prefix")
    runtime_id=_i16(data,off); off+=2
    template_resource_id=_i16(data,off); off+=2
    npc_type=data[off]; off+=1
    selling_group=_u32(data,off); off+=4
    scale_percent=_i16(data,off); off+=2
    weapon_1_item_id=_u32(data,off); off+=4
    weapon_2_item_id=_u32(data,off); off+=4
    name_len=data[off]; off+=1
    _need(data,off,name_len+18,"npc record suffix")
    name_bytes=data[off:off+name_len]; off+=name_len
    group_nation=data[off]; off+=1
    level=data[off]; off+=1
    x10=_u16(data,off); off+=2
    z10=_u16(data,off); off+=2
    y10=_i16(data,off); off+=2
    state_gate_open=_u32(data,off); off+=4
    object_type=data[off]; off+=1
    client_idk0=_i16(data,off); off+=2
    client_idk1=_i16(data,off); off+=2
    direction=data[off]; off+=1
    return {"runtime_id":runtime_id,"template_resource_id":template_resource_id,"npc_type":npc_type,
      "selling_group":selling_group,"scale_percent":scale_percent,"scale":scale_percent/100.0,
      "weapon_1_item_id":weapon_1_item_id,"weapon_2_item_id":weapon_2_item_id,
      "name_bytes_hex":name_bytes.hex(),"name":name_bytes.decode("latin-1"),"group_nation":group_nation,
      "level":level,"x10":x10,"x":x10/10.0,"z10":z10,"z":z10/10.0,"y10":y10,"y":y10/10.0,
      "state_gate_open":state_gate_open,"object_type":object_type,"client_idk0":client_idk0,
      "client_idk1":client_idk1,"direction":direction,"record_bytes":off-start}, off

def encode_npc_record(v: dict) -> bytes:
    name=v.get("name_bytes")
    if name is None: name=str(v.get("name","")).encode("latin-1")
    if len(name)>255: raise VisibilityProtocolError("name exceeds u8 length")
    for key in ("npc_type","group_nation","level","object_type","direction"):
        x=v[key]
        if not isinstance(x,int) or not 0<=x<=255: raise VisibilityProtocolError(f"{key} out of u8 range")
    return b"".join([_pack_i16(v["runtime_id"],"runtime_id"),_pack_i16(v["template_resource_id"],"template_resource_id"),
      bytes([v["npc_type"]]),_pack_u32(v["selling_group"],"selling_group"),_pack_i16(v["scale_percent"],"scale_percent"),
      _pack_u32(v["weapon_1_item_id"],"weapon_1_item_id"),_pack_u32(v["weapon_2_item_id"],"weapon_2_item_id"),
      bytes([len(name)]),name,bytes([v["group_nation"],v["level"]]),_pack_u16(v["x10"],"x10"),
      _pack_u16(v["z10"],"z10"),_pack_i16(v["y10"],"y10"),_pack_u32(v["state_gate_open"],"state_gate_open"),
      bytes([v["object_type"]]),_pack_i16(v.get("client_idk0",0),"client_idk0"),
      _pack_i16(v.get("client_idk1",0),"client_idk1"),bytes([v["direction"]])])

def _decode_id_list(payload: bytes, expected_opcode: int):
    if not payload or payload[0]!=expected_opcode: raise VisibilityProtocolError("wrong opcode")
    _need(payload,1,2,"count"); count=_i16(payload,1)
    if count<0: raise VisibilityProtocolError("negative count")
    if len(payload)!=3+2*count: raise VisibilityProtocolError("id list length/count mismatch")
    return count,[_i16(payload,3+2*i) for i in range(count)]

def decode_visibility_payload(payload: bytes, direction: str) -> dict:
    if not payload: raise VisibilityProtocolError("empty payload")
    direction=direction.upper(); op=payload[0]
    if op==0x1C:
        if direction!="S2C": raise VisibilityProtocolError("WIZ_NPC_REGION is S2C")
        count,ids=_decode_id_list(payload,0x1C)
        return {"name":"WIZ_NPC_REGION","opcode":"0x1C","direction":direction,"variant":"s2c_runtime_ids","count":count,"runtime_ids":ids}
    if op==0x1D:
        if direction=="C2S":
            count,ids=_decode_id_list(payload,0x1D)
            return {"name":"WIZ_REQ_NPCIN","opcode":"0x1D","direction":direction,"variant":"c2s_missing_ids","count":count,"runtime_ids":ids}
        if direction!="S2C": raise VisibilityProtocolError("direction must be C2S or S2C")
        _need(payload,1,2,"count"); count=_i16(payload,1)
        if count<0: raise VisibilityProtocolError("negative count")
        off=3; records=[]
        for _ in range(count):
            rec,off=decode_npc_record(payload,off); records.append(rec)
        if off!=len(payload): raise VisibilityProtocolError("trailing bytes after NPC records")
        return {"name":"WIZ_REQ_NPCIN","opcode":"0x1D","direction":direction,"variant":"s2c_detail_records","count":count,"records":records}
    if op==0x0A:
        if direction!="S2C": raise VisibilityProtocolError("WIZ_NPC_INOUT is S2C")
        _need(payload,1,1,"inout"); kind=payload[1]
        if kind==1:
            rec,off=decode_npc_record(payload,2)
            if off!=len(payload): raise VisibilityProtocolError("trailing bytes after NPC_IN record")
            return {"name":"WIZ_NPC_INOUT","opcode":"0x0A","direction":"S2C","variant":"in","inout":1,"record":rec}
        if kind==2:
            if len(payload)!=4: raise VisibilityProtocolError("NPC_OUT payload must be 4 bytes")
            return {"name":"WIZ_NPC_INOUT","opcode":"0x0A","direction":"S2C","variant":"out","inout":2,"runtime_id":_i16(payload,2)}
        raise VisibilityProtocolError(f"invalid NPC in/out type {kind}")
    raise VisibilityProtocolError(f"unsupported visibility opcode 0x{op:02X}")

def encode_visibility_payload(name: str, variant: str, values: dict) -> bytes:
    if name=="WIZ_NPC_REGION" and variant=="s2c_runtime_ids":
        ids=values["runtime_ids"]; return bytes([0x1C])+_pack_i16(len(ids),"count")+b"".join(_pack_i16(x,"runtime_id") for x in ids)
    if name=="WIZ_REQ_NPCIN" and variant=="c2s_missing_ids":
        ids=values["runtime_ids"]; return bytes([0x1D])+_pack_i16(len(ids),"count")+b"".join(_pack_i16(x,"runtime_id") for x in ids)
    if name=="WIZ_REQ_NPCIN" and variant=="s2c_detail_records":
        records=values["records"]; return bytes([0x1D])+_pack_i16(len(records),"count")+b"".join(encode_npc_record(x) for x in records)
    if name=="WIZ_NPC_INOUT" and variant=="in": return bytes([0x0A,1])+encode_npc_record(values["record"])
    if name=="WIZ_NPC_INOUT" and variant=="out": return bytes([0x0A,2])+_pack_i16(values["runtime_id"],"runtime_id")
    raise VisibilityProtocolError(f"unsupported encoder {name}/{variant}")

def _record_for_encode(r):
    keys=("runtime_id","template_resource_id","npc_type","selling_group","scale_percent","weapon_1_item_id","weapon_2_item_id","group_nation","level","x10","z10","y10","state_gate_open","object_type","client_idk0","client_idk1","direction")
    out={k:r[k] for k in keys}; out["name_bytes"]=bytes.fromhex(r["name_bytes_hex"]); return out

def reencode_decoded(d: dict) -> bytes:
    name=d["name"]; variant=d["variant"]
    if variant in ("s2c_runtime_ids","c2s_missing_ids"): return encode_visibility_payload(name,variant,{"runtime_ids":d["runtime_ids"]})
    if variant=="s2c_detail_records": return encode_visibility_payload(name,variant,{"records":[_record_for_encode(r) for r in d["records"]]})
    if variant=="in": return encode_visibility_payload(name,variant,{"record":_record_for_encode(d["record"])})
    if variant=="out": return encode_visibility_payload(name,variant,{"runtime_id":d["runtime_id"]})
    raise VisibilityProtocolError("unsupported decoded variant")
