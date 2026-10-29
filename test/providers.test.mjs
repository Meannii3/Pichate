import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProviders,SetupError} from '../providers.mjs';
const env={META_GRAPH_VERSION:'v-test',FACEBOOK_PAGE_ID:'fb',FACEBOOK_PAGE_TOKEN:'fb-token',INSTAGRAM_ACCOUNT_ID:'ig',INSTAGRAM_ACCESS_TOKEN:'ig-token',TIKTOK_ACCESS_TOKEN:'tt-token',TIKTOK_USERNAME:'studio',YOUTUBE_ACCESS_TOKEN:'yt-token',YOUTUBE_CHANNEL_ID:'yt',MEDIA_ALLOWED_HOSTS:'media.example.com'};
const draft={title:'title',videoUrl:'https://media.example.com/video.mp4',captions:{facebook:'fb',instagram:'ig',tiktok:'tt',youtube:'yt'},targets:{facebook:'fb',instagram:'ig',tiktok:'studio',youtube:'yt'},durationSeconds:20,options:{tiktok:{privacyLevel:'SELF_ONLY',consent:true,disableComment:true,disableDuet:true,disableStitch:true,brandContentToggle:false,brandOrganicToggle:false,isAigc:true},youtube:{privacyStatus:'private',madeForKids:false,containsSyntheticMedia:true}}};
const creator={creator_username:'studio',creator_nickname:'Studio',privacy_level_options:['SELF_ONLY'],max_video_post_duration_sec:60,comment_disabled:false,duet_disabled:false,stitch_disabled:false};
function queue(responses){const calls=[];const providers=createProviders(async(url,options)=>{calls.push({url:String(url),options});assert.ok(responses.length,'Unexpected request '+url);const result=responses.shift();return result instanceof Response?result:Response.json(result)});return {providers,calls}}
test('TikTok checks account, privacy, duration and consent before Direct Post',async()=>{
 const {providers,calls}=queue([{data:creator},{data:creator},{data:{publish_id:'pub'}},{data:{status:'PUBLISH_COMPLETE',publicaly_available_post_id:['123']}}]);
 await providers.preflight('tiktok',draft,env);const result=await providers.submit('tiktok',draft,env);assert.equal(result.providerId,'pub');
 const payload=JSON.parse(calls[2].options.body);assert.equal(payload.post_info.privacy_level,'SELF_ONLY');assert.equal(payload.post_info.is_aigc,true);assert.equal(payload.source_info.source,'PULL_FROM_URL');
 const final=await providers.finish('tiktok',result,draft,env);assert.equal(final.state,'verified');assert.equal(final.url,'https://www.tiktok.com/@studio/video/123');
 const bad=queue([{data:creator}]);await assert.rejects(()=>bad.providers.preflight('tiktok',{...draft,options:{tiktok:{privacyLevel:'PUBLIC_TO_EVERYONE',consent:true}}},env),SetupError);
});
test('YouTube uploads bytes, preserves audience, and reads processing state',async()=>{
 const {providers,calls}=queue([{items:[{id:'yt',snippet:{title:'Studio'}}]},new Response(Buffer.from('mp4-bytes'),{headers:{'content-length':'9'}}),new Response(null,{status:200,headers:{location:'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc'}}),{id:'yt-post'},{items:[{status:{uploadStatus:'processed',privacyStatus:'private'}}]}]);
 await providers.preflight('youtube',draft,env);const result=await providers.submit('youtube',draft,env);assert.equal(result.providerId,'yt-post');
 const metadata=JSON.parse(calls[2].options.body);assert.equal(metadata.status.privacyStatus,'private');assert.equal(metadata.status.selfDeclaredMadeForKids,false);assert.equal(calls[3].options.body.toString(),'mp4-bytes');
 const final=await providers.finish('youtube',result,draft,env);assert.equal(final.state,'verified');assert.equal(final.visibility,'private');assert.equal(calls[1].options.redirect,'error');assert.equal(calls[1].options.headers,undefined);
});
test('YouTube rejects media hosts outside the operator allowlist',async()=>{
 const {providers}=queue([{items:[{id:'yt',snippet:{title:'Studio'}}]}]);await assert.rejects(()=>providers.preflight('youtube',{...draft,videoUrl:'https://attacker.example/v.mp4'},env),SetupError);
});
test('Instagram waits for processing, publishes once, then reads permalink',async()=>{
 const {providers,calls}=queue([{id:'ig',username:'studio'},{id:'container'},{status_code:'IN_PROGRESS'},{status_code:'FINISHED'},{id:'post'},{id:'post',permalink:'https://www.instagram.com/reel/post/'}]);
 await providers.preflight('instagram',draft,env);const initial=await providers.submit('instagram',draft,env);
 assert.deepEqual(await providers.finish('instagram',initial,draft,env),initial);
 const published=await providers.finish('instagram',initial,draft,env);const final=await providers.finish('instagram',published,draft,env);assert.equal(final.state,'verified');assert.equal(calls.filter(call=>call.url.endsWith('/media_publish')).length,1);
});
test('Facebook checkpoints video ID before upload and verifies published readback',async()=>{
 const {providers,calls}=queue([{id:'fb',name:'Studio'},{video_id:'video',upload_url:'https://rupload.facebook.com/video-upload/video'},{success:true},{status:{uploading_phase:{status:'complete'},processing_phase:{status:'complete'}}},{success:true},{id:'video',published:true,permalink_url:'https://www.facebook.com/reel/video'}]);
 await providers.preflight('facebook',draft,env);let checkpoint;
 const initial=await providers.submit('facebook',draft,env,async value=>checkpoint=value);assert.equal(checkpoint.providerId,'video');
 const published=await providers.finish('facebook',initial,draft,env);const final=await providers.finish('facebook',published,draft,env);assert.equal(final.state,'verified');assert.equal(calls[2].options.headers.file_url,draft.videoUrl);
});
test('provider errors never include response credentials or private details',async()=>{
 const {providers}=queue([new Response(JSON.stringify({error:{message:'secret raw token'}}),{status:403})]);await assert.rejects(()=>providers.connection('facebook',env),error=>!error.message.includes('secret raw token'));
});
