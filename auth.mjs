import {randomBytes,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';

const form=body=>({method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
export function createAuth(env,request){
 const pending=new Map(),directory=path.resolve(env.DATA_DIR||'data');
 const encryptionKey=createHash('sha256').update(env.PUBLISHER_API_KEY).digest();
 let serial=Promise.resolve();
 async function read(){
  try{const data=JSON.parse(await readFile(path.join(directory,'accounts.enc.json'),'utf8'));const decipher=createDecipheriv('aes-256-gcm',encryptionKey,Buffer.from(data.iv,'hex'));decipher.setAuthTag(Buffer.from(data.tag,'hex'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.value,'hex')),decipher.final()]).toString())}
  catch(error){if(error.code==='ENOENT')return {};throw new Error('Cannot read account storage. Restore the original server key or reconnect accounts.')}
 }
 async function write(data){
  await mkdir(directory,{recursive:true,mode:0o700});const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey,iv);
  const value=Buffer.concat([cipher.update(JSON.stringify(data)),cipher.final()]);const target=path.join(directory,'accounts.enc.json'),temp=target+'.'+randomBytes(8).toString('hex');
  await writeFile(temp,JSON.stringify({iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),value:value.toString('hex')}),{mode:0o600});await rename(temp,target);
 }
 function change(fn){const result=serial.then(async()=>{const data=await read();const value=await fn(data);await write(data);return value});serial=result.catch(()=>{});return result}
 const callback=provider=>{
  const base=new URL(env.PUBLIC_BASE_URL);if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw new Error('PUBLIC_BASE_URL must be an HTTPS origin');
  return new URL(`/oauth/callback/${provider}`,base).href;
 };
 const requirements={meta:['PUBLIC_BASE_URL','META_GRAPH_VERSION','META_APP_ID','META_APP_SECRET'],tiktok:['PUBLIC_BASE_URL','TIKTOK_CLIENT_KEY','TIKTOK_CLIENT_SECRET'],google:['PUBLIC_BASE_URL','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET']};
 function status(){return Object.fromEntries(Object.entries(requirements).map(([provider,keys])=>[provider,{missing:keys.filter(key=>!env[key])}]))}
 function start(provider){
  if(!requirements[provider])throw new Error('Unsupported OAuth provider');const missing=status()[provider].missing;if(missing.length)throw new Error(`Missing: ${missing.join(', ')}`);
  const redirect=callback(provider),state=randomBytes(32).toString('hex');
  for(const [id,item]of pending)if(item.expires<Date.now())pending.delete(id);
  if(pending.size>100)throw new Error('Too many pending connections');
  pending.set(state,{provider,expires:Date.now()+600000});
  const urls={meta:`https://www.facebook.com/${env.META_GRAPH_VERSION}/dialog/oauth`,tiktok:'https://www.tiktok.com/v2/auth/authorize/',google:'https://accounts.google.com/o/oauth2/v2/auth'};
  const url=new URL(urls[provider]);url.search=new URLSearchParams({response_type:'code',redirect_uri:redirect,state,...(provider==='meta'?{client_id:env.META_APP_ID,scope:'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish'}:provider==='tiktok'?{client_key:env.TIKTOK_CLIENT_KEY,scope:'user.info.basic,video.publish'}:{client_id:env.GOOGLE_CLIENT_ID,scope:'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',access_type:'offline',prompt:'consent'})}).toString();
  return {url:url.href};
 }
 async function complete(provider,query){
  const state=query.get('state'),item=pending.get(state);pending.delete(state);
  if(!item||item.provider!==provider||item.expires<Date.now())throw new Error('Connection expired. Start connecting again.');
  if(query.get('error')||!query.get('code'))throw new Error('Connection was not authorized');
  const redirect=callback(provider),code=query.get('code');
  if(provider==='meta'){
   const base=`https://graph.facebook.com/${env.META_GRAPH_VERSION}`;
   const token=await request(`${base}/oauth/access_token`,form({client_id:env.META_APP_ID,client_secret:env.META_APP_SECRET,redirect_uri:redirect,code}));
   const extended=await request(`${base}/oauth/access_token`,form({grant_type:'fb_exchange_token',client_id:env.META_APP_ID,client_secret:env.META_APP_SECRET,fb_exchange_token:token.access_token}));
   const pages=await request(`${base}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100`,{headers:{authorization:`Bearer ${extended.access_token}`}});
   if(!pages.data?.length)throw new Error('No manageable Facebook Pages were returned');
   await change(data=>{data.metaPages=pages.data});return;
  }
  if(provider==='tiktok'){
   const token=await request('https://open.tiktokapis.com/v2/oauth/token/',form({client_key:env.TIKTOK_CLIENT_KEY,client_secret:env.TIKTOK_CLIENT_SECRET,code,grant_type:'authorization_code',redirect_uri:redirect}));
   if(!token.access_token||!token.refresh_token)throw new Error('TikTok did not return account credentials');
   const account=await request('https://open.tiktokapis.com/v2/post/publish/creator_info/query/',{method:'POST',headers:{authorization:`Bearer ${token.access_token}`,'content-type':'application/json'},body:'{}'});
   await change(data=>{data.tiktok={accessToken:token.access_token,refreshToken:token.refresh_token,expires:Date.now()+token.expires_in*1000,username:account.data.creator_username}});return;
  }
  const token=await request('https://oauth2.googleapis.com/token',form({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,code,grant_type:'authorization_code',redirect_uri:redirect}));
  const channels=await request('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',{headers:{authorization:`Bearer ${token.access_token}`}});
  if(channels.items?.length!==1)throw new Error('Choose the intended YouTube channel during authorization');
  await change(data=>{data.google={accessToken:token.access_token,refreshToken:token.refresh_token||data.google?.refreshToken,expires:Date.now()+token.expires_in*1000,channelId:channels.items[0].id,name:channels.items[0].snippet.title}});
 }
 async function accounts(){const data=await read();return {metaPages:(data.metaPages||[]).map(page=>({id:page.id,name:page.name,instagram:page.instagram_business_account})),selectedPage:data.selectedPage||null,tiktok:data.tiktok?.username||null,youtube:data.google?{id:data.google.channelId,name:data.google.name}:null}}
 async function select(pageId){await change(data=>{if(!data.metaPages?.some(page=>page.id===pageId))throw new Error('Page is not in the authorized account list');data.selectedPage=pageId})}
 async function environment(){
  // Serialize token refreshes so rotated refresh tokens cannot overwrite each other.
  return change(async data=>{
   let tiktokFailed=false,googleFailed=false;
   if(data.tiktok&&data.tiktok.expires<Date.now()+60000){try{
    const token=await request('https://open.tiktokapis.com/v2/oauth/token/',form({client_key:env.TIKTOK_CLIENT_KEY,client_secret:env.TIKTOK_CLIENT_SECRET,grant_type:'refresh_token',refresh_token:data.tiktok.refreshToken}));
    if(!token.access_token||!token.refresh_token)throw new Error('Reconnect TikTok');Object.assign(data.tiktok,{accessToken:token.access_token,refreshToken:token.refresh_token,expires:Date.now()+token.expires_in*1000});
   }catch{tiktokFailed=true}}
   if(data.google&&data.google.expires<Date.now()+60000){try{
    if(!data.google.refreshToken)throw new Error('Reconnect YouTube to grant offline access');
    const token=await request('https://oauth2.googleapis.com/token',form({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,grant_type:'refresh_token',refresh_token:data.google.refreshToken}));
    if(!token.access_token)throw new Error('Reconnect YouTube');Object.assign(data.google,{accessToken:token.access_token,expires:Date.now()+token.expires_in*1000});
   }catch{googleFailed=true}}
   const result={...env},page=data.metaPages?.find(page=>page.id===data.selectedPage);
   if(page){Object.assign(result,{FACEBOOK_PAGE_ID:page.id,FACEBOOK_PAGE_TOKEN:page.access_token});if(page.instagram_business_account)Object.assign(result,{INSTAGRAM_ACCOUNT_ID:page.instagram_business_account.id,INSTAGRAM_ACCESS_TOKEN:page.access_token})}
   if(data.tiktok&&!tiktokFailed)Object.assign(result,{TIKTOK_ACCESS_TOKEN:data.tiktok.accessToken,TIKTOK_USERNAME:data.tiktok.username});
   if(data.google&&!googleFailed)Object.assign(result,{YOUTUBE_ACCESS_TOKEN:data.google.accessToken,YOUTUBE_CHANNEL_ID:data.google.channelId});
   if(tiktokFailed){delete result.TIKTOK_ACCESS_TOKEN;delete result.TIKTOK_USERNAME}
   if(googleFailed){delete result.YOUTUBE_ACCESS_TOKEN;delete result.YOUTUBE_CHANNEL_ID}
   return result;
  });
 }
 return {status,start,complete,accounts,select,environment};
}
