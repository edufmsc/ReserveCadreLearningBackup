(function(){
  'use strict';

  const DIRECT_TITLE='__PACKAGE_DIRECT__';
  const state={packages:[],catalog:[],token:'',creating:new Map()};
  let scheduled=false;

  function esc(v){return String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function isDrive(url){return /(?:drive|docs)\.google\.com/i.test(String(url||''));}
  function isYoutube(url){try{const u=new URL(String(url||''));return /(^|\.)youtube\.com$/i.test(u.hostname)||/youtu\.be$/i.test(u.hostname);}catch{return false;}}
  function setText(el,text){if(el&&el.textContent!==text)el.textContent=text;}
  function directLesson(pkg){return (pkg?.lessons||[]).find(l=>String(l.title||'')===DIRECT_TITLE)||null;}
  function visibleLessons(pkg){return (pkg?.lessons||[]).filter(l=>String(l.title||'')!==DIRECT_TITLE);}
  function capture(data,token){
    if(token)state.token=token;
    if(!data)return;
    if(Array.isArray(data)){if(data.length&&data[0]&&Array.isArray(data[0].lessons))state.packages=data;return;}
    if(Array.isArray(data.packages))state.packages=data.packages;
    if(data.catalog&&Array.isArray(data.catalog.packages))state.catalog=data.catalog.packages;
  }

  if(window.LearningApi&&window.LearningApi.request){
    const original=window.LearningApi.request.bind(window.LearningApi);
    window.LearningApi=Object.freeze({
      configured:window.LearningApi.configured,
      request:async function(action,payload,token){
        if(token)state.token=token;
        const data=await original(action,payload,token);
        capture(data,token);
        return data;
      }
    });
  }

  function allPackages(){return [...(state.packages||[]),...(state.catalog||[])];}
  function activeLesson(){
    const packageLabel=document.getElementById('lessonPackageName')?.textContent?.trim();
    const lessonLabel=document.getElementById('lessonTitle')?.textContent?.trim();
    if(!lessonLabel)return null;
    if(packageLabel==='母課程教材'){
      const pkg=allPackages().find(p=>String(p.title||'').trim()===lessonLabel);
      return directLesson(pkg);
    }
    for(const p of allPackages()){
      if(String(p.title||'').trim()!==packageLabel)continue;
      const l=(p.lessons||[]).find(x=>String(x.title||'').trim()===lessonLabel);
      if(l)return l;
    }
    if(lessonLabel===DIRECT_TITLE){
      for(const p of allPackages()){const l=directLesson(p);if(l)return l;}
    }
    return null;
  }

  function patchEditor(){
    document.querySelectorAll('[data-add-question],[data-edit-question]').forEach(x=>{if(x.style.display!=='none')x.style.display='none';});
    const form=document.getElementById('adminEditForm');
    const type=document.getElementById('editType');
    if(type){
      [...type.options].filter(o=>o.value==='QUIZ').forEach(o=>o.remove());
      if(![...type.options].some(o=>o.value==='FILE')){const o=document.createElement('option');o.value='FILE';o.textContent='電子範本／下載檔';type.appendChild(o);}
      setText(type.closest('label')?.querySelector('span'),'教材類型');
    }
    const titleInput=document.getElementById('editTitle');
    const isDirectForm=form?.dataset.adminForm==='lesson'&&titleInput?.value===DIRECT_TITLE;
    if(isDirectForm){
      setText(document.getElementById('adminEditorTitle'),'母課程教材｜觀看條件');
      document.querySelectorAll('#adminEditorBody label').forEach(label=>{
        const t=label.textContent||'';
        const keep=t.includes('影片最低完成率');
        if(!keep&&label.style.display!=='none')label.style.display='none';
      });
      const video=document.getElementById('editVideo');
      if(video&&!video.placeholder)video.placeholder='例如 90；留空代表不檢核';
      if(!form.querySelector('[data-v1-direct-hint]')){
        const hint=document.createElement('p');hint.className='form-hint';hint.dataset.v1DirectHint='1';hint.textContent='有設定比例時，母課程中的每支影片都需達到該觀看比例；留空則不檢核。';
        form.querySelector('.form-actions')?.before(hint);
      }
    }else{
      document.querySelectorAll('#adminEditorBody label').forEach(label=>{
        const t=label.textContent||'';
        if((t.includes('測驗及格分數')||t.includes('PDF需完成確認'))&&label.style.display!=='none')label.style.display='none';
      });
    }
    const url=document.getElementById('editUrl');
    if(url)setText(url.closest('label')?.querySelector('span'),'影片／PDF／下載檔網址');
  }

  function patchPdf(){
    document.querySelectorAll('.pdf-content[data-pdf-url]').forEach(block=>{
      if(!isDrive(block.dataset.pdfUrl)||block.dataset.v1DriveBlocked==='1')return;
      block.dataset.v1DriveBlocked='1';block.dataset.loaded='1';
      const viewer=block.querySelector('.pdf-viewer');
      if(viewer)viewer.innerHTML='<div class="content-placeholder">正式版 PDF 不使用 Google Drive。請改成可直接讀取的 PDF 網址。</div>';
    });
  }

  function patchFiles(){
    const host=document.getElementById('lessonContent');
    if(!host||document.getElementById('lessonPage')?.hidden)return;
    const lesson=activeLesson();if(!lesson)return;
    (lesson.contents||[]).filter(c=>c.enabled!==false&&String(c.type||'').toUpperCase()==='FILE'&&c.url).forEach(c=>{
      if(host.querySelector(`[data-v1-file-id="${CSS.escape(c.id)}"]`))return;
      const a=document.createElement('article');a.className='content-block';a.dataset.v1FileId=c.id;
      a.innerHTML=`<h3>${esc(c.title||'電子範本')}</h3><div class="v1-download-card"><div><strong>電子範本檔</strong><span>下載後可直接使用或填寫</span></div><a class="primary-button primary-button--fit" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer" download>下載範本</a></div>`;
      host.appendChild(a);
    });
  }

  function patchNoExamUi(){
    document.querySelectorAll('.record-grid > div').forEach(x=>{if((x.textContent||'').includes('測驗分數')&&x.style.display!=='none')x.style.display='none';});
    document.querySelectorAll('.admin-lesson-meta').forEach(x=>{const old=x.textContent||'',next=old.replace(/｜測驗 [^｜]*｜完成/g,'｜完成');if(next!==old)x.textContent=next;});
    document.querySelectorAll('.criteria-item').forEach(x=>{if((x.textContent||'').includes('測驗')&&x.style.display!=='none')x.style.display='none';});
  }

  function patchAdminDirectUi(){
    const list=document.getElementById('adminCatalogList');
    if(!list||!state.catalog.length)return;
    const cards=[...list.querySelectorAll(':scope > .manage-card')];
    const childSummary=document.querySelector('#adminCatalogSummary .summary-card:nth-child(2) strong');
    if(childSummary)setText(childSummary,String(state.catalog.reduce((n,p)=>n+visibleLessons(p).length,0)));
    cards.forEach((card,i)=>{
      const pkg=state.catalog[i];if(!pkg)return;
      const actions=card.querySelector('.manage-card__actions');
      if(actions&&!actions.querySelector('[data-v1-add-package-content]')){
        const b=document.createElement('button');b.className='mini-button v1-direct-add';b.type='button';b.dataset.v1AddPackageContent=pkg.id;b.textContent='＋教材';
        const childButton=actions.querySelector('[data-add-lesson]');actions.insertBefore(b,childButton||null);
        b.onclick=()=>addPackageContent(pkg.id,b);
      }
      const rows=[...card.querySelectorAll('.manage-card__body > .manage-row')];
      (pkg.lessons||[]).forEach((lesson,idx)=>{
        const row=rows[idx];if(!row)return;
        row.querySelectorAll('[data-add-question],[data-edit-question]').forEach(x=>x.style.display='none');
        row.querySelectorAll('.manage-content small').forEach(x=>{if((x.textContent||'').includes('FILE'))setText(x,(x.textContent||'').replace(/FILE/g,'電子範本'));});
        if(String(lesson.title||'')!==DIRECT_TITLE)return;
        row.dataset.v1DirectRow='1';row.classList.add('v1-direct-row');
        setText(row.querySelector('.manage-row__top strong'),'母課程教材');
        const meta=row.querySelector('.manage-row__meta');
        if(meta){const rule=lesson.videoPassPercent!=null?`影片 ${lesson.videoPassPercent}%`:'未設定影片比例';setText(meta,`${rule}｜${lesson.enabled===false?'停用':'啟用'}`);}
        const edit=row.querySelector('[data-edit-lesson]');if(edit)setText(edit,'觀看條件');
      });
    });
  }

  async function ensureDirect(packageId){
    const pkg=state.catalog.find(p=>p.id===packageId);const existing=directLesson(pkg);if(existing)return existing;
    if(state.creating.has(packageId))return state.creating.get(packageId);
    const task=(async()=>{
      const data=await window.LearningApi.request('saveLesson',{packageId,title:DIRECT_TITLE,sort:1,required:true,enabled:true,videoPassPercent:null,pdfConfirmRequired:false,quizPassScore:null},state.token);
      capture(data,state.token);
      const fresh=directLesson(state.catalog.find(p=>p.id===packageId));
      if(!fresh)throw new Error('無法建立母課程教材區');
      return fresh;
    })();
    state.creating.set(packageId,task);
    try{return await task;}finally{state.creating.delete(packageId);}
  }

  async function addPackageContent(packageId,button){
    const pkg=state.catalog.find(p=>p.id===packageId);let direct=directLesson(pkg);
    if(direct){
      const native=document.querySelector(`[data-add-content="${CSS.escape(direct.id)}"]`);
      if(native){native.click();return;}
    }
    const old=button.textContent;button.disabled=true;button.textContent='建立中…';
    try{direct=await ensureDirect(packageId);openStandaloneContentEditor(direct,packageId);}catch(e){showLocalToast(e.message||'無法建立教材');button.disabled=false;button.textContent=old;}
  }

  function openStandaloneContentEditor(lesson,packageId){
    const overlay=document.getElementById('adminEditorOverlay'),body=document.getElementById('adminEditorBody'),title=document.getElementById('adminEditorTitle');
    if(!overlay||!body||!title){location.reload();return;}
    setText(title,'新增母課程教材');
    body.innerHTML=`<form id="v1DirectContentForm" class="admin-form"><div class="form-grid"><label class="field-group"><span>教材類型</span><select id="v1DirectType"><option value="VIDEO">YouTube影片</option><option value="PDF">PDF</option><option value="FILE">電子範本／下載檔</option><option value="TEXT">文字</option></select></label><label class="field-group"><span>排序</span><input id="v1DirectSort" type="number" min="1" value="${(lesson.contents||[]).length+1}" required></label><label class="field-group field-group--wide"><span>教材標題</span><input id="v1DirectTitle" type="text" required></label><label class="field-group field-group--wide"><span>影片／PDF／下載檔網址</span><input id="v1DirectUrl" type="url" placeholder="https://..."></label><label class="field-group field-group--wide"><span>文字教材內容</span><textarea id="v1DirectText"></textarea></label></div><div class="form-actions"><button id="v1DirectCancel" class="secondary-button" type="button">取消</button><button class="primary-button" type="submit">儲存</button></div></form>`;
    overlay.hidden=false;document.body.classList.add('is-locked');
    document.getElementById('v1DirectCancel').onclick=()=>location.reload();
    document.getElementById('v1DirectContentForm').onsubmit=async e=>{
      e.preventDefault();const submit=e.currentTarget.querySelector('button[type="submit"]'),type=document.getElementById('v1DirectType').value,url=document.getElementById('v1DirectUrl').value.trim(),text=document.getElementById('v1DirectText').value;
      if(type!=='TEXT'&&!/^https?:\/\//i.test(url)){showLocalToast('請輸入有效網址');return;}
      if(type==='VIDEO'&&!isYoutube(url)){showLocalToast('請使用有效的 YouTube 網址');return;}
      if(type==='PDF'&&isDrive(url)){showLocalToast('PDF 不可使用 Google Drive 網址');return;}
      submit.disabled=true;submit.textContent='儲存中…';
      try{await window.LearningApi.request('saveContent',{lessonId:lesson.id,type,title:document.getElementById('v1DirectTitle').value,url,text,sort:Number(document.getElementById('v1DirectSort').value)||1,enabled:true},state.token);location.reload();}catch(err){submit.disabled=false;submit.textContent='儲存';showLocalToast(err.message||'儲存失敗');}
    };
  }

  function patchStudentDirectUi(){
    if(!state.packages.length)return;
    const cards=[...document.querySelectorAll('#packageList > .package-card')];
    cards.forEach((card,i)=>{
      const pkg=state.packages[i];if(!pkg)return;const direct=directLesson(pkg);if(!direct)return;
      const rows=[...card.querySelectorAll('.lesson-list .lesson-row')],lessons=pkg.lessons||[];
      let directRow=null;
      lessons.forEach((l,idx)=>{if(String(l.title||'')===DIRECT_TITLE&&rows[idx]){directRow=rows[idx];rows[idx].style.display='none';}});
      const visibleCount=visibleLessons(pkg).length,toggle=card.querySelector('[data-toggle-package]');
      if(toggle&&visibleCount===0)toggle.style.display='none';
      const meta=card.querySelector('.progress-meta span');if(meta&&meta.textContent.includes('個必修子課程完成'))setText(meta,meta.textContent.replace('個必修子課程完成','個必修內容完成'));
      const actions=card.querySelector('.package-actions');
      if(actions&&!actions.querySelector('[data-v1-enter-direct]')){
        const native=directRow?.querySelector('[data-open-lesson]');
        if(native){const b=document.createElement('button');b.type='button';b.className='primary-button';b.dataset.v1EnterDirect='1';b.textContent=direct.status==='complete'?'再次查看':'進入課程';b.onclick=()=>native.click();actions.appendChild(b);}
      }
      const header=card.querySelector('.package-header');
      if(header&&!header.querySelector('[data-v1-direct-note]')){
        const note=document.createElement('div');note.className='v1-direct-note';note.dataset.v1DirectNote='1';note.textContent='本課程含母課程教材';header.querySelector('.progress-line')?.before(note);
      }
    });
    document.querySelectorAll('.record-card strong,.admin-lesson-row strong').forEach(x=>{if((x.textContent||'').trim()===DIRECT_TITLE)setText(x,'課程教材');});
  }

  function patchLessonDirectUi(){
    const page=document.getElementById('lessonPage');if(!page||page.hidden)return;
    const title=document.getElementById('lessonTitle'),pkg=document.getElementById('lessonPackageName');
    if(!title||title.textContent.trim()!==DIRECT_TITLE)return;
    const packageName=pkg?.textContent?.trim()||'課程';
    setText(pkg,'母課程教材');setText(title,packageName);
    const b=document.getElementById('completeLessonButton');if(b&&!b.disabled)setText(b,'完成此課程');
  }

  function showLocalToast(msg){
    const t=document.getElementById('toast');if(!t)return;t.textContent=msg;t.hidden=false;clearTimeout(showLocalToast.timer);showLocalToast.timer=setTimeout(()=>t.hidden=true,2800);
  }

  function run(){patchEditor();patchPdf();patchFiles();patchNoExamUi();patchAdminDirectUi();patchStudentDirectUi();patchLessonDirectUi();}
  function scheduleRun(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;run();});}

  const style=document.createElement('style');
  style.textContent=`[data-add-question],[data-edit-question]{display:none!important}.v1-direct-add{border-color:var(--brand)!important;color:var(--brand)!important;font-weight:700}.v1-direct-row{background:var(--surface-soft)}.v1-direct-note{margin:10px 0;padding:9px 11px;border:1px solid var(--line);border-radius:12px;background:var(--surface-soft);color:var(--muted);font-size:.9rem}.v1-download-card{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px;border:1px solid var(--line);border-radius:16px;background:var(--surface-soft)}.v1-download-card div{display:grid;gap:4px}.v1-download-card span{color:var(--muted);font-size:.9rem}@media(max-width:640px){.v1-download-card{align-items:stretch;flex-direction:column}.v1-download-card .primary-button{width:100%}}`;
  document.head.appendChild(style);
  new MutationObserver(scheduleRun).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',run);
})();
