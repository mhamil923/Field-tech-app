// File: app/screens/ViewWorkOrder.js
import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Dimensions,
  Alert,
  Image,
  FlatList,
  Share,
  TextInput,
  Linking,
  Platform,
  SafeAreaView,
  KeyboardAvoidingView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Camera, CameraType } from 'expo-camera';
import moment from 'moment';
import { useLocalSearchParams, useRouter } from 'expo-router';

import api, { fileUrl } from '../../constants/api';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

/** ─────────────────────────────────────────────────────────────
 * Statuses (keep in sync with web/server)
 * ───────────────────────────────────────────────────────────── */
const STATUS_OPTIONS = [
  'New',
  'Scheduled',
  'Needs to be Quoted',
  'Waiting for Approval',
  'Approved',
  'Waiting on Parts',
  'Needs to be Scheduled',
  'Needs to be Invoiced',
  'Completed',
];

/**
 * Read-only multi-page PDF viewer using pdf.js
 */
const PDF_VIEWER_HTML = `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>PDF Preview</title>
<style>
  html,body { margin:0; padding:0; background:#fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
  #pages { padding: 8px; }
  .pageWrap { margin: 0 auto 12px; max-width: 1100px; }
  canvas.page { width:100%; height:auto; display:block; background:#fafafa; box-shadow: 0 1px 2px rgba(0,0,0,.05); }
  .hint { text-align:center; font-size:12px; color:#6b7280; margin:8px 0 12px; }
</style>
</head>
<body>
  <div id="pages"></div>
  <div class="hint">Scroll to view all pages.</div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <script>
    if (window['pdfjsLib']) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    }
    function b64ToUint8(b64){const bin=atob(b64);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return bytes;}
    async function renderPDF(){
      try{
        const b64 = window.PDF_BASE64 || '';
        if(!b64) throw new Error('Missing PDF data.');
        const doc = await pdfjsLib.getDocument({ data: b64ToUint8(b64) }).promise;
        const container = document.getElementById('pages'); container.innerHTML='';
        for (let i=1; i<=doc.numPages; i++){
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          const targetWidth = Math.min(1100, Math.max(600, vp.width));
          const scale = targetWidth / vp.width;
          const viewport = page.getViewport({ scale });
          const wrap = document.createElement('div'); wrap.className = 'pageWrap';
          const c = document.createElement('canvas'); c.className='page';
          c.width = Math.floor(viewport.width); c.height = Math.floor(viewport.height);
          wrap.appendChild(c); container.appendChild(wrap);
          await page.render({ canvasContext: c.getContext('2d'), viewport }).promise;
        }
        setTimeout(()=>{
          const h=Math.max(document.documentElement.scrollHeight,document.body.scrollHeight);
          window.ReactNativeWebView?.postMessage('HEIGHT:'+h);
        },50);
      } catch(e){
        window.ReactNativeWebView?.postMessage('ERROR:'+(e?.message||String(e)));
      }
    }
    window.addEventListener('DOMContentLoaded', renderPDF);
  </script>
</body>
</html>
`;

/**
 * PDF Annotator (used for "Annotate & Sign PDF")
 * — fixed stroke engine: solid lines, higher min width, no gaps
 */
const ANNOTATOR_HTML = `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>Annotate</title>
<style>
  html,body { margin:0; padding:0; background:#fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
  body { padding-top: calc(env(safe-area-inset-top, 0px) + 6px); }
  #toolbar { position: sticky; top: 0; z-index: 1000; background: #111827; color:#fff; display:flex; gap:8px; align-items:center; padding:8px 10px; flex-wrap: wrap; }
  #toolbar button { background:#374151; border:0; color:#fff; padding:8px 10px; border-radius:6px; font-weight:600; }
  #toolbar button.primary { background:#2563EB; }
  #toolbar label { display:flex; align-items:center; gap:6px; font-size:13px; background:#1f2937; padding:6px 10px; border-radius:6px; }
  #toolbar .sep { flex:1; }
  #pages { padding: 8px; }
  .pageWrap { position:relative; margin: 0 auto 16px; max-width: 900px; }
  canvas.page { width:100%; height:auto; display:block; background:#fafafa; }
  canvas.overlay { position:absolute; left:0; top:0; touch-action:none; }
  .hint { text-align:center; font-size:12px; color:#6b7280; margin:8px 0 12px; }
  .cursor { position: fixed; pointer-events:none; z-index: 2000; width: 24px; height: 24px; border-radius: 999px; border: 2px solid rgba(0,0,0,0.6); background: rgba(255,255,255,0.9); display:none; transform: translate(-50%, -50%); }
  .cursor.pen { width: 10px; height: 10px; background: #111827; border-color: #111827; }
</style>
</head>
<body>
  <div id="toolbar">
    <label><input type="checkbox" id="drawToggle" /> Draw Mode</label>
    <button id="pen">Pen</button>
    <button id="erase">Erase</button>
    <button id="undo">Undo</button>
    <button id="clear">Clear Page</button>
    <div class="sep"></div>
    <div style="display:flex; gap:8px;">
      <button id="close">Close</button>
      <button id="save" class="primary">Save & Upload</button>
    </div>
  </div>
  <div id="pages"></div>
  <div class="hint">Turn OFF “Draw Mode” to scroll. Turn it ON to sign/annotate.</div>
  <div id="cursor" class="cursor"></div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <script>pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";</script>
  <script src="https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js"></script>
  <script>
    function b64ToUint8(b64){const bin=atob(b64);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return bytes;}

    const state={tool:'pen',drawEnabled:false,pages:[]};
    function applyPointerMode(){
      for(const p of state.pages){
        p.overlayCanvas.style.pointerEvents=state.drawEnabled?'auto':'none';
        p.overlayCanvas.style.touchAction=state.drawEnabled?'none':'auto';
        p.overlayCanvas.style.cursor=state.drawEnabled?(state.tool==='erase'?'cell':'crosshair'):'default';
      }
      const c=document.getElementById('cursor');
      if(!state.drawEnabled){c.style.display='none';return;}
      c.style.display='block'; c.className=state.tool==='erase'?'cursor':'cursor pen';
    }
    function setTool(t){state.tool=t;applyPointerMode();}
    function setDrawEnabled(on){state.drawEnabled=!!on;applyPointerMode();}
    function pushUndo(p){try{const snap=p.overlayCtx.getImageData(0,0,p.overlayCanvas.width,p.overlayCanvas.height);p.strokes.push(snap);if(p.strokes.length>50)p.strokes.shift();}catch(e){}}
    function undo(p){if(p.strokes.length)p.overlayCtx.putImageData(p.strokes.pop(),0,0);}
    function clearPage(p){pushUndo(p);p.overlayCtx.clearRect(0,0,p.overlayCanvas.width,p.overlayCanvas.height);}

    function widthFor(a,b){
      const dt = Math.max(1, (b.ts - a.ts));
      const dx=b.x-a.x, dy=b.y-a.y;
      const dist=Math.hypot(dx,dy);
      const vel = dist/dt; // px/ms
      const minW=1.25, maxW=2.8;
      const speedFactor = Math.max(0.25, 1 - Math.min(vel*2.0, 0.85));
      const pressureFactor = (('p' in a) && ('p' in b)) ? (0.6 + 0.4 * ((a.p + b.p)/2)) : 1.0;
      return Math.max(minW, Math.min(maxW, maxW * speedFactor * pressureFactor));
    }

    async function renderPDF(){
      try{
        const b64=window.PDF_BASE64||''; if(!b64) throw new Error('Missing PDF data.');
        const doc=await pdfjsLib.getDocument({data:b64ToUint8(b64)}).promise;
        const container=document.getElementById('pages'); container.innerHTML='';
        for(let i=1;i<=doc.numPages;i++){
          const page=await doc.getPage(i);
          const vp=page.getViewport({scale:1});
          const targetWidth=Math.min(900,Math.max(600,vp.width));
          const scale=targetWidth/vp.width;
          const viewport=page.getViewport({scale});
          const wrap=document.createElement('div'); wrap.className='pageWrap';
          const pageCanvas=document.createElement('canvas'); pageCanvas.className='page';
          pageCanvas.width=Math.floor(viewport.width); pageCanvas.height=Math.floor(viewport.height);
          wrap.appendChild(pageCanvas);
          const overlay=document.createElement('canvas'); overlay.className='overlay';
          overlay.width=pageCanvas.width; overlay.height=pageCanvas.height;
          overlay.style.width = pageCanvas.style.width = '100%';
          overlay.style.height = pageCanvas.style.height = 'auto';
          wrap.appendChild(overlay);
          container.appendChild(wrap);

          const ctx=pageCanvas.getContext('2d');
          await page.render({canvasContext:ctx,viewport}).promise;

          const octx=overlay.getContext('2d');
          octx.lineCap='round';
          octx.lineJoin='round';
          octx.strokeStyle='#000';
          octx.setLineDash([]);
          octx.miterLimit = 2;
          octx.imageSmoothingEnabled = true;

          const pState={pageCanvas,overlayCanvas:overlay,overlayCtx:octx,strokes:[]}; state.pages.push(pState);

          let drawing=false,last=null,points=[];

          function getPos(ev){
            const t=(ev.touches?ev.touches[0]:ev);
            const r=overlay.getBoundingClientRect();
            const x=(t.clientX-r.left)*(overlay.width/r.width);
            const y=(t.clientY-r.top)*(overlay.height/r.height);
            const p = (t.force && !isNaN(t.force)) ? t.force : (t.pressure && !isNaN(t.pressure) ? t.pressure : 0.5);
            return {x,y,p,ts:performance.now()};
          }

          function start(ev){
            if(!state.drawEnabled) return;
            ev.preventDefault();
            pushUndo(pState);
            drawing=true; points=[]; last=null;
            const pt=getPos(ev);
            points.push(pt); last=pt;
          }

          function move(ev){
            if(!state.drawEnabled||!drawing) return;
            ev.preventDefault();
            const pt=getPos(ev);
            const a = last || pt;
            const b = pt;

            const w = widthFor(a,b);
            const erase = (state.tool==='erase');

            octx.save();
            octx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
            octx.lineWidth = erase ? Math.max(10, w*10) : w;
            octx.beginPath();
            octx.moveTo(a.x, a.y);
            octx.lineTo(b.x, b.y);
            octx.stroke();
            octx.restore();

            last = pt;
            points.push(pt);
          }

          function end(){
            if(!drawing) return;
            drawing=false;

            if(points.length<2){
              const a=points[0];
              octx.save();
              octx.globalCompositeOperation = (state.tool==='erase')?'destination-out':'source-over';
              octx.beginPath();
              octx.arc(a.x,a.y,1.2,0,Math.PI*2);
              octx.fillStyle='#000';
              octx.fill();
              octx.restore();
            }

            points=[]; last=null;
          }

          overlay.addEventListener('touchstart',start,{passive:false});
          overlay.addEventListener('touchmove', move ,{passive:false});
          overlay.addEventListener('touchend',  end  ,{passive:false});
          overlay.addEventListener('mousedown',start);
          overlay.addEventListener('mousemove',move);
          window.addEventListener('mouseup',end);
        }
        applyPointerMode();
      }catch(e){window.ReactNativeWebView?.postMessage('ERROR:'+(e?.message||String(e))); }
    }

    async function saveAndUpload(){
      try{
        const b64=window.PDF_BASE64||''; if(!b64) throw new Error('Missing PDF data.');
        const pdfBytes=b64ToUint8(b64);
        const pdfDoc=await PDFLib.PDFDocument.load(pdfBytes);
        const pages=pdfDoc.getPages();
        for(let i=0;i<Math.min(pages.length,state.pages.length);i++){
          const p=pages[i], view=state.pages[i];
          const dataUrl=view.overlayCanvas.toDataURL('image/png');
          const pngBytes=await (await fetch(dataUrl)).arrayBuffer();
          const png=await pdfDoc.embedPng(pngBytes);
          const pageW=p.getWidth(), pageH=p.getHeight();
          const scaleX=pageW/view.overlayCanvas.width;
          const scaleY=pageH/view.overlayCanvas.height;
          p.drawImage(png,{x:0,y:0,width:view.overlayCanvas.width*scaleX,height:view.overlayCanvas.height*scaleY,opacity:1});
        }
        const outB64 = pdfDoc.saveAsBase64 ? await pdfDoc.saveAsBase64({dataUri:false}) : btoa(String.fromCharCode(...(await pdfDoc.save())));
        window.ReactNativeWebView?.postMessage('SIGNED:'+outB64);
      }catch(e){window.ReactNativeWebView?.postMessage('ERROR:'+(e?.message||String(e))); }
    }

    window.addEventListener('DOMContentLoaded',()=>{
      document.getElementById('pen').addEventListener('click',()=>setTool('pen'));
      document.getElementById('erase').addEventListener('click',()=>setTool('erase'));
      document.getElementById('save').addEventListener('click',saveAndUpload);
      document.getElementById('close').addEventListener('click',()=>window.ReactNativeWebView?.postMessage('CLOSE'));
      document.getElementById('undo').addEventListener('click',()=>{
        const winTop=window.scrollY; let target=state.pages[0];
        for(const p of state.pages){const top=p.overlayCanvas.getBoundingClientRect().top+window.scrollY; if(top<=winTop+100) target=p;}
        undo(target);
      });
      document.getElementById('clear').addEventListener('click',()=>{
        const winTop=window.scrollY; let target=state.pages[0];
        for(const p of state.pages){const top=p.overlayCanvas.getBoundingClientRect().top+window.scrollY; if(top<=winTop+100) target=p;}
        clearPage(target);
      });
      document.getElementById('drawToggle').addEventListener('change',e=>setDrawEnabled(e.target.checked));
      renderPDF();
    });
  </script>
</body>
</html>
`;

/**
 * SKETCH HTML (used for "Draw Note")
 */
const SKETCH_HTML = `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>Draw Note</title>
<style>
  html,body { margin:0; padding:0; background:#fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
  body { padding-top: calc(env(safe-area-inset-top, 0px) + 6px); }
  #toolbar { position: sticky; top: 0; z-index: 1000; background: #111827; color:#fff; display:flex; gap:8px; align-items:center; padding:8px 10px; flex-wrap: wrap; }
  #toolbar button { background:#374151; border:0; color:#fff; padding:8px 10px; border-radius:6px; font-weight:600; }
  #toolbar button.primary { background:#2563EB; }
  #toolbar label { display:flex; align-items:center; gap:6px; font-size:13px; background:#1f2937; padding:6px 10px; border-radius:6px; }
  #toolbar .sep { flex:1; }
  #pages { padding: 8px; }
  .pageWrap { position:relative; margin: 0 auto 16px; max-width: 900px; }
  canvas.page { width:100%; height:auto; display:block; background:#ffffff; }
  canvas.overlay { position:absolute; left:0; top:0; touch-action:none; }
  .hint { text-align:center; font-size:12px; color:#6b7280; margin:8px 0 12px; }
  .cursor { position: fixed; pointer-events:none; z-index: 2000; width: 22px; height: 22px; border-radius: 999px; border: 2px solid rgba(0,0,0,0.6); background: rgba(255,255,255,0.9); display:none; transform: translate(-50%, -50%); }
  .cursor.pen { width: 8px; height: 8px; background: #111827; border-color: #111827; }
</style>
</head>
<body>
  <div id="toolbar">
    <label><input type="checkbox" id="drawToggle" /> Draw Mode</label>
    <label><input type="checkbox" id="pencilOnly" /> Pencil Only</label>
    <button id="pen">Pen</button>
    <button id="erase">Erase</button>
    <button id="undo">Undo</button>
    <button id="clear">Clear</button>
    <div class="sep"></div>
    <div style="display:flex; gap:8px;">
      <button id="close">Close</button>
      <button id="save" class="primary">Save & Upload</button>
    </div>
  </div>
  <div id="pages"></div>
  <div class="hint">Turn OFF “Draw Mode” to scroll. Turn it ON to sketch. “Pencil Only” ignores finger.</div>
  <div id="cursor" class="cursor"></div>

  <script>
    const state = { tool: 'pen', drawEnabled: false, pencilOnly: false, page: null };

    function applyPointerMode(){
      const { overlayCanvas } = state.page || {};
      if (!overlayCanvas) return;
      overlayCanvas.style.pointerEvents = state.drawEnabled ? 'auto' : 'none';
      overlayCanvas.style.touchAction = state.drawEnabled ? 'none' : 'auto';
      const c = document.getElementById('cursor');
      if (!state.drawEnabled) { c.style.display = 'none'; return; }
      c.style.display = 'block'; c.className = state.tool === 'erase' ? 'cursor' : 'cursor pen';
    }
    function setTool(t){ state.tool=t; applyPointerMode(); }
    function setDrawEnabled(on){ state.drawEnabled=!!on; applyPointerMode(); }
    function setPencilOnly(on){ state.pencilOnly=!!on; }

    function pushUndo(){ try { const { overlayCtx, overlayCanvas } = state.page; const snap = overlayCtx.getImageData(0,0,overlayCanvas.width,overlayCanvas.height); state.page.strokes.push(snap); if(state.page.strokes.length>80) state.page.strokes.shift(); } catch(e){} }
    function undo(){ if(state.page?.strokes?.length){ state.page.overlayCtx.putImageData(state.page.strokes.pop(),0,0); } }
    function clearPage(){ pushUndo(); const { overlayCtx, overlayCanvas } = state.page; overlayCtx.clearRect(0,0,overlayCanvas.width,overlayCanvas.height); }

    function widthFor(a,b){
      const dt=Math.max(1,(b.ts-a.ts));
      const dx=b.x-a.x, dy=b.y-a.y;
      const dist=Math.hypot(dx,dy);
      const vel=dist/dt;
      const minW=1.25, maxW=2.8;
      const speedFactor = Math.max(0.25, 1 - Math.min(vel*2.0, 0.85));
      const pressureFactor = (('p' in a) && ('p' in b)) ? (0.6 + 0.4 * ((a.p + b.p)/2)) : 1.0;
      return Math.max(minW, Math.min(maxW, maxW * speedFactor * pressureFactor));
    }

    function setup(){
      const container=document.getElementById('pages');
      const wrap=document.createElement('div'); wrap.className='pageWrap';
      const targetWidth=Math.min(900,Math.max(600,window.innerWidth-24));
      const ratio=792/612;
      const pageW=Math.floor(targetWidth);
      const pageH=Math.floor(targetWidth*ratio);
      const pageCanvas=document.createElement('canvas'); pageCanvas.className='page';
      pageCanvas.width=pageW; pageCanvas.height=pageH; wrap.appendChild(pageCanvas);
      const overlay=document.createElement('canvas'); overlay.className='overlay';
      overlay.width=pageW; overlay.height=pageH; overlay.style.width=pageCanvas.style.width='100%'; overlay.style.height=pageCanvas.style.height='auto';
      wrap.appendChild(overlay);
      container.appendChild(wrap);

      const bctx=pageCanvas.getContext('2d'); bctx.fillStyle='#FFFFFF'; bctx.fillRect(0,0,pageW,pageH);

      const octx=overlay.getContext('2d');
      octx.lineCap='round';
      octx.lineJoin='round';
      octx.strokeStyle='#000';
      octx.setLineDash([]);
      octx.miterLimit = 2;
      octx.imageSmoothingEnabled = true;

      state.page={pageCanvas,overlayCanvas:overlay,overlayCtx:octx,strokes:[]}; applyPointerMode();

      let drawing=false,last=null,points=[];

      function getPos(ev){
        const t=(ev.touches?ev.touches[0]:ev);
        const r=overlay.getBoundingClientRect();
        const x=(t.clientX-r.left)*(overlay.width/r.width);
        const y=(t.clientY-r.top)*(overlay.height/r.height);
        const p = (t.force && !isNaN(t.force)) ? t.force : (t.pressure && !isNaN(t.pressure) ? t.pressure : 0.5);
        return {x,y,p,ts:performance.now()};
      }

      function start(ev){
        if(!state.drawEnabled) return;
        ev.preventDefault();
        pushUndo();
        drawing=true; points=[]; last=null;
        const pt=getPos(ev);
        if(state.pencilOnly && (ev.pointerType!=='pen')) return;
        points.push(pt); last=pt;
      }

      function move(ev){
        if(!state.drawEnabled||!drawing) return;
        ev.preventDefault();
        const pt=getPos(ev);
        const a=last || pt;
        const b=pt;

        const w = widthFor(a,b);
        const erase = (state.tool==='erase');

        octx.save();
        octx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
        octx.lineWidth = erase ? Math.max(10, w*10) : w;
        octx.beginPath();
        octx.moveTo(a.x, a.y);
        octx.lineTo(b.x, b.y);
        octx.stroke();
        octx.restore();

        last = pt;
        points.push(pt);
      }

      function end(){
        if(!drawing) return;
        drawing=false;

        if(points.length<2){
          const a=points[0];
          octx.save();
          octx.globalCompositeOperation = (state.tool==='erase')?'destination-out':'source-over';
          octx.beginPath();
          octx.arc(a.x,a.y,1.2,0,Math.PI*2);
          octx.fillStyle='#000';
          octx.fill();
          octx.restore();
        }

        points=[]; last=null;
      }

      overlay.addEventListener('touchstart',start,{passive:false});
      overlay.addEventListener('touchmove', move ,{passive:false});
      overlay.addEventListener('touchend',  end  ,{passive:false});
      overlay.addEventListener('mousedown',start);
      overlay.addEventListener('mousemove',move);
      window.addEventListener('mouseup',end);
    }

    function saveAsJPEG(){
      try{
        const { pageCanvas, overlayCanvas } = state.page;
        const merged=document.createElement('canvas'); merged.width=pageCanvas.width; merged.height=pageCanvas.height;
        const mctx=merged.getContext('2d'); mctx.drawImage(pageCanvas,0,0); mctx.drawImage(overlayCanvas,0,0);
        const dataUrl=merged.toDataURL('image/jpeg',0.92); const b64=dataUrl.split(',')[1];
        window.ReactNativeWebView?.postMessage('IMAGE:'+b64);
      }catch(e){window.ReactNativeWebView?.postMessage('ERROR:'+(e?.message||String(e)));}
    }

    window.addEventListener('DOMContentLoaded',()=>{
      document.getElementById('pen').addEventListener('click',()=>setTool('pen'));
      document.getElementById('erase').addEventListener('click',()=>setTool('erase'));
      document.getElementById('save').addEventListener('click',saveAsJPEG);
      document.getElementById('close').addEventListener('click',()=>window.ReactNativeWebView?.postMessage('CLOSE'));
      document.getElementById('undo').addEventListener('click',undo);
      document.getElementById('clear').addEventListener('click',clearPage);
      document.getElementById('drawToggle').addEventListener('change',e=>setDrawEnabled(e.target.checked));
      document.getElementById('pencilOnly').addEventListener('change',e=>setPencilOnly(e.target.checked));
      setup();
    });
  </script>
</body>
</html>
`;

export default function ViewWorkOrder() {
  const params = useLocalSearchParams();
  const workOrderId = params?.id ? (Array.isArray(params.id) ? params.id[0] : params.id) : null;
  const router = useRouter();

  const [workOrder, setWorkOrder] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [notes, setNotes] = useState([]);

  const [showAddNoteModal, setShowAddNoteModal] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');

  // Attachments flow
  const [viewAttachmentsVisible, setViewAttachmentsVisible] = useState(false);
  const [photoViewerVisible, setPhotoViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [cameFromAttachments, setCameFromAttachments] = useState(false); // NEW

  // Draw Notes (web sketch -> JPEG)
  const [sketchVisible, setSketchVisible] = useState(false);

  // Annotate & Sign existing WO PDF
  const [annotateVisible, setAnnotateVisible] = useState(false);
  const [pdfBase64, setPdfBase64] = useState(null);
  const annotatorRef = useRef(null);

  // Inline viewer (read-only preview) — Work Order PDF
  const [pdfInlineB64, setPdfInlineB64] = useState(null);
  const [pdfPreviewError, setPdfPreviewError] = useState(null);
  const [pdfInlineHeight, setPdfInlineHeight] = useState(Math.max(600, screenHeight * 0.8));

  // Inline viewer (read-only preview) — PO Order PDF
  const [poPdfInlineB64, setPoPdfInlineB64] = useState(null);
  const [poPdfPreviewError, setPoPdfPreviewError] = useState(null);
  const [poPdfInlineHeight, setPoPdfInlineHeight] = useState(Math.max(600, screenHeight * 0.8));

  // Status modal
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [pendingStatus, setPendingStatus] = useState('');

  // Multi-photo Camera modal
  const [cameraVisible, setCameraVisible] = useState(false);
  const [cameraType, setCameraType] = useState(CameraType.back);
  const [cameraPermission, requestCameraPermission] = Camera.useCameraPermissions();
  const cameraRef = useRef(null);
  const [captures, setCaptures] = useState([]); // array of { uri }
  const [isUploading, setIsUploading] = useState(false);

  // -------- helpers for contact actions & address --------
  const normPhone = (p) => String(p || '').replace(/[^\d+]/g, '');
  const callNumber = (p) => {
    const n = normPhone(p);
    if (!n) return;
    Linking.openURL(`tel:${n}`).catch(() => Alert.alert('Error', 'Unable to open Phone app.'));
  };
  const emailTo = (e) => {
    const addr = String(e || '').trim();
    if (!addr) return;
    Linking.openURL(`mailto:${addr}`).catch(() => Alert.alert('Error', 'Unable to open Mail app.'));
  };

  const openMap = (loc) => {
    const q = encodeURIComponent(loc || '');
    if (!q) return;
    const googleAppUrl = Platform.select({
      ios: `comgooglemaps://?q=${q}`,
      android: `geo:0,0?q=${q}`,
      default: `https://www.google.com/maps/search/?api=1&query=${q}`,
    });
    const googleWebUrl = `https://www.google.com/maps/search/?api=1&query=${q}`;
    Linking.canOpenURL(googleAppUrl)
      .then(supported => (supported ? Linking.openURL(googleAppUrl) : Linking.openURL(googleWebUrl)))
      .catch(() => Alert.alert('Error', 'Unable to open Google Maps.'));
  };
  // -------------------------------------------------------

  const sortNotesDesc = (arr = []) =>
    [...arr].sort((a, b) => {
      const ta = new Date(a?.createdAt || 0).getTime();
      const tb = new Date(b?.createdAt || 0).getTime();
      return tb - ta;
    });

  const fetchWorkOrder = useCallback(async () => {
    if (!workOrderId) return;
    try {
      const { data } = await api.get(`/work-orders/${workOrderId}`);
      setWorkOrder(data);

      const parsedNotes = Array.isArray(data.notes)
        ? data.notes
        : data.notes
        ? (() => { try { return JSON.parse(data.notes); } catch { return []; } })()
        : [];
      setNotes(sortNotesDesc(parsedNotes));

      const photoKeys = (data.photoPath || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      setPhotos(photoKeys.map(k => fileUrl(k)));

      // Reset previews
      setPdfInlineB64(null);
      setPdfPreviewError(null);
      setPoPdfInlineB64(null);
      setPoPdfPreviewError(null);

      // Work Order PDF
      if (data.pdfPath) {
        try {
          const url = fileUrl(data.pdfPath);
          const target = FileSystem.cacheDirectory + `wo_preview_${workOrderId}.pdf`;
          await FileSystem.downloadAsync(url, target);
          const b64 = await FileSystem.readAsStringAsync(target, { encoding: FileSystem.EncodingType.Base64 });
          setPdfInlineB64(b64);
        } catch (e) {
          setPdfPreviewError(e?.message || 'Failed to load PDF.');
        }
      }

      // PO Order PDF (optional)
      if (data.poPdfPath) {
        try {
          const url = fileUrl(data.poPdfPath);
          const target = FileSystem.cacheDirectory + `po_preview_${workOrderId}.pdf`;
          await FileSystem.downloadAsync(url, target);
          const b64 = await FileSystem.readAsStringAsync(target, { encoding: FileSystem.EncodingType.Base64 });
          setPoPdfInlineB64(b64);
        } catch (e) {
          setPoPdfPreviewError(e?.message || 'Failed to load PO PDF.');
        }
      }
    } catch {
      Alert.alert('Error', 'Failed to load work order.');
    }
  }, [workOrderId]);

  useEffect(() => {
    fetchWorkOrder();
  }, [fetchWorkOrder]);

  const addNote = async () => {
    if (!newNoteText.trim()) return;
    try {
      const { data } = await api.post(`/work-orders/${workOrderId}/notes`, { text: newNoteText.trim() });
      setNewNoteText('');
      setShowAddNoteModal(false);
      setNotes(sortNotesDesc(data.notes || []));
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.error || err.message);
    }
  };

  // keep uploads smaller
  const processImageForUpload = async (uri) => {
    try {
      const manip = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1600 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );
      return manip.uri;
    } catch {
      return uri;
    }
  };

  // NEW: open multi-photo camera modal
  const openCameraModal = async () => {
    try {
      const cam = await Camera.requestCameraPermissionsAsync();
      if (cam.status !== 'granted') {
        Alert.alert('Permission required', 'Need camera access.');
        return;
      }
      // (Optional) ask for media library permission if you also want to save locally
      setCaptures([]);
      setCameraType(CameraType.back);
      setCameraVisible(true);
    } catch (e) {
      Alert.alert('Error', 'Unable to open camera.');
    }
  };

  const capturePhoto = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1,
        skipProcessing: true,
        exif: false,
      });
      if (photo?.uri) setCaptures((arr) => [...arr, { uri: photo.uri }]);
    } catch (e) {
      Alert.alert('Error', 'Failed to capture photo.');
    }
  };

  const clearCaptures = () => setCaptures([]);

  const uploadAllCaptures = async () => {
    if (!captures.length) {
      Alert.alert('No photos', 'Take a photo first.');
      return;
    }
    try {
      setIsUploading(true);
      const form = new FormData();
      for (let i = 0; i < captures.length; i++) {
        const processedUri = await processImageForUpload(captures[i].uri);
        form.append('photoFile', {
          uri: processedUri,
          name: `photo-${Date.now()}-${i}.jpg`,
          type: 'image/jpeg',
        });
      }
      await api.put(`/work-orders/${workOrderId}/edit`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setCameraVisible(false);
      setCaptures([]);
      fetchWorkOrder();
      Alert.alert('Uploaded', 'Photos uploaded!');
    } catch (err) {
      Alert.alert('Upload Error', err?.response?.data?.error || err.message);
    } finally {
      setIsUploading(false);
    }
  };

  // Keep “Upload Photo(s)” from library with multi-select
  const uploadPhotos = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return Alert.alert('Permission required', 'Need photo library access.');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (result.canceled) return;

    const form = new FormData();
    for (let i = 0; i < result.assets.length; i++) {
      const processedUri = await processImageForUpload(result.assets[i].uri);
      const name = `photo-${Date.now()}-${i}.jpg`;
      form.append('photoFile', { uri: processedUri, name, type: 'image/jpeg' });
    }

    try {
      await api.put(`/work-orders/${workOrderId}/edit`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      fetchWorkOrder();
      Alert.alert('Success', 'Photos uploaded!');
    } catch (err) {
      Alert.alert('Upload Error', err?.response?.data?.error || err.message);
    }
  };

  const handleDeletePhoto = (idx) => {
    const keys = (workOrder?.photoPath || '').split(',').map(s => s.trim()).filter(Boolean);
    if (idx < 0 || idx >= keys.length) return;

    Alert.alert('Delete Photo?', 'This will permanently remove it.', [
      { text: 'Cancel, keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/work-orders/${workOrderId}/attachment`, { data: { photoPath: keys[idx] } });
            fetchWorkOrder();
            Alert.alert('Deleted');
          } catch (err) {
            Alert.alert('Error', err?.response?.data?.error || err.message);
          }
        },
      },
    ]);
  };

  const handleShare = async () => {
    if (!photos.length) return;
    const url = photos[viewerIndex];
    try { await Share.share({ url, message: url }); } catch {}
  };

  const pdfURL = workOrder?.pdfPath ? fileUrl(workOrder.pdfPath) : null;

  const openAnnotator = async () => {
    if (!pdfURL) return Alert.alert('No PDF', 'This work order does not have a PDF attached.');
    try {
      setAnnotateVisible(true);
      const tmp = FileSystem.cacheDirectory + `wo_${workOrderId}.pdf`;
      await FileSystem.downloadAsync(pdfURL, tmp);
      const b64 = await FileSystem.readAsStringAsync(tmp, { encoding: FileSystem.EncodingType.Base64 });
      setPdfBase64(b64);
    } catch {
      setAnnotateVisible(false);
      Alert.alert('Error', 'Failed to load PDF for annotation.');
    }
  };

  // Use upgraded web sketch for “Draw Note” (exports JPEG)
  const openSketch = () => setSketchVisible(true);

  // WebView message handlers
  const onAnnotatorMessage = async (ev) => {
    const msg = ev?.nativeEvent?.data || '';
    if (msg.startsWith('ERROR:')) {
      Alert.alert('Annotator Error', msg.slice(6));
      return;
    }
    if (msg === 'CLOSE') {
      setAnnotateVisible(false);
      return;
    }
    if (msg.startsWith('SIGNED:')) {
      const b64 = msg.slice(7);
      try {
        const signedUri = FileSystem.cacheDirectory + `signed_${Date.now()}.pdf`;
        await FileSystem.writeAsStringAsync(signedUri, b64, { encoding: FileSystem.EncodingType.Base64 });

        const form = new FormData();
        const name = `WO-${workOrder?.poNumber || workOrderId}-signed.pdf`;
        form.append('pdfFile', { uri: signedUri, name, type: 'application/pdf' });

        await api.put(`/work-orders/${workOrderId}/edit`, form, { headers: { 'Content-Type': 'multipart/form-data' } });

        setAnnotateVisible(false);
        fetchWorkOrder();
        Alert.alert('Success', 'Signed PDF uploaded.');
      } catch (e) {
        Alert.alert('Upload Error', e?.message || 'Failed to upload signed PDF.');
      }
    }
  };

  const onSketchMessage = async (ev) => {
    const msg = ev?.nativeEvent?.data || '';
    if (msg.startsWith('ERROR:')) {
      Alert.alert('Draw Notes Error', msg.slice(6));
      return;
    }
    if (msg === 'CLOSE') {
      setSketchVisible(false);
      return;
    }
    if (msg.startsWith('IMAGE:')) {
      const b64 = msg.slice(6);
      try {
        const jpgPath = FileSystem.cacheDirectory + `drawing_${Date.now()}.jpg`;
        await FileSystem.writeAsStringAsync(jpgPath, b64, { encoding: FileSystem.EncodingType.Base64 });

        const processed = await processImageForUpload(jpgPath);

        const form = new FormData();
        form.append('photoFile', {
          uri: processed,
          name: `drawing-note-${Date.now()}.jpg`,
          type: 'image/jpeg',
        });

        await api.put(`/work-orders/${workOrderId}/edit`, form, { headers: { 'Content-Type': 'multipart/form-data' } });

        setSketchVisible(false);
        fetchWorkOrder();
        Alert.alert('Uploaded', 'Drawing note uploaded as photo.');
      } catch (e) {
        Alert.alert('Upload Error', e?.message || 'Failed to upload drawing note.');
      }
    }
  };

  // ------- derived fields for display (with fallbacks) -------
  const siteName =
    workOrder?.siteLocation ||
    workOrder?.siteName ||
    workOrder?.siteLocationName ||
    '';

  // Prefer site address for navigation; if it's missing, fall back to site location string.
  const siteAddress =
    workOrder?.siteAddress ||
    workOrder?.serviceAddress ||
    workOrder?.address ||
    workOrder?.siteLocation ||
    '';

  const poNumber = workOrder?.poNumber || '—';
  const workOrderNumber = workOrder?.workOrderNumber || '—';

  const customer = workOrder?.customer || workOrder?.customerName || '—';
  const problem = workOrder?.problemDescription || workOrder?.problem || '—';
  const status = workOrder?.status || '—';
  const scheduled = workOrder?.scheduledDate
    ? moment(workOrder.scheduledDate).format('YYYY-MM-DD HH:mm')
    : 'Not Scheduled';

  const customerPhone =
    workOrder?.customerPhone ||
    workOrder?.phone ||
    workOrder?.customerPhoneNumber ||
    '';

  const customerEmail =
    workOrder?.customerEmail ||
    workOrder?.email ||
    '';

  const billingAddress =
    workOrder?.billingAddress ||
    [workOrder?.billingAddress1, workOrder?.billingAddress2, workOrder?.billingCity, workOrder?.billingState, workOrder?.billingZip]
      .filter(Boolean)
      .join(', ') ||
    '';

  // ----- status update -----
  const openStatusModal = () => {
    setPendingStatus(workOrder?.status || STATUS_OPTIONS[0]);
    setShowStatusModal(true);
  };

  const applyStatus = async () => {
    try {
      const form = new FormData();
      form.append('status', pendingStatus || STATUS_OPTIONS[0]);
      await api.put(`/work-orders/${workOrderId}/edit`, form);
      setShowStatusModal(false);
      fetchWorkOrder();
    } catch (e) {
      Alert.alert('Error', e?.response?.data?.error || e?.message || 'Failed to update status.');
    }
  };
  // -------------------------

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.details} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Work Order Details</Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Work Order #:</Text>
            <Text style={styles.value}>{workOrderNumber}</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>PO #:</Text>
            <Text style={styles.value}>{poNumber}</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Customer:</Text>
            <Text style={styles.value}>{customer}</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Customer Phone:</Text>
            {customerPhone ? (
              <TouchableOpacity onPress={() => callNumber(customerPhone)}>
                <Text style={[styles.value, styles.linkText]}>{customerPhone}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.value}>—</Text>
            )}
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Customer Email:</Text>
            {customerEmail ? (
              <TouchableOpacity onPress={() => emailTo(customerEmail)}>
                <Text style={[styles.value, styles.linkText]}>{customerEmail}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.value}>—</Text>
            )}
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Site Location:</Text>
            <Text style={styles.value}>{siteName || '—'}</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Site Address:</Text>
            {siteAddress ? (
              <TouchableOpacity onPress={() => openMap(siteAddress)}>
                <Text style={[styles.value, styles.linkText]}>{siteAddress}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.value}>—</Text>
            )}
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Billing Address:</Text>
            {/* Display-only to prevent wrong navigation target */}
            <Text style={styles.value}>{billingAddress || '—'}</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Problem Description:</Text>
            <Text style={styles.value}>{problem}</Text>
          </View>

          <View style={[styles.row, { alignItems: 'center' }]}>
            <Text style={styles.label}>Status:</Text>
            <Text style={[styles.value, { flex: 0 }]}>{status}</Text>
            <TouchableOpacity style={styles.smallBtn} onPress={openStatusModal}>
              <Text style={styles.smallBtnText}>Change</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Scheduled Date:</Text>
            <Text style={styles.value}>{scheduled}</Text>
          </View>
        </View>

        <TouchableOpacity style={[styles.buttonBase, styles.backBtn]} onPress={() => router.back()}>
          <Text style={styles.backText}>Back to List</Text>
        </TouchableOpacity>

        {/* Annotate & Sign */}
        <TouchableOpacity style={[styles.buttonBase, styles.attachBtn]} onPress={openAnnotator}>
          <Text style={styles.attachText}>Annotate & Sign PDF</Text>
        </TouchableOpacity>

        {/* Multi-photo camera */}
        <TouchableOpacity style={[styles.buttonBase, styles.photoBtn]} onPress={openCameraModal}>
          <Text style={styles.photoText}>Take Photo(s)</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.buttonBase, styles photoBtn]} onPress={uploadPhotos}>
          <Text style={styles.photoText}>Upload Photo(s)</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.buttonBase, styles.attachBtn]} onPress={() => setViewAttachmentsVisible(true)}>
          <Text style={styles.attachText}>View Attachments</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.buttonBase, styles.noteBtn]} onPress={() => setShowAddNoteModal(true)}>
          <Text style={styles.noteText}>Add Note</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.buttonBase, styles.drawBtn]} onPress={() => setSketchVisible(true)}>
          <Text style={styles.drawText}>Draw Note</Text>
        </TouchableOpacity>

        {notes.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>Notes</Text>
            {notes.map((n, i) => (
              <View key={i} style={styles.noteCard}>
                <Text style={styles.noteTimestamp}>
                  {n?.createdAt ? moment(n.createdAt).format('YYYY-MM-DD HH:mm') : ''}
                  {n?.by ? `  •  ${n.by}` : ''}
                </Text>
                <Text style={styles.noteBody}>{n?.text || ''}</Text>
              </View>
            ))}
          </>
        )}

        {/* Work Order PDF viewer */}
        {workOrder?.pdfPath && (
          <View style={styles.card}>
            <Text style={styles.sectionHeader}>Work Order PDF</Text>

            {!pdfInlineB64 && !pdfPreviewError && (
              <View style={[styles.pdfInline, { height: pdfInlineHeight, alignItems:'center', justifyContent:'center' }]}>
                <Text style={{ color:'#2B2D42' }}>Loading preview…</Text>
              </View>
            )}

            {!!pdfPreviewError && (
              <View style={[styles.pdfInline, { padding: 12 }]}>
                <Text style={{ marginBottom: 8, color: '#b00020' }}>
                  Couldn’t load inline preview: {pdfPreviewError}
                </Text>
                <TouchableOpacity
                  onPress={() => Linking.openURL(fileUrl(workOrder.pdfPath))}
                  style={{ backgroundColor:'#343a40', padding:10, borderRadius:6, alignSelf:'flex-start' }}
                >
                  <Text style={{ color:'#fff', fontWeight:'600' }}>Open PDF</Text>
                </TouchableOpacity>
              </View>
            )}

            {!!pdfInlineB64 && (
              <View style={[styles.pdfInline, { height: pdfInlineHeight }]}>
                <WebView
                  originWhitelist={['*']}
                  source={{ html: PDF_VIEWER_HTML }}
                  javaScriptEnabled
                  domStorageEnabled={false}
                  onMessage={(e) => {
                    const msg = e?.nativeEvent?.data || '';
                    if (msg.startsWith('ERROR:')) {
                      setPdfPreviewError(msg.slice(6));
                      return;
                    }
                    if (msg.startsWith('HEIGHT:')) {
                      const h = parseInt(msg.slice(7), 10);
                      if (Number.isFinite(h)) {
                        const minH = Math.max(600, screenHeight * 0.8);
                        const maxH = Math.max(minH, screenHeight * 2.5);
                        setPdfInlineHeight(Math.max(minH, Math.min(h, maxH)));
                      }
                    }
                  }}
                  injectedJavaScriptBeforeContentLoaded={
                    `window.PDF_BASE64 = ${JSON.stringify(pdfInlineB64)}; true;`
                  }
                  style={{ flex: 1 }}
                />
              </View>
            )}
          </View>
        )}

        {/* PO Order PDF viewer (optional) */}
        {workOrder?.poPdfPath && (
          <View style={styles.card}>
            <Text style={styles.sectionHeader}>PO Order PDF</Text>

            {!poPdfInlineB64 && !poPdfPreviewError && (
              <View style={[styles.pdfInline, { height: poPdfInlineHeight, alignItems:'center', justifyContent:'center' }]}>
                <Text style={{ color:'#2B2D42' }}>Loading PO preview…</Text>
              </View>
            )}

            {!!poPdfPreviewError && (
              <View style={[styles.pdfInline, { padding: 12 }]}>
                <Text style={{ marginBottom: 8, color: '#b00020' }}>
                  Couldn’t load PO PDF preview: {poPdfPreviewError}
                </Text>
                <TouchableOpacity
                  onPress={() => Linking.openURL(fileUrl(workOrder.poPdfPath))}
                  style={{ backgroundColor:'#343a40', padding:10, borderRadius:6, alignSelf:'flex-start' }}
                >
                  <Text style={{ color:'#fff', fontWeight:'600' }}>Open PO PDF</Text>
                </TouchableOpacity>
              </View>
            )}

            {!!poPdfInlineB64 && (
              <View style={[styles.pdfInline, { height: poPdfInlineHeight }]}>
                <WebView
                  originWhitelist={['*']}
                  source={{ html: PDF_VIEWER_HTML }}
                  javaScriptEnabled
                  domStorageEnabled={false}
                  onMessage={(e) => {
                    const msg = e?.nativeEvent?.data || '';
                    if (msg.startsWith('ERROR:')) {
                      setPoPdfPreviewError(msg.slice(6));
                      return;
                    }
                    if (msg.startsWith('HEIGHT:')) {
                      const h = parseInt(msg.slice(7), 10);
                      if (Number.isFinite(h)) {
                        const minH = Math.max(600, screenHeight * 0.8);
                        const maxH = Math.max(minH, screenHeight * 2.5);
                        setPoPdfInlineHeight(Math.max(minH, Math.min(h, maxH)));
                      }
                    }
                  }}
                  injectedJavaScriptBeforeContentLoaded={
                    `window.PDF_BASE64 = ${JSON.stringify(poPdfInlineB64)}; true;`
                  }
                  style={{ flex: 1 }}
                />
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Photo Viewer */}
      <Modal
        visible={photoViewerVisible}
        animationType="fade"
        onRequestClose={() => {
          setPhotoViewerVisible(false);
          if (cameFromAttachments) {
            // Re-open attachments modal when viewer was launched from it
            setViewAttachmentsVisible(true);
            setCameFromAttachments(false);
          }
        }}
      >
        <View style={styles.viewerContainer}>
          <FlatList
            data={photos}
            keyExtractor={(_, i) => i.toString()}
            horizontal
            pagingEnabled
            initialScrollIndex={viewerIndex}
            getItemLayout={(_, idx) => ({ length: screenWidth, offset: screenWidth * idx, index: idx })}
            onMomentumScrollEnd={ev => setViewerIndex(Math.round(ev.nativeEvent.contentOffset.x / screenWidth))}
            renderItem={({ item }) => <Image source={{ uri: item }} style={styles.fullScreenImage} />}
          />
          <View style={styles.viewerButtons}>
            <TouchableOpacity style={[styles.viewerButton, styles.shareBtn]} onPress={handleShare}>
              <Text style={styles.shareText}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.viewerButton, styles.exitBtn]}
              onPress={() => {
                setPhotoViewerVisible(false);
                if (cameFromAttachments) {
                  setViewAttachmentsVisible(true);
                  setCameFromAttachments(false);
                }
              }}
            >
              <Text style={styles.exitText}>Exit</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Attachments Gallery */}
      <Modal
        visible={viewAttachmentsVisible}
        animationType="fade"
        transparent
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => setViewAttachmentsVisible(false)}
      >
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>Attachments</Text>
          {photos.length === 0 ? (
            <Text style={styles.noPhotosText}>No photos uploaded.</Text>
          ) : (
            <FlatList
              data={photos}
              keyExtractor={(_, i) => i.toString()}
              numColumns={3}
              contentContainerStyle={styles.galleryList}
              renderItem={({ item, index }) => (
                <View style={styles.thumbWrapper}>
                  <TouchableOpacity
                    onPress={() => {
                      setViewAttachmentsVisible(false);
                      setViewerIndex(index);
                      setCameFromAttachments(true); // mark origin
                      setPhotoViewerVisible(true);
                    }}
                  >
                    <Image source={{ uri: item }} style={styles.thumbnail} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.deleteIcon} onPress={() => handleDeletePhoto(index)} hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}>
                    <Text style={styles.deleteText}>×</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          )}
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setViewAttachmentsVisible(false)}>
            <Text style={styles.cancelText}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Add Note Modal — keyboard-safe */}
      <Modal
        visible={showAddNoteModal}
        animationType="fade"
        transparent
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => setShowAddNoteModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.select({ ios: 80, android: 0 })}
          style={styles.addNoteOverlay}
        >
          <View style={styles.addNoteContainer}>
            <Text style={styles.addNoteTitle}>New Note</Text>
            <TextInput
              style={styles.addNoteInput}
              multiline
              placeholder="Enter your note…"
              value={newNoteText}
              onChangeText={setNewNoteText}
              autoFocus
              returnKeyType="done"
            />
            <View style={styles.addNoteButtons}>
              <TouchableOpacity style={styles.saveNoteBtn} onPress={addNote}>
                <Text style={styles.saveNoteText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelNoteBtn}
                onPress={() => setShowAddNoteModal(false)}
              >
                <Text style={styles.cancelNoteText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Change Status Modal */}
      <Modal
        visible={showStatusModal}
        animationType="fade"
        transparent
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => setShowStatusModal(false)}
      >
        <View style={styles.addNoteOverlay}>
          <View style={styles.addNoteContainer}>
            <Text style={styles.addNoteTitle}>Change Status</Text>
            <View style={styles.statusList}>
              {STATUS_OPTIONS.map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.statusOption, pendingStatus === s && styles.statusOptionActive]}
                  onPress={() => setPendingStatus(s)}
                >
                  <Text style={[styles.statusText, pendingStatus === s && styles.statusTextActive]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.addNoteButtons}>
              <TouchableOpacity style={styles.saveNoteBtn} onPress={applyStatus}>
                <Text style={styles.saveNoteText}>Apply</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelNoteBtn}
                onPress={() => setShowStatusModal(false)}
              >
                <Text style={styles.cancelNoteText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Draw Note Modal (JPEG export) */}
      <Modal visible={sketchVisible} animationType="slide" onRequestClose={() => setSketchVisible(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          <WebView
            originWhitelist={['*']}
            source={{ html: SKETCH_HTML }}
            javaScriptEnabled
            domStorageEnabled
            onMessage={onSketchMessage}
            style={{ flex: 1 }}
          />
        </SafeAreaView>
      </Modal>

      {/* Annotate & Sign Modal */}
      <Modal visible={annotateVisible} animationType="slide" onRequestClose={() => setAnnotateVisible(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          {pdfBase64 ? (
            <WebView
              ref={annotatorRef}
              originWhitelist={['*']}
              source={{ html: ANNOTATOR_HTML }}
              javaScriptEnabled
              domStorageEnabled
              onMessage={onAnnotatorMessage}
              injectedJavaScriptBeforeContentLoaded={
                `window.PDF_BASE64 = ${JSON.stringify(pdfBase64)}; true;`
              }
              style={{ flex: 1 }}
            />
          ) : (
            <View style={styles.center}>
              <Text style={styles.loadingText}>Loading PDF…</Text>
            </View>
          )}
        </SafeAreaView>
      </Modal>

      {/* Multi-Photo Camera Modal */}
      <Modal
        visible={cameraVisible}
        animationType="slide"
        onRequestClose={() => setCameraVisible(false)}
      >
        <SafeAreaView style={styles.camSafeArea}>
          <View style={styles.cameraWrap}>
            {cameraPermission?.granted ? (
              <Camera ref={cameraRef} style={styles.camera} type={cameraType} ratio="16:9" />
            ) : (
              <View style={[styles.camera, styles.center]}>
                <Text style={{ color: '#fff' }}>Waiting for camera permission…</Text>
              </View>
            )}
            <View style={styles.camControls}>
              <TouchableOpacity
                style={[styles.camBtn, styles.camSmall]}
                onPress={() => setCameraType(prev => (prev === CameraType.back ? CameraType.front : CameraType.back))}
              >
                <Text style={styles.camBtnText}>Flip</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.camBtn, styles.camShutter]} onPress={capturePhoto}>
                <Text style={styles.camShutterText}>●</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.camBtn, styles.camSmall]} onPress={clearCaptures}>
                <Text style={styles.camBtnText}>Clear</Text>
              </TouchableOpacity>
            </View>
          </View>

          {captures.length > 0 && (
            <FlatList
              data={captures}
              keyExtractor={(_, i) => i.toString()}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.thumbBar}
              renderItem={({ item }) => (
                <Image source={{ uri: item.uri }} style={styles.camThumb} />
              )}
            />
          )}

          <View style={styles.camFooter}>
            <TouchableOpacity
              disabled={isUploading}
              style={[styles.footerBtn, styles.footerCancel]}
              onPress={() => { setCameraVisible(false); setCaptures([]); }}
            >
              <Text style={styles.footerBtnText}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={!captures.length || isUploading}
              style={[styles.footerBtn, !captures.length ? styles.footerDisabled : styles.footerUpload]}
              onPress={uploadAllCaptures}
            >
              <Text style={styles.footerBtnText}>{isUploading ? 'Uploading…' : 'Upload All'}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F1F5F9' },
  details: { padding: 16, paddingBottom: 0 },
  center: { justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: 18, color: '#3D5A80' },
  title: { fontSize: 24, fontWeight: '700', color: '#2B2D42', textAlign: 'center', marginBottom: 12 },
  card: { backgroundColor: '#FFF', borderRadius: 8, padding: 16, marginBottom: 16, elevation: 3 },
  row: { flexDirection: 'row', marginBottom: 8, flexWrap: 'wrap' },
  label: { width: 140, fontWeight: '600', color: '#3D5A80' },
  value: { flex: 1, color: '#2B2D42' },
  linkText: { color: '#007bff', textDecorationLine: 'underline' },
  pdfInline: { width: '100%', backgroundColor: '#E2E8F0', borderRadius: 6, overflow: 'hidden', marginTop: 8 },

  buttonBase: { width: '100%', paddingVertical: 12, borderRadius: 6, alignItems: 'center', marginBottom: 12 },
  backBtn: { backgroundColor: '#6c757d' },
  backText: { color: '#FFF', fontWeight: '600', fontSize: 16 },
  photoBtn: { backgroundColor: '#17a2b8' },
  photoText: { color: '#FFF', fontWeight: '600', fontSize: 16 },
  attachBtn: { backgroundColor: '#343a40' },
  attachText: { color: '#FFF', fontWeight: '600', fontSize: 16 },
  noteBtn: { backgroundColor: '#ffc107' },
  noteText: { color: '#000', fontWeight: '600', fontSize: 16 },
  drawBtn: { backgroundColor: '#28a745' },
  drawText: { color: '#FFF', fontWeight: '600', fontSize: 16 },

  smallBtn: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#0ea5e9',
    borderRadius: 6,
  },
  smallBtnText: { color: '#fff', fontWeight: '700' },

  sectionHeader: { fontSize: 18, fontWeight: '600', marginVertical: 8, color: '#2B2D42' },
  noteCard: { backgroundColor: '#FFF', borderRadius: 6, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  noteTimestamp: { fontSize: 12, color: '#8D99AE', marginBottom: 4 },
  noteBody: { fontSize: 14, color: '#2B2D42' },

  viewerContainer: { flex: 1, backgroundColor: '#000' },
  fullScreenImage: { width: screenWidth, height: screenHeight, resizeMode: 'contain' },
  viewerButtons: { position: 'absolute', bottom: 40, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-around' },
  viewerButton: { flex: 1, marginHorizontal: 8, padding: 12, borderRadius: 6, alignItems: 'center' },
  shareBtn: { backgroundColor: 'rgba(255,255,255,0.3)' },
  shareText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  exitBtn: { backgroundColor: 'rgba(220,53,69,0.8)' },
  exitText: { color: '#fff', fontWeight: '600', fontSize: 16 },

  modal: { flex: 1, padding: 16, backgroundColor: '#fff', marginTop: 80, borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12, textAlign: 'center', color: '#2B2D42' },
  noPhotosText: { textAlign: 'center', marginTop: 20, fontStyle: 'italic' },
  galleryList: { paddingBottom: 16 },
  thumbWrapper: { flex: 1 / 3, aspectRatio: 1, padding: 4 },
  thumbnail: { width: '100%', height: '100%', borderRadius: 4 },
  deleteIcon: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.6)', width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: '#fff', fontSize: 14, lineHeight: 18 },
  cancelBtn: { backgroundColor: '#dc3545', padding: 12, borderRadius: 6, alignItems: 'center', marginTop: 16 },
  cancelText: { color: '#fff', fontWeight: '600', fontSize: 16 },

  // Overlay for modals that need transparency (iOS fix uses overFullScreen)
  addNoteOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 16 },
  addNoteContainer: { backgroundColor: '#fff', borderRadius: 10, padding: 16 },
  addNoteTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12, textAlign: 'center', color: '#2B2D42' },
  addNoteInput: { height: 120, borderColor: '#cfd5dd', borderWidth: 1, borderRadius: 8, padding: 10, textAlignVertical: 'top', marginBottom: 12 },
  addNoteButtons: { flexDirection: 'row', justifyContent: 'space-around' },
  saveNoteBtn: { backgroundColor: '#28a745', padding: 10, borderRadius: 6, flex: 1, marginHorizontal: 4 },
  saveNoteText: { color: '#fff', textAlign: 'center', fontWeight: '600' },
  cancelNoteBtn: { backgroundColor: '#dc3545', padding: 10, borderRadius: 6, flex: 1, marginHorizontal: 4 },
  cancelNoteText: { color: '#fff', textAlign: 'center', fontWeight: '600' },

  statusList: { gap: 8 },
  statusOption: { padding: 12, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, backgroundColor: '#fff' },
  statusOptionActive: { backgroundColor: '#0ea5e9' },
  statusText: { color: '#2B2D42', fontWeight: '600' },
  statusTextActive: { color: '#fff' },

  // Camera modal
  camSafeArea: { flex: 1, backgroundColor: '#000' },
  cameraWrap: { flex: 1 },
  camera: { flex: 1 },
  camControls: {
    position: 'absolute',
    bottom: 24,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  camBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.5)' },
  camSmall: {},
  camBtnText: { color: '#fff', fontWeight: '700' },
  camShutter: { width: 74, height: 74, borderRadius: 37, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  camShutterText: { color: '#fff', fontSize: 36, marginTop: -6 },
  thumbBar: { paddingVertical: 8, paddingHorizontal: 10, backgroundColor: '#111827' },
  camThumb: { width: 72, height: 72, borderRadius: 6, marginRight: 8 },

  camFooter: { padding: 12, flexDirection: 'row', gap: 10, backgroundColor: '#0f172a' },
  footerBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  footerCancel: { backgroundColor: '#374151' },
  footerUpload: { backgroundColor: '#22c55e' },
  footerDisabled: { backgroundColor: '#334155' },
  footerBtnText: { color: '#fff', fontWeight: '700' },
});
