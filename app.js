(()=>{'use strict';
(async()=>{try{
  const r=await fetch('app.v112.loader.js?v=1.1.3-safe',{cache:'no-store'});
  if(!r.ok) throw new Error('LOADER_HTTP_'+r.status);
  const source=await r.text();
  (0,eval)(source);
}catch(err){
  console.error('Stable frontend boot failed',err);
  const boot=document.getElementById('bootView');
  if(boot) boot.innerHTML='<strong>程式載入失敗：'+String(err&&err.message||err)+'</strong>';
}})();
})();
