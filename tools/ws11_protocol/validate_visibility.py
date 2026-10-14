#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from gameplay import parse_frame
from visibility import decode_visibility_payload,reencode_decoded
ROOT=Path(__file__).resolve().parents[2]
P=ROOT/'protocol-lab'/'VISIBILITY_PROTOCOL_PROFILE.json'
O=ROOT/'protocol-lab'/'PROTOCOL_OWNER_MATRIX.json'
D=ROOT/'protocol-lab'/'visibility-fixtures'
M=D/'manifest.json'
def die(x): raise SystemExit(f'WS11 visibility authority validation failed: {x}')
p=json.loads(P.read_text()); o=json.loads(O.read_text()); m=json.loads(M.read_text())
if p.get('milestone')!='MORADON_NPC_MOB_VISIBILITY': die('wrong milestone')
required={x['name']:x for x in p['required_packet_families']}
for name in ('WIZ_NPC_REGION','WIZ_REQ_NPCIN','WIZ_NPC_INOUT'):
    if required.get(name,{}).get('status')!='VERIFIED': die(f'{name} not VERIFIED')
    if required[name].get('blocking_milestone') is not True: die(f'{name} must be milestone-blocking')
rows={(x['opcode'],x['name']):x for x in o['matrix']}
for key in (('0x1C','WIZ_NPC_REGION'),('0x1D','WIZ_REQ_NPCIN'),('0x0A','WIZ_NPC_INOUT')):
    if key not in rows: die(f'owner row missing {key}')
if rows[('0x1D','WIZ_REQ_NPCIN')]['status']!='COLLISION_RESOLVED': die('0x1D ownership regression')
if 'WS14' not in rows[('0x1D','WIZ_REQ_NPCIN')]['semantic_owner'] or 'WS16' not in rows[('0x1D','WIZ_REQ_NPCIN')]['semantic_owner']: die('0x1D semantic split regression')
if p['monster_visibility']['status']!='VERIFIED': die('mob mapping not verified')
if p['position_y_wire']['y']!='i16le/10': die('Y wire contract drift')
if p['verification_summary']['unknown']: die('visibility milestone has UNKNOWN required rows')
if p['verification_summary']['blockers_for_ws50']: die('visibility profile unexpectedly blocks WS50')
listed={x['file'] for x in m['fixtures']}; actual={x.name for x in D.glob('*.bin')}
needed={'npc_region_list.bin','req_npcin_request.bin','req_npcin_response.bin','npc_in_spawn.bin','npc_out_despawn.bin','monster_in_spawn.bin','monster_out_despawn.bin'}
if listed!=actual: die(f'fixture manifest mismatch {sorted(listed ^ actual)}')
if not needed.issubset(listed): die(f'missing fixture(s) {sorted(needed-listed)}')
for e in m['fixtures']:
    raw=(D/e['file']).read_bytes()
    if hashlib.sha256(raw).hexdigest()!=e['sha256'] or raw.hex()!=e['frame_hex']: die(f"fixture integrity {e['file']}")
    payload=parse_frame(raw); d=decode_visibility_payload(payload,e['direction'])
    if d['name']!=e['name'] or d['variant']!=e['variant']: die(f"fixture decode {e['file']}")
    if reencode_decoded(d)!=payload: die(f"fixture roundtrip {e['file']}")
cap=p['canonical_ws10_capture']
if '0x0A NPC_IN' not in cap['not_observed']: die('capture non-observation must stay explicit')
print(json.dumps({'required_families':3,'fully_verified':len(p['verification_summary']['fully_verified']),'partial':len(p['verification_summary']['partial']),'unknown':0,'golden_fixtures':len(listed),'blockers_for_ws50':0,'status':'PASS'},sort_keys=True))
