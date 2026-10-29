import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAuth} from '../auth.mjs';
const base={PUBLISHER_API_KEY:'k'.repeat(40),PUBLIC_BASE_URL:'https://publisher.example.com',GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'private-client-secret',META_GRAPH_VERSION:'v-test',META_APP_ID:'meta-id',META_APP_SECRET:'meta-secret'};
async function fixture(fn){const directory=await mkdtemp(path.join(os.tmpdir(),'publisher-auth-'));try{await fn({...base,DATA_DIR:directory})}finally{await rm(directory,{recursive:true,force:true})}}
test('OAuth state is expiring, provider-bound and one-use; secrets are encrypted',()=>fixture(async env=>{
 const calls=[];const auth=createAuth(env,async(url,options)=>{calls.push({url,options});if(url.includes('/token'))return {access_token:'private-access-token',refresh_token:'private-refresh-token',expires_in:3600};return {items:[{id:'channel',snippet:{title:'Studio'}}]}});
 const start=auth.start('google'),url=new URL(start.url);assert.equal(url.hostname,'accounts.google.com');assert.ok(!url.href.includes('private-client-secret'));
 const query=new URLSearchParams({state:url.searchParams.get('state'),code:'auth-code'});await auth.complete('google',query);await assert.rejects(()=>auth.complete('google',query));
 const stored=await readFile(path.join(env.DATA_DIR,'accounts.enc.json'),'utf8');assert.ok(!stored.includes('private-access-token'));assert.ok(!stored.includes('private-refresh-token'));
 const current=await auth.environment();assert.equal(current.YOUTUBE_CHANNEL_ID,'channel');assert.equal(current.YOUTUBE_ACCESS_TOKEN,'private-access-token');
 assert.deepEqual((await auth.accounts()).youtube,{id:'channel',name:'Studio'});assert.ok(!JSON.stringify(await auth.accounts()).includes('private-access-token'));
 const other=createAuth({...env,PUBLISHER_API_KEY:'x'.repeat(40)},async()=>{});await assert.rejects(()=>other.accounts(),/original server key/);
}));
test('Meta page selection comes only from authorized pages',()=>fixture(async env=>{
 let index=0;const replies=[{access_token:'short'},{access_token:'long'},{data:[{id:'page',name:'Studio',access_token:'page-secret',instagram_business_account:{id:'ig',username:'studio'}}]}];
 const auth=createAuth(env,async()=>replies[index++]);const url=new URL(auth.start('meta').url);await auth.complete('meta',new URLSearchParams({state:url.searchParams.get('state'),code:'code'}));
 await assert.rejects(()=>auth.select('unapproved'));await auth.select('page');const current=await auth.environment();assert.equal(current.FACEBOOK_PAGE_TOKEN,'page-secret');assert.equal(current.INSTAGRAM_ACCOUNT_ID,'ig');assert.ok(!JSON.stringify(await auth.accounts()).includes('page-secret'));
}));
test('OAuth expiry and provider mismatch reject before token exchange',()=>fixture(async env=>{
 const auth=createAuth(env,async()=>{throw new Error('Token exchange should not run')});
 await assert.rejects(()=>auth.complete('google',new URLSearchParams({state:'unknown',code:'x'})),/expired/);
 const url=new URL(auth.start('google').url);await assert.rejects(()=>auth.complete('meta',new URLSearchParams({state:url.searchParams.get('state'),code:'x'})),/expired/);
}));
test('expired OAuth state rejects without exchanging a token',()=>fixture(async env=>{
 const auth=createAuth(env,async()=>{throw new Error('Unexpected exchange')}),url=new URL(auth.start('google').url),original=Date.now;
 try{Date.now=()=>original()+700000;await assert.rejects(()=>auth.complete('google',new URLSearchParams({state:url.searchParams.get('state'),code:'code'})),/expired/)}finally{Date.now=original}
}));
test('an expired YouTube refresh failure does not break other accounts',()=>fixture(async env=>{
 let stage=0;const auth=createAuth(env,async url=>{
  if(stage===0&&url.includes('/token'))return {access_token:'temporary',refresh_token:'refresh',expires_in:-1};
  if(stage===0)return {items:[{id:'yt',snippet:{title:'Studio'}}]};
  throw new Error('Google refresh temporarily unavailable');
 });
 const url=new URL(auth.start('google').url);await auth.complete('google',new URLSearchParams({state:url.searchParams.get('state'),code:'code'}));stage=1;
 const current=await auth.environment();assert.equal(current.YOUTUBE_ACCESS_TOKEN,undefined);assert.equal(current.META_APP_ID,'meta-id');
}));
