const el=id=>document.getElementById(id),platforms=['facebook','instagram','tiktok','youtube'];
const names={facebook:'Facebook',instagram:'Instagram',tiktok:'TikTok',youtube:'YouTube'};
let connections={},loaded,pollTimer,pollCount=0;
const message=text=>{el('message').textContent=text};
async function call(route,body,method){
 const response=await fetch(route,{method:method||(body?'POST':'GET'),headers:{authorization:`Bearer ${el('key').value}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const value=await response.json();if(!response.ok)throw new Error(value.error||'ไม่สามารถทำรายการได้');return value;
}
function node(tag,text,className){const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element}
function fail(error){message(error.message)}
function updateOptions(){for(const p of ['tiktok','youtube'])el(p+'-options').hidden=!el('choose-'+p).checked}
for(const p of platforms){
 const card=node('div',undefined,'caption-card'),label=node('label'),check=node('input');check.type='checkbox';check.id='choose-'+p;check.disabled=true;check.onchange=updateOptions;label.append(check,document.createTextNode(names[p]));
 const caption=node('textarea');caption.id='caption-'+p;caption.maxLength=2200;caption.setAttribute('aria-label','แคปชัน '+names[p]);caption.placeholder='วางแคปชันจาก ChatGPT หรือพิมพ์ที่นี่';card.append(label,caption);el('platform-fields').append(card);
}
async function refresh(){
 message('กำลังตรวจบัญชี…');const setup=await call('/setup');el('setup-info').textContent=Object.entries(setup.oauth).map(([provider,item])=>`${provider}: ${item.missing.length?'ยังขาด '+item.missing.join(', '):'พร้อมเริ่มเชื่อมบัญชี'}`).join('\n');
 connections=await call('/connections');el('accounts').replaceChildren();
 for(const p of platforms){
  const account=connections[p],card=node('div',undefined,'account-card');card.append(node('h3',names[p]));card.append(node('p',account.connected?`${account.name} · ${account.id}`:'ยังไม่เชื่อมบัญชี',account.connected?'good':'bad'));
  if(!account.connected){const provider={facebook:'meta',instagram:'meta',tiktok:'tiktok',youtube:'google'}[p],button=node('button','เชื่อม '+names[p],'secondary');button.disabled=setup.oauth[provider].missing.length>0;button.onclick=async()=>{const popup=window.open('about:blank','_blank');if(popup)popup.opener=null;try{const result=await call('/oauth/start',{provider});if(popup){popup.location=result.url;message('เชื่อมบัญชีในแท็บใหม่ แล้วกลับมากดตรวจอีกครั้ง')}else{const link=node('a','เปิดหน้าเชื่อมบัญชี');link.href=result.url;link.target='_blank';link.rel='noopener noreferrer';message('กรุณาเปิดหน้าเชื่อมบัญชี: ');el('message').append(link)}}catch(error){if(popup)popup.close();fail(error)}};card.append(button)}
  el('accounts').append(card);el('choose-'+p).disabled=!account.connected;if(!account.connected)el('choose-'+p).checked=false;
 }
 const oldPrivacy=el('tiktok-privacy').value;el('tiktok-privacy').replaceChildren(new Option('เลือกการมองเห็น',''));
 const creator=connections.tiktok.creator;
 if(creator){for(const privacy of creator.privacy_level_options)el('tiktok-privacy').add(new Option(({SELF_ONLY:'ส่วนตัว',PUBLIC_TO_EVERYONE:'ทุกคน',MUTUAL_FOLLOW_FRIENDS:'เพื่อนที่ติดตามกัน',FOLLOWER_OF_CREATOR:'ผู้ติดตาม'})[privacy]||privacy,privacy));el('tiktok-privacy').value=oldPrivacy;
  for(const [id,key]of [['tt-comment','comment_disabled'],['tt-duet','duet_disabled'],['tt-stitch','stitch_disabled']]){el(id).disabled=creator[key];if(creator[key])el(id).checked=false}
 }
 el('page-choice').replaceChildren();for(const page of setup.accounts.metaPages){el('page-choice').add(new Option(page.name+(page.instagram?' · @'+page.instagram.username:''),page.id))}
 el('meta-selection').hidden=!setup.accounts.metaPages.length;if(setup.accounts.selectedPage)el('page-choice').value=setup.accounts.selectedPage;
 updateOptions();message('ตรวจบัญชีแล้ว เลือกช่องที่พร้อมเพื่อเตรียมโพสต์');await history();
}
el('login-form').onsubmit=async event=>{event.preventDefault();try{await call('/setup');el('workspace').hidden=false;el('login').hidden=true;await refresh()}catch(error){fail(error)}};
el('refresh').onclick=()=>refresh().catch(fail);
el('select-page').onclick=async()=>{try{await call('/accounts/meta/select',{pageId:el('page-choice').value});await refresh()}catch(error){fail(error)}};
for(const id of ['tt-brand','tt-own-brand'])el(id).onchange=()=>{el('tt-brand-note').hidden=!el('tt-brand').checked&&!el('tt-own-brand').checked};
el('file').onchange=async()=>{
 const file=el('file').files[0];if(!file)return;if(file.size>256*1024*1024)return message('ไฟล์ต้องไม่เกิน 256 MiB');
 const video=document.createElement('video'),objectUrl=URL.createObjectURL(file);video.preload='metadata';video.onloadedmetadata=()=>{if(Number.isFinite(video.duration))el('duration').value=video.duration.toFixed(1);URL.revokeObjectURL(objectUrl)};video.onerror=()=>URL.revokeObjectURL(objectUrl);video.src=objectUrl;
 el('save').disabled=true;message('กำลังอัปโหลดคลิป…');
 try{const response=await fetch('/media',{method:'POST',headers:{authorization:`Bearer ${el('key').value}`,'content-type':'video/mp4'},body:file});const result=await response.json();if(!response.ok)throw new Error(result.error);el('video-url').value=result.videoUrl;message('อัปโหลดแล้ว ยังไม่ได้เผยแพร่โพสต์')}
 catch(error){fail(error)}finally{el('save').disabled=false}
};
el('compose').onsubmit=async event=>{
 event.preventDefault();const selected=platforms.filter(p=>el('choose-'+p).checked);if(!selected.length)return message('เลือกช่องที่จะโพสต์อย่างน้อยหนึ่งช่อง');
 if(selected.includes('tiktok')&&(!el('tiktok-privacy').value||!el('tt-consent').checked||!Number(el('duration').value)))return message('เลือกการมองเห็น ระบุความยาวคลิป และยินยอมส่งไป TikTok ก่อน');
 if(selected.includes('youtube')&&(!el('yt-privacy').value||!el('yt-kids').value))return message('เลือกการมองเห็นและผู้ชม YouTube ก่อน');
 el('save').disabled=true;try{const draft=await call('/drafts',{title:el('title').value,videoUrl:el('video-url').value,durationSeconds:Number(el('duration').value),platforms:selected,captions:Object.fromEntries(selected.map(p=>[p,el('caption-'+p).value])),options:{tiktok:{privacyLevel:el('tiktok-privacy').value,consent:el('tt-consent').checked,disableComment:!el('tt-comment').checked,disableDuet:!el('tt-duet').checked,disableStitch:!el('tt-stitch').checked,brandContentToggle:el('tt-brand').checked,brandOrganicToggle:el('tt-own-brand').checked,isAigc:el('tt-ai').checked},youtube:{privacyStatus:el('yt-privacy').value,madeForKids:el('yt-kids').value==='true',containsSyntheticMedia:el('yt-ai').checked}}});showDraft(draft);message('บันทึกร่างแล้ว ตรวจด้านล่างก่อนยืนยัน');el('review').scrollIntoView({behavior:'smooth'});await history()}catch(error){fail(error)}finally{el('save').disabled=false}
};
function showDraft(draft,reset=true){
 if(reset){clearTimeout(pollTimer);pollCount=0;el('approve').checked=false}loaded=draft;el('review').hidden=false;el('review-title').textContent=draft.title;el('draft-id').textContent='รหัสร่าง: '+draft.id;
 if(el('preview').getAttribute('src')!==draft.videoUrl)el('preview').src=draft.videoUrl;
 el('review-content').replaceChildren();for(const p of draft.platforms){const card=node('div',undefined,'result');card.append(node('strong',names[p]+' → '+draft.targetNames[p]+' ('+draft.targets[p]+')'),node('p',draft.captions[p],'caption-copy'));if(p==='youtube')card.append(node('p','การมองเห็น: '+draft.options.youtube?.privacyStatus+' · สำหรับเด็ก: '+(draft.options.youtube?.madeForKids?'ใช่':'ไม่ใช่')));if(p==='tiktok')card.append(node('p','การมองเห็น: '+draft.options.tiktok?.privacyLevel+' · AI: '+(draft.options.tiktok?.isAigc?'ใช่':'ไม่ใช่')));el('review-content').append(card)}
 renderResults();updateApproval();
}
function updateApproval(){el('publish').disabled=!loaded||!el('approve').checked||loaded.platforms.every(p=>loaded.results[p]&&loaded.results[p].state!=='blocked');el('continue').disabled=!loaded||!el('approve').checked||!loaded.platforms.some(p=>loaded.results[p]?.state==='processing')}
el('approve').onchange=updateApproval;
function renderResults(){el('results').replaceChildren();const labels={blocked:'ยังส่งไม่ได้',processing:'กำลังประมวลผล',verified:'แพลตฟอร์มยืนยันผลแล้ว',failed:'ไม่สำเร็จ',unknown:'ยังยืนยันผลไม่ได้ — ตรวจบัญชีก่อนส่งซ้ำ'};for(const [p,result]of Object.entries(loaded.results)){const card=node('div',names[p]+': '+labels[result.state],'result');if(result.message)card.append(node('p',result.message));if(result.url){const link=node('a','เปิดโพสต์');try{const url=new URL(result.url);if(url.protocol==='https:'){link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';card.append(link)}}catch{}}if(result.visibility)card.append(node('p','การมองเห็นจริง: '+result.visibility));el('results').append(card)}}
async function publish(action){
 if(!loaded||!el('approve').checked)return;const id=loaded.id;el('publish').disabled=true;el('continue').disabled=true;message('กำลังส่งคำขอ กรุณารอ…');
 try{const draft=await call(`/drafts/${id}/${action}`,{confirmation:`PUBLISH ${id}`});if(loaded?.id!==id)return;showDraft(draft,false);message(draft.status==='verified'?'แพลตฟอร์มยืนยันผลครบแล้ว':'ดูผลแยกแต่ละช่องด้านบน');if(draft.platforms.some(p=>draft.results[p]?.state==='processing')&&pollCount++<30&&el('approve').checked)pollTimer=setTimeout(()=>publish('continue'),8000);await history()}
 catch(error){fail(error);updateApproval()}
}
el('publish').onclick=()=>publish('publish');el('continue').onclick=()=>{clearTimeout(pollTimer);publish('continue')};
async function history(){const drafts=await call('/drafts');el('history').replaceChildren();if(!drafts.length)el('history').textContent='ยังไม่มีร่างโพสต์';for(const draft of drafts){const button=node('button',draft.title+' · '+new Date(draft.createdAt).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}),'secondary');button.onclick=()=>{showDraft(draft);el('review').scrollIntoView({behavior:'smooth'})};el('history').append(button)}}
el('history-refresh').onclick=()=>history().catch(fail);
