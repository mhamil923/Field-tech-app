// File: app/lib/pdfHtml.js
//
// The read-only PDF viewer document, shared by the work-order attachment lightbox
// and the recovered-sign-offs preview. It renders from base64 held in
// window.PDF_BASE64 and pulls pdf.js from the bundled assets (see pdfAssets.js), so
// it works with a purely local file and with no network at all.
//
// Lives here rather than inside a screen because two different screens now need it.

/**
 * Read-only multi-page PDF viewer using pdf.js (for lightbox / attachments)
 */
export const PDF_VIEWER_HTML = `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes" />
<title>PDF Preview</title>
<style>
  html, body {
    margin:0; padding:0;
    background:#111;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
    height:100%;
    overflow-y:scroll;
    -webkit-overflow-scrolling:touch;
    overscroll-behavior: contain;
  }
  #pages { padding:8px; display:flex; flex-direction:column; align-items:center; }
  .pageWrap { margin-bottom:16px; width:100%; max-width:1100px; display:flex; justify-content:center; touch-action: pan-y; }
  canvas.page { width:100%; height:auto; background:#fafafa; box-shadow:0 2px 6px rgba(0,0,0,.35); border-radius:6px; touch-action: pan-y; pointer-events: none; }
  #loader { color:#fff; text-align:center; padding:20px; font-size:16px; }
  #pageIndicator { position:fixed; bottom:12px; right:16px; background:rgba(0,0,0,0.65); color:#fff; padding:6px 10px; border-radius:8px; font-size:14px; font-weight:600; z-index:1000; }
</style>
</head>
<body>
  <div id="loader">Loading PDF…</div>
  <div id="pages"></div>
  <div id="pageIndicator" style="display:none;">Page 1 of 1</div>
  <!--PDF_LIBS-->
  <script>
    function b64ToUint8(b64){const bin=atob(b64);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return bytes;}
    async function renderAllPages(){
      const b64=window.PDF_BASE64||''; if(!b64){ document.getElementById('loader').innerText='Missing PDF data.'; return; }
      if(window.__PDF_BOOT_ERROR){ document.getElementById('loader').innerText=window.__PDF_BOOT_ERROR; window.ReactNativeWebView?.postMessage('ERROR:'+window.__PDF_BOOT_ERROR); return; }
      try{
        const pdfDoc=await pdfjsLib.getDocument({data:b64ToUint8(b64)}).promise;
        const pagesContainer=document.getElementById('pages'); const loader=document.getElementById('loader'); loader.remove();
        for(let i=1;i<=pdfDoc.numPages;i++){
          const page=await pdfDoc.getPage(i);
          const viewport=page.getViewport({scale:1.2});
          const wrap=document.createElement('div'); wrap.className='pageWrap';
          const canvas=document.createElement('canvas'); canvas.className='page';
          const context=canvas.getContext('2d'); canvas.height=viewport.height; canvas.width=viewport.width;
          wrap.appendChild(canvas); pagesContainer.appendChild(wrap);
          await page.render({canvasContext:context,viewport}).promise;
        }
        const indicator=document.getElementById('pageIndicator'); indicator.style.display='block';
        const total=pdfDoc.numPages;
        function updatePageIndicator(){
          const wraps=document.querySelectorAll('.pageWrap'); let current=1;
          for(let i=0;i<wraps.length;i++){ const rect=wraps[i].getBoundingClientRect(); if(rect.top<window.innerHeight*0.5) current=i+1; }
          indicator.textContent='Page '+current+' of '+total;
        }
        window.addEventListener('scroll',updatePageIndicator,{passive:true}); updatePageIndicator();
        setTimeout(()=>{ const h=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight); window.ReactNativeWebView?.postMessage('HEIGHT:'+h); },800);
      }catch(e){ document.getElementById('loader').innerText='Error loading PDF: '+e.message; window.ReactNativeWebView?.postMessage('ERROR:'+e.message); }
    }
    document.addEventListener('DOMContentLoaded',renderAllPages);
  </script>
</body>
</html>
`;
