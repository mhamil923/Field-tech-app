// File: app/screens/ViewWorkOrder.js
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
  KeyboardAvoidingView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import moment from 'moment';
import { useLocalSearchParams } from 'expo-router';
import { useNavigation } from '@react-navigation/native';

import api, { fileUrl } from '../../constants/api';
import MultiPhotoCamera from '../components/MultiPhotoCamera';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

/** ─────────────────────────────────────────────────────────────
 * Statuses (keep in sync with web/server)
 * ───────────────────────────────────────────────────────────── */
const STATUS_OPTIONS = [
  'New',
  'Scheduled',
  'Needs to be Quoted',
  'Waiting for Approval',
  'Declined',
  'Approved',
  'Waiting on Parts',
  'Needs to be Scheduled',
  'Needs to be Invoiced',
  'Invoiced Waiting for Payment',
  'Completed',
];

/* ---------- auth header (kept harmless; axios instance may already attach) ---------- */
const authHeaders = () => {
  try {
    const token =
      typeof localStorage !== 'undefined' ? localStorage.getItem('jwt') : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
};

/* --------------------------------------------------------------------------
 * Attachment filename conventions
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

const buildAttachmentName = ({
  workOrderNumberOrId,
  type,
  dateObj,
  ext = 'jpg',
}) => {
  const wo = safeSlug(workOrderNumberOrId || 'WO');
  const date = dateStamp(dateObj || new Date());
  const e = String(ext || 'jpg').toLowerCase().replace('.', '') || 'jpg';
  if (String(type || 'PHOTO').toUpperCase() === 'DRAW') {
    return `DrawNote-${wo}-${date}-${Date.now()}.${e}`;
  }
  return `Photo-${wo}-${date}-${Date.now()}.${e}`;
};

const detectKindFromKeyOrUrl = (keyOrUrl) => {
  const s = String(keyOrUrl || '').toLowerCase();

  // PDF?
  const isPdf =
    s.endsWith('.pdf') || s.includes('.pdf?') || s.startsWith('data:application/pdf');
  if (isPdf) return 'pdf';

  // Draw vs Photo (new + legacy)
  if (s.includes('__draw__') || s.includes('drawnote__') || s.includes('_draw_')) return 'draw';
  if (s.includes('__photo__') || s.includes('photo__') || s.includes('_photo_')) return 'photo';

  return 'image';
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

// Residential contract in-field signing surface: full legal name + signature pad.
// Posts 'CONTRACT_SIGN:' + JSON.stringify({ name, sig }) where sig is a PNG data URL.
const CONTRACT_SIGN_HTML = `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>Sign Contract</title>
<style>
  html,body { margin:0; padding:0; background:#f3f4f6; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; }
  .wrap { padding:16px; }
  h2 { color:#1b5e20; margin:6px 0 2px; font-size:18px; }
  .sub { color:#555; font-size:13px; margin:0 0 12px; }
  label { display:block; font-weight:600; font-size:13px; margin:14px 0 4px; }
  input[type=text] { width:100%; box-sizing:border-box; padding:12px; font-size:16px; border:1px solid #ccc; border-radius:8px; }
  #pad { width:100%; height:200px; background:#fff; border:2px dashed #b0b0b0; border-radius:10px; touch-action:none; }
  .row { display:flex; gap:8px; margin-top:14px; }
  button { flex:1; padding:14px; font-size:16px; font-weight:700; border:0; border-radius:10px; }
  #clear { background:#eee; color:#333; flex:0 0 90px; }
  #cancel { background:#9ca3af; color:#fff; }
  #save { background:#1b5e20; color:#fff; }
  button:disabled { opacity:.5; }
</style>
</head>
<body>
  <div class="wrap">
    <h2>Sign Residential Contract</h2>
    <p class="sub">Customer signs below to accept the agreement and terms (incl. cancellation policy).</p>
    <label>Full legal name</label>
    <input id="name" type="text" placeholder="Type full legal name" autocomplete="name" />
    <label>Signature</label>
    <canvas id="pad"></canvas>
    <div class="row"><button id="clear">Clear</button></div>
    <div class="row">
      <button id="cancel">Cancel</button>
      <button id="save">Sign &amp; Submit</button>
    </div>
  </div>
  <script>
    var c=document.getElementById('pad'), ctx=c.getContext('2d'), drawing=false, last=null, dirty=false;
    function size(){ c.width=c.offsetWidth*2; c.height=c.offsetHeight*2; }
    size();
    function pt(e){ var r=c.getBoundingClientRect(); var t=e.touches?e.touches[0]:e; return {x:(t.clientX-r.left)*(c.width/r.width), y:(t.clientY-r.top)*(c.height/r.height)}; }
    function down(e){ e.preventDefault(); drawing=true; last=pt(e); }
    function move(e){ if(!drawing)return; e.preventDefault(); var p=pt(e); ctx.strokeStyle='#111'; ctx.lineWidth=3; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; dirty=true; }
    function up(e){ drawing=false; }
    c.addEventListener('mousedown',down); c.addEventListener('mousemove',move); window.addEventListener('mouseup',up);
    c.addEventListener('touchstart',down,{passive:false}); c.addEventListener('touchmove',move,{passive:false}); c.addEventListener('touchend',up);
    document.getElementById('clear').addEventListener('click',function(){ ctx.clearRect(0,0,c.width,c.height); dirty=false; });
    document.getElementById('cancel').addEventListener('click',function(){ window.ReactNativeWebView && window.ReactNativeWebView.postMessage('CLOSE'); });
    document.getElementById('save').addEventListener('click',function(){
      var name=(document.getElementById('name').value||'').trim();
      if(!name){ alert('Please enter the full legal name.'); return; }
      if(!dirty){ alert('Please sign in the box.'); return; }
      var sig=c.toDataURL('image/png');
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage('CONTRACT_SIGN:'+JSON.stringify({name:name, sig:sig}));
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

  // Residential contract in-field signing
  const [contractSignVisible, setContractSignVisible] = useState(false);
  const [contractSigning, setContractSigning] = useState(false);

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
  const [showMultiCamera, setShowMultiCamera] = useState(false);

  // Close camera modal if workOrderId changes (prevents uploading to wrong WO)
  useEffect(() => {
    setShowMultiCamera(false);
  }, [workOrderId]);

  // Session tracking for status reminder
  const [hasAddedContentThisSession, setHasAddedContentThisSession] = useState(false);
  const [hasUpdatedStatusThisSession, setHasUpdatedStatusThisSession] = useState(false);

  // Ref to store pending navigation action when intercepted by beforeRemove
  const pendingNavAction = useRef(null);

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

  // ✅ Visit date + ID used for filename builders
  const getVisitDateForFilename = useCallback(() => {
    const raw = workOrder?.scheduledDate || null;
    if (raw && moment(raw).isValid()) return moment(raw).toDate();
    return new Date();
  }, [workOrder?.scheduledDate]);

  const getIdForFilename = useCallback(() => {
    const wo = String(workOrder?.workOrderNumber || '').trim();
    const po = String(workOrder?.poNumber || '').trim();
    if (wo) return safeSlug(wo);
    if (po) return safeSlug(po);
    return safeSlug(workOrderId);
  }, [workOrder?.workOrderNumber, workOrder?.poNumber, workOrderId]);

  // Fetch work order
  const fetchWorkOrder = useCallback(async () => {
    if (!workOrderId) return;

    try {
      const { data } = await api.get(`/work-orders/${workOrderId}`, { headers: authHeaders() });
      setWorkOrder(data);

      // Notes (supports array or legacy TEXT)
      const parsed = parseNotesArrayOrText(data?.notes);
      setNotes(sortNotesDesc(parsed));
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.error || 'Failed to load work order.');
    }
  }, [workOrderId]);

  useEffect(() => {
    fetchWorkOrder();
  }, [fetchWorkOrder]);

  // Intercept ALL navigation away (back button, navbar taps, etc.)
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      // No unsaved content or status already updated — allow navigation
      if (!hasAddedContentThisSession || hasUpdatedStatusThisSession) return;

      // Prevent the default navigation
      e.preventDefault();

      // Store the action so we can dispatch it later
      pendingNavAction.current = e.data.action;

      Alert.alert(
        'Update Status?',
        "You added notes or photos but haven't updated the work order status. Would you like to update it before leaving?",
        [
          {
            text: 'Update Status',
            onPress: () => openStatusModal(),
          },
          {
            text: 'Go Back Anyway',
            style: 'destructive',
            onPress: () => {
              pendingNavAction.current = null;
              navigation.dispatch(e.data.action);
            },
          },
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => {
              pendingNavAction.current = null;
            },
          },
        ],
        { cancelable: true }
      );
    });

    return unsubscribe;
  }, [navigation, hasAddedContentThisSession, hasUpdatedStatusThisSession]);

  // Work Order main PDF
  const woPdfUrl = workOrder?.pdfPath ? fileUrl(workOrder.pdfPath) : null;

  // Estimates
  const estimateUrls = useMemo(
    () => [
      ...toUrlArray(workOrder?.estimatePdfPaths),
      ...toUrlArray(workOrder?.estimatePaths),
      ...toUrlArray(workOrder?.estimatesPdf),
      ...toUrlArray(workOrder?.estimatePdfPath),
    ],
    [
      workOrder?.estimatePdfPaths,
      workOrder?.estimatePaths,
      workOrder?.estimatesPdf,
      workOrder?.estimatePdfPath,
    ]
  );

  // Purchase Orders
  const poUrls = useMemo(
    () => [
      ...toUrlArray(workOrder?.poPdfPaths),
      ...toUrlArray(workOrder?.poPaths),
      ...toUrlArray(workOrder?.poPdfPath),
    ],
    [workOrder?.poPdfPaths, workOrder?.poPaths, workOrder?.poPdfPath]
  );

  // ✅ Component-scope attachment lists derived from workOrder.photoPath (no duplicate state)
  const attachmentKeys = useMemo(() => {
    const raw = workOrder?.photoPath || '';
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }, [workOrder?.photoPath]);

  const attachmentItems = useMemo(
    () =>
      attachmentKeys.map((k) => ({
        key: k,
        url: fileUrl(k),
        kind: detectKindFromKeyOrUrl(k), // 'pdf' | 'draw' | 'photo' | 'image'
      })),
    [attachmentKeys]
  );

  const imageItems = useMemo(
    () => attachmentItems.filter((a) => a.kind !== 'pdf'),
    [attachmentItems]
  );

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
    setHasAddedContentThisSession(true);
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

  /**
   * ✅ Correct delete (index MUST match backend photoPath order)
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

  /**
   * Upload ONE camera photo immediately
   */
  const uploadCameraPhotoNow = async (uri) => {
    if (!workOrderId) return;

    const form = new FormData();
    const processedUri = await processImageForUpload(uri);

    const name = buildAttachmentName({
      workOrderNumberOrId: getIdForFilename(),
      type: 'PHOTO',
      dateObj: getVisitDateForFilename(),
      ext: 'jpg',
    });

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
   * Handle multi-photo upload from MultiPhotoCamera component
   */
  const handleMultiPhotoUpload = async (photos) => {
    if (!workOrderId || !photos?.length) return;

    // Capture the work order ID at upload time to prevent stale references
    const woId = workOrderId;

    setIsCameraUploading(true);

    try {
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const form = new FormData();
        const processedUri = await processImageForUpload(photo.uri);

        // Use buildAttachmentName for unique filenames per work order
        // (prevents filename collisions when uploading to multiple WOs same day)
        const name = buildAttachmentName({
          workOrderNumberOrId: getIdForFilename(),
          type: 'PHOTO',
          dateObj: getVisitDateForFilename(),
          ext: 'jpg',
        });

        form.append('photoFile', {
          uri: processedUri,
          name,
          type: 'image/jpeg',
        });

        console.log('[Photo] Uploading to WO ID:', woId, 'filename:', name);
        await api.put(`/work-orders/${woId}/edit`, form, {
          headers: {
            'Content-Type': 'multipart/form-data',
            ...authHeaders(),
          },
        });
      }

      await fetchWorkOrder();
      setHasAddedContentThisSession(true);
      Alert.alert('Success', `${photos.length} photo${photos.length !== 1 ? 's' : ''} uploaded successfully!`);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to upload photos.';
      Alert.alert('Upload Error', msg);
      throw err; // Re-throw so MultiPhotoCamera knows upload failed
    } finally {
      setIsCameraUploading(false);
    }
  };

  /**
   * CAMERA FLOW (multi-shot) - Legacy, kept for fallback
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
        setHasAddedContentThisSession(true);
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

      const name = buildAttachmentName({
        workOrderNumberOrId: getIdForFilename(),
        type: 'PHOTO',
        dateObj: getVisitDateForFilename(),
        ext: 'jpg',
      });

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
      setHasAddedContentThisSession(true);
      Alert.alert('Success', 'Photos uploaded!');
    } catch (err) {
      Alert.alert('Upload Error', err?.response?.data?.error || err?.message || 'Upload failed.');
    }
  };

  /**
   * Share currently viewed image (viewerIndex)
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
   * Residential contract in-field signing (from CONTRACT_SIGN_HTML)
   */
  const onContractSignMessage = async (ev) => {
    const msg = ev?.nativeEvent?.data || '';
    if (typeof msg !== 'string') return;
    if (msg === 'CLOSE') { setContractSignVisible(false); return; }
    if (msg.startsWith('CONTRACT_SIGN:')) {
      let payload;
      try { payload = JSON.parse(msg.slice('CONTRACT_SIGN:'.length)); }
      catch { Alert.alert('Error', 'Could not read the signature.'); return; }
      const signerName = (payload?.name || '').trim();
      const signatureData = payload?.sig || '';
      if (!signerName || !signatureData) { Alert.alert('Missing info', 'Name and signature are required.'); return; }
      setContractSigning(true);
      try {
        await api.post(
          `/work-orders/${workOrderId}/residential-contract/sign-infield`,
          { signerName, signatureData },
          { headers: authHeaders() }
        );
        setContractSignVisible(false);
        await fetchWorkOrder();
        Alert.alert('Signed', 'The residential contract has been signed.');
      } catch (e) {
        Alert.alert('Error', e?.response?.data?.error || e?.message || 'Failed to sign contract.');
      } finally {
        setContractSigning(false);
      }
    }
  };

  /**
   * Draw Note upload (from SKETCH_HTML)
   * ✅ ALWAYS saved as DRAW
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
          name: buildAttachmentName({
            workOrderNumberOrId: getIdForFilename(),
            type: 'DRAW',
            dateObj: getVisitDateForFilename(),
            ext: 'jpg',
          }),
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
        setHasAddedContentThisSession(true);
        Alert.alert('Uploaded', 'Drawing note uploaded.');
      } catch (e) {
        Alert.alert('Upload Error', e?.message || 'Failed to upload drawing note.');
      }
    }
  };

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
      setHasUpdatedStatusThisSession(true);

      // If status was updated from the navigation prompt, complete the pending navigation
      if (pendingNavAction.current) {
        const action = pendingNavAction.current;
        pendingNavAction.current = null;
        navigation.dispatch(action);
      }
    } catch (e) {
      setWorkOrder((w) => (w ? { ...w, status: prev } : w));
      Alert.alert('Error', e?.response?.data?.error || e?.message || 'Failed to update status.');
    } finally {
      setIsStatusSaving(false);
    }
  };

  // Back navigation — beforeRemove listener handles the status reminder prompt
  // -------------------------

  // Open a PDF attachment using the multi-page viewer (by attachment index)
  const openAttachmentPdf = (attachmentIndex) => {
    const item = attachmentItems?.[attachmentIndex];
    if (!item || item.kind !== 'pdf') {
      Alert.alert('No PDF', 'That attachment is not a PDF.');
      return;
    }

    const pdfItems = attachmentItems.filter((a) => a.kind === 'pdf');
    const start = Math.max(0, pdfItems.findIndex((p) => p.url === item.url));

    setDocGroup('ATTACH');
    setDocItems(pdfItems.map((p, i) => ({ title: `Attachment PDF ${i + 1}`, url: p.url })));

    setDocIndex(start);
    setDocModalVisible(true);
    loadDocIntoModal(pdfItems[start].url);
  };

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

  // If still loading
  if (!workOrder) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.details} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Work Order</Text>
          <Text style={styles.headerSub}>
            {workOrderNumber !== '—' ? `WO ${workOrderNumber}` : `ID ${workOrderId}`}
          </Text>
        </View>

        {/* Work Order Details */}
        <View style={styles.card}>
          <View style={styles.detailsHeaderRow}>
            <Text style={styles.cardTitle}>Details</Text>
            <Text style={styles.detailsHeaderMeta}>Created: {createdDateDisplay}</Text>
          </View>

          <View style={styles.cardTopRow}>
            <View style={{ flex: 1 }}>
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

          {/* Side-by-side detail grid */}
          <View style={[styles.detailsGrid, { marginTop: 12 }]}>
            {/* Row 1 */}
            <View style={styles.detailCell}>
              <Text style={styles.detailLabel}>WO #</Text>
              <Text style={styles.detailValue}>{workOrderNumber}</Text>
            </View>
            <View style={styles.detailCell}>
              <Text style={styles.detailLabel}>WO/PO #</Text>
              <Text style={styles.detailValue}>{poNumber}</Text>
            </View>

            {/* Row 2 */}
            <View style={styles.detailCell}>
              <Text style={styles.detailLabel}>Customer</Text>
              <Text style={styles.detailValue}>{customer}</Text>
            </View>
            <View style={styles.detailCell}>
              <Text style={styles.detailLabel}>Scheduled</Text>
              <Text style={styles.detailValue}>{scheduled}</Text>
            </View>

            {/* Row 3 */}
            <View style={styles.detailCell}>
              <Text style={styles.detailLabel}>Phone</Text>
              {customerPhone ? (
                <TouchableOpacity onPress={() => callNumber(customerPhone)}>
                  <Text style={[styles.detailValue, styles.linkText]}>{customerPhone}</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.detailValue}>—</Text>
              )}
            </View>
            <View style={styles.detailCell}>
              <Text style={styles.detailLabel}>Email</Text>
              {customerEmail ? (
                <TouchableOpacity onPress={() => emailTo(customerEmail)}>
                  <Text style={[styles.detailValue, styles.linkText]}>{customerEmail}</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.detailValue}>—</Text>
              )}
            </View>

            {/* Full-width rows */}
            <View style={[styles.detailCell, styles.detailCellFull]}>
              <Text style={styles.detailLabel}>Site Address</Text>
              {siteAddress ? (
                <TouchableOpacity onPress={() => openMap(siteAddress)} style={{ flex: 1 }}>
                  <Text style={[styles.detailValue, styles.linkText]}>{siteAddress}</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.detailValue}>—</Text>
              )}
            </View>

            {!!billingAddress && (
              <View style={[styles.detailCell, styles.detailCellFull]}>
                <Text style={styles.detailLabel}>Billing</Text>
                <Text style={styles.detailValue}>{billingAddress}</Text>
              </View>
            )}

            {Array.isArray(workOrder?.techNames) && workOrder.techNames.length > 0 && (
              <View style={[styles.detailCell, styles.detailCellFull]}>
                <Text style={styles.detailLabel}>Crew</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {workOrder.techNames.map((name, i) => (
                    <View
                      key={`${name}-${i}`}
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 999,
                        backgroundColor: '#1d4ed8',
                      }}
                    >
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{name}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            <View style={[styles.detailCell, styles.detailCellFull]}>
              <Text style={styles.detailLabel}>Problem</Text>
              <Text style={styles.detailValue}>{problem}</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.backRow} onPress={() => navigation.goBack()}>
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
              {poUrls.length ? `${poUrls.length} file${poUrls.length > 1 ? 's' : ''}` : 'None'}
            </Text>
            {!!poUrls.length && <Text style={styles.tileBadge}>PDF</Text>}
          </TouchableOpacity>

          {/* Residential Contract (Phase 3) — only on residential WOs */}
          {workOrder?.residentialContract && (() => {
            const rc = workOrder.residentialContract;
            const signed = rc.status === 'Signed';
            const viewPath = rc.signedPdfPath || rc.generatedPdfPath;
            return (
              <TouchableOpacity
                style={styles.tile}
                onPress={() => {
                  if (signed) {
                    if (viewPath) Linking.openURL(fileUrl(viewPath));
                    else Alert.alert('Signed', `Signed by ${rc.signerName || 'customer'}.`);
                  } else {
                    setContractSignVisible(true);
                  }
                }}
              >
                <View style={styles.tileIconCircle}>
                  <Text style={styles.tileIconText}>RC</Text>
                </View>
                <Text style={styles.tileTitle}>Residential Contract</Text>
                <Text style={styles.tileSub}>
                  {signed
                    ? `Signed${rc.signerName ? ' · ' + rc.signerName : ''}`
                    : (rc.status === 'Sent' ? 'Sent · tap to sign' : 'Tap to sign')}
                </Text>
                <Text
                  style={[
                    styles.tileBadge,
                    {
                      backgroundColor: signed ? '#16a34a' : (rc.status === 'Sent' ? '#2563EB' : '#6b7280'),
                      color: '#fff',
                    },
                  ]}
                >
                  {rc.status || 'Draft'}
                </Text>
              </TouchableOpacity>
            );
          })()}
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
            onPress={() => setShowMultiCamera(true)}
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

        {/* Notes (bottom only) */}
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

      {/* Photo Viewer */}
      <Modal visible={photoViewerVisible} animationType="fade" onRequestClose={closePhotoViewer}>
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
                  <Text style={styles.viewerBadgeText}>{(item?.kind || '').toUpperCase()}</Text>
                </View>
              </View>
            )}
          />

          <View style={styles.viewerButtons}>
            <TouchableOpacity style={[styles.viewerButton, styles.shareBtn]} onPress={handleShare}>
              <Text style={styles.shareText}>Share</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.viewerButton, styles.exitBtn]} onPress={closePhotoViewer}>
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
              <TouchableOpacity style={styles.sheetClose} onPress={() => setViewAttachmentsVisible(false)}>
                <Text style={styles.sheetCloseText}>Close</Text>
              </TouchableOpacity>
            </View>

            {!attachmentItems.length ? (
              <View style={{ paddingVertical: 18 }}>
                <Text style={styles.emptyText}>No attachments uploaded.</Text>
              </View>
            ) : (
              <FlatList
                data={attachmentItems}
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
            )}
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
              <TouchableOpacity style={styles.cancelNoteBtn} onPress={() => setShowAddNoteModal(false)}>
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
                  style={[styles.statusOption, pendingStatus === s && styles.statusOptionActive]}
                  onPress={() => setPendingStatus(s)}
                >
                  <Text style={[styles.statusText, pendingStatus === s && styles.statusTextActive]}>
                    {s}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.addNoteButtons}>
              <TouchableOpacity style={styles.saveNoteBtn} onPress={applyStatus}>
                <Text style={styles.saveNoteText}>Apply</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelNoteBtn} onPress={() => setShowStatusModal(false)}>
                <Text style={styles.cancelNoteText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Draw Note Modal (JPEG export) */}
      <Modal visible={sketchVisible} animationType="slide" onRequestClose={() => setSketchVisible(false)}>
        <View style={{ flex: 1, backgroundColor: '#000', paddingTop: Platform.OS === 'ios' ? 54 : 10 }}>
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
        </View>
      </Modal>

      {/* Annotate & Sign Modal */}
      <Modal visible={annotateVisible} animationType="slide" onRequestClose={() => setAnnotateVisible(false)}>
        <View style={{ flex: 1, backgroundColor: '#000', paddingTop: Platform.OS === 'ios' ? 54 : 10 }}>
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
              injectedJavaScriptBeforeContentLoaded={`window.PDF_BASE64 = ${JSON.stringify(pdfBase64)}; true;`}
              style={{ flex: 1 }}
            />
          ) : (
            <View style={styles.center}>
              <Text style={styles.loadingText}>Loading PDF…</Text>
            </View>
          )}
        </View>
      </Modal>

      {/* Residential Contract — In-Field Sign Modal */}
      <Modal visible={contractSignVisible} animationType="slide" onRequestClose={() => setContractSignVisible(false)}>
        <View style={{ flex: 1, backgroundColor: '#f3f4f6', paddingTop: Platform.OS === 'ios' ? 54 : 10 }}>
          {workOrder?.residentialContract?.generatedPdfPath ? (
            <TouchableOpacity
              onPress={() => Linking.openURL(fileUrl(workOrder.residentialContract.generatedPdfPath))}
              style={{ padding: 12, backgroundColor: '#111827' }}
            >
              <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '700' }}>📄 View Contract PDF</Text>
            </TouchableOpacity>
          ) : null}
          <WebView
            originWhitelist={['*']}
            source={{ html: CONTRACT_SIGN_HTML }}
            javaScriptEnabled
            domStorageEnabled
            keyboardDisplayRequiresUserAction={false}
            onMessage={onContractSignMessage}
            style={{ flex: 1 }}
          />
          {contractSigning ? (
            <View style={{ padding: 12, backgroundColor: '#111827' }}>
              <Text style={{ color: '#fff', textAlign: 'center' }}>Submitting…</Text>
            </View>
          ) : null}
        </View>
      </Modal>

      {/* Document Lightbox Modal (for WO/EST/PO/ATTACH) */}
      <Modal visible={docModalVisible} animationType="slide" onRequestClose={() => setDocModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: '#000', paddingTop: Platform.OS === 'ios' ? 54 : 10 }}>
          <View style={styles.docHeader}>
            <TouchableOpacity onPress={() => setDocModalVisible(false)} style={styles.docHeaderBtn}>
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
                injectedJavaScriptBeforeContentLoaded={`window.PDF_BASE64 = ${JSON.stringify(docB64)}; true;`}
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
        </View>
      </Modal>

      {/* Multi-Photo Camera */}
      <MultiPhotoCamera
        visible={showMultiCamera}
        onClose={() => setShowMultiCamera(false)}
        onUpload={handleMultiPhotoUpload}
        workOrderId={workOrderId}
      />
    </View>
  );
}

/* ================================
 * FINAL STYLES (single StyleSheet.create)
 * ================================ */
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
    color: '#0f172a',
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

  detailsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'flex-start',
    gap: 10,
  },

  detailsHeaderMeta: {
    fontSize: 12,
    color: '#0f172a',
    fontWeight: '800',
  },

  cardTitle: { fontSize: 16, fontWeight: '900', color: '#0F172A' },
  cardSubtitle: { marginTop: 2, color: '#0f172a', fontWeight: '700', fontSize: 16 },

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

  linkText: { color: '#2563EB', textDecorationLine: 'underline', fontWeight: '800' },

  /* ---------- Side-by-side details grid ---------- */
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  detailCell: {
    width: '48%',
    padding: 12,
  },
  detailCellFull: {
    width: '100%',
  },
  detailLabel: {
    fontSize: 12,
    color: '#1E3A8A',
    fontWeight: '900',
    marginBottom: 6,
  },
  detailValue: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 14,
    lineHeight: 19,
  },

  backRow: {
    marginTop: 14,
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
  tileSub: { color: '#0f172a', fontSize: 12, textAlign: 'center', fontWeight: '700' },

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
  actionSub: { color: '#0f172a', fontSize: 12, textAlign: 'center', fontWeight: '700' },

  /* ---------- Notes ---------- */
  noteCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  noteTimestamp: { fontSize: 12, color: '#0f172a', marginBottom: 6, fontWeight: '700' },
  noteBody: { fontSize: 14, color: '#0F172A', lineHeight: 20, fontWeight: '600' },
  emptyText: { color: '#0f172a', textAlign: 'center', fontWeight: '700', paddingVertical: 10 },

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
