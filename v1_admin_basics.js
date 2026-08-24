(function(){
  'use strict';

  const DIRECT_TITLE='__PACKAGE_DIRECT__';
  const state={catalog:[],learners:[],token:'',adminBasics:false};
  let scheduled=false;

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
        const data=await original(action,payload,token);
        capture(data,token);
        return data;
      }
    });
  }

  function visibleLessons(pkg){return (pkg?.lessons||[]).filter(l=>String(l.title||'')!==DIRECT_TITLE);}
  function toast(msg){
    const t=document.getElementById('toast');if(!t)return;
    t.textContent=msg;t.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.hidden=true,2800);
  }

  async function adminActionReload(action,payload,button){
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

  function run(){patchManage();patchAssignmentTools();}
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;run();});}

  const style=document.createElement('style');
  style.textContent='.v1-content-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.v1-assignment-tools{display:grid;gap:8px;padding:12px;border:1px solid var(--line);border-radius:14px;background:var(--surface-soft);margin-bottom:12px}.v1-assignment-buttons{display:flex;gap:8px;flex-wrap:wrap}.v1-assignment-tools small{color:var(--muted)}@media(max-width:640px){.v1-content-actions{justify-content:flex-end}}';
  document.head.appendChild(style);
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',run);
})();
