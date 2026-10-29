import http from 'node:http';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile,rename,open,unlink,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {configuration,createProviders} from './providers.mjs';
import {createAuth} from './auth.mjs';

export const platforms=['facebook','instagram','tiktok','youtube'];
export function validateDraft(body){
 const url=new URL(body.videoUrl);
 if(url.protocol!=='https:'||url.username||url.password||url.port)throw new Error('Use a public HTTPS media URL without credentials or custom port');
 if(!Array.isArray(body.platforms)||!body.platforms.length||new Set(body.platforms).size!==body.platforms.length||body.platforms.some(p=>!platforms.includes(p)))throw new Error('Choose supported, unique platforms');
 if(!body.title||typeof body.title!=='string'||body.title.length>100)throw new Error('Title must contain 1–100 characters');
 if(body.platforms.some(p=>typeof body.captions?.[p]!=='string'||body.captions[p].length>2200))throw new Error('Each platform needs a caption of at most 2200 characters');
 const options={},input=body.options||{};
 if(input.tiktok){const option=input.tiktok;options.tiktok={privacyLevel:String(option.privacyLevel||''),...Object.fromEntries(['consent','disableComment','disableDuet','disableStitch','brandContentToggle','brandOrganicToggle','isAigc'].map(key=>[key,option[key]===true]))}}
 if(input.youtube){const option=input.youtube;options.youtube={privacyStatus:String(option.privacyStatus||''),...(typeof option.madeForKids==='boolean'?{madeForKids:option.madeForKids}:{}),containsSyntheticMedia:option.containsSyntheticMedia===true}}
 return {title:body.title,videoUrl:url.href,platforms:body.platforms,captions:Object.fromEntries(body.platforms.map(p=>[p,body.captions[p]])),options,durationSeconds:Number(body.durationSeconds)||null};
}
export function createServer(env=process.env,providers=createProviders()){
 const key=env.PUBLISHER_API_KEY;if(!key||key.length<32)throw new Error('Set PUBLISHER_API_KEY to a random value of at least 32 characters');
 const directory=path.resolve(env.DATA_DIR||'data'),auth=createAuth(env,providers.request);
 const locks=new Set(),validId=id=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
 const load=async id=>{if(!validId(id))throw new Error('Invalid draft ID');return JSON.parse(await readFile(path.join(directory,id+'.json'),'utf8'))};
 const save=async draft=>{await mkdir(directory,{recursive:true,mode:0o700});const target=path.join(directory,draft.id+'.json'),temp=target+'.'+randomUUID();await writeFile(temp,JSON.stringify(draft,null,2),{mode:0o600});await rename(temp,target)};
 const assets={'/':['review.html','text/html; charset=utf-8'],'/review.js':['review.js','text/javascript'],'/style.css':['style.css','text/css']};
 const server=http.createServer(async(req,res)=>{
  res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');
  res.setHeader('content-security-policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const send=(status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(body))};
  let lock,ownsLock=false;
  try{
   const url=new URL(req.url,'http://localhost');
   if(req.method==='GET'&&url.pathname==='/health')return send(200,{ok:true});
   if(req.method==='GET'&&assets[url.pathname]){const [file,type]=assets[url.pathname];res.writeHead(200,{'content-type':type});return res.end(await readFile(new URL(file,import.meta.url)))}
   const media=url.pathname.match(/^\/media\/([a-f0-9-]{36})\.mp4$/);
   if((req.method==='GET'||req.method==='HEAD')&&media){
    const file=path.join(directory,'media',media[1]+'.mp4'),info=await stat(file);let start=0,end=info.size-1,status=200;
    if(req.headers.range){const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!range)return send(416,{error:'Invalid byte range'});start=Number(range[1]);end=range[2]?Number(range[2]):end;if(start>end||end>=info.size)return send(416,{error:'Invalid byte range'});status=206;res.setHeader('content-range',`bytes ${start}-${end}/${info.size}`)}
    res.writeHead(status,{'content-type':'video/mp4','content-length':end-start+1,'accept-ranges':'bytes'});if(req.method==='HEAD')return res.end();const stream=createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());return stream.pipe(res);
   }
   const callback=url.pathname.match(/^\/oauth\/callback\/(meta|tiktok|google)$/);
   if(req.method==='GET'&&callback){
    try{await auth.complete(callback[1],url.searchParams);res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end('<html lang="th"><meta charset="utf-8"><title>เชื่อมบัญชี</title><p>บันทึกการเชื่อมบัญชีแล้ว กลับไปหน้าหลักเพื่อตรวจชื่อบัญชีและเลือกเพจ</p><a href="/">กลับหน้าหลัก</a></html>')}
    catch{return send(400,{error:'เชื่อมบัญชีไม่สำเร็จหรือคำขอหมดอายุ กลับไปเริ่มเชื่อมอีกครั้งและตรวจสิทธิ์แอป'})}
   }
   const supplied=Buffer.from((req.headers.authorization||'').replace(/^Bearer /,'')),expected=Buffer.from(key);
   if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return send(401,{error:'กรุณาเข้าสู่ระบบด้วยกุญแจของเซิร์ฟเวอร์'});
   if(req.method==='POST'&&url.pathname==='/media'){
    const origin=new URL(env.PUBLIC_BASE_URL);if(origin.protocol!=='https:')return send(409,{error:'ตั้งค่าที่อยู่ HTTPS ของระบบก่อนอัปโหลดวิดีโอ'});
    if(req.headers['content-type']!=='video/mp4')return send(415,{error:'รองรับไฟล์ MP4 เท่านั้น'});
    const max=256*1024*1024;if(Number(req.headers['content-length'])>max)return send(413,{error:'ไฟล์ต้องไม่เกิน 256 MiB'});
    const id=randomUUID(),folder=path.join(directory,'media');await mkdir(folder,{recursive:true,mode:0o700});const file=path.join(folder,id+'.mp4'),handle=await open(file,'wx',0o600);let size=0,prefix=Buffer.alloc(0);
    try{for await(const chunk of req){size+=chunk.length;if(size>max)throw new Error('ไฟล์ต้องไม่เกิน 256 MiB');if(prefix.length<12)prefix=Buffer.concat([prefix,chunk.subarray(0,12-prefix.length)]);await handle.writeFile(chunk)}if(prefix.subarray(4,8).toString()!=='ftyp')throw new Error('ไฟล์นี้ไม่ใช่ MP4 ที่รองรับ');await handle.close()}
    catch(error){await handle.close().catch(()=>{});await unlink(file).catch(()=>{});throw error}
    return send(201,{videoUrl:new URL(`/media/${id}.mp4`,origin).href,size});
   }
   let body={};if(req.method==='POST'){let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>32768)return send(413,{error:'Request too large'})}body=JSON.parse(raw||'{}')}
   if(req.method==='GET'&&url.pathname==='/setup')return send(200,{oauth:auth.status(),accounts:await auth.accounts()});
   if(req.method==='POST'&&url.pathname==='/oauth/start')return send(200,auth.start(body.provider));
   if(req.method==='POST'&&url.pathname==='/accounts/meta/select'){await auth.select(body.pageId);return send(200,{ok:true})}
   if(req.method==='GET'&&url.pathname==='/connections'){
    const current=await auth.environment();
    const accounts=await Promise.all(platforms.map(async platform=>{try{return [platform,await providers.connection(platform,current)]}catch{return [platform,{connected:false,missing:configuration(platform,current),message:'ตรวจบัญชีไม่สำเร็จ กรุณาเชื่อมใหม่หรือตรวจสิทธิ์แอป'}]}}));
    return send(200,Object.fromEntries(accounts));
   }
   if(req.method==='GET'&&url.pathname==='/drafts'){
    await mkdir(directory,{recursive:true,mode:0o700});const files=(await readdir(directory)).filter(file=>file.endsWith('.json')&&validId(file.slice(0,-5)));
    const drafts=await Promise.all(files.map(file=>load(file.slice(0,-5))));return send(200,drafts.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100));
   }
   if(req.method==='POST'&&url.pathname==='/drafts'){
    const input=validateDraft(body),current=await auth.environment(),targets={},targetNames={};
    for(const platform of input.platforms){
     const account=await providers.connection(platform,current);if(!account.connected)return send(409,{error:`ยังไม่เชื่อมบัญชี ${platform}`,missing:account.missing});
     targets[platform]=account.id;targetNames[platform]=account.name;
    }
    const draft={...input,targets,targetNames,id:randomUUID(),createdAt:new Date().toISOString(),status:'awaiting_review',results:{}};await save(draft);return send(201,draft);
   }
   const match=url.pathname.match(/^\/drafts\/([a-f0-9-]+)(?:\/(publish|continue))?$/);
   if(!match)return send(404,{error:'Not found'});
   if(req.method==='GET'&&!match[2])return send(200,await load(match[1]));
   if(req.method!=='POST'||!match[2])return send(405,{error:'Method not allowed'});
   lock=match[1];if(locks.has(lock))return send(409,{error:'Draft is busy'});locks.add(lock);ownsLock=true;
   const draft=await load(lock);
   if(body.confirmation!==`PUBLISH ${draft.id}`)return send(400,{error:'ตรวจเนื้อหาและบัญชีปลายทางก่อนยืนยัน'});
   const current=await auth.environment();
   for(const platform of draft.platforms){
    const previous=draft.results[platform],continuing=match[2]==='continue'&&previous?.state==='processing';
    if(!continuing&&(match[2]==='continue'||previous&&previous.state!=='blocked'))continue;
    try{await providers.preflight(platform,draft,current)}catch(error){if(!continuing)draft.results[platform]={state:'blocked',message:error.message};await save(draft);continue}
    const checkpoint=async result=>{draft.results[platform]=result;await save(draft)};
    // Persist before any remote side effect. Uncertain outcomes are never resent automatically.
    await checkpoint({state:'unknown',providerId:previous?.providerId,message:'กำลังส่งคำขอ หากขาดการเชื่อมต่อให้ตรวจในแพลตฟอร์มก่อนลองใหม่'});
    try{draft.results[platform]=continuing?await providers.finish(platform,previous,draft,current):await providers.submit(platform,draft,current,checkpoint)}
    catch{draft.results[platform]={...draft.results[platform],state:'unknown',message:'ยังยืนยันผลไม่ได้ กรุณาตรวจในแพลตฟอร์มก่อนส่งซ้ำ'}}
    await save(draft);
   }
   draft.status=draft.platforms.every(p=>draft.results[p]?.state==='verified')?'verified':'review_results';await save(draft);return send(200,draft);
  }catch(error){return send(error.code==='ENOENT'?404:400,{error:error.code==='ENOENT'?'Draft not found':error instanceof SyntaxError?'Invalid JSON request':error.message})}
  finally{if(ownsLock)locks.delete(lock)}
 });
 server.requestTimeout=300000;server.headersTimeout=30000;return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const server=createServer();server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Publisher listening on configured port.'));
}
