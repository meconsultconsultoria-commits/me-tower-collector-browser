import test from 'node:test';
import assert from 'node:assert/strict';
import {collectWithFailover, SOURCES} from './failover.js';
const fleet = Array.from({length:250}, (_,i)=>({plate:`TEST${i}`}));
const quiet={info(){},warn(){}};
test('primary success skips backup',async()=>{
  const calls=[];
  const result=await collectWithFailover(async s=>{calls.push(s);return fleet},quiet);
  assert.deepEqual(calls,[SOURCES[0]]);assert.equal(result.contingency,false);
});
test('network, login, and map failures activate backup',async()=>{
  for(const reason of ['timeout','login failed','map unavailable']){
    const calls=[];
    const result=await collectWithFailover(async s=>{calls.push(s);if(s===SOURCES[0])throw Error(reason);return fleet},quiet);
    assert.deepEqual(calls,SOURCES);assert.equal(result.source,SOURCES[1]);assert.equal(result.contingency,true);
  }
});
test('incomplete primary activates backup',async()=>{
  const result=await collectWithFailover(async s=>s===SOURCES[0]?fleet.slice(0,100):fleet,quiet);
  assert.equal(result.contingency,true);
});
test('both failing produce no result to ingest',async()=>{
  await assert.rejects(collectWithFailover(async()=>{throw Error('offline')},quiet),/nenhum dado enviado/);
  await assert.rejects(collectWithFailover(async()=>[],quiet),/nenhum dado enviado/);
});
test('next run retries primary after contingency',async()=>{
  await collectWithFailover(async s=>{if(s===SOURCES[0])throw Error();return fleet},quiet);
  const calls=[];await collectWithFailover(async s=>{calls.push(s);return fleet},quiet);
  assert.deepEqual(calls,[SOURCES[0]]);
});
