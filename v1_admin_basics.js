(function(){
  'use strict';

  const DIRECT_TITLE='__PACKAGE_DIRECT__';
  const state={catalog:[],learners:[],token:'',adminBasics:false};
  const UI_STATE_KEY='reserve_cadre_v1_admin_ui';
  const BOOTSTRAP_CACHE_KEY='reserve_cadre_v1_bootstrap_cache';
  let scheduled=false;

  function saveUiState(extra={}){
    const expanded=[...document.querySelectorAll('[data-manage-body]')].filter(x=>!x.hidden).map(x=>x.dataset.manageBody).filter(Boolean);
    const currentTab=document.querySelector('[data-admin-tab].is-active')?.dataset.adminTab||'manage';
    sessionStorage.setItem(UI_STATE_KEY,JSON.stringify({tab:currentTab,expanded,scrollY:window.scrollY||0,ts:Date.now(),...extra}));
  }
  function readUiState(){
    try{const x=JSON.parse(sessionStorage.getItem(UI_STATE_KEY)||'null');return x&&Date.now()-Number(x.ts||0)<30000?x:null;}catch{return null;}
  }
  function restoreUiState(){
    const x=readUiState();if(!x)return;
    const tab=document.querySelector(`[data-admin-tab=\"${CSS.escape(x.tab||'manage')}\"]`);
    if(tab&&!tab.classList.contains('is-active'))tab.click();
    let ready=true;
    (x.expanded||[]).forEach(id=>{
      const body=document.querySelector(`[data-manage-body=\"${CSS.escape(id)}\"]`);
      if(!body){ready=false;return;}
      if(body.hidden){body.hidden=false;const b=document.querySelector(`[data-toggle-manage=\"${CSS.escape(id)}\"]`);if(b)b.textContent='收合';}
    });
    if(ready){requestAnimationFrame(()=>window.scrollTo({top:Number(x.scrollY)||0,behavior:'auto'}));sessionStorage.removeItem(UI_STATE_KEY);}
  }
  window.V1AdminUi={saveState:saveUiState,restoreState:restoreUiState};

  function capture(data,token){
    if(token)state.token=token;
    if(!data)return;
    if(data.features&&data.features.adminBasics===true)state.adminBasics=true;
    if(data.catalog&&Array.isArray(data.catalog.packages)){
      state.catalog=data.catalog.packages;
      state.learners=Array.isArray(data.catalog.learners)?data.catalog.learners:[];
    }
  }

  if(window.LearningApi&&window.LearningApi.request){
    const original=window.LearningApi.request.bind(window.LearningApi);
    window.LearningApi=Object.freeze({
      configured:window.LearningApi.configured,
      request:async function(action,payload,token){
        if(token)state.token=token;
        let attempt=0;
        while(true){
          try{
            const data=await original(action,payload,token);
            capture(data,token);
            if(action==='bootstrap'){try{sessionStorage.setItem(BOOTSTRAP_CACHE_KEY,JSON.stringify({data,ts:Date.now()}));}catch{}}
            return data;
          }catch(err){
            const msg=String(err&&err.message||'');
            const expired=/登入已逾時|請重新登入|SESSION_EXPIRED/i.test(msg);
            if(action!=='bootstrap'||expired)throw err;
            if(attempt>=2){
              try{const cached=JSON.parse(sessionStorage.getItem(BOOTSTRAP_CACHE_KEY)||'null');if(cached&&cached.data&&Date.now()-Number(cached.ts||0)<21600000){capture(cached.data,token);return cached.data;}}catch{}
              throw err;
            }
            attempt++;
            await new Promise(r=>setTimeout(r,450*attempt));
          }
        }
      }
    });
  }

  function visibleLessons(pkg){return (pkg?.lessons||[]).filter(l=>String(l.title||'')!==DIRECT_TITLE);}
  function toast(msg){
    const t=document.getElementById('toast');if(!t)return;
    t.textContent=msg;t.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.hidden=true,2800);
  }

  async function adminActionReload(action,payload,button){
    saveUiState();
    const old=button?.textContent||'';
    if(button){button.disabled=true;button.textContent='處理中…';}
    try{
      const data=await window.LearningApi.request(action,payload,state.token);
      toast(data?.message||'已完成');
      setTimeout(()=>location.reload(),350);
    }catch(e){
      if(button){button.disabled=false;button.textContent=old;}
      toast(e.message||'操作失敗');
    }
  }

  function addLessonControls(row,lesson,pkg){
    if(String(lesson.title||'')===DIRECT_TITLE)return;
    const actions=row.querySelector('.manage-row__actions');
    if(!actions||actions.querySelector('[data-v1-delete-lesson]'))return;
    const visible=visibleLessons(pkg),idx=visible.findIndex(x=>x.id===lesson.id);

    const up=document.createElement('button');
    up.type='button';up.className='mini-button';up.textContent='↑';up.title='子課程上移';up.disabled=idx<=0;
    up.onclick=()=>adminActionReload('moveLesson',{id:lesson.id,direction:-1},up);

    const down=document.createElement('button');
    down.type='button';down.className='mini-button';down.textContent='↓';down.title='子課程下移';down.disabled=idx<0||idx>=visible.length-1;
    down.onclick=()=>adminActionReload('moveLesson',{id:lesson.id,direction:1},down);

    const del=document.createElement('button');
    del.type='button';del.className='mini-button mini-button--danger';del.dataset.v1DeleteLesson=lesson.id;del.textContent='刪除';
    del.onclick=()=>{
      if(confirm(`確定刪除子課程「${lesson.title}」？\n若已有學習紀錄，系統只會安全停用，不會刪除歷史紀錄。`)){
        adminActionReload('deleteLesson',{id:lesson.id},del);
      }
    };
    actions.append(up,down,del);
  }

  function addContentControls(row,lesson){
    (lesson.contents||[]).forEach((content,idx)=>{
      const edit=row.querySelector(`[data-edit-content="${CSS.escape(content.id)}"]`);
      const item=edit?.closest('.manage-content');
      if(!item||item.querySelector('[data-v1-delete-content]'))return;

      let actions=item.querySelector('.v1-content-actions');
      if(!actions){
        actions=document.createElement('div');actions.className='v1-content-actions';
        edit.replaceWith(actions);actions.appendChild(edit);
      }

      const up=document.createElement('button');
      up.type='button';up.className='mini-button';up.textContent='↑';up.title='教材上移';up.disabled=idx===0;
      up.onclick=()=>adminActionReload('moveContent',{id:content.id,direction:-1},up);

      const down=document.createElement('button');
      down.type='button';down.className='mini-button';down.textContent='↓';down.title='教材下移';down.disabled=idx===(lesson.contents||[]).length-1;
      down.onclick=()=>adminActionReload('moveContent',{id:content.id,direction:1},down);

      const del=document.createElement('button');
      del.type='button';del.className='mini-button mini-button--danger';del.dataset.v1DeleteContent=content.id;del.textContent='刪除';
      del.onclick=()=>{
        if(confirm(`確定刪除教材「${content.title}」？\n若已有觀看或閱讀紀錄，系統只會安全停用並保留歷史。`)){
          adminActionReload('deleteContent',{id:content.id},del);
        }
      };
      actions.append(up,down,del);
    });
  }

  function patchManage(){
    if(!state.adminBasics||!state.catalog.length)return;
    const list=document.getElementById('adminCatalogList');if(!list)return;
    const cards=[...list.querySelectorAll(':scope > .manage-card')];
    cards.forEach((card,i)=>{
      const pkg=state.catalog[i];if(!pkg)return;
      const rows=[...card.querySelectorAll('.manage-card__body > .manage-row')];
      (pkg.lessons||[]).forEach((lesson,idx)=>{
        const row=rows[idx];if(!row)return;
        addContentControls(row,lesson);
        addLessonControls(row,lesson,pkg);
      });
    });
  }

  function patchAssignmentTools(){
    if(!state.adminBasics)return;
    const form=document.querySelector('#adminEditorBody form[data-admin-form="assignment"]');
    if(!form||form.querySelector('[data-v1-assignment-tools]'))return;

    const box=document.createElement('div');
    box.className='v1-assignment-tools';box.dataset.v1AssignmentTools='1';
    box.innerHTML='<strong>快速勾選</strong><div class="v1-assignment-buttons"><button type="button" class="mini-button" data-v1-pick="all">全部</button><button type="button" class="mini-button" data-v1-pick="門市">全部門市</button><button type="button" class="mini-button" data-v1-pick="儲備幹部">全部儲備幹部</button><button type="button" class="mini-button" data-v1-pick="clear">清除勾選</button></div><small>清除勾選只影響本次操作；既有指派請使用下方「取消指派」。</small>';
    form.insertBefore(box,form.firstElementChild?.nextSibling||form.firstElementChild);

    box.querySelectorAll('[data-v1-pick]').forEach(b=>b.onclick=()=>{
      const mode=b.dataset.v1Pick;
      document.querySelectorAll('input[name="assignLearner"]').forEach(input=>{
        if(mode==='all'){input.checked=true;return;}
        if(mode==='clear'){input.checked=false;return;}
        const learner=state.learners.find(x=>String(x.employeeId)===input.value);
        if(learner&&String(learner.role)===mode)input.checked=true;
      });
    });
  }

  function run(){patchManage();patchAssignmentTools();restoreUiState();}
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;run();});}

  const style=document.createElement('style');
  style.textContent='.v1-content-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.v1-assignment-tools{display:grid;gap:8px;padding:12px;border:1px solid var(--line);border-radius:14px;background:var(--surface-soft);margin-bottom:12px}.v1-assignment-buttons{display:flex;gap:8px;flex-wrap:wrap}.v1-assignment-tools small{color:var(--muted)}@media(max-width:640px){.v1-content-actions{justify-content:flex-end}}';
  document.head.appendChild(style);
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});

  document.addEventListener('submit',e=>{
    const f=e.target;
    if(f&&f.matches&&f.matches('#adminEditForm,#v1DirectContentForm'))saveUiState();
  },true);
  document.addEventListener('click',e=>{
    const b=e.target.closest&&e.target.closest('[data-delete-package],[data-add-lesson],[data-edit-lesson],[data-add-content],[data-edit-content],[data-v1-add-package-content]');
    if(b)saveUiState();
  },true);
  document.addEventListener('DOMContentLoaded',run);
})();
