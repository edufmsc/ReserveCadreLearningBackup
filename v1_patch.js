(function(){
  'use strict';
  const state={packages:[],catalog:[]};
  function esc(v){return String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function isDrive(url){return /(?:drive|docs)\.google\.com/i.test(String(url||''));}
  function capture(data){
    if(!data)return;
    if(Array.isArray(data.packages))state.packages=data.packages;
    if(data.catalog&&Array.isArray(data.catalog.packages))state.catalog=data.catalog.packages;
  }
  if(window.LearningApi&&window.LearningApi.request){
    const original=window.LearningApi.request.bind(window.LearningApi);
    window.LearningApi=Object.freeze({
      configured:window.LearningApi.configured,
      request:async function(action,payload,token){const data=await original(action,payload,token);capture(data);return data;}
    });
  }
  function allPackages(){return [...(state.packages||[]),...(state.catalog||[])];}
  function activeLesson(){
    const pn=document.getElementById('lessonPackageName')?.textContent?.trim();
    const ln=document.getElementById('lessonTitle')?.textContent?.trim();
    if(!pn||!ln)return null;
    for(const p of allPackages())if(String(p.title||'').trim()===pn){const l=(p.lessons||[]).find(x=>String(x.title||'').trim()===ln);if(l)return l;}
    return null;
  }
  function patchEditor(){
    document.querySelectorAll('[data-add-question],[data-edit-question]').forEach(x=>x.style.display='none');
    const type=document.getElementById('editType');
    if(type){
      [...type.options].filter(o=>o.value==='QUIZ').forEach(o=>o.remove());
      if(![...type.options].some(o=>o.value==='FILE')){const o=document.createElement('option');o.value='FILE';o.textContent='電子範本／下載檔';type.appendChild(o);}
      const label=type.closest('label');if(label){const span=label.querySelector('span');if(span)span.textContent='教材類型';}
    }
    document.querySelectorAll('#adminEditorBody label').forEach(label=>{
      const t=label.textContent||'';
      if(t.includes('測驗及格分數')||t.includes('PDF需完成確認'))label.style.display='none';
    });
    const url=document.getElementById('editUrl');
    if(url){const span=url.closest('label')?.querySelector('span');if(span)span.textContent='影片／PDF／下載檔網址';}
  }
  function patchPdf(){
    document.querySelectorAll('.pdf-content[data-pdf-url]').forEach(block=>{
      if(!isDrive(block.dataset.pdfUrl))return;
      const viewer=block.querySelector('.pdf-viewer');
      if(viewer)viewer.innerHTML='<div class="content-placeholder">正式版 PDF 不使用 Google Drive。請由教育中心改成可直接讀取的 PDF 網址。</div>';
      block.dataset.loaded='1';
    });
  }
  function patchFiles(){
    const host=document.getElementById('lessonContent');if(!host||document.getElementById('lessonPage')?.hidden)return;
    const lesson=activeLesson();if(!lesson)return;
    (lesson.contents||[]).filter(c=>c.enabled!==false&&String(c.type||'').toUpperCase()==='FILE'&&c.url).forEach(c=>{
      if(host.querySelector(`[data-v1-file-id="${CSS.escape(c.id)}"]`))return;
      const a=document.createElement('article');a.className='content-block';a.dataset.v1FileId=c.id;
      a.innerHTML=`<h3>${esc(c.title||'電子範本')}</h3><div class="v1-download-card"><div><strong>電子範本檔</strong><span>點擊下方按鈕下載或開啟檔案</span></div><a class="primary-button primary-button--fit" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer" download>下載範本</a></div>`;
      host.appendChild(a);
    });
    host.querySelectorAll('.tag,.lesson-info small').forEach(x=>{if(x.textContent.includes('FILE'))x.textContent=x.textContent.replace(/FILE/g,'範本檔');});
  }
  function patchNoExamUi(){
    document.querySelectorAll('.record-grid > div').forEach(x=>{if((x.textContent||'').includes('測驗分數'))x.style.display='none';});
    document.querySelectorAll('.admin-lesson-meta').forEach(x=>{x.textContent=(x.textContent||'').replace(/｜測驗 [^｜]*｜完成/g,'｜完成');});
    document.querySelectorAll('.criteria-item').forEach(x=>{if((x.textContent||'').includes('測驗'))x.style.display='none';});
  }
  function run(){patchEditor();patchPdf();patchFiles();patchNoExamUi();}
  const style=document.createElement('style');style.textContent=`[data-add-question],[data-edit-question]{display:none!important}.v1-download-card{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px;border:1px solid var(--line);border-radius:16px;background:var(--surface-soft)}.v1-download-card div{display:grid;gap:4px}.v1-download-card span{color:var(--muted);font-size:.9rem}@media(max-width:640px){.v1-download-card{align-items:stretch;flex-direction:column}.v1-download-card .primary-button{width:100%}}`;
  document.head.appendChild(style);
  new MutationObserver(run).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
  document.addEventListener('DOMContentLoaded',run);
})();
