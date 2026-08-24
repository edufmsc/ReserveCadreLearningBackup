(function(){
  'use strict';
  const KEY='reserve_cadre_v1_return_course_manage_105';
  const PAGE_ID=`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let restoring=false;

  function currentManageVisible(){
    const panel=document.getElementById('adminManagePanel');
    return !!panel && !panel.hidden;
  }
  function packageIdFrom(node){
    const card=node?.closest?.('.manage-card');
    return card?.querySelector('[data-toggle-manage]')?.dataset.toggleManage||'';
  }
  function save(node){
    if(!currentManageVisible())return;
    const card=node?.closest?.('.manage-card');
    const packageId=packageIdFrom(node);
    const expanded=[...document.querySelectorAll('[data-manage-body]')].filter(x=>!x.hidden).map(x=>x.dataset.manageBody).filter(Boolean);
    const data={pageId:PAGE_ID,packageId,expanded,scrollY:window.scrollY||0,cardTop:card?card.getBoundingClientRect().top:null,ts:Date.now()};
    try{sessionStorage.setItem(KEY,JSON.stringify(data));}catch{}
  }
  function read(){
    try{
      const x=JSON.parse(sessionStorage.getItem(KEY)||'null');
      if(!x||x.pageId===PAGE_ID||Date.now()-Number(x.ts||0)>120000)return null;
      return x;
    }catch{return null;}
  }
  function restore(){
    if(restoring)return;
    const saved=read();if(!saved)return;
    const admin=document.getElementById('adminDashboard');
    if(!admin||admin.hidden)return;
    const manageButton=document.querySelector('[data-admin-tab="manage"]');
    if(!manageButton)return;
    restoring=true;
    if(!manageButton.classList.contains('is-active'))manageButton.click();
    requestAnimationFrame(()=>{
      const list=document.getElementById('adminCatalogList');
      if(!list){restoring=false;return;}
      (saved.expanded||[]).forEach(id=>{
        const body=document.querySelector(`[data-manage-body="${CSS.escape(id)}"]`);
        if(body&&body.hidden){
          body.hidden=false;
          const toggle=document.querySelector(`[data-toggle-manage="${CSS.escape(id)}"]`);
          if(toggle)toggle.textContent='收合';
        }
      });
      const focusBody=saved.packageId?document.querySelector(`[data-manage-body="${CSS.escape(saved.packageId)}"]`):null;
      const focusCard=focusBody?.closest('.manage-card');
      requestAnimationFrame(()=>{
        if(focusCard&&Number.isFinite(Number(saved.cardTop))){
          const delta=focusCard.getBoundingClientRect().top-Number(saved.cardTop);
          window.scrollBy({top:delta,behavior:'auto'});
        }else{
          window.scrollTo({top:Number(saved.scrollY)||0,behavior:'auto'});
        }
        try{sessionStorage.removeItem(KEY);}catch{}
        restoring=false;
      });
    });
  }

  document.addEventListener('click',e=>{
    const b=e.target.closest?.('#adminCatalogList button');
    if(!b)return;
    if(b.matches('[data-toggle-manage],[data-preview-package]'))return;
    save(b);
  },true);
  document.addEventListener('submit',e=>{
    const f=e.target;
    if(f?.matches?.('#adminEditForm,#v1DirectContentForm'))save(f);
  },true);

  const observer=new MutationObserver(()=>restore());
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',restore);
  let attempts=0;
  const timer=setInterval(()=>{restore();if(++attempts>80||!read())clearInterval(timer);},125);
})();
