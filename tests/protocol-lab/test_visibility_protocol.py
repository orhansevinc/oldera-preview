from __future__ import annotations
import json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools'/'ws11_protocol'))
from gameplay import parse_frame
from visibility import VisibilityProtocolError,decode_visibility_payload,encode_visibility_payload,reencode_decoded
DIR=ROOT/'protocol-lab'/'visibility-fixtures'

class VisibilityProtocolTests(unittest.TestCase):
    def test_all_visibility_golden_roundtrip(self):
        m=json.loads((DIR/'manifest.json').read_text()); self.assertEqual(len(m['fixtures']),7)
        for e in m['fixtures']:
            payload=parse_frame((DIR/e['file']).read_bytes()); d=decode_visibility_payload(payload,e['direction'])
            self.assertEqual(d['name'],e['name']); self.assertEqual(d['variant'],e['variant']); self.assertEqual(reencode_decoded(d),payload)
    def test_region_and_request_ids_are_signed_i16_runtime_ids(self):
        d=decode_visibility_payload(parse_frame((DIR/'npc_region_list.bin').read_bytes()),'S2C'); self.assertEqual(d['runtime_ids'],[10001,10100])
        req=decode_visibility_payload(parse_frame((DIR/'req_npcin_request.bin').read_bytes()),'C2S'); self.assertEqual(req['runtime_ids'],d['runtime_ids'])
    def test_npc_and_monster_share_exact_inout_record_family(self):
        npc=decode_visibility_payload(parse_frame((DIR/'npc_in_spawn.bin').read_bytes()),'S2C'); mob=decode_visibility_payload(parse_frame((DIR/'monster_in_spawn.bin').read_bytes()),'S2C')
        self.assertEqual(npc['record']['npc_type'],1); self.assertEqual(mob['record']['npc_type'],0); self.assertEqual(mob['record']['template_resource_id'],750)
    def test_out_is_exact_four_byte_payload(self):
        for fn in ('npc_out_despawn.bin','monster_out_despawn.bin'):
            payload=parse_frame((DIR/fn).read_bytes()); self.assertEqual(len(payload),4); self.assertEqual(decode_visibility_payload(payload,'S2C')['inout'],2)
    def test_y_is_signed_tenths(self):
        r={'runtime_id':100,'template_resource_id':750,'npc_type':0,'selling_group':0,'scale_percent':100,'weapon_1_item_id':0,'weapon_2_item_id':0,'name':'Worm','group_nation':0,'level':1,'x10':1,'z10':2,'y10':-123,'state_gate_open':1,'object_type':0,'client_idk0':0,'client_idk1':0,'direction':0}
        d=decode_visibility_payload(encode_visibility_payload('WIZ_NPC_INOUT','in',{'record':r}),'S2C'); self.assertEqual(d['record']['y10'],-123); self.assertEqual(d['record']['y'],-12.3)
    def test_negative_count_mismatch_fails_closed(self):
        with self.assertRaises(VisibilityProtocolError): decode_visibility_payload(bytes([0x1C,2,0,1,0]),'S2C')
    def test_negative_invalid_inout_type_fails_closed(self):
        with self.assertRaises(VisibilityProtocolError): decode_visibility_payload(bytes([0x0A,3,1,0]),'S2C')
    def test_negative_truncated_variable_name_fails_closed(self):
        good=parse_frame((DIR/'npc_in_spawn.bin').read_bytes())
        with self.assertRaises(VisibilityProtocolError): decode_visibility_payload(good[:-3],'S2C')
    def test_negative_runtime_id_overflow_rejected(self):
        with self.assertRaises(VisibilityProtocolError): encode_visibility_payload('WIZ_NPC_INOUT','out',{'runtime_id':40000})
if __name__=='__main__': unittest.main()
