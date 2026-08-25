(()=>{'use strict';
(async()=>{
  try{
    if(typeof DecompressionStream!=='function')throw new Error('BROWSER_UNSUPPORTED');
    const files=['app.bundle.001','app.bundle.002','app.bundle.003','app.bundle.004'];
    const parts=await Promise.all(files.map(async f=>{
      const r=await fetch(`${f}?v=1.1.1`,{cache:'no-store'});
      if(!r.ok)throw new Error(`${f}_HTTP_${r.status}`);
      return (await r.text()).trim();
    }));
    const bin=atob(parts.join(''));
    const bytes=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const source=await new Response(stream).text();
    if(!source.includes("const VERSION = 'V1.1.1'"))throw new Error('BUNDLE_VERSION_MISMATCH');
    (0,eval)(source);
  }catch(err){
    console.error('V1.1.1 boot failed',err);
    const boot=document.getElementById('bootView');
    if(boot)boot.innerHTML='<strong>新版程式載入失敗，請重新整理頁面。</strong>';
  }
})();
})();