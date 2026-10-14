#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from gameplay import build_frame
from visibility import encode_visibility_payload
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'protocol-lab'/'visibility-fixtures'
SOURCE='Open-KO/KnightOnline@7d6cf81093e142c928c2ac9510512b2b182178b5'
npc={'runtime_id':10001,'template_resource_id':13001,'npc_type':1,'selling_group':203002,'scale_percent':100,'weapon_1_item_id':0,'weapon_2_item_id':0,'name':'Caspy','group_nation':0,'level':1,'x10':3120,'z10':4020,'y10':0,'state_gate_open':1,'object_type':0,'client_idk0':0,'client_idk1':0,'direction':0}
mob={'runtime_id':10100,'template_resource_id':750,'npc_type':0,'selling_group':0,'scale_percent':100,'weapon_1_item_id':0,'weapon_2_item_id':0,'name':'Worm','group_nation':0,'level':1,'x10':3200,'z10':4100,'y10':0,'state_gate_open':1,'object_type':0,'client_idk0':0,'client_idk1':0,'direction':0}
specs=[
 ('npc_region_list.bin','WIZ_NPC_REGION','s2c_runtime_ids','S2C',{'runtime_ids':[10001,10100]},'region-list'),
 ('req_npcin_request.bin','WIZ_REQ_NPCIN','c2s_missing_ids','C2S',{'runtime_ids':[10001,10100]},'detail-request'),
 ('req_npcin_response.bin','WIZ_REQ_NPCIN','s2c_detail_records','S2C',{'records':[npc,mob]},'detail-response'),
 ('npc_in_spawn.bin','WIZ_NPC_INOUT','in','S2C',{'record':npc},'npc-spawn'),
 ('npc_out_despawn.bin','WIZ_NPC_INOUT','out','S2C',{'runtime_id':10001},'npc-despawn'),
 ('monster_in_spawn.bin','WIZ_NPC_INOUT','in','S2C',{'record':mob},'monster-spawn'),
 ('monster_out_despawn.bin','WIZ_NPC_INOUT','out','S2C',{'runtime_id':10100},'monster-despawn')]
OUT.mkdir(parents=True,exist_ok=True); entries=[]
for fn,name,var,direction,values,role in specs:
    payload=encode_visibility_payload(name,var,values); raw=build_frame(payload); (OUT/fn).write_bytes(raw)
    entries.append({'file':fn,'name':name,'variant':var,'direction':direction,'role':role,'payload_bytes':len(payload),'frame_bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'frame_hex':raw.hex(),'provenance':'exact-layout / representative-values','source_commit':SOURCE})
(OUT/'manifest.json').write_text(json.dumps({'format':'ko1298-visibility-golden-fixtures-v1','frame':'AA55 + u16le payload length + payload + 55AA','note':'Values are deterministic representatives; packet shapes/signedness are exact 1298 source-derived.','fixtures':entries},separators=(',',':'))+'\n',encoding='utf-8')
print(json.dumps({'generated':len(entries),'status':'PASS'}))
