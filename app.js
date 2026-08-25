(()=>{'use strict';
const APP_PARTS=['app.bundle.001?v=1.1.2','app.bundle.002?v=1.1.2','app.bundle.003?v=1.1.2','app.bundle.004?v=1.1.2'];
const CSS_PARTS=['styles.bundle.001?v=1.1.2'];
async function unpack(parts){
  const texts=await Promise.all(parts.map(async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error('BUNDLE_HTTP_'+r.status);return r.text();}));
  const bin=atob(texts.join(''));
  const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
(async()=>{
  try{
    if(typeof DecompressionStream!=='function')throw new Error('BROWSER_UNSUPPORTED');
    const [source,css]=await Promise.all([unpack(APP_PARTS),unpack(CSS_PARTS)]);
    if(!source.includes("V='V1.1.2'"))throw new Error('BUNDLE_VERSION_MISMATCH');
    const style=document.createElement('style');style.id='v112-release-style';style.textContent=css;document.head.appendChild(style);
    (0,eval)(source);
  }catch(err){
    console.error('V1.1.2 boot failed',err);
    const boot=document.getElementById('bootView');
    if(boot)boot.innerHTML='<strong>新版程式載入失敗，請重新整理頁面。</strong>';
  }
})();
})();