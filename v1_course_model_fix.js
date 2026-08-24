(function(){
  'use strict';
  let scheduled=false;

  function text(el,value){if(el&&el.textContent!==value)el.textContent=value;}

  function cleanDirectWarnings(){
    document.querySelectorAll('.manage-warning').forEach(el=>{
      const raw=(el.textContent||'').trim();
      if(!raw)return;
      const parts=raw.split('；').map(x=>x.trim()).filter(Boolean).filter(x=>!x.includes('__PACKAGE_DIRECT__')&&!x.includes('母課程教材：尚未建立教材')&&!x.includes('課程教材：尚未建立教材'));
      if(!parts.length){el.style.display='none';return;}
      const next=parts.join('；');
      if(next!==raw)el.textContent=next;
      if(el.style.display==='none')el.style.display='';
    });
  }

  function patchDirectRows(){
    document.querySelectorAll('.v1-direct-row').forEach(row=>{
      const contents=row.querySelectorAll('.manage-content').length;
      if(!contents){row.style.display='none';return;}
      row.style.display='';
      text(row.querySelector('.manage-row__top strong'),'課程教材');
      const edit=row.querySelector('[data-edit-lesson]');
      if(edit)text(edit,'觀看條件');
    });
  }

  function patchLabels(){
    text(document.getElementById('newPackageButton'),'＋ 新增課程');
    const summary=document.querySelector('#adminCatalogSummary .summary-card:first-child span');
    if(summary)text(summary,'課程');

    document.querySelectorAll('#packageList .step-label').forEach(el=>{if((el.textContent||'').trim()==='母課程')text(el,'課程');});
    document.querySelectorAll('#studentSummary .summary-card span').forEach(el=>{if((el.textContent||'').trim()==='母課程')text(el,'課程');if((el.textContent||'').trim()==='母課程完成')text(el,'課程完成');});

    const editorTitle=document.getElementById('adminEditorTitle');
    if(editorTitle){
      const value=(editorTitle.textContent||'').trim();
      if(value==='新增母課程')text(editorTitle,'新增課程');
      if(value==='編輯母課程')text(editorTitle,'編輯課程');
      if(value==='母課程教材｜觀看條件')text(editorTitle,'課程教材｜觀看條件');
      if(value==='新增母課程教材')text(editorTitle,'新增課程教材');
    }
    document.querySelectorAll('#adminEditorBody label > span').forEach(el=>{
      if((el.textContent||'').trim()==='母課程名稱')text(el,'課程名稱');
    });
  }

  function patchEmptyStudentDirect(){
    document.querySelectorAll('#packageList .package-card').forEach(card=>{
      const rows=[...card.querySelectorAll('.lesson-row')];
      const emptyDirect=rows.find(row=>row.style.display==='none'&&(row.querySelector('.lesson-info strong')?.textContent||'').trim()==='__PACKAGE_DIRECT__'&&!(row.querySelector('.lesson-info small')?.textContent||'').match(/影片|PDF|文字|範本/));
      if(!emptyDirect)return;
      card.querySelector('[data-v1-enter-direct]')?.remove();
      card.querySelector('[data-v1-direct-note]')?.remove();
    });
  }

  function run(){patchLabels();patchDirectRows();cleanDirectWarnings();patchEmptyStudentDirect();}
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;run();});}

  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  document.addEventListener('DOMContentLoaded',run);
})();
