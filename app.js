(()=>{'use strict';
const APP_PARTS=['app.bundle.001?v=1.1.2','app.bundle.002?v=1.1.2','app.bundle.003?v=1.1.2','app.bundle.004?v=1.1.2'];
const CSS_FILE='styles.bundle.001?v=1.1.2';
async function fetchBytes(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error('BUNDLE_HTTP_'+r.status);return new Uint8Array(await r.arrayBuffer());}
async function gunzip(bytes){const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));return new Response(stream).text();}
(async()=>{
  try{
    if(typeof DecompressionStream!=='function')throw new Error('BROWSER_UNSUPPORTED');
    const [parts,cssBytes]=await Promise.all([Promise.all(APP_PARTS.map(fetchBytes)),fetchBytes(CSS_FILE)]);
    const total=parts.reduce((n,p)=>n+p.length,0);const appBytes=new Uint8Array(total);let offset=0;for(const p of parts){appBytes.set(p,offset);offset+=p.length;}
    const [source,css]=await Promise.all([gunzip(appBytes),gunzip(cssBytes)]);
    if(!source.includes("V='V1.1.2'"))throw new Error('BUNDLE_VERSION_MISMATCH');
    const style=document.createElement('style');style.id='v112-release-style';style.textContent=css;document.head.appendChild(style);
    (0,eval)(source);
  }catch(err){
    console.error('V1.1.2 boot failed',err);
    const boot=document.getElementById('bootView');if(boot)boot.innerHTML='<strong>新版程式載入失敗，請重新整理頁面。</strong>';
  }
})();
})();