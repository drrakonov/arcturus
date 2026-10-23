import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveSnapshot } from '../engine/dist/snapshot.js';
import { Engine } from '../engine/dist/trade/engine.js';
import { resetDemo } from '../scripts/reset-demo.mjs';

test('atomic snapshots restore exact state and failed serialization/rename preserve the old file',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'arcturus-snapshot-')),path=join(dir,'snapshot.json');
  try {
    const engine=new Engine();engine.createOrder('SOL_INR','9','0.3','sell','2');
    saveSnapshot(path,engine.getSnapshot());
    const old=await readFile(path,'utf8');
    assert.deepEqual(new Engine({snapshot:JSON.parse(old)}).getSnapshot().balances,engine.getSnapshot().balances);
    assert.throws(()=>saveSnapshot(path,{broken:1n}));assert.equal(await readFile(path,'utf8'),old);
    const original=fs.renameSync;
    try {fs.renameSync=()=>{throw new Error('simulated rename failure');};assert.throws(()=>saveSnapshot(path,{next:true}),/rename failure/);}
    finally {fs.renameSync=original;}
    assert.equal(await readFile(path,'utf8'),old);assert.deepEqual(await readdir(dir),['snapshot.json']);
    engine.createOrder('SOL_INR','10','0.1','buy','1');saveSnapshot(path,engine.getSnapshot());
    const restored=new Engine({snapshot:JSON.parse(await readFile(path,'utf8'))});
    assert.deepEqual(restored.getSnapshot().balances,engine.getSnapshot().balances);
    assert.equal(restored.getAccount('2').openOrders[0].filled,0.1);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('offline reset requires explicit confirmation, Redis target and absolute snapshot path',async()=>{
  for(const options of [{},{confirmed:true},{confirmed:true,redisUrl:'redis://localhost',snapshotPath:'relative.json'}])
    await assert.rejects(resetDemo(options),/requires RESET_DEMO/);
});
