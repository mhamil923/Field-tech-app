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
 * Read-only multi-page PDF viewer using pdf.js (for lightbox)
 */
const PDF_VIEWER_HTML = `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>PDF Preview</title>
<style>
  html,body { margin:0; padding:0; background:#111; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; height:100%; overflow-y:auto; -webkit-overflow-scrolling: touch; }
  #pages { padding: 8px; }
  .pageWrap { margin: 0 auto 12px; max-width: 1100px; }
  canvas.page { width:100%; height:auto; display:block; background:#fafafa; box-shadow: 0 1px 2px rgba(0,0,0,.35); border-radius: 6px; }
</style>
</head>
<body>
  <div id="pages"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <script>
    if (window['pdfjsLib']) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
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
 * — scrollable by default; overlay disabled until Draw Mode is enabled
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
  canvas.overlay { position:absolute; left:0; top:0; pointer-events:none; } /* start disabled so scrolling works */
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
    function pushUndo(p){try{const snap=p.overlayCtx.getImageData(0,0,p.overlayCanvas.width,p.overlayCanvas.height);p.strokes.push(snap);if(p.strokes.length>60)p.strokes.shift();}catch(e){}}
    function undo(p){if(p.strokes.length)p.overlayCtx.putImageData(p.strokes.pop(),0,0);}
    function clearPage(p){pushUndo(p);p.overlayCtx.clearRect(0,0,p.overlayCanvas.width,p.overlayCanvas.height);}
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
          const pState={pageCanvas,overlayCanvas:overlay,overlayCtx:octx,strokes:[]}; state.pages.push(pState);
          let drawing=false,last=null;
          function getPos(ev){
            const t=(ev.touches?ev.touches[0]:ev);
            const r=overlay.getBoundingClientRect();
            const x=(t.clientX-r.left)*(overlay.width/r.width);
            const y=(t.clientY-r.top)*(overlay.height/r.height);
            const p = (t.force && !isNaN(t.force)) ? t.force : (t.pressure && !isNaN(t.pressure) ? t.pressure : 0.5);
            return {x,y,p,ts:performance.now()};
          }
          function start(ev){ if(!state.drawEnabled) return; ev.preventDefault(); pushUndo(pState); drawing=true; last=getPos(ev); }
          function move(ev){
            if(!state.drawEnabled||!drawing) return; ev.preventDefault();
            const pt=getPos(ev); const a=last||pt, b=pt;
            const w=widthFor(a,b); const erase = (state.tool==='erase');
            octx.save(); octx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
            octx.lineWidth = erase ? Math.max(10, w*10) : w; octx.beginPath(); octx.moveTo(a.x, a.y); octx.lineTo(b.x, b.y); octx.stroke(); octx.restore(); last=pt;
          }
          function end(){ drawing=false; }
          overlay.addEventListener('touchstart',start,{passive:false});
          overlay.addEventListener('touchmove', move ,{passive:false});
          overlay.addEventListener('touchend',  end  ,{passive:false});
          overlay.addEventListener('mousedown',start);
          overlay.addEventListener('mousemove',move);
          window.addEventListener('mouseup',end);
        }
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
      const pageCanvas=document.createElement('canvas'); pageCanvas.className='page'; pageCanvas.width=W; pageCanvas.height=H; wrap.appendChild(pageCanvas);
      const overlay=document.createElement('canvas'); overlay.className='overlay'; overlay.width=W; overlay.height=H; overlay.style.width=pageCanvas.style.width='100%'; overlay.style.height=pageCanvas.style.height='auto'; wrap.appendChild(overlay);
      container.appendChild(wrap);
      const bctx=pageCanvas.getContext('2d'); bctx.fillStyle='#FFFFFF'; bctx.fillRect(0,0,W,H);
      const octx=overlay.getContext('2d'); octx.lineCap='round'; octx.lineJoin='round'; octx.strokeStyle='#000';
      state.page={pageCanvas,overlayCanvas:overlay,overlayCtx:octx,strokes:[]};
      overlay.addEventListener('mousedown',start); overlay.addEventListener('mousemove',move); window.addEventListener('mouseup',end);
      overlay.addEventListener('touchstart',start,{passive:false}); overlay.addEventListener('touchmove',move,{passive:false}); overlay.addEventListener('touchend',end,{passive:false});
      function start(ev){ ev.preventDefault(); state.drawing=true; state.last=getPos(ev); pushUndo(); }
      function move(ev){ if(!state.drawing) return; ev.preventDefault(); const pt=getPos(ev); draw(state.last, pt); state.last=pt; }
      function end(){ state.drawing=false; }
      function getPos(ev){ const t=(ev.touches?ev.touches[0]:ev); const r=overlay.getBoundingClientRect(); return {x:(t.clientX-r.left)*(overlay.width/r.width), y:(t.clientY-r.top)*(overlay.height/r.height)}; }
      function draw(a,b){ const w=2.2; const erase=(state.tool==='erase'); octx.save(); octx.globalCompositeOperation=erase?'destination-out':'source-over'; octx.lineWidth=erase?16:w; octx.beginPath(); octx.moveTo(a.x,a.y); octx.lineTo(b.x,b.y); octx.stroke(); octx.restore(); }
      function pushUndo(){ try{ const snap=octx.getImageData(0,0,overlay.width,overlay.height); state.page.strokes.push(snap); if(state.page.strokes.length>50) state.page.strokes.shift(); }catch(e){} }
      document.getElementById('undo').addEventListener('click',()=>{ const s=state.page.strokes.pop(); if(s) state.page.overlayCtx.putImageData(s,0,0);});
      document.getElementById('clear').addEventListener('click',()=>{ pushUndo(); octx.clearRect(0,0,overlay.width,overlay.height); });
    }
    function saveAsJPEG(){
      const { pageCanvas, overlayCanvas } = state.page;
      const merged=document.createElement('canvas'); merged.width=pageCanvas.width; merged.height=pageCanvas.height;
      const mctx=merged.getContext('2d'); mctx.drawImage(pageCanvas,0,0); mctx.drawImage(overlayCanvas,0,0);
      const dataUrl=merged.toDataURL('image/jpeg',0.92); const b64=dataUrl.split(',')[1];
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
  const workOrderId = params?.id ? (Array.isArray(params.id) ? params.id[0] : params.id) : null;
  const router = useRouter();

  const [workOrder, setWorkOrder] = useState(null);
  const [photos, setPhotos] = useState([]);
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

  // Photo viewer
  const [photoViewerVisible, setPhotoViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [returnToAttachments, setReturnToAttachments] = useState(false);

  // NEW: Lightbox for PDFs (tiles)
  const [docModalVisible, setDocModalVisible] = useState(false);
  const [docGroup, setDocGroup] = useState(null); // 'WO' | 'EST' | 'PO'
  const [docIndex, setDocIndex] = useState(0);
  const [docItems, setDocItems] = useState([]);  // [{title, path, url}]
  const [docB64, setDocB64] = useState(null);
  const [docHeight, setDocHeight] = useState(Math.max(600, screenHeight * 0.85));
  const [docError, setDocError] = useState(null);
  const [docLoading, setDocLoading] = useState(false);

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

  // Utility to normalize list/CSV fields into URLs
  const toUrlArray = (val) => {
    if (!val) return [];
    if (Array.isArray(val)) return val.filter(Boolean).map(fileUrl);
    if (typeof val === 'string') {
      return val
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(fileUrl);
    }
    return [];
  };

  const fetchWorkOrder = useCallback(async () => {
    if (!workOrderId) return;
    try {
      const { data } = await api.get(`/work-orders/${workOrderId}`);
      setWorkOrder(data);

      // Notes
      const parsedNotes = Array.isArray(data.notes)
        ? data.notes
        : data.notes
        ? (() => { try { return JSON.parse(data.notes); } catch { return []; } })()
        : [];
      setNotes(sortNotesDesc(parsedNotes));

      // Photos
      const photoKeys = (data.photoPath || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      setPhotos(photoKeys.map(k => fileUrl(k)));
    } catch {
      Alert.alert('Error', 'Failed to load work order.');
    }
  }, [workOrderId]);

  useEffect(() => { fetchWorkOrder(); }, [fetchWorkOrder]);

  // Derivations for tiles
  const woPdfUrl = workOrder?.pdfPath ? fileUrl(workOrder.pdfPath) : null;

  // Estimates: try multiple likely fields from backend, normalize to array of URLs
  const estimateUrls = [
    ...toUrlArray(workOrder?.estimatePdfPaths),
    ...toUrlArray(workOrder?.estimatePaths),
    ...toUrlArray(workOrder?.estimatesPdf),
    ...toUrlArray(workOrder?.estimatePdfPath),
  ];
  // POs: similarly normalize
  const poUrls = [
    ...toUrlArray(workOrder?.poPdfPaths),
    ...toUrlArray(workOrder?.poPaths),
    ...toUrlArray(workOrder?.poPdfPath),
  ];

  // Lightbox loader
  const loadDocIntoModal = useCallback(async (url) => {
    if (!url) { setDocError('Missing file URL'); return; }
    try {
      setDocLoading(true);
      setDocError(null);
      setDocB64(null);
      const target = FileSystem.cacheDirectory + `doc_${Date.now()}.pdf`;
      await FileSystem.downloadAsync(url, target);
      const b64 = await FileSystem.readAsStringAsync(target, { encoding: FileSystem.EncodingType.Base64 });
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
      if (!woPdfUrl) { Alert.alert('No PDF', 'This work order does not have a PDF attached.'); return; }
      items = [{ title: `Work Order ${workOrder?.workOrderNumber || workOrderId}`, url: woPdfUrl }];
    } else if (group === 'EST') {
      if (!estimateUrls.length) { Alert.alert('No Estimates', 'No Estimate PDFs found for this job.'); return; }
      items = estimateUrls.map((u, i) => ({ title: `Estimate ${i + 1}`, url: u }));
    } else if (group === 'PO') {
      if (!poUrls.length) { Alert.alert('No POs', 'No PO PDFs found for this job.'); return; }
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

  // Camera capture
  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') return Alert.alert('Permission required', 'Need camera access.');
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
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
      Alert.alert('Success', 'Photo taken!');
    } catch (err) {
      Alert.alert('Upload Error', err?.response?.data?.error || err.message);
    }
  };

  // Library multi-select
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
    const safeIndex = Math.min(Math.max(0, viewerIndex), Math.max(0, photos.length - 1));
    const url = photos[safeIndex];
    try { await Share.share({ url, message: url }); } catch {}
  };

  const closePhotoViewer = () => {
    setPhotoViewerVisible(false);
    if (returnToAttachments) {
      setViewAttachmentsVisible(true);
    }
    setReturnToAttachments(false);
  };

  const pdfURL = workOrder?.pdfPath ? fileUrl(workOrder.pdfPath) : null;

  // Core: open annotator safely (always on top of any other modal)
  const openAnnotator = async () => {
    if (!pdfURL) return Alert.alert('No PDF', 'This work order does not have a PDF attached.');
    try {
      // Preload the PDF before showing, so it appears ready
      const tmp = FileSystem.cacheDirectory + `wo_${workOrderId}.pdf`;
      await FileSystem.downloadAsync(pdfURL, tmp);
      const b64 = await FileSystem.readAsStringAsync(tmp, { encoding: FileSystem.EncodingType.Base64 });
      setPdfBase64(b64);
      setAnnotateVisible(true);
    } catch {
      setAnnotateVisible(false);
      Alert.alert('Error', 'Failed to load PDF for annotation.');
    }
  };

  // If the user taps "Annotate" from inside the Lightbox, close it first then open annotator
  const openAnnotatorFromLightbox = async () => {
    setDocModalVisible(false);
    // small delay to let the modal dismiss animation finish; prevents z-index conflicts
    setTimeout(() => { openAnnotator(); }, 250);
  };

  const openSketch = () => setSketchVisible(true);

  // WebView message handlers
  const onAnnotatorMessage = async (ev) => {
    const msg = ev?.nativeEvent?.data || '';
    if (typeof msg !== 'string') return;
    if (msg.startsWith('ERROR:')) { Alert.alert('Annotator Error', msg.slice(6)); return; }
    if (msg === 'CLOSE') { setAnnotateVisible(false); return; }
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
    if (typeof msg !== 'string') return;
    if (msg.startsWith('ERROR:')) { Alert.alert('Draw Notes Error', msg.slice(6)); return; }
    if (msg === 'CLOSE') { setSketchVisible(false); return; }
    if (msg.startsWith('IMAGE:')) {
      const b64 = msg.slice(6);
      try {
        const jpgPath = FileSystem.cacheDirectory + `drawing_${Date.now()}.jpg`;
        await FileSystem.writeAsStringAsync(jpgPath, b64, { encoding: FileSystem.EncodingType.Base64 });
        const processed = await processImageForUpload(jpgPath);
        const form = new FormData();
        form.append('photoFile', { uri: processed, name: `drawing-note-${Date.now()}.jpg`, type: 'image/jpeg' });
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
    const next = pendingStatus || STATUS_OPTIONS[0];
    const prev = workOrder?.status;
    setWorkOrder(w => (w ? { ...w, status: next } : w));
    setShowStatusModal(false);
    setIsStatusSaving(true);
    try {
      const form = new FormData();
      form.append('status', next);
      await api.put(`/work-orders/${workOrderId}/edit`, form);
      await fetchWorkOrder();
    } catch (e) {
      setWorkOrder(w => (w ? { ...w, status: prev } : w));
      Alert.alert('Error', e?.response?.data?.error || e?.message || 'Failed to update status.');
    } finally {
      setIsStatusSaving(false);
    }
  };
  // -------------------------

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.details} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Work Order Details</Text>

        <View style={styles.card}>
          <View style={styles.row}><Text style={styles.label}>Work Order #:</Text><Text style={styles.value}>{workOrderNumber}</Text></View>
          <View style={styles.row}><Text style={styles.label}>PO #:</Text><Text style={styles.value}>{poNumber}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Customer:</Text><Text style={styles.value}>{customer}</Text></View>

          <View style={styles.row}>
            <Text style={styles.label}>Customer Phone:</Text>
            {customerPhone ? (
              <TouchableOpacity onPress={() => callNumber(customerPhone)}>
                <Text style={[styles.value, styles.linkText]}>{customerPhone}</Text>
              </TouchableOpacity>
            ) : <Text style={styles.value}>—</Text>}
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Customer Email:</Text>
            {customerEmail ? (
              <TouchableOpacity onPress={() => emailTo(customerEmail)}>
                <Text style={[styles.value, styles.linkText]}>{customerEmail}</Text>
              </TouchableOpacity>
            ) : <Text style={styles.value}>—</Text>}
          </View>

          <View style={styles.row}><Text style={styles.label}>Site Location:</Text><Text style={styles.value}>{siteName || '—'}</Text></View>

          <View style={styles.row}>
            <Text style={styles.label}>Site Address:</Text>
            {siteAddress ? (
              <TouchableOpacity onPress={() => openMap(siteAddress)}>
                <Text style={[styles.value, styles.linkText]}>{siteAddress}</Text>
              </TouchableOpacity>
            ) : <Text style={styles.value}>—</Text>}
          </View>

          <View style={styles.row}><Text style={styles.label}>Billing Address:</Text><Text style={styles.value}>{billingAddress || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Problem Description:</Text><Text style={styles.value}>{problem}</Text></View>

          <View style={[styles.row, { alignItems: 'center' }]}>
            <Text style={styles.label}>Status:</Text>
            <Text style={[styles.value, { flex: 0 }]}>{status}{isStatusSaving ? ' …' : ''}</Text>
            <TouchableOpacity style={[styles.smallBtn, isStatusSaving && { opacity: 0.6 }]} onPress={openStatusModal} disabled={isStatusSaving}>
              <Text style={styles.smallBtnText}>{isStatusSaving ? 'Saving…' : 'Change'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.row}><Text style={styles.label}>Scheduled Date:</Text><Text style={styles.value}>{scheduled}</Text></View>
        </View>

        {/* Actions */}
        <TouchableOpacity style={[styles.buttonBase, styles.backBtn]} onPress={() => router.back()}>
          <Text style={styles.backText}>Back to List</Text>
        </TouchableOpacity>

        {/* Tiles (like web CRM) */}
        <Text style={styles.sectionHeader}>Documents</Text>
        <View style={styles.tilesGrid}>
          <TouchableOpacity style={styles.tile} onPress={() => openDocGroup('WO', 0)}>
            <View style={styles.tileIconCircle}><Text style={styles.tileIconText}>WO</Text></View>
            <Text style={styles.tileTitle}>Work Order</Text>
            <Text style={styles.tileSub}>{woPdfUrl ? 'Tap to view' : 'No file'}</Text>
            {woPdfUrl && <Text style={styles.tileBadge}>PDF</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.tile} onPress={() => openDocGroup('EST', 0)}>
            <View style={styles.tileIconCircle}><Text style={styles.tileIconText}>EST</Text></View>
            <Text style={styles.tileTitle}>Estimates</Text>
            <Text style={styles.tileSub}>{estimateUrls.length ? `${estimateUrls.length} file${estimateUrls.length>1?'s':''}` : 'None'}</Text>
            {!!estimateUrls.length && <Text style={styles.tileBadge}>PDF</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.tile} onPress={() => openDocGroup('PO', 0)}>
            <View style={styles.tileIconCircle}><Text style={styles.tileIconText}>PO</Text></View>
            <Text style={styles.tileTitle}>POs</Text>
            <Text style={styles.tileSub}>{poUrls.length ? `${poUrls.length} file${poUrls.length>1?'s':''}` : 'None'}</Text>
            {!!poUrls.length && <Text style={styles.tileBadge}>PDF</Text>}
          </TouchableOpacity>
        </View>

        {/* Quick actions */}
        <View style={{ marginTop: 8 }}>
          {/* If the lightbox is open, call the special handler; otherwise open directly */}
          <TouchableOpacity
            style={[styles.buttonBase, styles.attachBtn]}
            onPress={() => (docModalVisible ? openAnnotatorFromLightbox() : openAnnotator())}
          >
            <Text style={styles.attachText}>Annotate & Sign PDF</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.buttonBase, styles.photoBtn]} onPress={takePhoto}>
            <Text style={styles.photoText}>Take Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.buttonBase, styles.photoBtn]} onPress={uploadPhotos}>
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
        </View>

        {/* Notes list */}
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
      </ScrollView>

      {/* Photo Viewer */}
      <Modal visible={photoViewerVisible} animationType="fade" onRequestClose={closePhotoViewer}>
        <View style={styles.viewerContainer}>
          <FlatList
            data={photos}
            keyExtractor={(_, i) => i.toString()}
            horizontal
            pagingEnabled
            initialScrollIndex={viewerIndex}
            getItemLayout={(_, idx) => ({ length: screenWidth, offset: screenWidth * idx, index: idx })}
            onMomentumScrollEnd={ev => {
              const x = ev?.nativeEvent?.contentOffset?.x ?? 0;
              const idx = Math.round(x / screenWidth);
              setViewerIndex(Number.isFinite(idx) ? idx : 0);
            }}
            renderItem={({ item }) => <Image source={{ uri: item }} style={styles.fullScreenImage} />}
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
                      setReturnToAttachments(true);
                      setViewerIndex(index);
                      setPhotoViewerVisible(true);
                      setViewAttachmentsVisible(false);
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
              <TouchableOpacity style={styles.cancelNoteBtn} onPress={() => setShowStatusModal(false)}>
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
            scrollEnabled
            nestedScrollEnabled
            showsVerticalScrollIndicator
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
        </SafeAreaView>
      </Modal>

      {/* Document Lightbox Modal (for WO/EST/PO) */}
      <Modal visible={docModalVisible} animationType="slide" onRequestClose={() => setDocModalVisible(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          <View style={styles.docHeader}>
            <TouchableOpacity onPress={() => setDocModalVisible(false)} style={styles.docHeaderBtn}>
              <Text style={styles.docHeaderBtnText}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.docHeaderTitle}>
              {docItems[docIndex]?.title || (docGroup === 'WO' ? 'Work Order' : docGroup === 'EST' ? 'Estimate' : 'PO')}
              {docItems.length > 1 ? `  (${docIndex + 1}/${docItems.length})` : ''}
            </Text>
            <View style={styles.docHeaderRight}>
              {!!docItems.length && (
                <TouchableOpacity onPress={() => Linking.openURL(docItems[docIndex].url)} style={styles.docHeaderBtn}>
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
                <Text style={{ color: '#ff6b6b', textAlign: 'center' }}>Couldn’t load document: {docError}</Text>
              </View>
            )}

            {!!docB64 && !docError && (
              <WebView
                originWhitelist={['*']}
                source={{ html: PDF_VIEWER_HTML }}
                javaScriptEnabled
                domStorageEnabled={false}
                scrollEnabled
                nestedScrollEnabled
                showsVerticalScrollIndicator
                onMessage={(e) => {
                  const msg = e?.nativeEvent?.data || '';
                  if (typeof msg !== 'string') return;
                  if (msg.startsWith('ERROR:')) {
                    setDocError(msg.slice(6));
                    return;
                  }
                  if (msg.startsWith('HEIGHT:')) {
                    const h = parseInt(msg.slice(7), 10);
                    if (Number.isFinite(h)) {
                      const minH = Math.max(600, screenHeight * 0.85);
                      const maxH = Math.max(minH, screenHeight * 2.5);
                      setDocHeight(Math.max(minH, Math.min(h, maxH)));
                    }
                  }
                }}
                injectedJavaScriptBeforeContentLoaded={`window.PDF_BASE64 = ${JSON.stringify(docB64)}; true;`}
                style={{ flex: 1 }}
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

          {docGroup === 'WO' && woPdfUrl && (
            <View style={{ padding: 12 }}>
              <TouchableOpacity style={[styles.buttonBase, styles.signBtn]} onPress={openAnnotatorFromLightbox}>
                <Text style={styles.signBtnText}>Annotate & Sign This Work Order</Text>
              </TouchableOpacity>
            </View>
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F1F5F9' },
  details: { padding: 16, paddingBottom: 24 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: 18, color: '#3D5A80' },
  title: { fontSize: 24, fontWeight: '700', color: '#2B2D42', textAlign: 'center', marginBottom: 12 },
  card: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, marginBottom: 16, elevation: 3 },

  row: { flexDirection: 'row', marginBottom: 8, flexWrap: 'wrap' },
  label: { width: 140, fontWeight: '600', color: '#3D5A80' },
  value: { flex: 1, color: '#2B2D42' },
  linkText: { color: '#007bff', textDecorationLine: 'underline' },

  buttonBase: { width: '100%', paddingVertical: 12, borderRadius: 8, alignItems: 'center', marginBottom: 12 },
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

  smallBtn: { marginLeft: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#0ea5e9', borderRadius: 8 },
  smallBtnText: { color: '#fff', fontWeight: '700' },

  sectionHeader: { fontSize: 18, fontWeight: '700', marginVertical: 8, color: '#2B2D42' },

  // Tiles
  tilesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    flexBasis: '31%',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 12,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  tileIconCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#0ea5e9', alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  tileIconText: { color: '#fff', fontWeight: '800' },
  tileTitle: { fontWeight: '700', color: '#1f2937', marginBottom: 2 },
  tileSub: { color: '#6b7280', fontSize: 12 },
  tileBadge: {
    marginTop: 6, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999,
    backgroundColor: '#e5f3ff', color: '#0369a1', overflow: 'hidden',
  },

  noteCard: { backgroundColor: '#FFF', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  noteTimestamp: { fontSize: 12, color: '#8D99AE', marginBottom: 4 },
  noteBody: { fontSize: 14, color: '#2B2D42' },

  // Photo viewer
  viewerContainer: { flex: 1, backgroundColor: '#000' },
  fullScreenImage: { width: screenWidth, height: screenHeight, resizeMode: 'contain' },
  viewerButtons: { position: 'absolute', bottom: 40, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-around' },
  viewerButton: { flex: 1, marginHorizontal: 8, padding: 12, borderRadius: 8, alignItems: 'center' },
  shareBtn: { backgroundColor: 'rgba(255,255,255,0.3)' },
  shareText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  exitBtn: { backgroundColor: 'rgba(220,53,69,0.85)' },
  exitText: { color: '#fff', fontWeight: '600', fontSize: 16 },

  // Attachments modal
  modal: { flex: 1, padding: 16, backgroundColor: '#fff', marginTop: 80, borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12, textAlign: 'center', color: '#2B2D42' },
  noPhotosText: { textAlign: 'center', marginTop: 20, fontStyle: 'italic' },
  galleryList: { paddingBottom: 16 },
  thumbWrapper: { flex: 1 / 3, aspectRatio: 1, padding: 4 },
  thumbnail: { width: '100%', height: '100%', borderRadius: 8 },
  deleteIcon: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.6)', width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: '#fff', fontSize: 14, lineHeight: 18 },
  cancelBtn: { backgroundColor: '#dc3545', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 16 },
  cancelText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  // Transparent overlays
  addNoteOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 16 },
  addNoteContainer: { backgroundColor: '#fff', borderRadius: 12, padding: 16 },
  addNoteTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12, textAlign: 'center', color: '#2B2D42' },
  addNoteInput: { height: 120, borderColor: '#cfd5dd', borderWidth: 1, borderRadius: 10, padding: 10, textAlignVertical: 'top', marginBottom: 12 },
  addNoteButtons: { flexDirection: 'row', justifyContent: 'space-around' },
  saveNoteBtn: { backgroundColor: '#28a745', padding: 10, borderRadius: 8, flex: 1, marginHorizontal: 4 },
  saveNoteText: { color: '#fff', textAlign: 'center', fontWeight: '700' },
  cancelNoteBtn: { backgroundColor: '#dc3545', padding: 10, borderRadius: 8, flex: 1, marginHorizontal: 4 },
  cancelNoteText: { color: '#fff', textAlign: 'center', fontWeight: '700' },

  statusList: { gap: 8 },
  statusOption: { padding: 12, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, backgroundColor: '#fff' },
  statusOptionActive: { backgroundColor: '#0ea5e9' },
  statusText: { color: '#2B2D42', fontWeight: '700' },
  statusTextActive: { color: '#fff' },

  // Doc modal header & nav
  docHeader: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 6, backgroundColor: '#0b0f14', flexDirection: 'row', alignItems: 'center' },
  docHeaderBtn: { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#1f2937', borderRadius: 8, marginRight: 8 },
  docHeaderBtnText: { color: '#fff', fontWeight: '700' },
  docHeaderTitle: { color: '#fff', fontWeight: '800', fontSize: 16, flex: 1, textAlign: 'center' },
  docHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  docNavBar: { flexDirection: 'row', justifyContent: 'center', padding: 12, backgroundColor: '#0b0f14' },
  docNavBtn: { paddingVertical: 10, paddingHorizontal: 16, backgroundColor: '#1f2937', borderRadius: 999 },
  docNavText: { color: '#fff', fontWeight: '700' },

  signBtn: { backgroundColor: '#2563EB', borderRadius: 10 },
  signBtnText: { color: '#fff', fontWeight: '800' },
});
