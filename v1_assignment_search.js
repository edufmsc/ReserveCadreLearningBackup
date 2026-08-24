(function(){
  'use strict';
  let scheduled=false;

  function normalize(v){return String(v||'').trim().toLowerCase();}

  function enhance(){
    const form=document.querySelector('#adminEditorBody form[data-admin-form="assignment"]');
    if(!form||form.querySelector('[data-v1-assignment-search]'))return;

    const checklist=form.querySelector('.learner-checklist');
    if(!checklist)return;

    const wrap=document.createElement('div');
    wrap.className='v1-assignment-search';
    wrap.dataset.v1AssignmentSearch='1';
    wrap.innerHTML=`
      <label class="field-group">
        <span>搜尋指派對象</span>
        <div class="v1-search-row">
          <input type="search" data-v1-assignment-search-input placeholder="輸入帳號、姓名或店別">
          <button type="button" class="mini-button" data-v1-assignment-search-clear>清除</button>
        </div>
      </label>
      <div class="v1-search-result" data-v1-assignment-search-result></div>
    `;

    checklist.parentElement.insertBefore(wrap,checklist);

    const input=wrap.querySelector('[data-v1-assignment-search-input]');
    const clear=wrap.querySelector('[data-v1-assignment-search-clear]');
    const result=wrap.querySelector('[data-v1-assignment-search-result]');

    const filter=()=>{
      const q=normalize(input.value);
      const rows=[...checklist.querySelectorAll('.learner-check')];
      let shown=0;
      rows.forEach(row=>{
        const hit=!q||normalize(row.textContent).includes(q);
        row.hidden=!hit;
        if(hit)shown++;
      });
      result.textContent=q?`找到 ${shown} 筆`:`共 ${rows.length} 筆可指派帳號`;
    };

    input.addEventListener('input',filter);
    clear.addEventListener('click',()=>{input.value='';filter();input.focus();});
    filter();
  }

  function run(){enhance();}
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;run();});}

  const style=document.createElement('style');
  style.textContent=`
    .v1-assignment-search{margin:0 0 12px;padding:12px;border:1px solid var(--line);border-radius:14px;background:#fff}
    .v1-search-row{display:flex;gap:8px;align-items:center}
    .v1-search-row input{flex:1;min-width:0}
    .v1-search-result{margin-top:6px;color:var(--muted);font-size:.86rem}
    .learner-check[hidden]{display:none!important}
    @media(max-width:640px){.v1-search-row{align-items:stretch}.v1-search-row .mini-button{white-space:nowrap}}
  `;
  document.head.appendChild(style);

  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',run);
})();
