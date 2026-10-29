const required=(env,key)=>{if(!env[key])throw new Error(`Missing ${key}`);return env[key]};
export class SetupError extends Error {}
const json=(body,token)=>({method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(body)});
export function configuration(platform,env=process.env){
 const keys={facebook:['META_GRAPH_VERSION','FACEBOOK_PAGE_ID','FACEBOOK_PAGE_TOKEN'],instagram:['META_GRAPH_VERSION','INSTAGRAM_ACCOUNT_ID','INSTAGRAM_ACCESS_TOKEN'],tiktok:['TIKTOK_ACCESS_TOKEN','TIKTOK_USERNAME'],youtube:['YOUTUBE_ACCESS_TOKEN','YOUTUBE_CHANNEL_ID']}[platform];
 if(!keys)throw new SetupError('Unsupported platform');return keys.filter(key=>!env[key]);
}
export function createProviders(fetcher=fetch){
 async function request(url,options={}){
  const response=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(60000)});
  const body=await response.json();
  if(!response.ok||(body.error?.code&&body.error.code!=='ok'))throw new Error('Provider rejected request; check permissions, token expiry and media requirements');
  return body;
 }
 const graph=env=>`https://graph.facebook.com/${required(env,'META_GRAPH_VERSION')}`;
 async function connection(platform,env){
  const missing=configuration(platform,env);if(missing.length)return {connected:false,missing};
  if(platform==='facebook'||platform==='instagram'){
   const id=platform==='facebook'?env.FACEBOOK_PAGE_ID:env.INSTAGRAM_ACCOUNT_ID;
   const token=platform==='facebook'?env.FACEBOOK_PAGE_TOKEN:env.INSTAGRAM_ACCESS_TOKEN;
   const result=await request(`${graph(env)}/${encodeURIComponent(id)}?fields=${platform==='facebook'?'id,name':'id,username'}`,{headers:{authorization:`Bearer ${token}`}});
   if(result.id!==id)throw new SetupError('Account identity mismatch');
   return {connected:true,missing:[],id,name:result.name||result.username};
  }
  if(platform==='tiktok'){
   const result=await request('https://open.tiktokapis.com/v2/post/publish/creator_info/query/',json({},env.TIKTOK_ACCESS_TOKEN));
   const creator=result.data;if(creator.creator_username!==env.TIKTOK_USERNAME)throw new SetupError('TikTok account identity mismatch');
   return {connected:true,missing:[],id:creator.creator_username,name:creator.creator_nickname,creator};
  }
  const result=await request('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',{headers:{authorization:`Bearer ${env.YOUTUBE_ACCESS_TOKEN}`}});
  const channel=result.items?.find(item=>item.id===env.YOUTUBE_CHANNEL_ID);if(!channel)throw new SetupError('YouTube channel identity mismatch');
  return {connected:true,missing:[],id:channel.id,name:channel.snippet.title};
 }
 async function preflight(platform,draft,env){
  const missing=configuration(platform,env);if(missing.length)throw new SetupError(`Missing: ${missing.join(', ')}`);
  const account=await connection(platform,env);
  if(draft.targets?.[platform]!==account.id)throw new SetupError('Account changed. Create a new draft and review the target.');
  if(platform==='tiktok'){
   const options=draft.options?.tiktok,creator=account.creator;
   if(!options?.privacyLevel||!creator.privacy_level_options.includes(options.privacyLevel))throw new SetupError('Choose a TikTok privacy option offered by this account');
   if(!options.consent)throw new SetupError('TikTok content posting consent is required');
   if(!Number.isFinite(draft.durationSeconds)||draft.durationSeconds<=0||draft.durationSeconds>creator.max_video_post_duration_sec)throw new SetupError('Video duration exceeds the TikTok account limit or is missing');
   if(options.brandContentToggle&&options.privacyLevel==='SELF_ONLY')throw new SetupError('Branded content cannot be posted as private');
  }
  if(platform==='youtube'){
   if(!['private','unlisted','public'].includes(draft.options?.youtube?.privacyStatus)||typeof draft.options.youtube.madeForKids!=='boolean')throw new SetupError('Choose YouTube visibility and audience');
   const media=new URL(draft.videoUrl),allowed=(env.MEDIA_ALLOWED_HOSTS||'').split(',').map(s=>s.trim()).filter(Boolean);
   if(env.PUBLIC_BASE_URL)allowed.push(new URL(env.PUBLIC_BASE_URL).hostname);
   if(media.protocol!=='https:'||media.username||media.password||!allowed.includes(media.hostname)||media.port)throw new SetupError('YouTube media host is not explicitly allowed');
  }
  return account;
 }
 async function submit(platform,draft,env,checkpoint=async()=>{}){
  if(platform==='instagram'){
   const result=await request(`${graph(env)}/${env.INSTAGRAM_ACCOUNT_ID}/media`,json({media_type:'REELS',video_url:draft.videoUrl,caption:draft.captions.instagram},env.INSTAGRAM_ACCESS_TOKEN));
   return {state:'processing',phase:'container',providerId:result.id};
  }
  if(platform==='facebook'){
   const result=await request(`${graph(env)}/${env.FACEBOOK_PAGE_ID}/video_reels`,json({upload_phase:'start'},env.FACEBOOK_PAGE_TOKEN));
   await checkpoint({state:'unknown',providerId:result.video_id,message:'Upload outcome must be checked before retrying'});
   const upload=new URL(result.upload_url);if(upload.protocol!=='https:'||upload.hostname!=='rupload.facebook.com'||upload.port)throw new Error('Unexpected Meta upload destination');
   await request(upload.href,{method:'POST',headers:{authorization:`OAuth ${env.FACEBOOK_PAGE_TOKEN}`,file_url:draft.videoUrl}});
   return {state:'processing',phase:'upload',providerId:result.video_id};
  }
  if(platform==='tiktok'){
   const {creator}=await connection(platform,env),options=draft.options.tiktok;
   const result=await request('https://open.tiktokapis.com/v2/post/publish/video/init/',json({post_info:{title:draft.captions.tiktok,privacy_level:options.privacyLevel,disable_comment:creator.comment_disabled||options.disableComment,disable_duet:creator.duet_disabled||options.disableDuet,disable_stitch:creator.stitch_disabled||options.disableStitch,brand_content_toggle:options.brandContentToggle,brand_organic_toggle:options.brandOrganicToggle,is_aigc:options.isAigc},source_info:{source:'PULL_FROM_URL',video_url:draft.videoUrl}},env.TIKTOK_ACCESS_TOKEN));
   return {state:'processing',phase:'publishing',providerId:result.data.publish_id};
  }
  if(platform==='youtube'){
   // Operator-allowlisted media hosts only, no redirects, bounded memory, no media auth.
   const response=await fetcher(draft.videoUrl,{redirect:'error',signal:AbortSignal.timeout(120000)});
   if(!response.ok)throw new Error('Cannot read media');
   const max=256*1024*1024,parts=[];let size=0;
   if(Number(response.headers.get('content-length'))>max){await response.body.cancel();throw new Error('Video exceeds 256 MiB')}
   for await(const chunk of response.body){size+=chunk.length;if(size>max)throw new Error('Video exceeds 256 MiB');parts.push(chunk)}
   if(!size)throw new Error('Empty video');const video=Buffer.concat(parts);
   const start=await fetcher('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',{...json({snippet:{title:draft.title,description:draft.captions.youtube},status:{privacyStatus:draft.options.youtube.privacyStatus,selfDeclaredMadeForKids:draft.options.youtube.madeForKids,containsSyntheticMedia:draft.options.youtube.containsSyntheticMedia}},env.YOUTUBE_ACCESS_TOKEN),headers:{...json({},env.YOUTUBE_ACCESS_TOKEN).headers,'x-upload-content-length':String(size),'x-upload-content-type':'video/mp4'},redirect:'error',signal:AbortSignal.timeout(60000)});
   if(!start.ok)throw new Error('YouTube rejected upload initialization');
   const upload=new URL(start.headers.get('location'));if(upload.protocol!=='https:'||upload.hostname!=='www.googleapis.com'||!upload.pathname.startsWith('/upload/')||upload.port)throw new Error('Unexpected YouTube upload destination');
   await checkpoint({state:'unknown',message:'Upload started; inspect YouTube Studio if completion is uncertain'});
   const result=await request(upload.href,{method:'PUT',headers:{authorization:`Bearer ${env.YOUTUBE_ACCESS_TOKEN}`,'content-type':'video/mp4','content-length':String(size)},body:video});
   return {state:'processing',phase:'publishing',providerId:result.id};
  }
  throw new Error('Unsupported platform');
 }
 async function finish(platform,previous,draft,env){
  const id=previous.providerId;
  if(platform==='instagram'){
   if(previous.phase==='publishing'){
    const result=await request(`${graph(env)}/${encodeURIComponent(id)}?fields=id,permalink`,{headers:{authorization:`Bearer ${env.INSTAGRAM_ACCESS_TOKEN}`}});
    return {state:'verified',providerId:id,url:result.permalink};
   }
   const status=await request(`${graph(env)}/${encodeURIComponent(id)}?fields=status_code`,{headers:{authorization:`Bearer ${env.INSTAGRAM_ACCESS_TOKEN}`}});
   if(['ERROR','EXPIRED'].includes(status.status_code))return {state:'failed',providerId:id,message:'Instagram media processing failed'};
   if(status.status_code!=='FINISHED')return previous;
   const result=await request(`${graph(env)}/${env.INSTAGRAM_ACCOUNT_ID}/media_publish`,json({creation_id:id},env.INSTAGRAM_ACCESS_TOKEN));
   return {state:'processing',phase:'publishing',providerId:result.id};
  }
  if(platform==='facebook'){
   if(previous.phase==='publishing'){
    const result=await request(`${graph(env)}/${encodeURIComponent(id)}?fields=id,permalink_url,published`,{headers:{authorization:`Bearer ${env.FACEBOOK_PAGE_TOKEN}`}});
    return result.published?{state:'verified',providerId:id,url:result.permalink_url}:previous;
   }
   const result=await request(`${graph(env)}/${encodeURIComponent(id)}?fields=status`,{headers:{authorization:`Bearer ${env.FACEBOOK_PAGE_TOKEN}`}});
   if(result.status?.video_status==='error')return {state:'failed',providerId:id,message:'Facebook processing failed'};
   if(result.status?.uploading_phase?.status!=='complete'||result.status?.processing_phase?.status!=='complete')return previous;
   await request(`${graph(env)}/${env.FACEBOOK_PAGE_ID}/video_reels`,json({upload_phase:'finish',video_id:id,video_state:'PUBLISHED',description:draft.captions.facebook},env.FACEBOOK_PAGE_TOKEN));
   return {state:'processing',phase:'publishing',providerId:id};
  }
  if(platform==='tiktok'){
   const result=await request('https://open.tiktokapis.com/v2/post/publish/status/fetch/',json({publish_id:id},env.TIKTOK_ACCESS_TOKEN));
   if(result.data.status==='FAILED')return {state:'failed',providerId:id,message:'TikTok processing failed'};
   const postId=result.data.publicaly_available_post_id?.[0]||result.data.publicly_available_post_id?.[0];
   if(result.data.status==='PUBLISH_COMPLETE')return {state:'verified',providerId:id,...(postId?{postId,url:`https://www.tiktok.com/@${encodeURIComponent(env.TIKTOK_USERNAME)}/video/${postId}`}:{message:'Provider confirms completion; visibility may be private'})};
   return previous;
  }
  if(platform==='youtube'){
   const result=await request(`https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=${encodeURIComponent(id)}`,{headers:{authorization:`Bearer ${env.YOUTUBE_ACCESS_TOKEN}`}});
   const video=result.items?.[0];if(!video)return previous;
   if(['failed','rejected','deleted'].includes(video.status?.uploadStatus))return {state:'failed',providerId:id,message:'YouTube processing failed'};
   if(video.status?.uploadStatus==='processed')return {state:'verified',providerId:id,url:`https://www.youtube.com/watch?v=${id}`,visibility:video.status.privacyStatus};
   return previous;
  }
  throw new Error('Unsupported platform');
 }
 return {request,connection,preflight,submit,finish};
}
