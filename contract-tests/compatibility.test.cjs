'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const { classifyChange, compareDescriptors }=require('./lib/compatibility.cjs');

test('removing a required method is breaking',()=>{
  const result=classifyChange({methods:['get','put'],fields:[],semantics:[]},{methods:['get'],fields:[],semantics:[]});
  assert.equal(result.breaking,true);
  assert.ok(result.issues.some(i=>i.code==='REMOVED_METHOD'&&i.name==='put'));
});

test('conflicting field type is breaking',()=>{
  const issues=compareDescriptors(['zoneId:uint16'],['zoneId:string'],'field');
  assert.ok(issues.some(i=>i.code==='CONFLICTING_TYPE'));
});

test('adding optional/additional surface does not break existing requirements',()=>{
  const result=classifyChange({methods:['get'],fields:['id:string'],semantics:['authoritative']},{methods:['get','list'],fields:['id:string','displayName:string'],semantics:['authoritative','cached-view']});
  assert.equal(result.breaking,false);
  assert.deepEqual(result.issues,[]);
});

test('removing transaction/authority semantic is breaking',()=>{
  const result=classifyChange({methods:['transfer'],fields:[],semantics:['single-transaction','server-authoritative']},{methods:['transfer'],fields:[],semantics:['server-authoritative']});
  assert.equal(result.breaking,true);
  assert.ok(result.issues.some(i=>i.code==='REMOVED_SEMANTIC'&&i.name==='single-transaction'));
});
