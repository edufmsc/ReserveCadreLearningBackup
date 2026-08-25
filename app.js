(()=>{'use strict';
const BUNDLE='app.bundle.dat?v=1.1.1';
(async()=>{
  try{
    if(typeof DecompressionStream!=='function')throw new Error('BROWSER_UNSUPPORTED');
    const r=await fetch(BUNDLE,{cache:'no-store'});
    if(!r.ok)throw new Error('BUNDLE_HTTP_'+r.status);
    const gz=await r.arrayBuffer();
    const stream=new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
    const source=await new Response(stream).text();
    if(!source.includes("V='V1.1.1'"))throw new Error('BUNDLE_VERSION_MISMATCH');
    (0,eval)(source);
  }catch(err){
    console.error('V1.1.1 boot failed',err);
    const boot=document.getElementById('bootView');
    if(boot)boot.innerHTML='<strong>新版程式載入失敗，請重新整理頁面。</strong>';
  }
})();
})();