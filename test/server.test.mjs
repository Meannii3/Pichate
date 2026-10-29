import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer,validateDraft} from '../server.mjs';
const example={title:'ตอนทดสอบ',videoUrl:'https://media.example.com/episode.mp4',platforms:['facebook','tiktok'],captions:{facebook:'ทดสอบ',tiktok:'ทดสอบ'}};
const key='a'.repeat(40);
async function fixture(fn,providers){
 const directory=await mkdtemp(path.join(os.tmpdir(),'publisher-test-'));
 const server=createServer({PUBLISHER_API_KEY:key,DATA_DIR:directory,PUBLIC_BASE_URL:'https://publisher.example.com'},providers);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const request=(route,body,auth=true,headers={})=>fetch(base+route,{method:body?'POST':'GET',headers:{...(auth?{authorization:`Bearer ${key}`}:{ }),'content-type':'application/json',...headers},...(body?{body:typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body)}:{})});
 try{await fn({request,directory,base})}finally{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true})}
}
const mockProviders=overrides=>({request:async()=>{throw new Error('Unexpected provider request')},connection:async p=>({connected:true,id:p+'-id',name:p+' account'}),preflight:async()=>{},submit:async p=>({state:'processing',phase:'publishing',providerId:p+'-post'}),finish:async(p,previous)=>({state:'verified',providerId:previous.providerId,url:'https://example.com/post'}),...overrides});
test('rejects invalid media and unsupported targets',()=>{
 for(const videoUrl of ['file:///etc/passwd','http://example.com/a','https://user:password@example.com/a','https://example.com:8080/a'])assert.throws(()=>validateDraft({...example,videoUrl}));
 assert.throws(()=>validateDraft({...example,platforms:['unknown']}));assert.throws(()=>validateDraft({...example,captions:{}}));
 assert.equal(validateDraft({...example,options:{tiktok:{consent:'false'}}}).options.tiktok.consent,false);
});
test('requires authentication and blocks unconnected draft creation',()=>fixture(async({request})=>{
 assert.equal((await request('/health',undefined,false)).status,200);assert.equal((await request('/connections',undefined,false)).status,401);
 const accounts=await (await request('/connections')).json();assert.equal(accounts.facebook.connected,false);
 assert.equal((await request('/drafts',example)).status,409);
 assert.equal((await request('/oauth/start',{provider:'google'})).status,400);
 assert.match(await (await request('/',undefined,false)).text(),/เตรียมครั้งเดียว ส่งทุกช่อง/);
}));
test('publishing requires confirmation, is not repeated, and verifies readback',()=>fixture(async({request})=>{
 const created=await request('/drafts',example);assert.equal(created.status,201);const draft=await created.json();
 assert.equal(draft.targets.facebook,'facebook-id');assert.equal((await request(`/drafts/${draft.id}/publish`,{})).status,400);
 const confirm={confirmation:`PUBLISH ${draft.id}`},route=`/drafts/${draft.id}`;
 const result=await (await request(route+'/publish',confirm)).json();assert.equal(result.results.facebook.state,'processing');
 assert.deepEqual((await (await request(route+'/publish',confirm)).json()).results,result.results);
 const verified=await (await request(route+'/continue',confirm)).json();assert.equal(verified.status,'verified');
 assert.equal((await (await request('/drafts')).json()).length,1);
},mockProviders()));
test('uncertain provider outcome persists checkpoint and is never retried',()=>{
 let calls=0;return fixture(async({request})=>{
 const draft=await (await request('/drafts',{...example,platforms:['facebook']})).json(),confirm={confirmation:`PUBLISH ${draft.id}`},route=`/drafts/${draft.id}/publish`;
 const first=await (await request(route,confirm)).json();assert.equal(first.results.facebook.state,'unknown');assert.equal(first.results.facebook.providerId,'checkpoint-id');
 await request(route,confirm);assert.equal(calls,1);
 },mockProviders({submit:async(p,d,e,checkpoint)=>{calls++;await checkpoint({state:'unknown',providerId:'checkpoint-id'});throw new Error('network lost')}}));
});
test('concurrent calls cannot clear another requests lock',()=>{
 let release,started,submissions=0;const gate=new Promise(resolve=>release=resolve),begun=new Promise(resolve=>started=resolve);
 return fixture(async({request})=>{
 const draft=await (await request('/drafts',{...example,platforms:['facebook']})).json(),confirm={confirmation:`PUBLISH ${draft.id}`},route=`/drafts/${draft.id}/publish`;
 const first=request(route,confirm);await begun;
 assert.equal((await request(route,confirm)).status,409);assert.equal((await request(route,confirm)).status,409);release();assert.equal((await first).status,200);assert.equal(submissions,1);
 },mockProviders({submit:async()=>{submissions++;started();await gate;return {state:'processing',providerId:'id'}}}));
});
test('media upload validates format, authenticates, and serves byte ranges',()=>fixture(async({request,directory})=>{
 const bytes=Buffer.concat([Buffer.from([0,0,0,20]),Buffer.from('ftypisom'),Buffer.alloc(24)]);
 assert.equal((await request('/media',bytes,false,{'content-type':'video/mp4'})).status,401);
 const uploaded=await request('/media',bytes,true,{'content-type':'video/mp4'});assert.equal(uploaded.status,201);const result=await uploaded.json();
 const route=new URL(result.videoUrl).pathname,range=await request(route,undefined,false,{range:'bytes=4-7'});assert.equal(range.status,206);assert.equal(await range.text(),'ftyp');
 assert.equal((await request(route,undefined,false,{range:'bytes=999-1000'})).status,416);
 assert.equal((await request('/media',Buffer.from('bad'),true,{'content-type':'video/mp4'})).status,400);
 assert.equal((await readdir(path.join(directory,'media'))).length,1);
 const secrets=await readFile(path.join(directory,'accounts.enc.json'),'utf8').catch(()=> '');assert.ok(!secrets.includes('accessToken'));
}));
