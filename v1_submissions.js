(function(){
  'use strict';

  const state={
    token:'',user:null,packages:[],catalog:{packages:[],learners:[],assignments:[]},overview:[],
    uploadConfig:{enabled:false,maxMb:20,maxFilesPerBatch:5,maxFilesPerSubmission:20,allowedExtensions:[]},
    features:{},pendingPolicy:null,currentPackageId:'',currentLessonId:'',currentSubmission:null,
    adminSubmissionData:{items:[],config:null,rootFolderUrl:''},selectedFiles:[]
  };
  const FORCE_RETURN_KEY='reserve_cadre_force_return_1011';
  let scheduled=false;

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=v=>String(v??'').trim().toLowerCase();
  const formatBytes=n=>{n=Number(n)||0;if(n<1024)return `${n} B`;if(n<1048576)return `${(n/1024).toFixed(1)} KB`;return `${(n/1048576).toFixed(1)} MB`;};
  const versionText=v=>`V${String(Math.max(1,Number(v)||1)).padStart(2,'0')}`;
  function toast(msg){const t=document.getElementById('toast');if(!t)return;t.textContent=msg;t.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.hidden=true,3200);}

  function capture(data,token){
    if(token)state.token=token;
    if(!data)return;
    if(data.user)state.user=data.user;
    if(data.features)state.features={...state.features,...data.features};
    if(data.uploadConfig)state.uploadConfig={...state.uploadConfig,...data.uploadConfig};
    if(Array.isArray(data.packages))state.packages=data.packages;
    if(data.catalog){state.catalog=data.catalog;if(Array.isArray(data.catalog.packages))state.catalog.packages=data.catalog.packages;}
    if(Array.isArray(data.overview))state.overview=data.overview;
    if(Array.isArray(data.items)&&data.config){state.adminSubmissionData=data;state.uploadConfig={...state.uploadConfig,...data.config};}
    if(data.lessonId&&('latest' in data)){state.currentSubmission=data;if(data.config)state.uploadConfig={...state.uploadConfig,...data.config};}
  }

  if(window.LearningApi&&window.LearningApi.request){
    const original=window.LearningApi.request.bind(window.LearningApi);
    window.LearningApi=Object.freeze({
      configured:window.LearningApi.configured,
      request:async function(action,payload,token){
        if(token)state.token=token;
        const data=await original(action,payload,token);
        capture(data,token);
        if(action==='saveLesson'&&state.pendingPolicy){
          const policy=state.pendingPolicy;state.pendingPolicy=null;
          let lessonId=String(payload?.id||'').trim();
          if(!lessonId&&data?.catalog?.packages){
            const pkg=data.catalog.packages.find(p=>p.id===payload.packageId);
            const matches=(pkg?.lessons||[]).filter(l=>String(l.title||'')===String(payload.title||''));
            lessonId=matches.length?matches[matches.length-1].id:'';
          }
          if(lessonId&&policy.title!=='__PACKAGE_DIRECT__'){
            const refreshed=await original('saveLessonPolicy',{lessonId,submissionMode:policy.mode,submissionNote:policy.note},token);
            capture(refreshed,token);
            return refreshed;
          }
        }
        return data;
      }
    });
  }

  function allLessons(){const out=[];(state.packages||[]).forEach(p=>(p.lessons||[]).forEach(l=>out.push({...l,_package:p})));return out;}
  function findStudentLesson(){
    if(state.currentLessonId){const l=allLessons().find(x=>x.id===state.currentLessonId);if(l)return l;}
    const title=document.getElementById('lessonTitle')?.textContent?.trim();
    const packageTitle=document.getElementById('lessonPackageName')?.textContent?.trim();
    if(!title)return null;
    return allLessons().find(l=>String(l.title||'').trim()===title&&(String(l._package?.title||'').trim()===packageTitle||!packageTitle))||allLessons().find(l=>String(l.title||'').trim()===title)||null;
  }
  function findCatalogLesson(id){for(const p of state.catalog?.packages||[]){const l=(p.lessons||[]).find(x=>x.id===id);if(l)return l;}return null;}

  function patchLessonPolicyEditor(){
    const form=document.querySelector('#adminEditorBody #adminEditForm[data-admin-form="lesson"]');
    if(!form||form.querySelector('[data-v1-submission-policy]'))return;
    const title=document.getElementById('editTitle')?.value||'';
    if(title==='__PACKAGE_DIRECT__')return;
    const id=document.getElementById('editId')?.value||'';
    const lesson=findCatalogLesson(id);
    const mode=lesson?.submissionMode||'不需要',note=lesson?.submissionNote||'';
    const wrap=document.createElement('div');wrap.className='v1-policy-fields';wrap.dataset.v1SubmissionPolicy='1';
    wrap.innerHTML=`<label class="field-group"><span>作業回傳</span><select id="v1SubmissionMode"><option value="不需要">不需要</option><option value="選填">選填</option><option value="必繳審核">必繳並由教育中心審核</option></select></label><label class="field-group field-group--wide"><span>作業說明</span><textarea id="v1SubmissionNote" placeholder="例如：請下載檢核表填寫完成後回傳。">${esc(note)}</textarea></label>`;
    const grid=form.querySelector('.form-grid');if(grid)grid.appendChild(wrap);
    const select=document.getElementById('v1SubmissionMode');if(select)select.value=mode;
  }

  document.addEventListener('submit',e=>{
    const form=e.target;if(!form?.matches?.('#adminEditForm[data-admin-form="lesson"]'))return;
    const title=document.getElementById('editTitle')?.value||'';
    if(title==='__PACKAGE_DIRECT__'){state.pendingPolicy=null;return;}
    state.pendingPolicy={title,mode:document.getElementById('v1SubmissionMode')?.value||'不需要',note:document.getElementById('v1SubmissionNote')?.value||''};
  },true);

  function patchManagePolicyMeta(){
    const list=document.getElementById('adminCatalogList');if(!list||!state.catalog?.packages?.length)return;
    const cards=[...list.querySelectorAll(':scope > .manage-card')];
    cards.forEach((card,pi)=>{
      const pkg=state.catalog.packages[pi];if(!pkg)return;
      const rows=[...card.querySelectorAll(':scope > .manage-card__body > .manage-row')];
      (pkg.lessons||[]).forEach((lesson,li)=>{
        const row=rows[li];if(!row||lesson.title==='__PACKAGE_DIRECT__')return;
        const meta=row.querySelector('.manage-row__meta');if(!meta)return;
        meta.querySelector('[data-v1-policy-tag]')?.remove();
        if((lesson.submissionMode||'不需要')!=='不需要'){
          const span=document.createElement('span');span.dataset.v1PolicyTag='1';span.className='v1-policy-inline';span.textContent=`｜作業：${lesson.submissionMode}`;meta.appendChild(span);
        }
      });
    });
  }

  function ensureSubmissionAdminTab(){
    const admin=document.getElementById('adminDashboard'),nav=admin?.querySelector(':scope > .tab-bar');if(!admin||!nav)return;
    let button=nav.querySelector('[data-v1-submissions-tab]');
    if(!button){button=document.createElement('button');button.className='tab-button';button.type='button';button.dataset.v1SubmissionsTab='1';button.textContent='作業回傳';const manage=nav.querySelector('[data-admin-tab="manage"]');nav.insertBefore(button,manage||null);button.addEventListener('click',openSubmissionAdminTab);}
    let panel=document.getElementById('adminSubmissionPanel');
    if(!panel){panel=document.createElement('section');panel.id='adminSubmissionPanel';panel.className='tab-panel';panel.hidden=true;panel.innerHTML='<div class="panel-heading"><div><h2>作業回傳</h2><p class="package-meta">查看、通過或退回學員繳交的附件</p></div></div><div id="v1SubmissionAdminBody"><div class="empty-state"><h3>載入中…</h3></div></div>';admin.appendChild(panel);}
  }
  async function openSubmissionAdminTab(){
    document.querySelectorAll('[data-admin-tab]').forEach(b=>b.classList.remove('is-active'));
    const btn=document.querySelector('[data-v1-submissions-tab]');if(btn)btn.classList.add('is-active');
    const track=document.getElementById('adminTrackingPanel'),manage=document.getElementById('adminManagePanel'),panel=document.getElementById('adminSubmissionPanel');
    if(track)track.hidden=true;if(manage)manage.hidden=true;if(panel)panel.hidden=false;
    await loadAdminSubmissions();
  }
  document.addEventListener('click',e=>{const b=e.target.closest?.('[data-admin-tab]');if(!b)return;const panel=document.getElementById('adminSubmissionPanel');if(panel)panel.hidden=true;document.querySelector('[data-v1-submissions-tab]')?.classList.remove('is-active');},true);

  async function loadAdminSubmissions(){
    const body=document.getElementById('v1SubmissionAdminBody');if(body)body.innerHTML='<div class="empty-state"><h3>載入作業資料中…</h3></div>';
    try{const data=await window.LearningApi.request('adminSubmissions',{},state.token);state.adminSubmissionData=data;renderAdminSubmissions();}catch(e){if(body)body.innerHTML=`<div class="empty-state"><h3>${esc(e.message||'無法載入')}</h3></div>`;}
  }
  function renderAdminSubmissions(){
    const body=document.getElementById('v1SubmissionAdminBody');if(!body)return;
    const items=state.adminSubmissionData.items||[];
    const counts={pending:items.filter(x=>x.status==='待審核').length,rejected:items.filter(x=>x.status==='已退件').length,approved:items.filter(x=>x.status==='已通過').length};
    body.innerHTML=`<div class="summary-grid v1-sub-summary"><article class="summary-card"><span>待審核</span><strong>${counts.pending}</strong></article><article class="summary-card"><span>已退件</span><strong>${counts.rejected}</strong></article><article class="summary-card"><span>已通過</span><strong>${counts.approved}</strong></article></div><div class="v1-sub-toolbar"><input id="v1SubSearch" type="search" placeholder="搜尋帳號、姓名、店別、課程或子課程"><select id="v1SubFilter"><option value="">全部狀態</option><option value="待審核">待審核</option><option value="已退件">已退件</option><option value="已通過">已通過</option><option value="未送審">未送審</option></select>${state.adminSubmissionData.rootFolderUrl?`<a class="secondary-button primary-button--fit" href="${esc(state.adminSubmissionData.rootFolderUrl)}" target="_blank" rel="noopener">開啟回傳資料夾</a>`:''}</div><div id="v1SubList" class="v1-sub-list"></div>`;
    document.getElementById('v1SubSearch').addEventListener('input',renderAdminSubmissionList);document.getElementById('v1SubFilter').addEventListener('change',renderAdminSubmissionList);renderAdminSubmissionList();
  }
  function renderAdminSubmissionList(){
    const host=document.getElementById('v1SubList');if(!host)return;
    const q=norm(document.getElementById('v1SubSearch')?.value),filter=document.getElementById('v1SubFilter')?.value||'';
    const items=(state.adminSubmissionData.items||[]).filter(x=>(!filter||x.status===filter)&&(!q||norm(`${x.employeeId} ${x.name} ${x.store} ${x.courseTitle} ${x.lessonTitle}`).includes(q)));
    host.innerHTML=items.length?items.map(renderAdminSubmissionCard).join(''):'<div class="empty-state"><h3>查無作業回傳</h3></div>';
    host.querySelectorAll('[data-v1-approve]').forEach(b=>b.onclick=()=>reviewSubmission(b.dataset.v1Approve,'approve'));
    host.querySelectorAll('[data-v1-reject]').forEach(b=>b.onclick=()=>reviewSubmission(b.dataset.v1Reject,'reject'));
  }
  function renderAdminSubmissionCard(x){
    const statusClass=x.status==='已通過'?'tag--success':x.status==='待審核'?'tag--warning':x.status==='已退件'?'tag--danger':'tag--muted';
    const files=(x.files||[]).map(f=>`<a class="v1-file-link" href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)} <small>${formatBytes(f.size)}</small></a>`).join('')||'<span class="package-meta">尚無附件</span>';
    return `<article class="card v1-sub-admin-card"><div class="v1-sub-card-head"><div><strong>${esc(x.name||x.employeeId)}｜${esc(x.employeeId)}</strong><p class="package-meta">${esc(x.store||'')}｜${esc(x.courseTitle)} → ${esc(x.lessonTitle)}</p></div><span class="tag ${statusClass}">${esc(x.status)}</span></div><div class="v1-sub-meta"><span>${versionText(x.version)}</span><span>送出：${esc(x.submittedAt||'—')}</span><span>審核：${esc(x.reviewedAt||'—')}</span></div>${x.rejectReason?`<div class="v1-reject-note"><strong>退件原因：</strong>${esc(x.rejectReason)}</div>`:''}<div class="v1-file-grid">${files}</div>${x.status==='待審核'?`<div class="v1-review-actions"><button class="primary-button primary-button--fit" type="button" data-v1-approve="${esc(x.id)}">通過</button><button class="secondary-button primary-button--fit" type="button" data-v1-reject="${esc(x.id)}">退件</button></div>`:''}</article>`;
  }
  async function reviewSubmission(id,decision){
    let reason='';if(decision==='reject'){reason=prompt('請輸入退件原因（必填）','')??'';if(!reason.trim())return;}else if(!confirm('確定將這份作業設為「已通過」？'))return;
    try{const data=await window.LearningApi.request('reviewSubmission',{id,decision,reason},state.token);state.adminSubmissionData=data;toast(data.message||'審核完成');renderAdminSubmissions();}catch(e){toast(e.message||'審核失敗');}
  }

  function patchForceComplete(){
    const root=document.getElementById('adminPeoplePanel');if(!root||!state.overview?.length)return;
    root.querySelectorAll(':scope > .accordion-card').forEach(card=>{
      const header=card.querySelector('.accordion-title strong')?.textContent||'';const employeeId=header.split('｜').pop()?.trim();const person=state.overview.find(p=>String(p.employeeId)===employeeId);if(!person)return;
      const blocks=[...card.querySelectorAll('.person-package')];
      blocks.forEach(block=>{
        if(block.querySelector('[data-v1-force-package]'))return;
        const title=block.querySelector('.person-package__toggle strong')?.textContent?.trim();const pkg=(person.packages||[]).find(p=>String(p.title||'').trim()===title);if(!pkg)return;
        const body=block.querySelector(':scope > .person-package__body');if(!body)return;
        const row=document.createElement('div');row.className='v1-force-row';
        const complete=(pkg.status==='complete')||(Number(pkg.requiredTotal)>0&&Number(pkg.requiredDone)===Number(pkg.requiredTotal));
        row.innerHTML=complete?'<span class="tag tag--success">課程已完成</span>':`<button class="mini-button v1-force-button" type="button" data-v1-force-package="${esc(pkg.id)}" data-v1-force-employee="${esc(employeeId)}">強制通過此課程</button><small>僅變更完成紀錄，不會偽造觀看秒數或作業附件。</small>`;
        body.insertBefore(row,body.firstChild);
      });
    });
    root.querySelectorAll('[data-v1-force-package]').forEach(b=>{if(b.dataset.v1Bound)return;b.dataset.v1Bound='1';b.onclick=()=>forceComplete(b);});
  }
  async function forceComplete(button){
    const employeeId=button.dataset.v1ForceEmployee,packageId=button.dataset.v1ForcePackage;if(!confirm('確定強制將此人員的整門課程記錄為完成？\n\n此動作會保留原本觀看／作業資料，並留下教育中心強制通過紀錄。'))return;
    const reason=prompt('完成備註（可修改）','教育中心人工確認')??null;if(reason===null)return;
    button.disabled=true;button.textContent='處理中…';
    try{const data=await window.LearningApi.request('forceCompletePackage',{employeeId,packageId,reason},state.token);capture(data,state.token);toast(data.message||'已強制通過');sessionStorage.setItem(FORCE_RETURN_KEY,String(window.scrollY||0));setTimeout(()=>location.reload(),500);}catch(e){button.disabled=false;button.textContent='強制通過此課程';toast(e.message||'操作失敗');}
  }
  function restoreForcePosition(){const raw=sessionStorage.getItem(FORCE_RETURN_KEY);if(raw===null)return;if(!document.getElementById('adminPeoplePanel')?.children.length)return;sessionStorage.removeItem(FORCE_RETURN_KEY);requestAnimationFrame(()=>window.scrollTo({top:Number(raw)||0,behavior:'auto'}));}

  document.addEventListener('click',e=>{const b=e.target.closest?.('[data-open-lesson]');if(!b)return;state.currentLessonId=b.dataset.openLesson||'';state.currentPackageId=b.dataset.packageId||'';state.currentSubmission=null;state.selectedFiles=[];},true);

  function submissionStatusText(sub){if(!sub)return '尚未上傳';return sub.status||'尚未上傳';}
  function submissionStatusClass(status){return status==='已通過'?'tag--success':status==='待審核'?'tag--warning':status==='已退件'?'tag--danger':status==='未送審'?'tag--warning':'tag--muted';}
  function patchStudentSubmission(){
    const lessonPage=document.getElementById('lessonPage'),host=document.getElementById('lessonContent');if(!lessonPage||lessonPage.hidden||!host)return;
    const lesson=findStudentLesson();if(!lesson)return;
    const mode=lesson.submissionMode||'不需要';if(mode==='不需要'){host.querySelector('[data-v1-student-submission]')?.remove();return;}
    let card=host.querySelector('[data-v1-student-submission]');if(!card){card=document.createElement('article');card.className='content-block v1-student-submission';card.dataset.v1StudentSubmission='1';host.appendChild(card);}
    const data=state.currentSubmission?.lessonId===lesson.id?state.currentSubmission:{latest:lesson.submission||null,history:[],config:state.uploadConfig,mode,note:lesson.submissionNote||''};
    renderStudentSubmissionCard(card,lesson,data);
  }
  function renderStudentSubmissionCard(card,lesson,data){
    const sub=data.latest||null,status=submissionStatusText(sub),files=sub?.files||[],config=data.config||state.uploadConfig,locked=status==='待審核'||status==='已通過';
    const canEdit=!locked,required=(data.mode||lesson.submissionMode)==='必繳審核';
    const fileRows=files.map(f=>`<div class="v1-uploaded-file"><span><strong>${esc(f.name)}</strong><small>${formatBytes(f.size)}${f.uploadedAt?`｜${esc(f.uploadedAt)}`:''}</small></span>${status==='未送審'?`<button class="mini-button mini-button--danger" type="button" data-v1-remove-upload="${esc(f.id)}">刪除</button>`:''}</div>`).join('');
    card.innerHTML=`<div class="v1-sub-title"><div><h3>作業／附件回傳</h3><p class="package-meta">${required?'必須送出並由教育中心審核通過':'選填，不影響課程完成'}</p></div><span class="tag ${submissionStatusClass(status)}">${esc(status)}</span></div>${data.note||lesson.submissionNote?`<div class="v1-assignment-note">${esc(data.note||lesson.submissionNote)}</div>`:''}${sub?`<div class="v1-sub-meta"><span>${versionText(sub.version)}</span><span>${sub.submittedAt?`送出：${esc(sub.submittedAt)}`:'尚未送審'}</span></div>`:''}${status==='已退件'&&sub?.rejectReason?`<div class="v1-reject-note"><strong>退件原因：</strong>${esc(sub.rejectReason)}</div>`:''}<div class="v1-uploaded-list">${fileRows||'<div class="manage-empty">目前沒有附件</div>'}</div>${canEdit?`<div class="v1-upload-box"><input id="v1SubmissionFiles" type="file" multiple accept="${(config.allowedExtensions||[]).map(x=>'.'+x).join(',')}"><small>一次最多 ${config.maxFilesPerBatch||5} 個；單檔最多 ${config.maxMb||20} MB；同一版最多 ${config.maxFilesPerSubmission||20} 個。</small><div id="v1SelectedFiles" class="v1-selected-files"></div><button id="v1UploadFilesButton" class="secondary-button primary-button--fit" type="button" disabled>選擇檔案後上傳</button></div>`:''}${status==='未送審'&&files.length?'<button class="primary-button" type="button" data-v1-submit-review>送出教育中心審核</button>':''}${status==='待審核'?'<div class="v1-lock-note">已送出審核，目前附件已鎖定；若教育中心退件後即可重新上傳新版。</div>':''}${status==='已通過'?'<div class="v1-pass-note">教育中心已審核通過。</div>':''}`;
    const complete=document.getElementById('completeLessonButton');if(complete&&required&&lesson.status!=='complete'){const approved=status==='已通過';complete.disabled=!approved;complete.textContent=approved?'完成此子課程':'需先完成作業審核';}
    bindStudentSubmissionCard(card,lesson,config);
  }
  function bindStudentSubmissionCard(card,lesson,config){
    const input=card.querySelector('#v1SubmissionFiles'),upload=card.querySelector('#v1UploadFilesButton'),selected=card.querySelector('#v1SelectedFiles');
    if(input){input.onchange=()=>{const files=[...input.files||[]];const maxBatch=config.maxFilesPerBatch||5;if(files.length>maxBatch){toast(`一次最多選擇 ${maxBatch} 個檔案`);input.value='';state.selectedFiles=[];return;}const allowed=(config.allowedExtensions||[]).map(x=>String(x).toLowerCase()),maxBytes=(config.maxMb||20)*1024*1024;const bad=files.find(f=>f.size>maxBytes||!allowed.includes((f.name.split('.').pop()||'').toLowerCase()));if(bad){toast(`${bad.name} 的格式不支援或超過 ${config.maxMb||20} MB`);input.value='';state.selectedFiles=[];return;}state.selectedFiles=files;if(selected)selected.innerHTML=files.map(f=>`<span>${esc(f.name)} <small>${formatBytes(f.size)}</small></span>`).join('');if(upload){upload.disabled=!files.length;upload.textContent=files.length?`上傳 ${files.length} 個檔案`:'選擇檔案後上傳';}};}
    if(upload)upload.onclick=()=>uploadSelectedFiles(lesson,upload);
    card.querySelectorAll('[data-v1-remove-upload]').forEach(b=>b.onclick=()=>removeUploadedFile(lesson,b.dataset.v1RemoveUpload,b));
    card.querySelector('[data-v1-submit-review]')?.addEventListener('click',()=>submitForReview(lesson));
  }
  function fileBase64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>{const s=String(r.result||''),i=s.indexOf(',');resolve(i>=0?s.slice(i+1):s);};r.onerror=()=>reject(new Error('無法讀取檔案：'+file.name));r.readAsDataURL(file);});}
  async function uploadSelectedFiles(lesson,button){
    const files=[...state.selectedFiles];if(!files.length)return;button.disabled=true;
    try{for(let i=0;i<files.length;i++){const f=files[i];button.textContent=`上傳中 ${i+1}/${files.length}…`;const b64=await fileBase64(f);const data=await window.LearningApi.request('uploadSubmissionFile',{lessonId:lesson.id,fileName:f.name,mimeType:f.type||'application/octet-stream',fileBase64:b64},state.token);state.currentSubmission=data;}state.selectedFiles=[];toast('檔案已上傳');patchStudentSubmission();}catch(e){button.disabled=false;button.textContent='重新上傳';toast(e.message||'上傳失敗');}
  }
  async function removeUploadedFile(lesson,fileId,button){if(!confirm('確定刪除這個尚未送審的附件？'))return;button.disabled=true;try{const data=await window.LearningApi.request('removeSubmissionFile',{lessonId:lesson.id,fileId},state.token);state.currentSubmission=data;patchStudentSubmission();}catch(e){button.disabled=false;toast(e.message||'刪除失敗');}}
  async function submitForReview(lesson){if(!confirm('送出後附件會鎖定，教育中心審核前不能再修改。\n\n確定送出審核？'))return;try{const data=await window.LearningApi.request('submitSubmission',{lessonId:lesson.id},state.token);state.currentSubmission=data;toast('已送出教育中心審核');patchStudentSubmission();}catch(e){toast(e.message||'送出失敗');}}

  function run(){patchLessonPolicyEditor();patchManagePolicyMeta();ensureSubmissionAdminTab();patchForceComplete();patchStudentSubmission();restoreForcePosition();}
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;run();});}

  const style=document.createElement('style');style.textContent=`
    .v1-policy-fields{display:contents}.v1-policy-inline{font-weight:700;color:var(--brand)}
    .v1-sub-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:14px 0}.v1-sub-toolbar input{flex:1;min-width:230px}.v1-sub-toolbar select{min-width:150px}
    .v1-sub-list{display:grid;gap:12px}.v1-sub-admin-card{padding:16px}.v1-sub-card-head,.v1-sub-title{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.v1-sub-meta{display:flex;gap:12px;flex-wrap:wrap;color:var(--muted);font-size:.88rem;margin:8px 0}
    .v1-file-grid{display:grid;gap:7px;margin:10px 0}.v1-file-link{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;text-decoration:none;color:inherit;background:var(--surface-soft)}
    .v1-review-actions{display:flex;gap:8px;margin-top:12px}.v1-reject-note{padding:10px 12px;border-radius:12px;background:#fff0ee;color:#a02b1c;margin:10px 0}.v1-force-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 0;border-bottom:1px dashed var(--line)}.v1-force-row small{color:var(--muted)}
    .v1-student-submission{border:1px solid var(--line)}.v1-assignment-note,.v1-lock-note,.v1-pass-note{padding:10px 12px;border-radius:12px;background:var(--surface-soft);margin:10px 0}.v1-pass-note{background:#edf8f0}.v1-lock-note{background:#fff7e7}
    .v1-uploaded-list{display:grid;gap:8px;margin:12px 0}.v1-uploaded-file{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--line);border-radius:12px}.v1-uploaded-file span{display:grid;gap:2px}.v1-uploaded-file small{color:var(--muted)}
    .v1-upload-box{display:grid;gap:8px;padding:12px;border:1px dashed var(--line);border-radius:14px;margin:12px 0}.v1-selected-files{display:grid;gap:5px}.v1-selected-files span{padding:7px 9px;border-radius:9px;background:var(--surface-soft)}
    @media(max-width:680px){.v1-sub-card-head,.v1-sub-title{flex-direction:column}.v1-sub-toolbar{align-items:stretch}.v1-sub-toolbar input,.v1-sub-toolbar select{width:100%}.v1-review-actions{flex-direction:column}}
  `;document.head.appendChild(style);
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',schedule);
  setTimeout(schedule,200);
})();
