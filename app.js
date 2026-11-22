import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.0';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
const siteRoot=new URL('./',import.meta.url);
const onGitHubPages=siteRoot.origin==='https://easontian714.github.io';
const aiEndpoint=new URL('api/organize',onGitHubPages?'https://gift-wishes-together.xuanchen-tian.chatgpt.site/':siteRoot);
const db=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{flowType:'pkce',...(onGitHubPages?{storageKey:'gift-wishlist-auth-v1'}:{})}});
const $=id=>document.getElementById(id);
const form=$('wishForm'), editor=$('editor'), detail=$('detail');
let session, code, activePair, pairs=[], wishes=[], people=new Map(), editing, cover, coverChoices=[], croppedCover, croppedCoverUrl, savedCoverUrl, screenshots=[], side='mine', refreshId=0, editorId=0;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function url(value){try{const parsed=new URL(value);return ['https:','http:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password?parsed.href:''}catch{return ''}}
const currencySymbols={GBP:'£',USD:'US$',CNY:'¥',HKD:'HK$'};
const wholeNumber=new Intl.NumberFormat('en-GB',{maximumFractionDigits:0});
function formatMoney(amount,currency){
  return currencySymbols[currency]+wholeNumber.format(amount);
}
function savedQuote(w){
  if(w?.quote_amount!=null&&Object.hasOwn(currencySymbols,w.quote_currency)){
    return {amount:w.quote_amount,currency:w.quote_currency};
  }
  if(w?.price_cny!=null)return {amount:w.price_cny,currency:'CNY'};
  return {amount:w?.price??null,currency:w?.quote_currency||'GBP'};
}
function formatPrice(w){
  const {amount,currency}=savedQuote(w);
  return amount==null?'':formatMoney(amount,currency);
}
let fxRates=new Map();
function updateFx(){
  const {quote_currency:currency,quote_amount:amount}=form.elements;
  const value=amount.valueAsNumber;
  const quote=fxRates.get(currency.value==='GBP'?'CNY':currency.value);
  const preview=$('fxNote');
  preview.hidden=!quote||!Number.isFinite(value)||value<0;
  if(preview.hidden){preview.textContent='';return}
  const inPounds=currency.value!=='GBP';
  const converted=inPounds?value/quote.rate:value*quote.rate;
  preview.textContent='参考换算 · 约 '+formatMoney(converted,inPounds?'GBP':'CNY')+'（'+quote.date+'）';
}
form.elements.quote_amount.addEventListener('input',updateFx);
form.elements.quote_currency.addEventListener('change',updateFx);
async function loadFx(){
  try{
    const response=await fetch('https://api.frankfurter.dev/v2/rates?base=GBP&quotes=USD,CNY,HKD&providers=ecb',{signal:AbortSignal.timeout(6500)});
    if(!response.ok)return;
    const quotes=await response.json();
    fxRates=new Map(quotes.filter(quote=>quote.base==='GBP'&&Object.hasOwn(currencySymbols,quote.quote)&&Number.isFinite(quote.rate)&&quote.rate>0).map(quote=>[quote.quote,quote]));
    updateFx();
  }catch{}
}
let quoteSource='', quoteKind='', channelUrl='', currencyEdited=false;
function defaultCurrency(link){
  const normalized=url(link);
  if(!normalized)return 'GBP';
  return /(^|\.)(jd\.com|tmall\.com|taobao\.com|suning\.com)$/.test(new URL(normalized).hostname)?'CNY':'GBP';
}
function suggestCurrency(){
  if(currencyEdited||form.elements.quote_amount.value!=='')return;
  form.elements.quote_currency.value=defaultCurrency(form.elements.link.value.trim());
  updateFx();
}
form.elements.link.addEventListener('input',suggestCurrency);
function showSource(id,label,source){
  const target=$(id), link=url(source);
  target.hidden=!link;target.replaceChildren();
  if(!link)return;
  const anchor=document.createElement('a');anchor.href=link;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.textContent=label;
  target.append(anchor);
}
function showProductSources(){
  showSource('quoteSource',quoteKind==='historical'?'历史参考价来源':'查看参考报价',quoteSource);
  showSource('channelSource','查看推荐商家的商品页',channelUrl);
}
for(const field of ['quote_currency','quote_amount','channel'])form.elements[field].addEventListener('input',()=>{
  if(field==='channel')channelUrl='';else{quoteSource='';quoteKind='';if(field==='quote_currency')currencyEdited=true}
  showProductSources();
});
function result({data,error}){if(error)throw new Error(error.message);return data}
function showError(id,error){$(id).textContent=error.message||'操作失败，请重试。'}
function button(label,fn){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>run(b,fn,'pairStatus');return b}
async function run(b,fn,errorId){b.disabled=true;$(errorId).textContent='';try{await fn()}catch(error){showError(errorId,error)}finally{b.disabled=false}}
const partnerId=pair=>pair.person===session.user.id?pair.partner:pair.person;
const coverLinks=new Map();
async function attachCoverLinks(rows){
  const now=Date.now();
  const missing=[...new Set(rows.map(w=>w.cover_path).filter(path=>path&&!(coverLinks.get(path)?.until>now)))];
  if(missing.length){
    const {data}=await db.storage.from('gift-cover-images').createSignedUrls(missing,600);
    for(const item of data||[])if(item.signedUrl)coverLinks.set(item.path,{url:item.signedUrl,until:now+480000});
  }
  return rows.map(w=>({...w,cover_preview:w.cover_path?coverLinks.get(w.cover_path)?.url||'':w.cover}));
}
async function refresh(){
  if(!session)return;
  const version=++refreshId, user=session.user.id;
  const responses=await Promise.all([db.from('gift_partners').select('*'),db.from('gift_people').select('id,name,public_id,avatar_style'),db.from('gift_invitations').select('id,sender,recipient').eq('state','pending')]);
  if(version!==refreshId||session?.user.id!==user)return;
  const [nextPairs,profiles,pending]=responses.map(result);
  const invites=pending.filter(invite=>invite.recipient===user);
  const sent=pending.filter(invite=>invite.sender===user);
  pairs=nextPairs;people=new Map(profiles.map(p=>[p.id,p]));
  const me=people.get(user);
  code=String(me?.public_id??'');
  $('mycode').textContent=code;
  $('profileCode').textContent=code;
  $('generateInvite').disabled=!code;
  $('copyProfileCode').disabled=!code;
  showAccount();
  activePair=pairs.some(p=>p.id===activePair)?activePair:pairs[0]?.id;
  const current=activePair;
  const nextWishes=current?result(await db.from('gift_wishes').select('*').eq('pair_id',current).order('created_at',{ascending:false})):[];
  if(version!==refreshId||current!==activePair)return;
  const withCovers=await attachCoverLinks(nextWishes);
  if(version!==refreshId||current!==activePair)return;
  wishes=withCovers;
  $('startPair').textContent=invites.length?'查看邀请 · '+invites.length:'寻找搭子';
  $('pair').textContent=invites.length?'新增绑定 · '+invites.length+' 个邀请':'新增绑定';
  $('invites').replaceChildren(...(invites.length?invites.map(i=>{
    const item=document.createElement('div');item.className='invite';
    const who=document.createElement('span');who.textContent=(people.get(i.sender)?.name||'对方')+' 邀请与你配对 ';
    const answer=async accepted=>{result(await db.rpc('gift_answer',{invite_id:i.id,accept_invite:accepted}));await refresh()};
    item.append(who,button('接受',()=>answer(true)),button('拒绝',()=>answer(false)));return item
  }):[document.createTextNode('暂无邀请')]));
  $('sentInvites').replaceChildren(...(sent.length?sent.map(invite=>{
    const row=document.createElement('div');row.className='invite sent-invite';
    const person=people.get(invite.recipient);
    const who=profileLabel(person,'对方');
    const status=document.createElement('small');status.className='invite-status';status.textContent='等待接受';
    row.append(who,status);return row;
  }):[document.createTextNode('暂无待接受的邀请')]));
  render();
}
function render(){
  $('intro').textContent=activePair?'每份清单只对已配对的两个人可见。':'';
  $('add').disabled=!activePair;$('tabs').hidden=!activePair;
  $('pairModule').hidden=!activePair;
  $('emptyPairs').hidden=Boolean(activePair);
  $('workspaceToolbar').hidden=!activePair;
  if(!activePair){$('lists').replaceChildren();return}
  const pair=pairs.find(item=>item.id===activePair);
  $('pairTitle').replaceChildren(profileLabel(people.get(partnerId(pair)),'对方','我和 '));
  $('pairs').replaceChildren(...pairs.filter(item=>item.id!==activePair).map(item=>{
    const person=people.get(partnerId(item));
    const switchButton=button('',async()=>{activePair=item.id;wishes=[];render();await refresh()});
    switchButton.append(profileLabel(person,'对方','切换到 我和 '));return switchButton;
  }));
  const card=w=>'<button type="button" class="card '+(w.bought_by?'bought':'')+'" data-wish="'+w.id+'">'+('<span class="card-art"><span class="icon" aria-hidden="true">🎁</span>'+(url(w.cover_preview)?'<img alt="" src="'+esc(url(w.cover_preview))+'" referrerpolicy="no-referrer" data-remote-cover>':'')+'</span>')+'<span><strong>'+esc(w.title)+'</strong><small>'+esc([w.variant,w.color,w.preference,formatPrice(w)].filter(Boolean).join(' · '))+'</small></span></button>';
  const expanded=new Set([...$('lists').querySelectorAll('details[open]')].map(d=>d.dataset.side));
  $('lists').innerHTML=['mine','other'].map(key=>{
    const rows=wishes.filter(w=>(w.owner===session.user.id)===(key==='mine'));
    const open=rows.filter(w=>!w.bought_by), bought=rows.filter(w=>w.bought_by);
    return '<section '+(side===key?'':'hidden')+'><h2>'+(key==='mine'?'我的愿望':'对方的愿望')+'</h2>'+(open.map(card).join('')||'<p class="empty">暂无待买愿望</p>')+'<details data-side="'+key+'" '+(expanded.has(key)?'open':'')+'><summary>已买 '+bought.length+' 件</summary>'+bought.map(card).join('')+'</details></section>'
  }).join('');
}
for(const type of ['load','error'])document.addEventListener(type,event=>{
  const image=event.target;
  if(image instanceof HTMLImageElement&&image.hasAttribute('data-remote-cover')){
    image.toggleAttribute('data-loaded',type==='load'&&image.naturalWidth>0);
  }
},true);
function probeCover(candidate){
  return new Promise(resolve=>{
    const image=new Image();
    const timeout=setTimeout(()=>finish(false),5000);
    function finish(loaded){
      clearTimeout(timeout);
      image.onload=null;image.onerror=null;
      resolve(loaded);
    }
    image.referrerPolicy='no-referrer';
    image.onload=()=>finish(image.naturalWidth>0);
    image.onerror=()=>finish(false);
    image.src=candidate;
  });
}
async function availableCovers(values){
  const candidates=[...new Set(values.map(url).filter(Boolean))].slice(0,6);
  const loaded=await Promise.all(candidates.map(probeCover));
  return candidates.filter((_,index)=>loaded[index]).slice(0,3);
}
function showCover(){
  const image=$('cover'),current=cover&&cover===croppedCoverUrl?cover:url(cover);
  image.hidden=true;$('placeholder').hidden=false;
  if(current&&image.getAttribute('src')===current&&image.complete&&image.naturalWidth){
    image.hidden=false;$('placeholder').hidden=true;
  }else if(current)image.src=current;else image.removeAttribute('src');
}
$('cover').addEventListener('load',()=>{
  if($('cover').src!==cover||!$('cover').naturalWidth)return;
  $('cover').hidden=false;$('placeholder').hidden=true;
});
function removeFailedCover(candidate){
  coverChoices=coverChoices.filter(value=>value!==candidate);
  if(cover===candidate){cover=coverChoices[0]||'';showCover()}
  renderCoverChoices();
}
$('cover').addEventListener('error',()=>{
  const candidate=$('cover').getAttribute('src');
  if(!candidate||candidate!==cover)return;
  removeFailedCover(candidate);
});
function renderCoverChoices(){
  $('coverOptions').replaceChildren(...coverChoices.map((candidate,index)=>{
    const choice=document.createElement('button');
    choice.type='button';choice.className='cover-choice';
    const isCrop=candidate===croppedCoverUrl||(candidate===savedCoverUrl&&editing?.cover_path);
    choice.setAttribute('aria-label',isCrop?'截图裁图':index===0?'推荐主图':'备选主图 '+index);
    choice.setAttribute('aria-pressed',String(candidate===cover));
    const photo=document.createElement('img');
    photo.alt='';photo.referrerPolicy='no-referrer';
    photo.onerror=()=>{if(choice.isConnected)removeFailedCover(candidate)};
    photo.src=candidate;
    const caption=document.createElement('span');caption.textContent=isCrop?'截图裁图':index===0?'推荐':'备选 '+index;
    choice.append(photo,caption);
    choice.onclick=()=>{cover=candidate;showCover();for(const button of $('coverOptions').children)button.setAttribute('aria-pressed',String(button===choice))};
    return choice;
  }));
}
function openEditor(w){
  editorId++;editing=w;resetCrop();savedCoverUrl=w?.cover_path?w.cover_preview:'';cover=w?.cover_preview||'';coverChoices=cover?[cover]:[];form.reset();loadSavedScreenshots(w);
  $('editTitle').textContent=w?'编辑愿望':'记个愿望';$('editStatus').textContent='';
  $('draft').hidden=!w;
  $('editorActions').hidden=!w;
  $('editorMaterials').open=!w;
  $('organize').setAttribute('aria-expanded',String(Boolean(w)));
  $('organizeLabel').textContent=w?'用 AI 重新整理':'AI 帮我整理';
  for(const key of ['source','link','title','preference','channel','notes'])form.elements[key].value=w?.[key]??'';
  const quote=savedQuote(w);
  quoteSource=w?.quote_source||'';quoteKind=w?.quote_kind||'';channelUrl=w?.channel_url||'';showProductSources();
  currencyEdited=Boolean(w?.quote_currency||quote.amount!=null);
  form.elements.quote_currency.value=currencyEdited?quote.currency:defaultCurrency(w?.link||'');
  $('coverStatus').textContent='';
  form.elements.quote_amount.value=quote.amount??'';
  showCover();renderCoverChoices();updateFx();editor.showModal();$('editorScroll').scrollTop=0;
}
const imageTypes=['image/png','image/jpeg','image/webp'];
const maxScreenshots=4;
const maxFileBytes=5*1024*1024;
const maxScreenshotBytes=12*1024*1024;
const screenshotStorage=db.storage.from('gift-screenshots');
function clearScreenshotPreviews(){
  for(const item of screenshots)if(item.file&&item.preview)URL.revokeObjectURL(item.preview);
  screenshots=[];
}
function renderScreenshots(){
  const list=$('screenshotList');
  list.hidden=!screenshots.length;
  list.replaceChildren(...screenshots.map((item,index)=>{
    const tile=document.createElement('li');tile.className='screenshot-tile';
    const view=document.createElement('button');view.type='button';view.className='screenshot-thumb';
    view.setAttribute('aria-label','预览截图 '+(index+1));view.disabled=!item.preview;
    if(item.preview){
      const image=document.createElement('img');image.src=item.preview;image.alt='';
      view.append(image);
    }else{
      view.textContent=item.previewFailed?'无法预览':'加载中';
    }
    view.onclick=()=>{
      $('largeScreenshot').src=item.preview;$('screenshotViewer').showModal();
    };
    const remove=document.createElement('button');remove.type='button';remove.className='screenshot-remove';remove.textContent='×';
    remove.setAttribute('aria-label','移除截图 '+(index+1));
    remove.onclick=()=>{
      if(item.file&&item.preview)URL.revokeObjectURL(item.preview);
      screenshots=screenshots.filter(entry=>entry!==item);
      $('photoStatus').textContent='';
      renderScreenshots();$('chooseScreenshot').focus();
    };
    tile.append(view,remove);return tile;
  }));
  $('screenshotAction').textContent=screenshots.length?'继续添加截图':'粘贴截图到这里';
  $('screenshotHint').textContent=screenshots.length?screenshots.length+' / '+maxScreenshots+' 张 · 可继续粘贴或选择':'按 Ctrl / ⌘ + V，或点击选择多张';
}
function loadSavedScreenshots(wish){
  clearScreenshotPreviews();
  const paths=[...new Set([...(wish?.screenshot_paths||[]),wish?.screenshot].filter(Boolean))].slice(0,maxScreenshots);
  screenshots=paths.map(path=>({path}));
  $('photoStatus').textContent='';renderScreenshots();
  if(!paths.length)return;
  const version=editorId;
  void screenshotStorage.createSignedUrls(paths,600).then(({data})=>{
    if(version!==editorId)return;
    const previews=new Map((data||[]).map(entry=>[entry.path,entry.signedUrl]));
    for(const item of screenshots)if(item.path){item.preview=previews.get(item.path);item.previewFailed=!item.preview}
    renderScreenshots();
  }).catch(()=>{
    if(version!==editorId)return;
    for(const item of screenshots)if(item.path)item.previewFailed=true;
    renderScreenshots();
  });
}
function addScreenshots(files){
  let message='';
  for(const file of files){
    if(!imageTypes.includes(file.type)||file.size>maxFileBytes){
      message='每张截图须为 5 MB 以内的 PNG、JPEG 或 WebP。';continue;
    }
    if(screenshots.length>=maxScreenshots){message='每条愿望最多可添加 4 张截图。';break}
    screenshots.push({file,preview:URL.createObjectURL(file)});
  }
  $('photoStatus').textContent=message;renderScreenshots();
}
$('chooseScreenshot').onclick=()=>form.elements.image.click();
form.elements.image.onchange=()=>{
  addScreenshots([...form.elements.image.files]);form.elements.image.value='';
};
editor.onpaste=e=>{
  const data=e.clipboardData;
  const files=[...(data?.files||[])].filter(file=>file.type.startsWith('image/'));
  const images=files.length?files:[...(data?.items||[])].filter(item=>item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);
  if(images.length){e.preventDefault();addScreenshots(images)}
};
const screenshotBox=$('screenshotBox');
screenshotBox.addEventListener('dragover',event=>{
  if(event.dataTransfer?.types.includes('Files')){
    event.preventDefault();screenshotBox.classList.add('drag-over');
  }
});
screenshotBox.addEventListener('dragleave',event=>{
  if(!screenshotBox.contains(event.relatedTarget))screenshotBox.classList.remove('drag-over');
});
screenshotBox.addEventListener('drop',event=>{
  event.preventDefault();screenshotBox.classList.remove('drag-over');
  addScreenshots([...(event.dataTransfer?.files||[])]);
});
function readImage(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('无法读取截图'));reader.readAsDataURL(file)})}
function resetCrop(){
  if(croppedCoverUrl)URL.revokeObjectURL(croppedCoverUrl);
  croppedCover=null;croppedCoverUrl='';
}
async function cropScreenshot(file,bounds){
  if(!Array.isArray(bounds)||bounds.length!==4)return null;
  const bitmap=await createImageBitmap(file);
  try{
    const [x0,y0,x1,y1]=bounds;
    const x=Math.floor(bitmap.width*x0/1000),y=Math.floor(bitmap.height*y0/1000);
    const width=Math.ceil(bitmap.width*x1/1000)-x,height=Math.ceil(bitmap.height*y1/1000)-y;
    if(width<40||height<40||width>height*5||height>width*5)return null;
    const scale=Math.min(1,640/Math.max(width,height));
    const canvas=document.createElement('canvas');canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
    const context=canvas.getContext('2d');if(!context)return null;
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(bitmap,x,y,width,height,0,0,canvas.width,canvas.height);
    return await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));
  }finally{bitmap.close()}
}
async function organize(coverOnly){
  const version=editorId, fields=form.elements, source=fields.source.value.trim(), rawLink=fields.link.value.trim(), link=url(rawLink);
  if(rawLink&&!link)throw new Error('请输入有效的商品链接。');
  if(!source&&!link&&!screenshots.length&&!(coverOnly&&fields.title.value.trim()))throw new Error('请至少提供描述、链接或截图。');
  $('editStatus').textContent=coverOnly?'正在找同款商品图…':'正在整理商品信息并查找价格与渠道…';
  const initialQuote=[fields.quote_currency.value,fields.quote_amount.value], initialChannel=fields.channel.value;
  const screenshotFiles=coverOnly?[]:await Promise.all(screenshots.map(async item=>item.file||result(await screenshotStorage.download(item.path))));
  if(screenshotFiles.reduce((total,file)=>total+file.size,0)>maxScreenshotBytes)throw new Error('AI 整理时，截图合计不能超过 12 MB。请移除或压缩一张后再试。');
  const images=await Promise.all(screenshotFiles.map(readImage));
  if(version!==editorId||!editor.open)return;
  const response=await fetch(aiEndpoint,{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({pair:activePair,source,link,images,title:fields.title.value,notes:fields.notes.value,coverOnly,previous:cover===savedCoverUrl?null:cover,previousCovers:coverChoices.filter(value=>value!==savedCoverUrl)})});
  const payload=await response.json();
  if(version!==editorId||!editor.open)return;
  if(!response.ok)throw new Error(payload.error||'AI 处理失败。');
  if(!coverOnly){
    if(payload.title!=null)fields.title.value=payload.title;
    if(payload.channel!=null&&fields.channel.value===initialChannel){
      fields.channel.value=payload.channel;channelUrl=url(payload.channel_url);
    }
    if(fields.quote_currency.value===initialQuote[0]&&fields.quote_amount.value===initialQuote[1]&&Object.hasOwn(currencySymbols,payload.quote_currency)&&Number.isFinite(payload.quote_amount)){
      fields.quote_currency.value=payload.quote_currency;
      fields.quote_amount.value=payload.quote_amount;
      quoteSource=url(payload.quote_source);quoteKind=quoteSource?payload.quote_kind:'';
    }
  }
  updateFx();showProductSources();
  const hits=Array.isArray(payload.covers)?payload.covers:[];
  if(hits.length)$('editStatus').textContent='正在检查图片能否打开…';
  const candidates=await availableCovers(hits);
  const screenshotFile=screenshotFiles[payload.cover_image_index-1];
  const crop=!candidates.length&&screenshotFile?await cropScreenshot(screenshotFile,payload.cover_crop).catch(()=>null):null;
  if(version!==editorId||!editor.open)return;
  if(crop){
    resetCrop();croppedCover=crop;croppedCoverUrl=URL.createObjectURL(crop);candidates.push(croppedCoverUrl);
  }
  if(candidates.length){
    coverChoices=candidates;cover=candidates[0];showCover();renderCoverChoices();
  }
  $('coverStatus').textContent=crop?'这张主图裁自你提供的截图，请确认商品是否正确。':candidates.length||cover?'':'暂未找到可确认的同款图。可补充清晰的商品截图后重新整理。';
  $('editStatus').textContent=coverOnly?(candidates.length?'已找到 '+candidates.length+' 张同款图，可以点选。':'暂未找到能打开的新主图。'):fields.title.value.trim()?(fields.quote_amount.value?'请检查整理结果，确认后保存。':'暂未查到可核实的同款报价，可以手动填写或留空。'):'暂未确认商品名称，可以手动填写或补充素材。';
}
function revealDraft(){
  if(!$('draft').hidden)return;
  $('draft').hidden=false;
  $('editorActions').hidden=false;
  $('organize').setAttribute('aria-expanded','true');
  $('draftHeading').focus({preventScroll:true});
  $('draftHeading').scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}
$('organize').onclick=()=>run($('organize'),async()=>{
  const version=editorId;
  if(!form.elements.source.value.trim()&&!form.elements.link.value.trim()&&!screenshots.length)throw new Error('请至少提供描述、链接或截图。');
  $('organize').setAttribute('aria-busy','true');
  $('organizeLabel').textContent='正在整理…';
  try{
    await organize(false);
  }finally{
    $('organize').removeAttribute('aria-busy');
    if(version===editorId&&editor.open){
      $('organizeLabel').textContent='用 AI 重新整理';
      revealDraft();
    }
  }
},'editStatus');
$('retry').onclick=()=>run($('retry'),()=>organize(true),'editStatus');
form.onsubmit=e=>{e.preventDefault();if($('draft').hidden)return;void run($('save'),async()=>{
  const f=form.elements, link=url(f.link.value.trim()), title=f.title.value.trim();
  if(!title)throw new Error('请输入礼物名称。');
  if(!f.preference.value)throw new Error('请选择款式偏好。');
  if(f.link.value.trim()&&!link)throw new Error('请输入有效的商品链接。');
  const pair=activePair, previous=editing, attachments=[...screenshots], selectedCover=cover;
  const localCover=selectedCover&&selectedCover===croppedCoverUrl?croppedCover:null;
  if(!pair)throw new Error('请先选择配对。');
  const attachmentPaths=await Promise.all(attachments.map(async item=>{
    if(item.path)return item.path;
    const path=session.user.id+'/'+crypto.randomUUID();
    result(await screenshotStorage.upload(path,item.file));
    item.path=path;
    return path;
  }));
  let coverPath=previous?.cover_path&&(!selectedCover||selectedCover===savedCoverUrl)?previous.cover_path:null;
  if(localCover){
    coverPath=session.user.id+'/'+crypto.randomUUID()+'.jpg';
    result(await db.storage.from('gift-cover-images').upload(coverPath,localCover));
  }
  const record={title,source:f.source.value.trim().slice(0,4000),link,screenshot:attachmentPaths[0]||null,screenshot_paths:attachmentPaths,cover_path:coverPath,cover:coverPath?null:url(selectedCover)||null,preference:f.preference.value,quote_currency:f.quote_currency.value,quote_amount:f.quote_amount.value===''?null:f.quote_amount.valueAsNumber,price:null,price_cny:null,quote_source:quoteSource||null,quote_kind:quoteKind||null,channel_url:channelUrl||null,channel:f.channel.value,notes:f.notes.value};
  result(previous?await db.from('gift_wishes').update(record).eq('id',previous.id).eq('pair_id',pair).select('id').single():await db.from('gift_wishes').insert({...record,pair_id:pair}));
  editor.close();await refresh();
},'editStatus')};
function detailNotes(notes, productLink){
  const text=String(notes||'').trim();
  const fragments=[];
  const links=new Set();
  let cursor=0;
  for(const match of text.matchAll(/https?:\/\/[^\s<>"'，。；、！？（）【】]+/gi)){
    const address=match[0].replace(/[.,;!?)]*$/,'');
    const link=url(address);
    if(!link)continue;
    fragments.push(esc(text.slice(cursor,match.index)));
    fragments.push(`<a target="_blank" rel="noopener noreferrer" href="${esc(link)}">${esc(address)}</a>`);
    links.add(link);
    cursor=match.index+address.length;
  }
  fragments.push(esc(text.slice(cursor)));
  if(productLink&&!links.has(productLink)){
    if(text)fragments.push('\n');
    fragments.push(`<a target="_blank" rel="noopener noreferrer" href="${esc(productLink)}">${esc(productLink)}</a>`);
  }
  return fragments.join('');
}
function openDetail(w){
  const mine=w.owner===session.user.id;
  const productLink=url(w.link), coverLink=url(w.cover_preview), price=formatPrice(w), priceSource=url(w.quote_source), suggestedStore=url(w.channel_url);
  const notes=detailNotes(w.notes,productLink);
  const specifications=[w.variant,w.color].filter(value=>value&&!w.title.includes(value)).join(' · ');
  detail.innerHTML=`
    <div class="detail-shell">
      <header class="detail-header">
        <h2 id="detailTitle">${esc(w.title)}</h2>
        <button type="button" class="detail-close" data-close aria-label="关闭" autofocus>×</button>
      </header>
      <div class="detail-scroll">
        <div class="detail-overview">
          <div class="detail-art"><span aria-hidden="true">🎁</span>${coverLink?`<img class="detail-cover" alt="商品主图" src="${esc(coverLink)}" referrerpolicy="no-referrer" data-remote-cover>`:''}</div>
          <div class="detail-facts">
            ${price?`<small>${w.quote_kind==='historical'?'历史参考价':w.quote_kind==='reference'?'同款参考价':'大概价格'}</small><p class="detail-price">${esc(price)}</p>`:''}
            ${priceSource?`<a class="detail-source" target="_blank" rel="noopener noreferrer" href="${esc(priceSource)}">查看报价来源</a>`:''}
            ${w.preference?`<span class="detail-preference">${esc(w.preference)}</span>`:''}
            ${w.channel?`<div><small>推荐渠道</small><p>${suggestedStore&&suggestedStore!==productLink?`<a target="_blank" rel="noopener noreferrer" href="${esc(suggestedStore)}">${esc(w.channel)}</a>`:esc(w.channel)}</p></div>`:''}
            ${specifications?`<div><small>款式信息</small><p>${esc(specifications)}</p></div>`:''}
          </div>
        </div>
        ${notes?`<section class="detail-notes"><h3>备注</h3><p>${notes}</p></section>`:''}
        <p id="detailStatus" class="error" role="status"></p>
      </div>
      <footer class="detail-actions">
        <button type="button" class="${!mine&&!w.bought_by?'primary':''}" id="action">${mine?'编辑愿望':w.bought_by?'撤销已买':'标为已买'}</button>
      </footer>
    </div>`;
  detail.showModal();$('action').onclick=()=>{if(mine){detail.close();openEditor(w);return}void run($('action'),async()=>{result(await db.rpc('gift_purchase',{wish_id:w.id,purchased:!w.bought_by}));detail.close();await refresh()},'detailStatus')};

}
document.addEventListener('click',e=>{
  const close=e.target.closest('[data-close]');if(close)close.closest('dialog').close();
  const wish=e.target.closest('[data-wish]');if(wish){const item=wishes.find(w=>w.id===wish.dataset.wish);if(item)openDetail(item)}
  const tab=e.target.closest('button[data-side]');if(tab){side=tab.dataset.side;for(const b of $('tabs').querySelectorAll('button'))b.classList.toggle('primary',b===tab);render()}
});
$('pair').onclick=()=>{$('pairStatus').textContent='';$('found').replaceChildren();$('mycode').textContent=code;$('pairing').showModal()};
$('startPair').onclick=()=>$('pair').click();
$('copy').onclick=()=>run($('copy'),async()=>{await navigator.clipboard.writeText(code);$('pairStatus').textContent='已复制。'},'pairStatus');
$('search').onsubmit=e=>{e.preventDefault();const b=e.submitter;void run(b,async()=>{
  $('found').replaceChildren();const value=$('targetcode').value.trim();
  const number=Number(value);
  if(!/^[1-9]\d{5}$/.test(value))throw new Error('请输入六位数字配对 ID。');
  const [other]=result(await db.rpc('gift_find_number',{target_number:number}));if(!other)throw new Error('未找到已注册的用户。');
  const name=document.createElement('p');name.textContent=other.name;
  $('found').append(name,button('发送邀请',async()=>{result(await db.rpc('gift_invite_number',{target_number:number}));$('found').replaceChildren();$('pairStatus').textContent='已发送邀请，等待对方接受。';await refresh()}));
},'pairStatus')};
$('add').onclick=()=>openEditor(null);
$('login').onclick=()=>run($('login'),async()=>result(await db.auth.signInWithOAuth({provider:'google',options:{redirectTo:siteRoot.href,queryParams:{prompt:'select_account'}}})),'status');
$('signout').onclick=()=>run($('signout'),async()=>{result(await db.auth.signOut());location.replace(siteRoot.href)},'status');
function profileLabel(person,fallback,prefix=''){
  const label=document.createElement('span');label.className='profile-label';
  label.append(makeAvatar(person));
  label.append(prefix+(person?.name||fallback));return label;
}
const presets=[['🐻','#e9dccb'],['🐱','#f4ded3'],['🐰','#e6e3f7'],['🦊','#f8e0c9'],['🐼','#dde8e3'],['🐨','#e2e9f5'],['🐸','#dfecd1'],['🦦','#eae1d7']];
let draftStyle=0;
function makeAvatar(person){
  const [symbol,color]=presets[person?.avatar_style]||presets[0];
  const badge=document.createElement('span');
  badge.className='avatar avatar-fallback';badge.style.background=color;badge.textContent=symbol;badge.setAttribute('aria-hidden','true');
  return badge;
}
function showAvatarDraft(){
  $('avatarDraft').replaceChildren(makeAvatar({avatar_style:draftStyle}));
}
$('shuffleAvatar').onclick=()=>{
  draftStyle=(draftStyle+1)%presets.length;
  showAvatarDraft();
};
$('copyProfileCode').onclick=()=>run($('copyProfileCode'),async()=>{
  await navigator.clipboard.writeText(code);$('profileShareStatus').textContent='已复制 ID。';
},'profileShareStatus');
$('generateInvite').onclick=()=>{
  if(!code)return;
  const invite=$('inviteText');
  invite.value=[
    '来心愿簿和我一起记礼物吧！',
    siteRoot.href,
    '打开网页后用 Google 登录，点「寻找搭子」或「新增绑定」，输入我的配对 ID '+code+'，再发送邀请。'
  ].join('\n');
  $('profileInvite').hidden=false;
  $('generateInvite').setAttribute('aria-expanded','true');
  $('profileShareStatus').textContent='';
  invite.focus();
};
$('copyInvite').onclick=()=>run($('copyInvite'),async()=>{
  const invite=$('inviteText');
  try{
    await navigator.clipboard.writeText(invite.value);
    $('profileShareStatus').textContent='已复制邀请。';
  }catch{
    invite.focus();invite.select();
    $('profileShareStatus').textContent='邀请已选中，可以手动复制。';
  }
},'profileShareStatus');
$('profile').onclick=()=>{
  const form=$('profileForm');form.reset();form.elements.nickname.value=people.get(session.user.id)?.name||'';
  draftStyle=people.get(session.user.id)?.avatar_style??0;showAvatarDraft();
  $('profileStatus').textContent='';$('profileShareStatus').textContent='';
  $('profileInvite').hidden=true;$('generateInvite').setAttribute('aria-expanded','false');
  $('pairManagement').open=false;renderPairManagement();$('profileDialog').showModal();
};
$('profileForm').onsubmit=e=>{
  e.preventDefault();const form=e.currentTarget;
  void run(e.submitter,async()=>{
    const name=form.elements.nickname.value.trim();
    if(!name)throw new Error('请输入昵称。');
    result(await db.rpc('gift_save_system_profile',{display_name:name,selected_style:draftStyle}));
    $('profileDialog').close();await refresh();
  },'profileStatus');
};
let endingPair;
function renderPairManagement(){
  $('managedPairs').replaceChildren(...(pairs.length?pairs.map(pair=>{
    const person=people.get(partnerId(pair));
    const group=document.createElement('div');group.className='managed-pair';
    const identity=document.createElement('div');identity.className='managed-pair-identity';
    identity.append(makeAvatar(person));
    const text=document.createElement('div');
    const name=document.createElement('strong');name.textContent=person?.name||'对方';text.append(name);
    if(person?.public_id){
      const id=document.createElement('small');id.textContent='配对 ID · '+person.public_id;text.append(id);
    }
    identity.append(text);
    const end=button('解除配对',async()=>{
      endingPair=pair.id;
      $('endPairMessage').textContent='解除你和 '+(person?.name||'对方')+' 的配对后，双方都将无法查看这份清单。以后重新配对会开启一份新清单。';
      $('endPairStatus').textContent='';$('endPairDialog').showModal();
    });
    end.className='danger-action';
    group.append(identity,end);return group;
  }):[document.createTextNode('暂无配对')]));
}
$('confirmEndPair').onclick=()=>run($('confirmEndPair'),async()=>{
  const id=endingPair;
  result(await db.rpc('gift_end_pair',{target_pair:id}));
  $('endPairDialog').close();$('profileDialog').close();
  if(activePair===id){activePair=null;wishes=[];render()}
  await refresh();
},'endPairStatus');
function showAccount(){
  const account=$('accountSummary'), user=session?.user;
  account.hidden=!user;
  if(!user)return;
  const person=people.get(user.id);
  const name=person?.name||user.user_metadata?.full_name||'我的账号';
  $('accountName').textContent=name;
  $('currentAccount').textContent=user.email||'';
  $('accountId').textContent=person?.public_id?'配对 ID · '+person.public_id:'正在获取配对 ID…';
  $('accountId').hidden=false;
  const avatar=makeAvatar(person);avatar.id='accountAvatar';$('accountAvatar').replaceWith(avatar);
}
async function start(){
  const error=new URLSearchParams(location.search).get('error_description');
  if(error)$('status').textContent=error;
  session=result(await db.auth.getSession()).session;
  showAccount();
  $('profile').hidden=!session;$('login').hidden=Boolean(session);$('signout').hidden=!session;$('workspace').hidden=!session;
  if(!session){$('intro').textContent='用你的 Google 账号登录，和想一起记礼物的人配对。';return}
  result(await db.rpc('gift_register'));await refresh();
  db.auth.onAuthStateChange((_event,next)=>{session=next;showAccount()});
  setInterval(()=>{if(document.visibilityState==='visible'&&session)void refresh().catch(error=>showError('status',error))},12000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&session)void refresh().catch(error=>showError('status',error))});
}
void loadFx();
start().catch(error=>showError('status',error));
