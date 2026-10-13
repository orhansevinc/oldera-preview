import fs from 'node:fs';
import path from 'node:path';
import { Reporter } from './lib/reporter.mjs';
const root=process.argv[2]||process.env.QA_CLIENT_DIR||'.qa-target/client';
const r=new Reporter();
try{
  const req=['index.html','KnightOnLine.js','KnightOnLine.wasm','KnightOnLine.data'];
  const sizes={};
  for(const f of req){const p=path.join(root,f);const st=fs.statSync(p);if(!st.isFile()||st.size===0)throw new Error(`${f} missing/empty`);sizes[f]=st.size;}
  const magic=fs.readFileSync(path.join(root,'KnightOnLine.wasm')).subarray(0,4).toString('hex');
  if(magic!=='0061736d')throw new Error(`invalid WASM magic ${magic}`);
  if(sizes['KnightOnLine.data']<1024*1024)throw new Error('KnightOnLine.data unexpectedly small');
  r.pass(0,'Canonical browser package is complete and WASM header is valid',{root,sizes,wasmMagic:magic});
}catch(e){r.fail(0,e.message,{root});process.exitCode=1;}
