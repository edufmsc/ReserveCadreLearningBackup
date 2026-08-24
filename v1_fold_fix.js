(function(){
  'use strict';

  const KEY='reserve_cadre_v1_fold_state_108';
  let scheduled=false;
  let state=load();

  function emptyState(){return {packages:[],lessons:[],focusPackage:'',focusLesson:'',scrollY:0};}
  function load(){
    try{
      const value=JSON.parse(sessionStorage.getItem(KEY)||'null');
      return value&&typeof value==='object'?{...emptyState(),...value}:emptyState();
    }catch{return emptyState();}
  }
  function save(){try{sessionStorage.setItem(KEY,JSON.stringify(state));}catch{}}
  function uniq(values){return [...new Set((values||[]).filter(Boolean))];}
  function packageId(card){return card?.querySelector('[data-toggle-manage]')?.dataset.toggleManage||'';}
  function lessonId(row){return row?.querySelector('[data-edit-lesson]')?.dataset.editLesson||'';}
  function packageBody(card){return card?.querySelector(':scope > .manage-card__body')||null;}
  function contentList(row){return row?.querySelector(':scope > .manage-content-list')||null;}

  function setPackageOpen(card,open){
    const body=packageBody(card);if(!body)return;
    body.hidden=!open;
    body.dataset.v1PackageOpen=open?'1':'0';
    const toggle=card.querySelector('[data-toggle-manage]');
    if(toggle){toggle.textContent=open?'收合':'展開';toggle.setAttribute('aria-expanded',open?'true':'false');}
    card.classList.toggle('is-v1-package-open',open);
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

  function rememberPackage(id,open){
    if(open)state.packages=uniq([...state.packages,id]);
    else state.packages=state.packages.filter(x=>x!==id);
    state.focusPackage=id;
    state.scrollY=window.scrollY||0;
    save();
  }

  function rememberLesson(id,open,row){
    if(open)state.lessons=uniq([...state.lessons,id]);
    else state.lessons=state.lessons.filter(x=>x!==id);
    state.focusLesson=id;
    const card=row?.closest('.manage-card');
    const pid=packageId(card);
    if(pid){state.packages=uniq([...state.packages,pid]);state.focusPackage=pid;}
    state.scrollY=window.scrollY||0;
    save();
  }

  function captureCurrent(){
    const list=document.getElementById('adminCatalogList');if(!list)return;
    state.packages=uniq([...list.querySelectorAll(':scope > .manage-card')]
      .filter(card=>packageBody(card)&&!packageBody(card).hidden)
      .map(packageId));
    state.lessons=uniq([...list.querySelectorAll('.manage-row')]
      .filter(row=>contentList(row)?.dataset.v1FoldOpen==='1')
      .map(lessonId));
    state.scrollY=window.scrollY||0;
    save();
  }

  function rememberAction(button){
    const card=button?.closest?.('.manage-card');
    const row=button?.closest?.('.manage-row');
    const pid=packageId(card),lid=lessonId(row);
    captureCurrent();
    if(pid){state.packages=uniq([...state.packages,pid]);state.focusPackage=pid;}
    if(lid&&button.matches('[data-edit-lesson],[data-add-content],[data-edit-content],[data-v1-delete-content],[data-v1-delete-lesson]')){
      if(contentList(row)&&!contentList(row).hidden)state.lessons=uniq([...state.lessons,lid]);
      state.focusLesson=lid;
    }
    save();
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
    }
    toggle.dataset.count=String(count);
    if(count===0){
      toggle.hidden=true;
      list.hidden=false;
      list.dataset.v1FoldOpen='0';
      row.classList.remove('is-v1-lesson-open');
      return;
    }
    toggle.hidden=false;
    if(!list.dataset.v1FoldInit){
      list.dataset.v1FoldInit='1';
      setLessonOpen(row,state.lessons.includes(id));
    }else{
      const open=list.dataset.v1FoldOpen==='1';
      setLessonOpen(row,open);
    }
  }

  function decorate(){
    const manage=document.getElementById('adminManagePanel');
    const list=document.getElementById('adminCatalogList');
    if(!manage||manage.hidden||!list)return;
    [...list.querySelectorAll(':scope > .manage-card')].forEach(card=>{
      const id=packageId(card);if(!id)return;
      const body=packageBody(card);
      if(body&&!body.dataset.v1PackageInit){
        body.dataset.v1PackageInit='1';
        setPackageOpen(card,state.packages.includes(id));
      }
      card.querySelectorAll(':scope > .manage-card__body > .manage-row').forEach(addLessonToggle);
    });
  }

  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;decorate();});}

  document.addEventListener('click',e=>{
    const button=e.target.closest?.('button');if(!button)return;

    if(button.matches('[data-toggle-manage]')){
      const card=button.closest('.manage-card');
      const body=packageBody(card);if(!card||!body)return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const open=body.hidden;
      setPackageOpen(card,open);
      rememberPackage(button.dataset.toggleManage||packageId(card),open);
      return;
    }

    if(button.matches('[data-v1-toggle-lesson]')){
      const row=button.closest('.manage-row');
      const list=contentList(row);if(!row||!list)return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const open=list.hidden;
      setLessonOpen(row,open);
      rememberLesson(button.dataset.v1ToggleLesson||lessonId(row),open,row);
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
    .manage-card.is-v1-package-open>.manage-card__head{border-bottom:1px solid var(--line)}
    .manage-row__top{gap:12px}
    @media(max-width:720px){.v1-lesson-fold-button{min-width:auto}}
  `;
  document.head.appendChild(style);

  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',schedule);
  setTimeout(schedule,150);
})();
