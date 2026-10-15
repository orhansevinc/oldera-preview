'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {MAGIC_COMMAND,decodeMagicProcessPayload,encodeMagicProcessPayload,parseMainRow,parseType1Row,parseType2Row,parseType3Row,parseType4Row,toClientSkillResult}=require('../../services/ko1298-combat');
test('1298 magic process request/result payload round-trips exact 21-byte layout',()=>{const input={command:MAGIC_COMMAND.EFFECTING,skillId:104001,sourceId:12,targetId:34,data:[1,-2,3,-4,5,-6]};const b=encodeMagicProcessPayload(input);assert.equal(b.length,21);assert.deepEqual(decodeMagicProcessPayload(b),input);});
test('malformed magic payload length is rejected',()=>assert.throws(()=>decodeMagicProcessPayload(Buffer.alloc(20)),/21 bytes/));
test('client result adapter preserves source target skill and fail opcode',()=>{const out=toClientSkillResult({ok:false,skillId:1,casterId:2,targetId:3,protocolErrorCode:-103});assert.equal(out.command,MAGIC_COMMAND.FAIL);assert.equal(out.data[3],-103);});
test('main parser enforces verified 30-column format',()=>assert.throws(()=>parseMainRow(['1'],{}),/30 columns/));
test('type parsers enforce exact verified column counts',()=>{assert.throws(()=>parseType1Row([1],{}),/12/);assert.throws(()=>parseType2Row([1],{}),/6/);assert.throws(()=>parseType3Row([1],{}),/7/);assert.throws(()=>parseType4Row([1],{}),/26/);});
