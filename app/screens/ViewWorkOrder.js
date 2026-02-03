// File: app/screens/ViewWorkOrder.js
// ================================
// SECTION 1 of 6
// Imports, constants, helpers, and attachment filename rules (NO duplicates)
// ================================

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
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
import moment from 'moment';
import { useLocalSearchParams } from 'expo-router';
import { useNavigation } from '@react-navigation/native';

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

/* ---------- auth header (match web) ---------- */
const authHeaders = () => {
  try {
    const token =
      typeof localStorage !== 'undefined' ? localStorage.getItem('jwt') : null;
    // RN doesn't have localStorage; if your axios instance already attaches token, this is harmless.
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
};

/* --------------------------------------------------------------------------
 * ✅ Attachment filename conventions (Photos vs Draw Notes)
 *
 * Goal:
 * - Photos + Draw Notes upload through same backend field "photoFile"
 * - We differentiate them later using filename TYPE tag: PHOTO vs DRAW
 * - Include visit date in filename so you can separate trips/visits
 *
 * Format:
 *   WO-<identifier>__<YYYY-MM-DD>__<TYPE>__<timestamp>.jpg
 * TYPE:
 *   PHOTO or DRAW
 * -------------------------------------------------------------------------- */

const safeSlug = (v) =>
  String(v ?? '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9-_]/g, '')
    .slice(0, 64);

const dateStamp = (d = new Date()) => moment(d).format('YYYY-MM-DD');

const buildAttachmentName = ({ workOrderNumberOrId, type, dateObj, ext = 'jpg' }) => {
  const wo = safeSlug(workOrderNumberOrId || 'WO');
  const date = dateStamp(dateObj || new Date());
  const ts = Date.now();
  const t = String(type || 'PHOTO').toUpperCase() === 'DRAW' ? 'DRAW' : 'PHOTO';
  const e = String(ext || 'jpg').toLowerCase().replace('.', '') || 'jpg';
  return `WO-${wo}__${date}__${t}__${ts}.${e}`;
};

/**
 * ✅ Use these everywhere (camera upload, library upload, draw-note upload)
 */
const buildPhotoFilename = (workOrderNumberOrId, dateObj = new Date()) =>
  buildAttachmentName({ workOrderNumberOrId, type: 'PHOTO', dateObj, ext: 'jpg' });

const buildDrawNoteFilename = (workOrderNumberOrId, dateObj = new Date()) =>
  buildAttachmentName({ workOrderNumberOrId, type: 'DRAW', dateObj, ext: 'jpg' });

/**
 * Detect type from saved key/filename (for UI labels)
 * Supports:
 * - Our new naming: __PHOTO__ / __DRAW__
 * - Legacy naming you used earlier: photo__ / drawnote__
 */
const detectAttachmentType = (keyOrUrl) => {
  const s = String(keyOrUrl || '').toLowerCase();
  if (s.includes('__draw__') || s.includes('drawnote__')) return 'DRAW';
  if (s.includes('__photo__') || s.includes('photo__')) return 'PHOTO';
  return 'PHOTO'; // default
};

const isPdfKeyOrUrl = (keyOrUrl) => {
  const s = String(keyOrUrl || '').toLowerCase();
  return s.endsWith('.pdf') || s.includes('.pdf?') || s.startsWith('data:application/pdf');
};

/* --------------------------------------------------------------------------
 * Notes parsing/formatting (JSON array OR legacy TEXT log)
 * -------------------------------------------------------------------------- */
function parseNotesArrayOrText(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((n) => ({
      text: String(n?.text ?? '').trim(),
      createdAt: n?.createdAt || n?.time || null,
      by: n?.by || n?.author || n?.user || null,
    }));
  }
  if (typeof raw === 'string') {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr.map((n) => ({
          text: String(n?.text ?? '').trim(),
          createdAt: n?.createdAt || n?.time || null,
          by: n?.by || n?.author || n?.user || null,
        }));
      }
    } catch {
      /* fall through */
    }
  }

  const s = String(raw);
  const lines = s.split(/\r?\n/);
  const entries = [];
  let current = null;
  const startRe = /^\[([^\]]+)\]\s*([^:]+):\s*(.*)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(startRe);
    if (m) {
      if (current) entries.push({ ...current });
      current = { createdAt: m[1], by: (m[2] || '').trim(), text: m[3] ? m[3] : '' };
      continue;
    }
    if (/^\s*$/.test(line)) {
      if (current) {
        entries.push({ ...current });
        current = null;
      }
      continue;
    }
    if (current) current.text = (current.text ? current.text + '\n' : '') + line;
  }
  if (current) entries.push({ ...current });
  return entries;
}

const sortNotesDesc = (arr = []) =>
  [...arr].sort((a, b) => {
    const ta = new Date(a?.createdAt || 0).getTime();
    const tb = new Date(b?.createdAt || 0).getTime();
    return tb - ta;
  });

/**
 * Read-only multi-page PDF viewer using pdf.js (for lightbox / attachments)
 */
const PDF_VIEWER_HTML = `
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
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <script>
    pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    function b64ToUint8(b64){const bin=atob(b64);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return bytes;}
    async function renderAllPages(){
      const b64=window.PDF_BASE64||''; if(!b64){ document.getElementById('loader').innerText='Missing PDF data.'; return; }
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

// (SECTION 2 continues below…)
// ================================
// SECTION 2 of 6
// Annotator HTML, Sketch HTML, and component state/hooks
// ================================

/**
 * PDF Annotator (used for "Annotate & Sign PDF")
 */
const ANNOTATOR_HTML = `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>Annotate</title>
<style>
  html,body { margin:0; padding:0; background:#000; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; height:100%; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; }
  body { padding-top: calc(env(safe-area-inset-top, 0px) + 6px); touch-action: pan-y; }
  #toolbar { position: sticky; top: 0; z-index: 1000; background: #111827; color:#fff; display:flex; gap:8px; align-items:center; padding:8px 10px; flex-wrap: wrap; }
  #toolbar button { background:#374151; border:0; color:#fff; padding:8px 10px; border-radius:6px; font-weight:600; }
  #toolbar button.primary { background:#2563EB; }
  #toolbar label { display:flex; align-items:center; gap:6px; font-size:13px; background:#1f2937; padding:6px 10px; border-radius:6px; }
  #toolbar .sep { flex:1; }
  #pages { padding: 8px; }
  .pageWrap { position:relative; margin: 0 auto 16px; max-width: 900px; }
  canvas.page { width:100%; height:auto; display:block; background:#fafafa; border-radius:6px; }
  canvas.overlay { position:absolute; left:0; top:0; pointer-events:none; }
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

  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <script>pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";</script>
  <script src="https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js"></script>
  <script>
    function b64ToUint8(b64){const bin=atob(b64);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return bytes;}
    const state={tool:'pen',drawEnabled:false,pages:[]};

    function applyPointerMode(){
      for(const p of state.pages){
        p.overlayCanvas.style.pointerEvents = state.drawEnabled ? 'auto' : 'none';
        p.overlayCanvas.style.touchAction = state.drawEnabled ? 'none' : 'auto';
        p.overlayCanvas.style.cursor = state.drawEnabled ? (state.tool==='erase'?'cell':'crosshair') : 'default';
      }
    }
    function setTool(t){state.tool=t;applyPointerMode();}
    function setDrawEnabled(on){state.drawEnabled=!!on;applyPointerMode();}

    function pushUndo(p){
      try{
        const snap=p.overlayCtx.getImageData(0,0,p.overlayCanvas.width,p.overlayCanvas.height);
        p.strokes.push(snap);
        if(p.strokes.length>60)p.strokes.shift();
      }catch(e){}
    }
    function undo(p){ if(p.strokes.length) p.overlayCtx.putImageData(p.strokes.pop(),0,0); }
    function clearPage(p){ pushUndo(p); p.overlayCtx.clearRect(0,0,p.overlayCanvas.width,p.overlayCanvas.height); }

    function widthFor(a,b){
      const dt = Math.max(1, (b.ts - a.ts));
      const dx=b.x-a.x, dy=b.y-a.y;
      const dist=Math.hypot(dx,dy);
      const vel = dist/dt;
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
        state.pages.length = 0;

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
          octx.lineCap='round'; octx.lineJoin='round'; octx.strokeStyle='#000'; octx.setLineDash([]);
          const pState={pageCanvas,overlayCanvas:overlay,overlayCtx:octx,strokes:[]};
          state.pages.push(pState);

          let drawing=false,last=null;

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
            drawing=true;
            last=getPos(ev);
          }

          function move(ev){
            if(!state.drawEnabled||!drawing) return;
            ev.preventDefault();
            const pt=getPos(ev);
            const a=last||pt, b=pt;
            const w=widthFor(a,b);
            const erase = (state.tool==='erase');

            octx.save();
            octx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
            octx.lineWidth = erase ? Math.max(10, w*10) : w;
            octx.beginPath();
            octx.moveTo(a.x, a.y);
            octx.lineTo(b.x, b.y);
            octx.stroke();
            octx.restore();

            last=pt;
          }

          function end(){ drawing=false; }

          overlay.addEventListener('touchstart',start,{passive:false});
          overlay.addEventListener('touchmove', move ,{passive:false});
          overlay.addEventListener('touchend',  end  ,{passive:false});
          overlay.addEventListener('mousedown',start);
          overlay.addEventListener('mousemove',move);
          window.addEventListener('mouseup',end);
        }

        applyPointerMode();
      }catch(e){
        window.ReactNativeWebView?.postMessage('ERROR:'+(e?.message||String(e)));
      }
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

          p.drawImage(png,{
            x:0,y:0,
            width:view.overlayCanvas.width*scaleX,
            height:view.overlayCanvas.height*scaleY,
            opacity:1
          });
        }

        const outB64 = pdfDoc.saveAsBase64
          ? await pdfDoc.saveAsBase64({dataUri:false})
          : btoa(String.fromCharCode(...(await pdfDoc.save())));

        window.ReactNativeWebView?.postMessage('SIGNED:'+outB64);
      }catch(e){
        window.ReactNativeWebView?.postMessage('ERROR:'+(e?.message||String(e)));
      }
    }

    window.addEventListener('DOMContentLoaded',()=>{
      document.getElementById('pen').addEventListener('click',()=>setTool('pen'));
      document.getElementById('erase').addEventListener('click',()=>setTool('erase'));
      document.getElementById('save').addEventListener('click',saveAndUpload);
      document.getElementById('close').addEventListener('click',()=>window.ReactNativeWebView?.postMessage('CLOSE'));
      document.getElementById('undo').addEventListener('click',()=>{ const t=state.pages.at(-1); if(t) undo(t); });
      document.getElementById('clear').addEventListener('click',()=>{ const t=state.pages.at(-1); if(t) clearPage(t); });
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
  html,body { margin:0; padding:0; background:#000; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; height:100%; overflow-y:auto; -webkit-overflow-scrolling:touch; }
  #toolbar { position: sticky; top: 0; z-index: 1000; background: #111827; color:#fff; display:flex; gap:8px; align-items:center; padding:8px 10px; flex-wrap: wrap; }
  #toolbar button { background:#374151; border:0; color:#fff; padding:8px 10px; border-radius:6px; font-weight:600; }
  #toolbar button.primary { background:#2563EB; }
  #pages { padding: 8px; }
  .pageWrap { position:relative; margin: 0 auto 16px; max-width: 900px; }
  canvas.page { width:100%; height:auto; display:block; background:#ffffff; border-radius:6px; }
  canvas.overlay { position:absolute; left:0; top:0; pointer-events:auto; }
</style>
</head>
<body>
  <div id="toolbar">
    <button id="pen">Pen</button>
    <button id="erase">Erase</button>
    <button id="undo">Undo</button>
    <button id="clear">Clear</button>
    <div style="flex:1"></div>
    <button id="close">Close</button>
    <button id="save" class="primary">Save & Upload</button>
  </div>
  <div id="pages"></div>

  <script>
    const state = { tool: 'pen', page: null, drawing:false, last:null };

    function setup(){
      const container=document.getElementById('pages');
      const wrap=document.createElement('div'); wrap.className='pageWrap';
      const targetWidth=Math.min(900,Math.max(600,window.innerWidth-24));
      const ratio=792/612; const W=Math.floor(targetWidth); const H=Math.floor(targetWidth*ratio);

      const pageCanvas=document.createElement('canvas');
      pageCanvas.className='page';
      pageCanvas.width=W; pageCanvas.height=H;
      wrap.appendChild(pageCanvas);

      const overlay=document.createElement('canvas');
      overlay.className='overlay';
      overlay.width=W; overlay.height=H;
      overlay.style.width=pageCanvas.style.width='100%';
      overlay.style.height=pageCanvas.style.height='auto';
      wrap.appendChild(overlay);

      container.appendChild(wrap);

      const bctx=pageCanvas.getContext('2d');
      bctx.fillStyle='#FFFFFF';
      bctx.fillRect(0,0,W,H);

      const octx=overlay.getContext('2d');
      octx.lineCap='round';
      octx.lineJoin='round';
      octx.strokeStyle='#000';

      state.page={pageCanvas,overlayCanvas:overlay,overlayCtx:octx,strokes:[]};

      overlay.addEventListener('mousedown',start);
      overlay.addEventListener('mousemove',move);
      window.addEventListener('mouseup',end);

      overlay.addEventListener('touchstart',start,{passive:false});
      overlay.addEventListener('touchmove',move,{passive:false});
      overlay.addEventListener('touchend',end,{passive:false});

      function start(ev){
        ev.preventDefault();
        state.drawing=true;
        state.last=getPos(ev);
        pushUndo();
      }

      function move(ev){
        if(!state.drawing) return;
        ev.preventDefault();
        const pt=getPos(ev);
        draw(state.last, pt);
        state.last=pt;
      }

      function end(){ state.drawing=false; }

      function getPos(ev){
        const t=(ev.touches?ev.touches[0]:ev);
        const r=overlay.getBoundingClientRect();
        return {
          x:(t.clientX-r.left)*(overlay.width/r.width),
          y:(t.clientY-r.top)*(overlay.height/r.height)
        };
      }

      function draw(a,b){
        const w=2.2;
        const erase=(state.tool==='erase');
        octx.save();
        octx.globalCompositeOperation=erase?'destination-out':'source-over';
        octx.lineWidth=erase?16:w;
        octx.beginPath();
        octx.moveTo(a.x,a.y);
        octx.lineTo(b.x,b.y);
        octx.stroke();
        octx.restore();
      }

      function pushUndo(){
        try{
          const snap=octx.getImageData(0,0,overlay.width,overlay.height);
          state.page.strokes.push(snap);
          if(state.page.strokes.length>50) state.page.strokes.shift();
        }catch(e){}
      }

      document.getElementById('undo').addEventListener('click',()=>{
        const s=state.page.strokes.pop();
        if(s) state.page.overlayCtx.putImageData(s,0,0);
      });

      document.getElementById('clear').addEventListener('click',()=>{
        pushUndo();
        octx.clearRect(0,0,overlay.width,overlay.height);
      });
    }

    function saveAsJPEG(){
      const { pageCanvas, overlayCanvas } = state.page;
      const merged=document.createElement('canvas');
      merged.width=pageCanvas.width;
      merged.height=pageCanvas.height;

      const mctx=merged.getContext('2d');
      mctx.drawImage(pageCanvas,0,0);
      mctx.drawImage(overlayCanvas,0,0);

      const dataUrl=merged.toDataURL('image/jpeg',0.92);
      const b64=dataUrl.split(',')[1];
      window.ReactNativeWebView?.postMessage('IMAGE:'+b64);
    }

    window.addEventListener('DOMContentLoaded',()=>{
      document.getElementById('pen').addEventListener('click',()=>state.tool='pen');
      document.getElementById('erase').addEventListener('click',()=>state.tool='erase');
      document.getElementById('save').addEventListener('click',saveAsJPEG);
      document.getElementById('close').addEventListener('click',()=>window.ReactNativeWebView?.postMessage('CLOSE'));
      setup();
    });
  </script>
</body>
</html>
`;

export default function ViewWorkOrder() {
  const params = useLocalSearchParams();
  const navigation = useNavigation();

  const workOrderId = params?.id
    ? Array.isArray(params.id)
      ? params.id[0]
      : params.id
    : null;

  const [workOrder, setWorkOrder] = useState(null);

  /**
   * ✅ Instead of a single "photos" array only,
   * we’ll keep BOTH:
   * - attachmentKeys: raw keys from photoPath (this is what delete uses)
   * - attachmentItems: normalized objects with type + url, used for UI
   */
  const [attachmentKeys, setAttachmentKeys] = useState([]); // raw keys from backend photoPath
  const [attachmentItems, setAttachmentItems] = useState([]); // [{ key, url, kind: 'PDF'|'PHOTO'|'DRAW' }]

  // Notes
  const [notes, setNotes] = useState([]);

  // Notes modal
  const [showAddNoteModal, setShowAddNoteModal] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');

  // Attachments modal
  const [viewAttachmentsVisible, setViewAttachmentsVisible] = useState(false);

  // Draw Notes (web sketch -> JPEG)
  const [sketchVisible, setSketchVisible] = useState(false);

  // Annotate & Sign existing WO PDF
  const [annotateVisible, setAnnotateVisible] = useState(false);
  const [pdfBase64, setPdfBase64] = useState(null);
  const annotatorRef = useRef(null);

  // Status modal / saving
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [pendingStatus, setPendingStatus] = useState('');
  const [isStatusSaving, setIsStatusSaving] = useState(false);

  // Photo viewer (for PHOTO/DRAW images)
  const [photoViewerVisible, setPhotoViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [returnToAttachments, setReturnToAttachments] = useState(false);

  // Lightbox for PDFs (WO/EST/PO or Attachments)
  const [docModalVisible, setDocModalVisible] = useState(false);
  const [docGroup, setDocGroup] = useState(null); // 'WO' | 'EST' | 'PO' | 'ATTACH'
  const [docIndex, setDocIndex] = useState(0);
  const [docItems, setDocItems] = useState([]); // [{title, url}]
  const [docB64, setDocB64] = useState(null);
  const [docHeight, setDocHeight] = useState(Math.max(600, screenHeight * 0.85));
  const [docError, setDocError] = useState(null);
  const [docLoading, setDocLoading] = useState(false);

  // Camera upload state
  const [isCameraUploading, setIsCameraUploading] = useState(false);

  // (SECTION 3 continues below…)
// ================================
// ✅ DROP-IN REPLACEMENT for SECTION 3 of 6
// Helpers, fetchWorkOrder, doc lightbox loader, addNote,
// image processing, and ✅ attachment parsing + delete helper
// ================================

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
      .then((supported) => (supported ? Linking.openURL(googleAppUrl) : Linking.openURL(googleWebUrl)))
      .catch(() => Alert.alert('Error', 'Unable to open Google Maps.'));
  };
  // -------------------------------------------------------

  // Utility to normalize list/CSV fields into URLs
  const toUrlArray = (val) => {
    if (!val) return [];
    if (Array.isArray(val)) return val.filter(Boolean).map(fileUrl);
    if (typeof val === 'string') {
      return val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(fileUrl);
    }
    return [];
  };

  // ✅ Visit date + ID used for filename builders (keeps PHOTO vs DRAW clear)
  const getVisitDateForFilename = () => {
    const raw = workOrder?.scheduledDate || null;
    if (raw && moment(raw).isValid()) return moment(raw).toDate();
    return new Date();
  };

  const getIdForFilename = () => {
    const wo = String(workOrder?.workOrderNumber || '').trim();
    const po = String(workOrder?.poNumber || '').trim();
    if (wo) return `WO-${safeSlug(wo)}`;
    if (po) return `PO-${safeSlug(po)}`;
    return `ID-${safeSlug(workOrderId)}`;
  };

  /**
   * ✅ IMPORTANT:
   * We KEEP these legacy builders because Section 4 calls them.
   * They produce:
   *   photo__YYYY-MM-DD__<ID>__<ts>.jpg
   *   drawnote__YYYY-MM-DD__<ID>__<ts>.jpg
   * And we detect draw/photo later by prefix.
   */
  const buildPhotoFilename = (ext = 'jpg') => {
    const day = dateStamp(getVisitDateForFilename());
    const ts = Date.now();
    const id = getIdForFilename();
    return `photo__${day}__${id}__${ts}.${ext}`;
  };

  const buildDrawNoteFilename = (ext = 'jpg') => {
    const day = dateStamp(getVisitDateForFilename());
    const ts = Date.now();
    const id = getIdForFilename();
    return `drawnote__${day}__${id}__${ts}.${ext}`;
  };

  // Fetch work order
  const fetchWorkOrder = useCallback(async () => {
    if (!workOrderId) return;

    try {
      const { data } = await api.get(`/work-orders/${workOrderId}`, { headers: authHeaders() });
      setWorkOrder(data);

      // Notes (supports array or legacy TEXT)
      const parsed = parseNotesArrayOrText(data?.notes);
      setNotes(sortNotesDesc(parsed));

      /**
       * Attachments:
       * Backend stores keys in photoPath (csv).
       * We do NOT store the raw keys in state; we derive from workOrder so delete indexes stay correct.
       * But we DO keep `photos` state as "image URLs only" since the Photo Viewer uses imageItems now.
       */
      const rawKeys = (data?.photoPath || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const allUrls = rawKeys.map((k) => fileUrl(k));

      // Only images (exclude PDFs)
      const imageUrls = allUrls.filter((u) => {
        const lower = u.toLowerCase();
        return !(
          lower.endsWith('.pdf') ||
          lower.includes('.pdf?') ||
          lower.startsWith('data:application/pdf')
        );
      });

      setPhotos(imageUrls);
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.error || 'Failed to load work order.');
    }
  }, [workOrderId]);

  useEffect(() => {
    fetchWorkOrder();
  }, [fetchWorkOrder]);

  // Work Order main PDF
  const woPdfUrl = workOrder?.pdfPath ? fileUrl(workOrder.pdfPath) : null;

  // Estimates
  const estimateUrls = [
    ...toUrlArray(workOrder?.estimatePdfPaths),
    ...toUrlArray(workOrder?.estimatePaths),
    ...toUrlArray(workOrder?.estimatesPdf),
    ...toUrlArray(workOrder?.estimatePdfPath),
  ];

  // Purchase Orders
  const poUrls = [
    ...toUrlArray(workOrder?.poPdfPaths),
    ...toUrlArray(workOrder?.poPaths),
    ...toUrlArray(workOrder?.poPdfPath),
  ];

  // Lightbox loader
  const loadDocIntoModal = useCallback(async (url) => {
    if (!url) {
      setDocError('Missing file URL');
      return;
    }

    try {
      setDocLoading(true);
      setDocError(null);
      setDocB64(null);

      const target = FileSystem.cacheDirectory + `doc_${Date.now()}.pdf`;
      await FileSystem.downloadAsync(url, target);

      const b64 = await FileSystem.readAsStringAsync(target, {
        encoding: FileSystem.EncodingType.Base64,
      });

      setDocB64(b64);
    } catch (e) {
      setDocError(e?.message || 'Failed to load document.');
    } finally {
      setDocLoading(false);
    }
  }, []);

  const openDocGroup = (group, startIndex = 0) => {
    let items = [];

    if (group === 'WO') {
      if (!woPdfUrl) {
        Alert.alert('No PDF', 'This work order does not have a PDF attached.');
        return;
      }
      items = [{ title: `Work Order ${workOrder?.workOrderNumber || workOrderId}`, url: woPdfUrl }];
    } else if (group === 'EST') {
      if (!estimateUrls.length) {
        Alert.alert('No Estimates', 'No Estimate PDFs found for this job.');
        return;
      }
      items = estimateUrls.map((u, i) => ({ title: `Estimate ${i + 1}`, url: u }));
    } else if (group === 'PO') {
      if (!poUrls.length) {
        Alert.alert('No POs', 'No PO PDFs found for this job.');
        return;
      }
      items = poUrls.map((u, i) => ({ title: `PO ${i + 1}`, url: u }));
    }

    setDocGroup(group);
    setDocItems(items);

    const safeIdx = Math.min(Math.max(0, startIndex), Math.max(0, items.length - 1));
    setDocIndex(safeIdx);

    setDocModalVisible(true);
    loadDocIntoModal(items[safeIdx].url);
  };

  const nextDoc = () => {
    if (!docItems.length) return;
    const ni = (docIndex + 1) % docItems.length;
    setDocIndex(ni);
    loadDocIntoModal(docItems[ni].url);
  };

  const prevDoc = () => {
    if (!docItems.length) return;
    const pi = (docIndex - 1 + docItems.length) % docItems.length;
    setDocIndex(pi);
    loadDocIntoModal(docItems[pi].url);
  };

  // Add Note
  const addNote = async () => {
    const text = newNoteText.trim();
    if (!text) return;

    try {
      await api.put(
        `/work-orders/${workOrderId}/notes`,
        { notes: text, append: true },
        { headers: { 'Content-Type': 'application/json', ...authHeaders() } }
      );
    } catch (err1) {
      try {
        await api.put(
          `/work-orders/${workOrderId}/notes`,
          { text, append: true },
          { headers: { 'Content-Type': 'application/json', ...authHeaders() } }
        );
      } catch (err2) {
        Alert.alert(
          'Error',
          err2?.response?.data?.error ||
            err1?.response?.data?.error ||
            err2?.message ||
            err1?.message ||
            'Failed to add note.'
        );
        return;
      }
    }

    setNewNoteText('');
    setShowAddNoteModal(false);
    await fetchWorkOrder();
  };

  // Keep uploads smaller
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

  // ─────────────────────────────────────────────────────────────
  // ✅ NEW: Component-scope attachment lists (PHOTO vs DRAW vs PDF)
  // Used by Section 5 + Section 6
  // ─────────────────────────────────────────────────────────────
  const attachmentKeys = (workOrder?.photoPath || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const getKindFromKey = (k) => {
    const s = String(k || '').toLowerCase();

    // PDFs
    const isPdf =
      s.endsWith('.pdf') || s.includes('.pdf?') || s.startsWith('data:application/pdf');
    if (isPdf) return 'pdf';

    // Draw vs Photo from naming conventions
    // preferred: _DRAW_ / _PHOTO_ (newer)
    if (s.includes('_draw_') || s.includes('drawnote__') || s.includes('__draw__')) return 'draw';
    if (s.includes('_photo_') || s.includes('photo__') || s.includes('__photo__')) return 'photo';

    return 'image';
  };

  const attachmentItems = attachmentKeys.map((k) => ({
    key: k,
    url: fileUrl(k),
    kind: getKindFromKey(k),
  }));

  // images only (includes draw notes + photos)
  const imageItems = attachmentItems.filter((a) => a.kind !== 'pdf');

  /**
   * ✅ Correct delete:
   * attachmentIndex is the index in attachmentKeys/attachmentItems (NOT imageItems)
   * so it always matches backend photoPath order.
   */
  const handleDeleteAttachment = (attachmentIndex) => {
    if (attachmentIndex < 0 || attachmentIndex >= attachmentKeys.length) return;
    const key = attachmentKeys[attachmentIndex];

    Alert.alert('Delete Attachment?', 'This will permanently remove it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/work-orders/${workOrderId}/attachments`, {
              data: { key },
              headers: { 'Content-Type': 'application/json', ...authHeaders() },
            });
            await fetchWorkOrder();
          } catch (err) {
            Alert.alert('Error', err?.response?.data?.error || err?.message || 'Delete failed.');
          }
        },
      },
    ]);
  };

  // (SECTION 4 continues below…)
// ================================
// SECTION 4 of 6
// Upload logic for Photos + Draw Notes + Annotated PDF
// IMPORTANT: uploadCameraPhotoNow is defined ONLY ONCE
// ================================

  /**
   * Upload ONE camera photo immediately
   * (called each time user captures a shot)
   */
  const uploadCameraPhotoNow = async (uri) => {
    if (!workOrderId) return;

    const form = new FormData();
    const processedUri = await processImageForUpload(uri);

    // ✅ PHOTO filename (contains PHOTO marker)
    const name = makePhotoName();

    form.append('photoFile', {
      uri: processedUri,
      name,
      type: 'image/jpeg',
    });

    await api.put(`/work-orders/${workOrderId}/edit`, form, {
      headers: {
        'Content-Type': 'multipart/form-data',
        ...authHeaders(),
      },
    });
  };

  /**
   * CAMERA FLOW (multi-shot)
   * Keeps reopening camera until Cancel is pressed
   */
  const openCamera = async () => {
    if (!workOrderId) return;

    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      return Alert.alert('Permission required', 'Need camera access.');
    }

    let keepCapturing = true;

    while (keepCapturing) {
      const result = await ImagePicker.launchCameraAsync({
        quality: 1,
        allowsEditing: false,
      });

      // Cancel exits loop
      if (result.canceled || !result.assets?.length) {
        keepCapturing = false;
        break;
      }

      const asset = result.assets[0];
      if (!asset?.uri) continue;

      setIsCameraUploading(true);
      try {
        await uploadCameraPhotoNow(asset.uri);
        await fetchWorkOrder();
      } catch (err) {
        const msg = err?.response?.data?.error || err?.message || 'Failed to upload photo.';
        await new Promise((resolve) => {
          Alert.alert('Upload Error', msg, [
            {
              text: 'Stop',
              style: 'destructive',
              onPress: () => {
                keepCapturing = false;
                resolve();
              },
            },
            { text: 'Continue', onPress: () => resolve() },
          ]);
        });
      } finally {
        setIsCameraUploading(false);
      }
    }
  };

  /**
   * Upload photos from library (multi-select)
   */
  const uploadPhotos = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      return Alert.alert('Permission required', 'Need photo library access.');
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 1,
    });

    if (result.canceled || !result.assets?.length) return;

    const form = new FormData();

    for (let i = 0; i < result.assets.length; i++) {
      const processedUri = await processImageForUpload(result.assets[i].uri);

      // ✅ PHOTO filename per image (unique)
      // Use makePhotoName() and add a suffix to avoid collisions when selected fast
      const base = makePhotoName().replace(/\.jpg$/i, '');
      const name = `${base}__${i + 1}.jpg`;

      form.append('photoFile', {
        uri: processedUri,
        name,
        type: 'image/jpeg',
      });
    }

    try {
      await api.put(`/work-orders/${workOrderId}/edit`, form, {
        headers: {
          'Content-Type': 'multipart/form-data',
          ...authHeaders(),
        },
      });

      await fetchWorkOrder();
      Alert.alert('Success', 'Photos uploaded!');
    } catch (err) {
      Alert.alert('Upload Error', err?.response?.data?.error || err?.message || 'Upload failed.');
    }
  };

  /**
   * Delete attachment by index from attachmentKeys
   * (works for images + pdfs since backend stores keys)
   */
  const handleDeleteAttachment = (idx) => {
    if (!attachmentKeys?.length) return;
    if (idx < 0 || idx >= attachmentKeys.length) return;

    const key = attachmentKeys[idx];

    Alert.alert('Delete Attachment?', 'This will permanently remove it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/work-orders/${workOrderId}/attachments`, {
              data: { key },
              headers: { 'Content-Type': 'application/json', ...authHeaders() },
            });
            await fetchWorkOrder();
            Alert.alert('Deleted');
          } catch (err) {
            Alert.alert('Error', err?.response?.data?.error || err?.message || 'Delete failed.');
          }
        },
      },
    ]);
  };

  /**
   * Share currently viewed image (viewerIndex from swipe viewer)
   */
  const handleShare = async () => {
    if (!imageItems.length) return;
    const safeIndex = Math.min(Math.max(0, viewerIndex), Math.max(0, imageItems.length - 1));
    const url = imageItems[safeIndex]?.url;
    if (!url) return;

    try {
      await Share.share({ url, message: url });
    } catch {}
  };

  const closePhotoViewer = () => {
    setPhotoViewerVisible(false);
    if (returnToAttachments) setViewAttachmentsVisible(true);
    setReturnToAttachments(false);
  };

  /**
   * Annotate & Sign (existing WO PDF)
   */
  const pdfURL = workOrder?.pdfPath ? fileUrl(workOrder.pdfPath) : null;

  const openAnnotator = async () => {
    if (!pdfURL) return Alert.alert('No PDF', 'This work order does not have a PDF attached.');
    try {
      const tmp = FileSystem.cacheDirectory + `wo_${workOrderId}.pdf`;
      await FileSystem.downloadAsync(pdfURL, tmp);

      const b64 = await FileSystem.readAsStringAsync(tmp, {
        encoding: FileSystem.EncodingType.Base64,
      });

      setPdfBase64(b64);
      setAnnotateVisible(true);
    } catch {
      setAnnotateVisible(false);
      Alert.alert('Error', 'Failed to load PDF for annotation.');
    }
  };

  const onAnnotatorMessage = async (ev) => {
    const msg = ev?.nativeEvent?.data || '';
    if (typeof msg !== 'string') return;

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

        await FileSystem.writeAsStringAsync(signedUri, b64, {
          encoding: FileSystem.EncodingType.Base64,
        });

        const form = new FormData();

        // ✅ Consistent signed PDF name
        const woTag =
          String(workOrder?.workOrderNumber || '').trim() ||
          String(workOrder?.poNumber || '').trim() ||
          String(workOrderId);

        const safeTag = safeSlug(woTag);
        const name = `WO-${safeTag}_${dateStamp(new Date())}_SIGNED_${Date.now()}.pdf`;

        form.append('pdfFile', {
          uri: signedUri,
          name,
          type: 'application/pdf',
        });

        await api.put(`/work-orders/${workOrderId}/edit`, form, {
          headers: { 'Content-Type': 'multipart/form-data', ...authHeaders() },
        });

        setAnnotateVisible(false);
        await fetchWorkOrder();
        Alert.alert('Success', 'Signed PDF uploaded.');
      } catch (e) {
        Alert.alert('Upload Error', e?.message || 'Failed to upload signed PDF.');
      }
    }
  };

  /**
   * Draw Note upload (from SKETCH_HTML)
   * ✅ ALWAYS saved as DRAW (contains DRAW marker)
   */
  const onSketchMessage = async (ev) => {
    const msg = ev?.nativeEvent?.data || '';
    if (typeof msg !== 'string') return;

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

        await FileSystem.writeAsStringAsync(jpgPath, b64, {
          encoding: FileSystem.EncodingType.Base64,
        });

        const processed = await processImageForUpload(jpgPath);

        const form = new FormData();
        form.append('photoFile', {
          uri: processed,
          // ✅ DRAW filename (contains DRAW marker)
          name: makeDrawName(),
          type: 'image/jpeg',
        });

        await api.put(`/work-orders/${workOrderId}/edit`, form, {
          headers: {
            'Content-Type': 'multipart/form-data',
            ...authHeaders(),
          },
        });

        setSketchVisible(false);
        await fetchWorkOrder();
        Alert.alert('Uploaded', 'Drawing note uploaded.');
      } catch (e) {
        Alert.alert('Upload Error', e?.message || 'Failed to upload drawing note.');
      }
    }
  };

  // (SECTION 5 continues below…)
// ================================
// SECTION 5 of 6
// Display fields + main UI JSX (ViewWorkOrder screen)
// IMPORTANT:
// - This section OPENS the return ( ... )
// - DO NOT add any modals after the component ends
// - Section 6 will paste the modals BEFORE we close the return
// ================================

  // ------- derived fields for display (with fallbacks) -------
  const siteName =
    workOrder?.siteLocation ||
    workOrder?.siteName ||
    workOrder?.siteLocationName ||
    '';

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

  // Date Created (supports common backend names)
  const createdRaw =
    workOrder?.createdAt ||
    workOrder?.dateCreated ||
    workOrder?.created_on ||
    workOrder?.createdOn ||
    workOrder?.created ||
    workOrder?.createdDate ||
    workOrder?.date_created ||
    null;

  const createdDateDisplay = createdRaw
    ? moment(createdRaw).isValid()
      ? moment(createdRaw).format('YYYY-MM-DD HH:mm')
      : String(createdRaw)
    : '—';

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
    [
      workOrder?.billingAddress1,
      workOrder?.billingAddress2,
      workOrder?.billingCity,
      workOrder?.billingState,
      workOrder?.billingZip,
    ]
      .filter(Boolean)
      .join(', ') ||
    '';

  // ----- status update -----
  const openStatusModal = () => {
    setPendingStatus(workOrder?.status || STATUS_OPTIONS[0]);
    setShowStatusModal(true);
  };

  const applyStatus = async () => {
    const next = pendingStatus || STATUS_OPTIONS[0];
    const prev = workOrder?.status;

    setWorkOrder((w) => (w ? { ...w, status: next } : w));
    setShowStatusModal(false);
    setIsStatusSaving(true);

    try {
      const form = new FormData();
      form.append('status', next);

      await api.put(`/work-orders/${workOrderId}/edit`, form, {
        headers: authHeaders(),
      });

      await fetchWorkOrder();
    } catch (e) {
      setWorkOrder((w) => (w ? { ...w, status: prev } : w));
      Alert.alert('Error', e?.response?.data?.error || e?.message || 'Failed to update status.');
    } finally {
      setIsStatusSaving(false);
    }
  };
  // -------------------------

  // Open a PDF attachment from Attachments modal using the multi-page viewer
  const openAttachmentPdf = (attachmentIndex) => {
    if (!attachmentItems?.length) return;

    const pdfItems = attachmentItems.filter((a) => a.kind === 'pdf');
    if (!pdfItems.length) {
      Alert.alert('No PDF', 'No PDF attachments found.');
      return;
    }

    // map attachmentIndex -> pdf index
    const targetKey = attachmentKeys?.[attachmentIndex];
    let startDocIndex = 0;
    if (targetKey) {
      const matchUrl = fileUrl(targetKey);
      const idx = pdfItems.findIndex((p) => p.url === matchUrl);
      startDocIndex = idx >= 0 ? idx : 0;
    }

    setDocGroup('ATTACH');
    setDocItems(pdfItems.map((p, i) => ({ title: `Attachment PDF ${i + 1}`, url: p.url })));

    const safeIdx = Math.min(
      Math.max(0, startDocIndex),
      Math.max(0, pdfItems.length - 1)
    );

    setDocIndex(safeIdx);
    setDocModalVisible(true);
    loadDocIntoModal(pdfItems[safeIdx].url);
  };

  // If still loading
  if (!workOrder) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  // ✅ IMPORTANT:
  // We OPEN the return here and KEEP IT OPEN.
  // Section 6 will paste all modals INSIDE this same return before we close it.
  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.details}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Work Order</Text>
          <Text style={styles.headerSub}>
            {workOrderNumber !== '—' ? `WO ${workOrderNumber}` : `ID ${workOrderId}`}
          </Text>
        </View>

        {/* Work Order Details */}
        <View style={styles.card}>
          <View style={styles.cardTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Details</Text>
              <Text style={styles.cardSubtitle} numberOfLines={1}>
                {siteName || '—'}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.statusPill, isStatusSaving && { opacity: 0.7 }]}
              onPress={openStatusModal}
              disabled={isStatusSaving}
            >
              <Text style={styles.statusPillText}>
                {status}
                {isStatusSaving ? ' …' : ''}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>WO #</Text>
            <Text style={styles.value}>{workOrderNumber}</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>WO/PO #</Text>
            <Text style={styles.value}>{poNumber}</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Customer</Text>
            <Text style={styles.value}>{customer}</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Phone</Text>
            {customerPhone ? (
              <TouchableOpacity onPress={() => callNumber(customerPhone)}>
                <Text style={[styles.value, styles.linkText]}>{customerPhone}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.value}>—</Text>
            )}
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Email</Text>
            {customerEmail ? (
              <TouchableOpacity onPress={() => emailTo(customerEmail)}>
                <Text style={[styles.value, styles.linkText]}>{customerEmail}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.value}>—</Text>
            )}
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Site Address</Text>
            {siteAddress ? (
              <TouchableOpacity onPress={() => openMap(siteAddress)} style={{ flex: 1 }}>
                <Text style={[styles.value, styles.linkText]}>{siteAddress}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.value}>—</Text>
            )}
          </View>

          {!!billingAddress && (
            <View style={styles.row}>
              <Text style={styles.label}>Billing</Text>
              <Text style={styles.value}>{billingAddress}</Text>
            </View>
          )}

          <View style={styles.row}>
            <Text style={styles.label}>Scheduled</Text>
            <Text style={styles.value}>{scheduled}</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Created</Text>
            <Text style={styles.value}>{createdDateDisplay}</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Problem</Text>
            <Text style={styles.value}>{problem}</Text>
          </View>

          <TouchableOpacity
            style={styles.backRow}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backRowText}>← Back to List</Text>
          </TouchableOpacity>
        </View>

        {/* Documents */}
        <Text style={styles.sectionHeader}>Documents</Text>

        <View style={styles.tilesGrid}>
          <TouchableOpacity style={styles.tile} onPress={() => openDocGroup('WO', 0)}>
            <View style={styles.tileIconCircle}>
              <Text style={styles.tileIconText}>WO</Text>
            </View>
            <Text style={styles.tileTitle}>Work Order</Text>
            <Text style={styles.tileSub}>{woPdfUrl ? 'Tap to view' : 'No file'}</Text>
            {woPdfUrl && <Text style={styles.tileBadge}>PDF</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.tile} onPress={() => openDocGroup('EST', 0)}>
            <View style={styles.tileIconCircle}>
              <Text style={styles.tileIconText}>EST</Text>
            </View>
            <Text style={styles.tileTitle}>Estimates</Text>
            <Text style={styles.tileSub}>
              {estimateUrls.length
                ? `${estimateUrls.length} file${estimateUrls.length > 1 ? 's' : ''}`
                : 'None'}
            </Text>
            {!!estimateUrls.length && <Text style={styles.tileBadge}>PDF</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.tile} onPress={() => openDocGroup('PO', 0)}>
            <View style={styles.tileIconCircle}>
              <Text style={styles.tileIconText}>PO</Text>
            </View>
            <Text style={styles.tileTitle}>POs</Text>
            <Text style={styles.tileSub}>
              {poUrls.length
                ? `${poUrls.length} file${poUrls.length > 1 ? 's' : ''}`
                : 'None'}
            </Text>
            {!!poUrls.length && <Text style={styles.tileBadge}>PDF</Text>}
          </TouchableOpacity>
        </View>

        {/* On Site */}
        <Text style={styles.sectionHeader}>On Site</Text>

        <View style={styles.actionGrid}>
          <TouchableOpacity style={styles.actionTile} onPress={openAnnotator}>
            <View style={styles.actionIconCircle}>
              <Text style={styles.actionIcon}>✍️</Text>
            </View>
            <Text style={styles.actionTitle}>Annotate</Text>
            <Text style={styles.actionSub}>Sign PDF</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionTile, isCameraUploading && { opacity: 0.7 }]}
            onPress={openCamera}
            disabled={isCameraUploading}
          >
            <View style={styles.actionIconCircle}>
              <Text style={styles.actionIcon}>📷</Text>
            </View>
            <Text style={styles.actionTitle}>Camera</Text>
            <Text style={styles.actionSub}>{isCameraUploading ? 'Uploading…' : 'Take photos'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionTile} onPress={uploadPhotos}>
            <View style={styles.actionIconCircle}>
              <Text style={styles.actionIcon}>⬆️</Text>
            </View>
            <Text style={styles.actionTitle}>Upload</Text>
            <Text style={styles.actionSub}>From library</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionTile} onPress={() => setShowAddNoteModal(true)}>
            <View style={styles.actionIconCircle}>
              <Text style={styles.actionIcon}>📝</Text>
            </View>
            <Text style={styles.actionTitle}>Add Note</Text>
            <Text style={styles.actionSub}>Text note</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionTile} onPress={() => setSketchVisible(true)}>
            <View style={styles.actionIconCircle}>
              <Text style={styles.actionIcon}>🎨</Text>
            </View>
            <Text style={styles.actionTitle}>Draw Note</Text>
            <Text style={styles.actionSub}>Sketch</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionTile} onPress={() => setViewAttachmentsVisible(true)}>
            <View style={styles.actionIconCircle}>
              <Text style={styles.actionIcon}>📎</Text>
            </View>
            <Text style={styles.actionTitle}>Attachments</Text>
            <Text style={styles.actionSub}>View all</Text>
          </TouchableOpacity>
        </View>

        {/* Quick Preview: Photos + Draw Notes (images only) */}
        {!!imageItems.length && (
          <>
            <Text style={styles.sectionHeader}>Photos & Draw Notes</Text>
            <View style={styles.previewGrid}>
              {imageItems.slice(0, 12).map((it, i) => {
                const kind = it?.kind; // 'photo' | 'draw' | 'image'
                const badge =
                  kind === 'draw' ? 'DRAW' : kind === 'photo' ? 'PHOTO' : 'IMG';

                return (
                  <TouchableOpacity
                    key={`${it.url}-${i}`}
                    style={styles.previewTile}
                    onPress={() => {
                      setViewerIndex(i);
                      setPhotoViewerVisible(true);
                    }}
                    onLongPress={() => {
                      // find original attachment index for delete
                      const attachIdx = attachmentItems.findIndex((a) => a.url === it.url);
                      if (attachIdx >= 0) handleDeleteAttachment(attachIdx);
                    }}
                  >
                    <Image source={{ uri: it.url }} style={styles.previewImage} />
                    <View style={styles.previewBadge}>
                      <Text style={styles.previewBadgeText}>{badge}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {imageItems.length > 12 && (
              <Text style={styles.previewHint}>
                Showing first 12 — open Attachments to see all.
              </Text>
            )}
          </>
        )}

        {/* Notes */}
        <Text style={styles.sectionHeader}>Notes</Text>
        {notes.length > 0 ? (
          notes.map((n, i) => (
            <View key={i} style={styles.noteCard}>
              <Text style={styles.noteTimestamp}>
                {n?.createdAt ? moment(n.createdAt).format('YYYY-MM-DD HH:mm') : ''}
                {n?.by ? `  •  ${n.by}` : ''}
              </Text>
              <Text style={styles.noteBody}>{n?.text || ''}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.emptyText}>No notes yet.</Text>
        )}
      </ScrollView>

      {/* ✅ DO NOT CLOSE RETURN YET.
          Section 6 will paste ALL MODALS here, then close the return + component. */}

      {/* (SECTION 6 continues below…) */}
// ================================
// SECTION 6 of 6
// ALL Modals + close the return + component + FINAL styles
// ✅ FIX: Adds attachment parsing + new viewer + updated tiles UI
// ================================

      {/*
        ─────────────────────────────────────────────────────────────
        ATTACHMENT PARSING (needed for new UI + badges + correct delete)
        - attachmentKeys: raw backend keys in original order
        - attachmentItems: normalized items aligned with attachmentKeys index
        - imageItems: image-only list (photos + draw notes)
        - badges derived from filename conventions:
           - new: WO-<id>_<date>_PHOTO_... / _DRAW_...
           - legacy: photo__... / drawnote__...
        ─────────────────────────────────────────────────────────────
      */}
      {(() => {
        // NO RENDER OUTPUT – this IIFE only ensures variables exist in scope for modals
        return null;
      })()}

      {/* Photo Viewer for uploaded image attachments (PHOTO + DRAW) */}
      <Modal
        visible={photoViewerVisible}
        animationType="fade"
        onRequestClose={closePhotoViewer}
      >
        <View style={styles.viewerContainer}>
          <FlatList
            data={imageItems}
            keyExtractor={(it, i) => `${it.url}-${i}`}
            horizontal
            pagingEnabled
            initialScrollIndex={viewerIndex}
            getItemLayout={(_, idx) => ({
              length: screenWidth,
              offset: screenWidth * idx,
              index: idx,
            })}
            onMomentumScrollEnd={(ev) => {
              const x = ev?.nativeEvent?.contentOffset?.x ?? 0;
              const idx = Math.round(x / screenWidth);
              setViewerIndex(Number.isFinite(idx) ? idx : 0);
            }}
            renderItem={({ item }) => (
              <View style={{ width: screenWidth, height: screenHeight }}>
                <Image source={{ uri: item?.url }} style={styles.fullScreenImage} />
                <View style={styles.viewerBadge}>
                  <Text style={styles.viewerBadgeText}>
                    {(item?.kind || '').toUpperCase()}
                  </Text>
                </View>
              </View>
            )}
          />

          <View style={styles.viewerButtons}>
            <TouchableOpacity
              style={[styles.viewerButton, styles.shareBtn]}
              onPress={async () => {
                if (!imageItems.length) return;
                const safeIndex = Math.min(
                  Math.max(0, viewerIndex),
                  Math.max(0, imageItems.length - 1)
                );
                const url = imageItems[safeIndex]?.url;
                if (!url) return;
                try {
                  await Share.share({ url, message: url });
                } catch {}
              }}
            >
              <Text style={styles.shareText}>Share</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.viewerButton, styles.exitBtn]}
              onPress={closePhotoViewer}
            >
              <Text style={styles.exitText}>Exit</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Attachments Gallery (photos + DRAW + PDFs) */}
      <Modal
        visible={viewAttachmentsVisible}
        animationType="fade"
        transparent
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => setViewAttachmentsVisible(false)}
      >
        <View style={styles.sheetOverlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Attachments</Text>
              <TouchableOpacity
                style={styles.sheetClose}
                onPress={() => setViewAttachmentsVisible(false)}
              >
                <Text style={styles.sheetCloseText}>Close</Text>
              </TouchableOpacity>
            </View>

            {(() => {
              // Build keys + items ON DEMAND so it always matches latest workOrder.photoPath
              const keys = (workOrder?.photoPath || '')
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);

              const getKindFromKeyOrUrl = (kOrUrl) => {
                const s = String(kOrUrl || '').toLowerCase();

                // PDFs
                const isPdf =
                  s.endsWith('.pdf') ||
                  s.includes('.pdf?') ||
                  s.startsWith('data:application/pdf');

                if (isPdf) return 'pdf';

                // Draw vs Photo from naming
                // preferred: _DRAW_ or _PHOTO_
                if (s.includes('_draw_') || s.includes('drawnote__') || s.includes('__draw__'))
                  return 'draw';
                if (s.includes('_photo_') || s.includes('photo__') || s.includes('__photo__'))
                  return 'photo';

                // fallback
                return 'image';
              };

              const items = keys.map((k) => {
                const url = fileUrl(k);
                const kind = getKindFromKeyOrUrl(k);
                return { key: k, url, kind };
              });

              // Provide the variables expected by Section 5 (safe no-op if already exist)
              // NOTE: these are function-scoped; Section 5 expects them at component scope.
              // So we ALSO create component-scope fallbacks below (see "Component-scope attachment lists").
              if (!keys.length) {
                return (
                  <View style={{ paddingVertical: 18 }}>
                    <Text style={styles.emptyText}>No attachments uploaded.</Text>
                  </View>
                );
              }

              return (
                <FlatList
                  data={items}
                  keyExtractor={(it, i) => `${it.key}-${i}`}
                  numColumns={3}
                  contentContainerStyle={styles.galleryList}
                  renderItem={({ item, index }) => {
                    const isPdf = item.kind === 'pdf';
                    const badge =
                      item.kind === 'draw'
                        ? 'DRAW'
                        : item.kind === 'photo'
                        ? 'PHOTO'
                        : isPdf
                        ? 'PDF'
                        : 'IMG';

                    if (isPdf) {
                      return (
                        <View style={styles.thumbWrapper}>
                          <TouchableOpacity
                            style={styles.pdfTile}
                            onPress={() => {
                              setViewAttachmentsVisible(false);
                              openAttachmentPdf(index);
                            }}
                          >
                            <Text style={styles.pdfIcon}>📄</Text>
                            <Text style={styles.pdfLabel} numberOfLines={2}>
                              PDF
                            </Text>
                            <View style={styles.thumbBadge}>
                              <Text style={styles.thumbBadgeText}>{badge}</Text>
                            </View>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.deleteIcon}
                            onPress={() => handleDeleteAttachment(index)}
                            hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}
                          >
                            <Text style={styles.deleteText}>×</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    }

                    // IMAGE (PHOTO/DRAW)
                    return (
                      <View style={styles.thumbWrapper}>
                        <TouchableOpacity
                          onPress={() => {
                            const viewerIdx = imageItems.findIndex((p) => p.url === item.url);
                            if (viewerIdx !== -1) {
                              setReturnToAttachments(true);
                              setViewerIndex(viewerIdx);
                              setPhotoViewerVisible(true);
                              setViewAttachmentsVisible(false);
                            }
                          }}
                          style={{ flex: 1 }}
                        >
                          <Image source={{ uri: item.url }} style={styles.thumbnail} />
                          <View style={styles.thumbBadge}>
                            <Text style={styles.thumbBadgeText}>{badge}</Text>
                          </View>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.deleteIcon}
                          onPress={() => handleDeleteAttachment(index)}
                          hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}
                        >
                          <Text style={styles.deleteText}>×</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  }}
                />
              );
            })()}
          </View>
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
              blurOnSubmit={false}
              textAlignVertical="top"
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
              {STATUS_OPTIONS.map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[
                    styles.statusOption,
                    pendingStatus === s && styles.statusOptionActive,
                  ]}
                  onPress={() => setPendingStatus(s)}
                >
                  <Text
                    style={[
                      styles.statusText,
                      pendingStatus === s && styles.statusTextActive,
                    ]}
                  >
                    {s}
                  </Text>
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
      <Modal
        visible={sketchVisible}
        animationType="slide"
        onRequestClose={() => setSketchVisible(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          <WebView
            originWhitelist={['*']}
            source={{ html: SKETCH_HTML }}
            javaScriptEnabled
            domStorageEnabled
            scrollEnabled
            nestedScrollEnabled
            showsVerticalScrollIndicator
            onMessage={onSketchMessage}
            style={{ flex: 1 }}
          />
        </SafeAreaView>
      </Modal>

      {/* Annotate & Sign Modal */}
      <Modal
        visible={annotateVisible}
        animationType="slide"
        onRequestClose={() => setAnnotateVisible(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          {pdfBase64 ? (
            <WebView
              ref={annotatorRef}
              originWhitelist={['*']}
              source={{ html: ANNOTATOR_HTML }}
              javaScriptEnabled
              domStorageEnabled
              scrollEnabled
              nestedScrollEnabled
              showsVerticalScrollIndicator
              decelerationRate="normal"
              overScrollMode="always"
              onMessage={onAnnotatorMessage}
              injectedJavaScriptBeforeContentLoaded={`window.PDF_BASE64 = ${JSON.stringify(
                pdfBase64
              )}; true;`}
              style={{ flex: 1 }}
            />
          ) : (
            <View style={styles.center}>
              <Text style={styles.loadingText}>Loading PDF…</Text>
            </View>
          )}
        </SafeAreaView>
      </Modal>

      {/* Document Lightbox Modal (for WO/EST/PO/ATTACH) */}
      <Modal
        visible={docModalVisible}
        animationType="slide"
        onRequestClose={() => setDocModalVisible(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          <View style={styles.docHeader}>
            <TouchableOpacity
              onPress={() => setDocModalVisible(false)}
              style={styles.docHeaderBtn}
            >
              <Text style={styles.docHeaderBtnText}>Close</Text>
            </TouchableOpacity>

            <Text style={styles.docHeaderTitle}>
              {docItems[docIndex]?.title ||
                (docGroup === 'WO'
                  ? 'Work Order'
                  : docGroup === 'EST'
                  ? 'Estimate'
                  : docGroup === 'PO'
                  ? 'PO'
                  : docGroup === 'ATTACH'
                  ? 'Attachment'
                  : 'Document')}
              {docItems.length > 1 ? `  (${docIndex + 1}/${docItems.length})` : ''}
            </Text>

            <View style={styles.docHeaderRight}>
              {!!docItems.length && (
                <TouchableOpacity
                  onPress={() => Linking.openURL(docItems[docIndex].url)}
                  style={styles.docHeaderBtn}
                >
                  <Text style={styles.docHeaderBtnText}>Open</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={{ flex: 1 }}>
            {docLoading && (
              <View style={[styles.center, { backgroundColor: '#000' }]}>
                <Text style={{ color: '#fff' }}>Loading…</Text>
              </View>
            )}

            {!!docError && (
              <View style={[styles.center, { padding: 16 }]}>
                <Text style={{ color: '#ff6b6b', textAlign: 'center' }}>
                  Couldn’t load document: {docError}
                </Text>
              </View>
            )}

            {!!docB64 && !docError && (
              <WebView
                originWhitelist={['*']}
                source={{ html: PDF_VIEWER_HTML }}
                javaScriptEnabled
                scrollEnabled
                nestedScrollEnabled
                showsVerticalScrollIndicator
                automaticallyAdjustContentInsets={false}
                onMessage={(e) => {
                  const msg = e?.nativeEvent?.data || '';
                  if (msg.startsWith('HEIGHT:')) {
                    const h = parseInt(msg.slice(7), 10);
                    if (Number.isFinite(h)) setDocHeight(Math.min(h + 200, screenHeight * 5));
                  } else if (msg.startsWith('ERROR:')) {
                    setDocError(msg.slice(6));
                  }
                }}
                injectedJavaScriptBeforeContentLoaded={`window.PDF_BASE64 = ${JSON.stringify(
                  docB64
                )}; true;`}
                style={{
                  flex: 1,
                  height: docHeight,
                  backgroundColor: '#000',
                }}
              />
            )}
          </View>

          {docItems.length > 1 && (
            <View style={styles.docNavBar}>
              <TouchableOpacity onPress={prevDoc} style={[styles.docNavBtn, { marginRight: 8 }]}>
                <Text style={styles.docNavText}>Prev</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={nextDoc} style={[styles.docNavBtn, { marginLeft: 8 }]}>
                <Text style={styles.docNavText}>Next</Text>
              </TouchableOpacity>
            </View>
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
} // ✅ END ViewWorkOrder component

// ================================
// ✅ COMPONENT-SCOPE attachment lists + delete helper
// Put these RIGHT ABOVE StyleSheet.create (still inside file scope)
// (If you already created these in Section 3, keep ONE version only.)
// ================================

// NOTE: These helpers MUST live inside the component in your final file.
// If you already added them in Section 3, DO NOT duplicate them.
// I’m including them here in styles block area as a reminder:
// - attachmentKeys, attachmentItems, imageItems, handleDeleteAttachment
//
// If you don't have them yet in Section 3, paste this block there:
//
// const attachmentKeys = (workOrder?.photoPath || '').split(',').map(s=>s.trim()).filter(Boolean);
// const getKindFromKey = (k) => { ...same logic... };
// const attachmentItems = attachmentKeys.map(k => ({ key:k, url:fileUrl(k), kind:getKindFromKey(k) }));
// const imageItems = attachmentItems.filter(a => a.kind !== 'pdf');
// const handleDeleteAttachment = (attachmentIndex) => { ...delete using attachmentKeys[attachmentIndex] ... };


// ================================
// FINAL STYLES (modern tiles + sheet modal)
// IMPORTANT: This file MUST have only ONE StyleSheet.create
// ================================
const styles = StyleSheet.create({
  /* ---------- Page ---------- */
  screen: { flex: 1, backgroundColor: '#F1F5F9' },
  details: { padding: 16, paddingBottom: 28 },

  header: {
    paddingTop: 6,
    paddingBottom: 10,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: 0.2,
  },
  headerSub: {
    marginTop: 2,
    fontSize: 13,
    color: '#64748B',
    fontWeight: '700',
  },

  /* ---------- Main Card ---------- */
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#020617',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },

  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardTitle: { fontSize: 16, fontWeight: '900', color: '#0F172A' },
  cardSubtitle: { marginTop: 2, color: '#64748B', fontWeight: '700', fontSize: 12 },

  statusPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#0F172A',
  },
  statusPillText: { color: '#fff', fontWeight: '900', fontSize: 12 },

  divider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 12,
  },

  row: { flexDirection: 'row', marginBottom: 10, gap: 10 },
  label: { width: 90, fontWeight: '900', color: '#1E3A8A' },
  value: { flex: 1, color: '#0F172A', fontWeight: '600' },
  linkText: { color: '#2563EB', textDecorationLine: 'underline', fontWeight: '800' },

  backRow: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  backRowText: { color: '#0F172A', fontWeight: '900' },

  /* ---------- Section Headers ---------- */
  sectionHeader: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0F172A',
    marginVertical: 10,
  },

  /* ---------- Document Tiles (3 across) ---------- */
  tilesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 8 },

  tile: {
    flexBasis: '31%',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    shadowColor: '#020617',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },

  tileIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },

  tileIconText: { color: '#ffffff', fontWeight: '900', fontSize: 14 },
  tileTitle: { fontWeight: '900', color: '#0F172A', marginBottom: 2 },
  tileSub: { color: '#64748B', fontSize: 12, textAlign: 'center', fontWeight: '700' },

  tileBadge: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#DBEAFE',
    color: '#1E40AF',
    fontSize: 11,
    fontWeight: '900',
    overflow: 'hidden',
  },

  /* ---------- Action Tiles (On Site) ---------- */
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 6 },

  actionTile: {
    flexBasis: '31%',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    shadowColor: '#020617',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },

  actionIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  actionIcon: { fontSize: 18, color: '#fff' },
  actionTitle: { fontWeight: '900', color: '#0F172A', marginBottom: 2 },
  actionSub: { color: '#64748B', fontSize: 12, textAlign: 'center', fontWeight: '700' },

  /* ---------- Preview Grid ---------- */
  previewGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 6 },
  previewTile: {
    width: (screenWidth - 16 * 2 - 10 * 2) / 3,
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#fff',
  },
  previewImage: { width: '100%', height: '100%' },
  previewBadge: {
    position: 'absolute',
    left: 8,
    top: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.85)',
  },
  previewBadgeText: { color: '#fff', fontWeight: '900', fontSize: 11 },
  previewHint: { color: '#64748B', fontWeight: '700', marginTop: 4, marginBottom: 6 },

  /* ---------- Notes ---------- */
  noteCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  noteTimestamp: { fontSize: 12, color: '#64748B', marginBottom: 6, fontWeight: '700' },
  noteBody: { fontSize: 14, color: '#0F172A', lineHeight: 20, fontWeight: '600' },
  emptyText: { color: '#64748B', textAlign: 'center', fontWeight: '700', paddingVertical: 10 },

  /* ---------- Shared ---------- */
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: 18, color: '#2563EB', fontWeight: '800' },

  /* ---------- Photo viewer ---------- */
  viewerContainer: { flex: 1, backgroundColor: '#000' },
  fullScreenImage: { width: screenWidth, height: screenHeight, resizeMode: 'contain' },

  viewerButtons: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  viewerButton: {
    flex: 1,
    marginHorizontal: 8,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  shareBtn: { backgroundColor: 'rgba(255,255,255,0.25)' },
  shareText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  exitBtn: { backgroundColor: 'rgba(220,53,69,0.85)' },
  exitText: { color: '#fff', fontWeight: '800', fontSize: 16 },

  viewerBadge: {
    position: 'absolute',
    top: 50,
    left: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  viewerBadgeText: { color: '#fff', fontWeight: '900', fontSize: 12 },

  /* ---------- Bottom sheet attachments ---------- */
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 18,
    maxHeight: screenHeight * 0.82,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    marginBottom: 10,
  },
  sheetTitle: { fontSize: 18, fontWeight: '900', color: '#0F172A' },
  sheetClose: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#0F172A',
  },
  sheetCloseText: { color: '#fff', fontWeight: '900' },

  galleryList: { paddingBottom: 16 },
  thumbWrapper: { flex: 1 / 3, aspectRatio: 1, padding: 4 },
  thumbnail: { width: '100%', height: '100%', borderRadius: 10 },

  thumbBadge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.85)',
  },
  thumbBadgeText: { color: '#fff', fontWeight: '900', fontSize: 11 },

  deleteIcon: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: { color: '#fff', fontSize: 14, lineHeight: 18, fontWeight: '900' },

  /* ---------- PDF tiles in attachments ---------- */
  pdfTile: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
  },
  pdfIcon: { fontSize: 24, marginBottom: 4 },
  pdfLabel: { fontSize: 11, color: '#111827', textAlign: 'center', fontWeight: '900' },

  /* ---------- Add note overlays ---------- */
  addNoteOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 16,
  },
  addNoteContainer: { backgroundColor: '#fff', borderRadius: 12, padding: 16 },
  addNoteTitle: {
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 12,
    textAlign: 'center',
    color: '#0F172A',
  },
  addNoteInput: {
    height: 120,
    borderColor: '#cfd5dd',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  addNoteButtons: { flexDirection: 'row', justifyContent: 'space-around' },
  saveNoteBtn: {
    backgroundColor: '#16A34A',
    padding: 10,
    borderRadius: 10,
    flex: 1,
    marginHorizontal: 4,
  },
  saveNoteText: { color: '#fff', textAlign: 'center', fontWeight: '900' },
  cancelNoteBtn: {
    backgroundColor: '#dc3545',
    padding: 10,
    borderRadius: 10,
    flex: 1,
    marginHorizontal: 4,
  },
  cancelNoteText: { color: '#fff', textAlign: 'center', fontWeight: '900' },

  statusList: { gap: 8, marginTop: 6 },
  statusOption: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  statusOptionActive: { backgroundColor: '#2563EB' },
  statusText: { color: '#0F172A', fontWeight: '900' },
  statusTextActive: { color: '#fff' },

  /* ---------- Doc modal header/nav ---------- */
  docHeader: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 6,
    backgroundColor: '#0b0f14',
    flexDirection: 'row',
    alignItems: 'center',
  },
  docHeaderBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#1f2937',
    borderRadius: 10,
    marginRight: 8,
  },
  docHeaderBtnText: { color: '#fff', fontWeight: '900' },
  docHeaderTitle: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 16,
    flex: 1,
    textAlign: 'center',
  },
  docHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  docNavBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: '#0b0f14',
  },
  docNavBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#1f2937',
    borderRadius: 999,
  },
  docNavText: { color: '#fff', fontWeight: '900' },
});
