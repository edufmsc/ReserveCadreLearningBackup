(function(){
  'use strict';

  const KEY='reserve_cadre_v1_fold_state_107';
  let scheduled=false;
  let state=load();

  function load(){
    try{
      const value=JSON.parse(sessionStorage.getItem(KEY)||'null');
      return value&&typeof value==='object'?value:{packages:[],lessons:[],focusPackage:'',focusLesson:'',scrollY:0};
    }catch{return {packages:[],lessons:[],focusPackage:'',focusLesson:'',scrollY:0};}
  }
  function save(){
    try{sessionStorage.setItem(KEY,JSON.stringify(state));}catch{}
  }
  function uniq(values){return [...new Set(values.filter(Boolean))];}
  function packageId(card){return card?.querySelector('[data-toggle-manage]')?.dataset.toggleManage||'';}
  function lessonId(row){return row?.querySelector('[data-edit-lesson]')?.dataset.editLesson||'';}
  function packageBody(card){return card?.querySelector(':scope > .manage-card__body')||null;}
  function contentList(row){return row?.querySelector(':scope > .manage-content-list')||null;}

  function captureCurrent(){
    const list=document.getElementById('adminCatalogList');
    if(!list)return;
    state.packages=uniq([...list.querySelectorAll(':scope > .manage-card')].filter(card=>{const body=packageBody(card);return body&&!body.hidden;}).map(packageId));
    state.lessons=uniq([...list.querySelectorAll('.manage-row')].filter(row=>{const body=contentList(row);return body&&body.dataset.v1FoldOpen==='1';}).map(lessonId));
    state.scrollY=window.scrollY||0;
    save();
  }

  function rememberAction(button){
    const card=button?.closest?.('.manage-card');
    const row=button?.closest?.('.manage-row');
    const pid=packageId(card);
    const lid=lessonId(row);
    captureCurrent();

    if(pid&&button.matches('[data-add-lesson],[data-edit-lesson],[data-add-content],[data-edit-content],[data-v1-add-package-content],[data-v1-delete-lesson],[data-v1-delete-content],[data-delete-package]')){
      state.packages=uniq([...state.packages,pid]);
      state.focusPackage=pid;
    }
    if(lid&&button.matches('[data-edit-lesson],[data-add-content],[data-edit-content],[data-v1-delete-content]')){
      state.lessons=uniq([...state.lessons,lid]);
      state.focusLesson=lid;
    }
    state.scrollY=window.scrollY||0;
    save();
  }

  function setPackageOpen(card,open){
    const body=packageBody(card);if(!body)return;
    body.hidden=!open;
    const toggle=card.querySelector('[data-toggle-manage]');
    if(toggle)toggle.textContent=open?'收合':'展開';
  }

  function setLessonOpen(row,open){
    const list=contentList(row);if(!list)return;
    list.hidden=!open;
    list.dataset.v1FoldOpen=open?'1':'0';
    row.classList.toggle('is-v1-lesson-open',open);
    const toggle=row.querySelector('[data-v1-toggle-lesson]');
    if(toggle){
      const count=Number(toggle.dataset.count||0);
      toggle.textContent=open?`收合教材 (${count})`:`展開教材 (${count})`;
      toggle.setAttribute('aria-expanded',open?'true':'false');
    }
  }

  function addLessonToggle(row){
    const list=contentList(row);if(!list)return;
    const actions=row.querySelector('.manage-row__actions');if(!actions)return;
    const id=lessonId(row);if(!id)return;
    const count=list.querySelectorAll(':scope > .manage-content').length;
    let toggle=actions.querySelector('[data-v1-toggle-lesson]');
    if(!toggle){
      toggle=document.createElement('button');
      toggle.type='button';
      toggle.className='mini-button v1-lesson-fold-button';
      toggle.dataset.v1ToggleLesson=id;
      const add=actions.querySelector('[data-add-content]');
      actions.insertBefore(toggle,add||actions.firstChild);
      toggle.addEventListener('click',()=>{
        const open=list.dataset.v1FoldOpen!=='1';
        setLessonOpen(row,open);
        if(open)state.lessons=uniq([...state.lessons,id]);
        else state.lessons=state.lessons.filter(x=>x!==id);
        state.focusLesson=id;
        const card=row.closest('.manage-card'),pid=packageId(card);
        if(pid){state.packages=uniq([...state.packages,pid]);state.focusPackage=pid;}
        state.scrollY=window.scrollY||0;
        save();
      });
    }
    toggle.dataset.count=String(count);
    if(count===0){
      toggle.hidden=true;
      list.hidden=false;
      list.dataset.v1FoldOpen='0';
      return;
    }
    toggle.hidden=false;
    setLessonOpen(row,state.lessons.includes(id));
  }

  function restorePosition(){
    let target=null;
    if(state.focusLesson){
      const edit=document.querySelector(`[data-edit-lesson="${CSS.escape(state.focusLesson)}"]`);
      target=edit?.closest('.manage-row')||null;
    }
    if(!target&&state.focusPackage){
      const toggle=document.querySelector(`[data-toggle-manage="${CSS.escape(state.focusPackage)}"]`);
      target=toggle?.closest('.manage-card')||null;
    }
    if(target){
      const rect=target.getBoundingClientRect();
      if(rect.top<110||rect.top>window.innerHeight-100)target.scrollIntoView({block:'center',behavior:'auto'});
    }
  }

  function apply(){
    const manage=document.getElementById('adminManagePanel');
    const list=document.getElementById('adminCatalogList');
    if(!manage||manage.hidden||!list)return;

    [...list.querySelectorAll(':scope > .manage-card')].forEach(card=>{
      const id=packageId(card);
      setPackageOpen(card,state.packages.includes(id));
      card.querySelectorAll(':scope > .manage-card__body > .manage-row').forEach(addLessonToggle);
    });
    requestAnimationFrame(restorePosition);
  }

  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;apply();});}

  document.addEventListener('click',e=>{
    const button=e.target.closest?.('button');if(!button)return;
    if(button.matches('[data-toggle-manage]')){
      requestAnimationFrame(()=>{captureCurrent();state.focusPackage=button.dataset.toggleManage||'';save();});
      return;
    }
    if(button.closest('#adminCatalogList'))rememberAction(button);
  },true);

  document.addEventListener('submit',e=>{
    const form=e.target;
    if(!form?.matches?.('#adminEditForm,#v1DirectContentForm'))return;
    captureCurrent();
    const pid=form.querySelector('#editPackageId')?.value||state.focusPackage;
    const lid=form.querySelector('#editLessonId')?.value||form.querySelector('#editId')?.value||state.focusLesson;
    if(pid)state.packages=uniq([...state.packages,pid]);
    if(lid&&form.dataset.adminForm!=='package')state.lessons=uniq([...state.lessons,lid]);
    state.focusPackage=pid||state.focusPackage;
    state.focusLesson=lid||state.focusLesson;
    save();
  },true);

  const style=document.createElement('style');
  style.textContent=`
    .manage-row .manage-content-list[hidden]{display:none!important}
    .v1-lesson-fold-button{min-width:104px}
    .manage-row.is-v1-lesson-open{box-shadow:inset 3px 0 0 var(--brand)}
    .manage-row__top{gap:12px}
    @media(max-width:720px){.v1-lesson-fold-button{min-width:auto}}
  `;
  document.head.appendChild(style);

  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',schedule);
  setTimeout(schedule,200);
})();
