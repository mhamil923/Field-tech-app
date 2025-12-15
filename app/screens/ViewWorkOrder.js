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
  SafeAreaView,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Camera } from 'expo-camera';
import moment from 'moment';

// Expo Router + React Navigation compatibility
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useRoute, useNavigation } from '@react-navigation/native';

import AsyncStorage from '@react-native-async-storage/async-storage';
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

/** ─────────────────────────────────────────────────────────────
 * Auth headers (React Native: use AsyncStorage, not localStorage)
 * ───────────────────────────────────────────────────────────── */
async function getAuthHeaders() {
  try {
    const token = await AsyncStorage.getItem('jwt');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

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

  // legacy text log format:
  // [timestamp] Name: message
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
 * Expects: window.PDF_BASE64 = "...." (base64, no data: prefix)
 * Posts: HEIGHT:<number> so RN can resize modal height if desired
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
      const b64=window.PDF_BASE64||'';
      if(!b64){ document.getElementById('loader').innerText='Missing PDF data.'; return; }
      try{
        const pdfDoc=await pdfjsLib.getDocument({data:b64ToUint8(b64)}).promise;
        const pagesContainer=document.getElementById('pages');
        const loader=document.getElementById('loader'); loader.remove();
        for(let i=1;i<=pdfDoc.numPages;i++){
          const page=await pdfDoc.getPage(i);
          const viewport=page.getViewport({scale:1.2});
          const wrap=document.createElement('div'); wrap.className='pageWrap';
          const canvas=document.createElement('canvas'); canvas.className='page';
          const context=canvas.getContext('2d');
          canvas.height=viewport.height; canvas.width=viewport.width;
          wrap.appendChild(canvas); pagesContainer.appendChild(wrap);
          await page.render({canvasContext:context,viewport}).promise;
        }
        const indicator=document.getElementById('pageIndicator'); indicator.style.display='block';
        const total=pdfDoc.numPages;
        function updatePageIndicator(){
          const wraps=document.querySelectorAll('.pageWrap'); let current=1;
          for(let i=0;i<wraps.length;i++){
            const rect=wraps[i].getBoundingClientRect();
            if(rect.top<window.innerHeight*0.5) current=i+1;
          }
          indicator.textContent='Page '+current+' of '+total;
        }
        window.addEventListener('scroll',updatePageIndicator,{passive:true}); updatePageIndicator();
        setTimeout(()=>{
          const h=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight);
          window.ReactNativeWebView?.postMessage('HEIGHT:'+h);
        },800);
      }catch(e){
        document.getElementById('loader').innerText='Error loading PDF: '+e.message;
        window.ReactNativeWebView?.postMessage('ERROR:'+e.message);
      }
    }
    document.addEventListener('DOMContentLoaded',renderAllPages);
  </script>
</body>
</html>
`;

/**
 * PDF Annotator & Signer
 * - Renders all pages
 * - Allows drawing annotations per page
 * - Saves a NEW PDF with overlay annotations using pdf-lib
 * Expects: window.PDF_BASE64 (base64 input PDF)
 * Posts:
 *   - PDF_BASE64:<base64NewPdf>
 *   - ERROR:<message>
 */
const ANNOTATOR_HTML = `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>Annotate & Sign</title>
<style>
  html, body { margin:0; padding:0; height:100%; background:#0b1220; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; color:#e5e7eb; overflow:hidden; }
  #topbar {
    position:fixed; top:0; left:0; right:0; z-index:10;
    display:flex; align-items:center; justify-content:space-between;
    padding:10px 12px; background:rgba(2,6,23,0.95); border-bottom:1px solid rgba(148,163,184,0.18);
  }
  #topbar .title { font-weight:700; font-size:14px; opacity:0.95; }
  .btn {
    border:1px solid rgba(148,163,184,0.35);
    background:rgba(15,23,42,0.85);
    color:#e5e7eb; padding:8px 10px; border-radius:10px;
    font-weight:700; font-size:12px;
  }
  .btn.primary { background:#16a34a; border-color:#16a34a; color:#03120a; }
  .btn.danger { background:#dc2626; border-color:#dc2626; color:#fff; }
  #wrap {
    position:absolute; top:52px; left:0; right:0; bottom:0;
    overflow:auto; -webkit-overflow-scrolling:touch; padding:12px 10px;
  }
  .page {
    width:100%;
    max-width:1100px;
    margin:0 auto 14px auto;
    background:rgba(255,255,255,0.03);
    border:1px solid rgba(148,163,184,0.18);
    border-radius:14px;
    overflow:hidden;
    box-shadow:0 10px 30px rgba(0,0,0,0.35);
  }
  .canvasWrap { position:relative; width:100%; }
  canvas.render { width:100%; height:auto; display:block; background:#fff; }
  canvas.draw { position:absolute; left:0; top:0; width:100%; height:100%; }
  .pageFooter {
    display:flex; justify-content:space-between; align-items:center;
    padding:10px 12px; background:rgba(2,6,23,0.65);
    border-top:1px solid rgba(148,163,184,0.14);
  }
  .small { font-size:12px; color:#cbd5e1; font-weight:600; }
  #loader { padding:16px; text-align:center; color:#e5e7eb; }
  #hint { padding:0 12px 10px 12px; font-size:12px; color:#93c5fd; opacity:0.95; }
</style>
</head>
<body>
  <div id="topbar">
    <button class="btn danger" id="clearAllBtn">Clear All</button>
    <div class="title">Annotate & Sign</div>
    <button class="btn primary" id="saveBtn">Save PDF</button>
  </div>

  <div id="wrap">
    <div id="loader">Loading PDF…</div>
    <div id="hint">Tip: draw with your finger on each page. Tap “Save PDF” to create a new signed PDF.</div>
    <div id="pages"></div>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js"></script>
  <script>
    pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    function b64ToUint8(b64){
      const bin=atob(b64); const bytes=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
      return bytes;
    }
    function uint8ToB64(bytes){
      let bin=''; const chunk=0x8000;
      for(let i=0;i<bytes.length;i+=chunk){
        bin += String.fromCharCode.apply(null, bytes.subarray(i,i+chunk));
      }
      return btoa(bin);
    }

    const state = {
      pdfB64: '',
      pdfBytes: null,
      pdfDoc: null,
      pageCanvases: [], // { renderCanvas, drawCanvas, drawCtx, viewport }
      drawing: false,
      lastX: 0,
      lastY: 0,
      activeCtx: null,
      dpr: Math.max(1, window.devicePixelRatio || 1),
    };

    function attachDrawing(drawCanvas, ctx){
      const getPos = (e) => {
        const rect = drawCanvas.getBoundingClientRect();
        const p = e.touches ? e.touches[0] : e;
        const x = (p.clientX - rect.left);
        const y = (p.clientY - rect.top);
        return { x, y };
      };

      const start = (e) => {
        e.preventDefault();
        state.drawing = true;
        state.activeCtx = ctx;
        const {x,y} = getPos(e);
        state.lastX = x; state.lastY = y;
      };
      const move = (e) => {
        if(!state.drawing || state.activeCtx !== ctx) return;
        e.preventDefault();
        const {x,y} = getPos(e);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(state.lastX, state.lastY);
        ctx.lineTo(x, y);
        ctx.stroke();
        state.lastX = x; state.lastY = y;
      };
      const end = (e) => {
        if(!state.drawing) return;
        e.preventDefault();
        state.drawing = false;
        state.activeCtx = null;
      };

      drawCanvas.addEventListener('mousedown', start);
      drawCanvas.addEventListener('mousemove', move);
      window.addEventListener('mouseup', end);

      drawCanvas.addEventListener('touchstart', start, {passive:false});
      drawCanvas.addEventListener('touchmove', move, {passive:false});
      drawCanvas.addEventListener('touchend', end, {passive:false});
      drawCanvas.addEventListener('touchcancel', end, {passive:false});
    }

    async function renderAll(){
      const b64 = window.PDF_BASE64 || '';
      state.pdfB64 = b64;
      if(!b64){
        document.getElementById('loader').innerText = 'Missing PDF data.';
        return;
      }
      try{
        state.pdfBytes = b64ToUint8(b64);
        const pdf = await pdfjsLib.getDocument({data: state.pdfBytes}).promise;
        state.pdfDoc = pdf;

        const pagesEl = document.getElementById('pages');
        document.getElementById('loader').remove();

        for(let i=1;i<=pdf.numPages;i++){
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({scale: 1.35});

          const pageWrap = document.createElement('div');
          pageWrap.className='page';

          const canvasWrap = document.createElement('div');
          canvasWrap.className='canvasWrap';

          const renderCanvas = document.createElement('canvas');
          renderCanvas.className='render';
          const drawCanvas = document.createElement('canvas');
          drawCanvas.className='draw';

          // set internal pixel size for crispness
          renderCanvas.width = Math.floor(viewport.width * state.dpr);
          renderCanvas.height = Math.floor(viewport.height * state.dpr);
          drawCanvas.width = renderCanvas.width;
          drawCanvas.height = renderCanvas.height;

          // CSS size follows viewport
          renderCanvas.style.width = viewport.width + 'px';
          renderCanvas.style.height = viewport.height + 'px';
          drawCanvas.style.width = viewport.width + 'px';
          drawCanvas.style.height = viewport.height + 'px';

          const rctx = renderCanvas.getContext('2d');
          rctx.setTransform(state.dpr,0,0,state.dpr,0,0);

          const dctx = drawCanvas.getContext('2d');
          dctx.setTransform(state.dpr,0,0,state.dpr,0,0);

          canvasWrap.appendChild(renderCanvas);
          canvasWrap.appendChild(drawCanvas);

          const footer = document.createElement('div');
          footer.className='pageFooter';
          footer.innerHTML = '<div class="small">Page '+i+' of '+pdf.numPages+'</div><button class="btn" data-clear="'+(i-1)+'">Clear Page</button>';

          pageWrap.appendChild(canvasWrap);
          pageWrap.appendChild(footer);
          pagesEl.appendChild(pageWrap);

          await page.render({canvasContext: rctx, viewport}).promise;

          attachDrawing(drawCanvas, dctx);

          state.pageCanvases.push({ renderCanvas, drawCanvas, drawCtx: dctx, viewport });

          footer.querySelector('button').addEventListener('click', () => {
            dctx.clearRect(0,0,drawCanvas.width,state.dpr*viewport.height);
            // better: clear whole canvas pixels
            dctx.setTransform(state.dpr,0,0,state.dpr,0,0);
            dctx.clearRect(0,0,viewport.width,viewport.height);
          });
        }
      }catch(e){
        window.ReactNativeWebView?.postMessage('ERROR:'+e.message);
        const loader = document.getElementById('loader');
        if(loader) loader.innerText='Error loading PDF: '+e.message;
      }
    }

    async function savePdf(){
      try{
        const { PDFDocument } = PDFLib;
        const pdfDoc = await PDFDocument.load(state.pdfBytes);
        const pages = pdfDoc.getPages();

        for(let i=0;i<pages.length;i++){
          const page = pages[i];
          const overlayCanvas = state.pageCanvases[i]?.drawCanvas;
          if(!overlayCanvas) continue;

          // detect if anything drawn (quick heuristic)
          const ctx = overlayCanvas.getContext('2d');
          const imgData = ctx.getImageData(0,0,overlayCanvas.width,overlayCanvas.height).data;
          let hasInk = false;
          for(let k=3;k<imgData.length;k+=128){ // stride to keep fast
            if(imgData[k] !== 0){ hasInk = true; break; }
          }
          if(!hasInk) continue;

          const pngDataUrl = overlayCanvas.toDataURL('image/png');
          const pngBytes = Uint8Array.from(atob(pngDataUrl.split(',')[1]), c => c.charCodeAt(0));
          const pngEmbed = await pdfDoc.embedPng(pngBytes);

          const { width, height } = page.getSize();

          // pdf-lib drawImage uses PDF units; cover the whole page
          page.drawImage(pngEmbed, { x: 0, y: 0, width, height, opacity: 1 });
        }

        const outBytes = await pdfDoc.save();
        const outB64 = uint8ToB64(outBytes);
        window.ReactNativeWebView?.postMessage('PDF_BASE64:'+outB64);
      }catch(e){
        window.ReactNativeWebView?.postMessage('ERROR:'+e.message);
      }
    }

    function clearAll(){
      for(const p of state.pageCanvases){
        const ctx = p.drawCtx;
        ctx.setTransform(state.dpr,0,0,state.dpr,0,0);
        ctx.clearRect(0,0,p.viewport.width,p.viewport.height);
      }
    }

    document.getElementById('saveBtn').addEventListener('click', savePdf);
    document.getElementById('clearAllBtn').addEventListener('click', clearAll);

    document.addEventListener('DOMContentLoaded', renderAll);
  </script>
</body>
</html>
`;

/**
 * Simple Sketch Pad (used for "Draw Note")
 * Posts: PNG_BASE64:<base64Png>
 */
const SKETCH_HTML = `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>Draw Note</title>
<style>
  html, body { margin:0; padding:0; height:100%; background:#0b1220; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; overflow:hidden; }
  #topbar {
    position:fixed; top:0; left:0; right:0; z-index:10;
    display:flex; align-items:center; justify-content:space-between;
    padding:10px 12px; background:rgba(2,6,23,0.95); border-bottom:1px solid rgba(148,163,184,0.18);
    color:#e5e7eb;
  }
  .btn {
    border:1px solid rgba(148,163,184,0.35);
    background:rgba(15,23,42,0.85);
    color:#e5e7eb; padding:8px 10px; border-radius:10px;
    font-weight:700; font-size:12px;
  }
  .btn.primary { background:#0ea5e9; border-color:#0ea5e9; color:#06121b; }
  .btn.danger { background:#dc2626; border-color:#dc2626; color:#fff; }
  #wrap { position:absolute; top:52px; left:0; right:0; bottom:0; }
  canvas { width:100%; height:100%; display:block; background:#ffffff; touch-action:none; }
</style>
</head>
<body>
  <div id="topbar">
    <button class="btn danger" id="clearBtn">Clear</button>
    <div style="font-weight:800; font-size:14px;">Draw Note</div>
    <button class="btn primary" id="saveBtn">Save</button>
  </div>
  <div id="wrap">
    <canvas id="c"></canvas>
  </div>

<script>
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  function resize(){
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0,0,rect.width,rect.height);
  }
  window.addEventListener('resize', resize);
  setTimeout(resize, 60);

  let drawing=false, lastX=0, lastY=0;

  function pos(e){
    const rect = canvas.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: p.clientX - rect.left, y: p.clientY - rect.top };
  }

  function start(e){
    e.preventDefault();
    drawing=true;
    const p = pos(e);
    lastX=p.x; lastY=p.y;
  }
  function move(e){
    if(!drawing) return;
    e.preventDefault();
    const p = pos(e);
    ctx.lineJoin='round';
    ctx.lineCap='round';
    ctx.strokeStyle='#111827';
    ctx.lineWidth=3.2;
    ctx.beginPath();
    ctx.moveTo(lastX,lastY);
    ctx.lineTo(p.x,p.y);
    ctx.stroke();
    lastX=p.x; lastY=p.y;
  }
  function end(e){
    if(!drawing) return;
    e.preventDefault();
    drawing=false;
  }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);

  canvas.addEventListener('touchstart', start, {passive:false});
  canvas.addEventListener('touchmove', move, {passive:false});
  canvas.addEventListener('touchend', end, {passive:false});
  canvas.addEventListener('touchcancel', end, {passive:false});

  document.getElementById('clearBtn').addEventListener('click', () => resize());

  document.getElementById('saveBtn').addEventListener('click', () => {
    try{
      const dataUrl = canvas.toDataURL('image/png');
      const b64 = dataUrl.split(',')[1];
      window.ReactNativeWebView?.postMessage('PNG_BASE64:'+b64);
    }catch(e){
      window.ReactNativeWebView?.postMessage('ERROR:'+e.message);
    }
  });
</script>
</body>
</html>
`;

/** ─────────────────────────────────────────────────────────────
 * Camera type compatibility (avoids CameraType.back undefined)
 * ───────────────────────────────────────────────────────────── */
const CAMERA_TYPE_BACK = Camera?.Constants?.Type?.back ?? 'back';
const CAMERA_TYPE_FRONT = Camera?.Constants?.Type?.front ?? 'front';

export default function ViewWorkOrder() {
  const router = useRouter();
  const navigation = useNavigation();
  const route = useRoute?.();
  const params = useLocalSearchParams?.() || {};

  // Works for expo-router AND react-navigation
  const workOrderId =
    params?.id ??
    params?.workOrderId ??
    params?.orderId ??
    route?.params?.id ??
    route?.params?.workOrderId ??
    route?.params?.orderId ??
    null;

  const [workOrder, setWorkOrder] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [notes, setNotes] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // PENDING camera photos
  const [pendingCameraPhotos, setPendingCameraPhotos] = useState([]);
  const [pendingViewerVisible, setPendingViewerVisible] = useState(false);
  const [pendingViewerIndex, setPendingViewerIndex] = useState(0);

  // Camera state
  const [cameraVisible, setCameraVisible] = useState(false);
  const [cameraType, setCameraType] = useState(CAMERA_TYPE_BACK);
  const [isCapturing, setIsCapturing] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState(null);
  const cameraRef = useRef(null);

  // Notes modal
  const [showAddNoteModal, setShowAddNoteModal] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');

  // Attachments modal
  const [viewAttachmentsVisible, setViewAttachmentsVisible] = useState(false);

  // Draw Notes (sketch)
  const [sketchVisible, setSketchVisible] = useState(false);

  // Annotate & Sign existing WO PDF
  const [annotateVisible, setAnnotateVisible] = useState(false);
  const [pdfBase64, setPdfBase64] = useState(null);

  // Status modal / saving
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [pendingStatus, setPendingStatus] = useState('');
  const [isStatusSaving, setIsStatusSaving] = useState(false);

  // Photo viewer (uploaded)
  const [photoViewerVisible, setPhotoViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [returnToAttachments, setReturnToAttachments] = useState(false);

  // Lightbox for PDFs (multi-page)
  const [docModalVisible, setDocModalVisible] = useState(false);
  const [docGroup, setDocGroup] = useState(null);
  const [docIndex, setDocIndex] = useState(0);
  const [docItems, setDocItems] = useState([]);
  const [docB64, setDocB64] = useState(null);
  const [docHeight, setDocHeight] = useState(Math.max(600, screenHeight * 0.85));
  const [docError, setDocError] = useState(null);
  const [docLoading, setDocLoading] = useState(false);

  // -------- helpers --------
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

  const safeGoBack = () => {
    if (router?.back) return router.back();
    if (navigation?.goBack) return navigation.goBack();
  };

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

  const isPdfLike = (s = '') => {
    const lower = String(s || '').toLowerCase();
    return lower.endsWith('.pdf') || lower.includes('.pdf?') || lower.startsWith('data:application/pdf');
  };

  const fetchWorkOrder = useCallback(async () => {
    if (!workOrderId) return;
    setIsLoading(true);
    try {
      const headers = await getAuthHeaders();
      const { data } = await api.get(`/work-orders/${workOrderId}`, { headers });

      setWorkOrder(data);

      const parsed = parseNotesArrayOrText(data?.notes);
      setNotes(sortNotesDesc(parsed));

      const rawKeys = (data?.photoPath || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const allUrls = rawKeys.map((k) => fileUrl(k));
      const imageUrls = allUrls.filter((u) => !isPdfLike(u));
      setPhotos(imageUrls);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401) {
        Alert.alert('Session Expired', 'Please log in again.');
        safeGoBack();
        return;
      }
      Alert.alert('Error', err?.response?.data?.error || 'Failed to load work order.');
    } finally {
      setIsLoading(false);
    }
  }, [workOrderId]);

  useEffect(() => {
    fetchWorkOrder();
  }, [fetchWorkOrder]);

  const woPdfUrl = workOrder?.pdfPath ? fileUrl(workOrder.pdfPath) : null;

  const estimateUrls = useMemo(
    () => [
      ...toUrlArray(workOrder?.estimatePdfPaths),
      ...toUrlArray(workOrder?.estimatePaths),
      ...toUrlArray(workOrder?.estimatesPdf),
      ...toUrlArray(workOrder?.estimatePdfPath),
    ],
    [workOrder]
  );

  const poUrls = useMemo(
    () => [
      ...toUrlArray(workOrder?.poPdfPaths),
      ...toUrlArray(workOrder?.poPaths),
      ...toUrlArray(workOrder?.poPdfPath),
    ],
    [workOrder]
  );

  const attachmentKeys = useMemo(() => {
    return (workOrder?.photoPath || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }, [workOrder]);

  const attachmentUrls = useMemo(() => attachmentKeys.map((k) => fileUrl(k)), [attachmentKeys]);

  const attachmentPhotoUrls = useMemo(
    () => attachmentUrls.filter((u) => !isPdfLike(u)),
    [attachmentUrls]
  );

  const attachmentPdfUrls = useMemo(
    () => attachmentUrls.filter((u) => isPdfLike(u)),
    [attachmentUrls]
  );

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
      if (!woPdfUrl) return Alert.alert('No PDF', 'This work order does not have a PDF attached.');
      items = [{ title: `Work Order ${workOrder?.workOrderNumber || workOrderId}`, url: woPdfUrl }];
    } else if (group === 'EST') {
      if (!estimateUrls.length) return Alert.alert('No Estimates', 'No Estimate PDFs found for this job.');
      items = estimateUrls.map((u, i) => ({ title: `Estimate ${i + 1}`, url: u }));
    } else if (group === 'PO') {
      if (!poUrls.length) return Alert.alert('No POs', 'No PO PDFs found for this job.');
      items = poUrls.map((u, i) => ({ title: `PO ${i + 1}`, url: u }));
    } else if (group === 'ATTACH') {
      if (!attachmentPdfUrls.length) return Alert.alert('No PDFs', 'No PDF attachments found.');
      items = attachmentPdfUrls.map((u, i) => ({ title: `Attachment PDF ${i + 1}`, url: u }));
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

  /* ---------- ADD NOTE ---------- */
  const addNote = async () => {
    const text = newNoteText.trim();
    if (!text) return;

    try {
      const headers = await getAuthHeaders();
      await api.put(
        `/work-orders/${workOrderId}/notes`,
        { notes: text, append: true },
        { headers: { 'Content-Type': 'application/json', ...headers } }
      );
    } catch (err1) {
      // fallback payload style
      try {
        const headers = await getAuthHeaders();
        await api.put(
          `/work-orders/${workOrderId}/notes`,
          { text, append: true },
          { headers: { 'Content-Type': 'application/json', ...headers } }
        );
      } catch (err2) {
        const msg =
          err2?.response?.data?.error ||
          err1?.response?.data?.error ||
          err2?.message ||
          err1?.message ||
          'Failed to add note.';
        Alert.alert('Error', msg);
        return;
      }
    }

    setNewNoteText('');
    setShowAddNoteModal(false);
    await fetchWorkOrder();
  };

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

  /** CAMERA FLOW */
  const openCamera = async () => {
    try {
      const { status } = await Camera.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        setHasCameraPermission(false);
        Alert.alert('Permission required', 'Need camera access to take photos.');
        return;
      }
      setHasCameraPermission(true);
      setCameraVisible(true);
    } catch (e) {
      setHasCameraPermission(false);
      Alert.alert('Camera Error', e?.message || 'Unable to request camera permission.');
    }
  };

  const capturePhoto = async () => {
    if (!cameraRef.current || isCapturing) return;
    try {
      setIsCapturing(true);
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1,
        skipProcessing: true,
      });
      if (photo?.uri) {
        setPendingCameraPhotos((prev) => [
          ...prev,
          { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, uri: photo.uri },
        ]);
      }
    } catch (e) {
      console.warn('capturePhoto error', e?.message || e);
    } finally {
      setIsCapturing(false);
    }
  };

  const toggleCameraType = () => {
    setCameraType((prev) => (prev === CAMERA_TYPE_BACK ? CAMERA_TYPE_FRONT : CAMERA_TYPE_BACK));
  };

  const removePendingCameraPhoto = (id) => {
    setPendingCameraPhotos((prev) => prev.filter((p) => p.id !== id));
  };

  const clearPendingCameraPhotos = () => {
    if (!pendingCameraPhotos.length) return;
    Alert.alert('Discard All?', 'This will remove all pending camera photos that have not been uploaded yet.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => setPendingCameraPhotos([]) },
    ]);
  };

  const uploadPendingCameraPhotos = async () => {
    if (!pendingCameraPhotos.length) return;

    const form = new FormData();
    try {
      for (let i = 0; i < pendingCameraPhotos.length; i++) {
        const p = pendingCameraPhotos[i];
        const processedUri = await processImageForUpload(p.uri);
        const name = `photo-${Date.now()}-${i}.jpg`;
        form.append('photoFile', { uri: processedUri, name, type: 'image/jpeg' });
      }

      const headers = await getAuthHeaders();
      await api.put(`/work-orders/${workOrderId}/edit`, form, {
        headers: { 'Content-Type': 'multipart/form-data', ...headers },
      });

      setPendingCameraPhotos([]);
      await fetchWorkOrder();
      Alert.alert('Success', 'Camera photos uploaded!');
    } catch (err) {
      Alert.alert('Upload Error', err?.response?.data?.error || err.message || 'Failed to upload photos.');
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
    if (result.canceled || !result.assets?.length) return;

    const form = new FormData();
    for (let i = 0; i < result.assets.length; i++) {
      const processedUri = await processImageForUpload(result.assets[i].uri);
      const name = `photo-${Date.now()}-${i}.jpg`;
      form.append('photoFile', { uri: processedUri, name, type: 'image/jpeg' });
    }

    try {
      const headers = await getAuthHeaders();
      await api.put(`/work-orders/${workOrderId}/edit`, form, {
        headers: { 'Content-Type': 'multipart/form-data', ...headers },
      });
      await fetchWorkOrder();
      Alert.alert('Success', 'Photos uploaded!');
    } catch (err) {
      Alert.alert('Upload Error', err?.response?.data?.error || err.message || 'Failed to upload photos.');
    }
  };

  const handleDeleteAttachmentByKey = (key) => {
    if (!key) return;
    Alert.alert('Delete Attachment?', 'This will permanently remove it.', [
      { text: 'Cancel, keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const headers = await getAuthHeaders();
            await api.delete(`/work-orders/${workOrderId}/attachment`, {
              data: { photoPath: key },
              headers,
            });
            await fetchWorkOrder();
            Alert.alert('Deleted');
          } catch (err) {
            Alert.alert('Error', err?.response?.data?.error || err.message || 'Failed to delete.');
          }
        },
      },
    ]);
  };

  const handleShare = async () => {
    if (!photos.length) return;
    const safeIndex = Math.min(Math.max(0, viewerIndex), Math.max(0, photos.length - 1));
    const url = photos[safeIndex];
    try {
      await Share.share({ url, message: url });
    } catch {}
  };

  const closePhotoViewer = () => {
    setPhotoViewerVisible(false);
    if (returnToAttachments) setViewAttachmentsVisible(true);
    setReturnToAttachments(false);
  };

  const openPhotoViewerFromAttachments = (index) => {
    setViewAttachmentsVisible(false);
    setReturnToAttachments(true);
    setViewerIndex(index);
    setPhotoViewerVisible(true);
  };

  // Load base64 for WO PDF and open annotator
  const openAnnotator = async () => {
    if (!woPdfUrl) return Alert.alert('No PDF', 'This work order does not have a PDF attached.');
    try {
      const tmp = FileSystem.cacheDirectory + `wo_${workOrderId}_${Date.now()}.pdf`;
      await FileSystem.downloadAsync(woPdfUrl, tmp);
      const b64 = await FileSystem.readAsStringAsync(tmp, { encoding: FileSystem.EncodingType.Base64 });
      setPdfBase64(b64);
      setAnnotateVisible(true);
    } catch (e) {
      setAnnotateVisible(false);
      Alert.alert('Error', e?.message || 'Failed to load PDF for annotation.');
    }
  };

  const uploadSignedPdfBase64 = async (signedB64) => {
    try {
      if (!signedB64) return;

      const outPath = FileSystem.cacheDirectory + `signed_${workOrderId}_${Date.now()}.pdf`;
      await FileSystem.writeAsStringAsync(outPath, signedB64, { encoding: FileSystem.EncodingType.Base64 });

      const form = new FormData();
      form.append('pdfFile', {
        uri: outPath,
        name: `Signed_WorkOrder_${workOrderId}.pdf`,
        type: 'application/pdf',
      });

      const headers = await getAuthHeaders();
      await api.put(`/work-orders/${workOrderId}/edit`, form, {
        headers: { 'Content-Type': 'multipart/form-data', ...headers },
      });

      await fetchWorkOrder();
      Alert.alert('Saved', 'Signed PDF uploaded to this work order.');
    } catch (e) {
      Alert.alert('Upload Error', e?.response?.data?.error || e?.message || 'Failed to upload signed PDF.');
    }
  };

  const uploadSketchPngBase64 = async (pngB64) => {
    try {
      if (!pngB64) return;
      const outPath = FileSystem.cacheDirectory + `sketch_${workOrderId}_${Date.now()}.png`;
      await FileSystem.writeAsStringAsync(outPath, pngB64, { encoding: FileSystem.EncodingType.Base64 });

      const form = new FormData();
      form.append('photoFile', {
        uri: outPath,
        name: `DrawNote_${workOrderId}.png`,
        type: 'image/png',
      });

      const headers = await getAuthHeaders();
      await api.put(`/work-orders/${workOrderId}/edit`, form, {
        headers: { 'Content-Type': 'multipart/form-data', ...headers },
      });

      await fetchWorkOrder();
      Alert.alert('Saved', 'Draw note uploaded as an attachment.');
    } catch (e) {
      Alert.alert('Upload Error', e?.response?.data?.error || e?.message || 'Failed to upload draw note.');
    }
  };

  // ------- derived fields for display -------
  const siteName = workOrder?.siteLocation || workOrder?.siteName || workOrder?.siteLocationName || '';
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

  const customerEmail = workOrder?.customerEmail || workOrder?.email || '';

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
      const headers = await getAuthHeaders();
      await api.put(`/work-orders/${workOrderId}/edit`, form, { headers });
      await fetchWorkOrder();
    } catch (e) {
      setWorkOrder((w) => (w ? { ...w, status: prev } : w));
      Alert.alert('Error', e?.response?.data?.error || e?.message || 'Failed to update status.');
    } finally {
      setIsStatusSaving(false);
    }
  };

  // Open doc modal for a PDF attachment (only PDFs)
  const openAttachmentPdfByIndex = (pdfIndex) => {
    openDocGroup('ATTACH', pdfIndex);
  };

  // Pending photo viewer controls
  const pendingCount = pendingCameraPhotos.length;
  const pendingActive = pendingCameraPhotos[pendingViewerIndex]?.uri || null;

  const closePendingViewer = () => setPendingViewerVisible(false);
  const nextPending = () => {
    if (!pendingCount) return;
    setPendingViewerIndex((i) => (i + 1) % pendingCount);
  };
  const prevPending = () => {
    if (!pendingCount) return;
    setPendingViewerIndex((i) => (i - 1 + pendingCount) % pendingCount);
  };

  const deleteCurrentPendingFromViewer = () => {
    const current = pendingCameraPhotos[pendingViewerIndex];
    if (!current) return;
    removePendingCameraPhoto(current.id);
    setTimeout(() => {
      setPendingViewerIndex((i) => Math.max(0, Math.min(i, pendingCameraPhotos.length - 2)));
    }, 0);
    if (pendingCameraPhotos.length <= 1) setPendingViewerVisible(false);
  };

  // Photo viewer paging for uploaded photos
  const viewPhotoAt = (index) => {
    setViewerIndex(index);
    setPhotoViewerVisible(true);
  };
  const nextPhoto = () => {
    if (!photos.length) return;
    setViewerIndex((i) => (i + 1) % photos.length);
  };
  const prevPhoto = () => {
    if (!photos.length) return;
    setViewerIndex((i) => (i - 1 + photos.length) % photos.length);
  };

  const injectedPdfViewerJS = useMemo(() => {
    // inject base64 into window and kick rendering
    if (!docB64) return '';
    const safe = docB64.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
    return `window.PDF_BASE64 = \`${safe}\`; true;`;
  }, [docB64]);

  const injectedAnnotatorJS = useMemo(() => {
    if (!pdfBase64) return '';
    const safe = pdfBase64.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
    return `window.PDF_BASE64 = \`${safe}\`; true;`;
  }, [pdfBase64]);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.details} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Work Order Details</Text>

        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" />
            <Text style={{ marginTop: 10, color: '#334155', fontWeight: '700' }}>Loading…</Text>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.label}>Work Order #:</Text>
                <Text style={styles.value}>{workOrderNumber}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>WO/PO #:</Text>
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
                <Text style={styles.value}>{billingAddress || '—'}</Text>
              </View>

              <View style={styles.row}>
                <Text style={styles.label}>Problem:</Text>
                <Text style={styles.value}>{problem}</Text>
              </View>

              <View style={[styles.row, { alignItems: 'center' }]}>
                <Text style={styles.label}>Status:</Text>
                <Text style={[styles.value, { flex: 0 }]}>
                  {status}
                  {isStatusSaving ? ' …' : ''}
                </Text>
                <TouchableOpacity
                  style={[styles.smallBtn, isStatusSaving && { opacity: 0.6 }]}
                  onPress={openStatusModal}
                  disabled={isStatusSaving}
                >
                  <Text style={styles.smallBtnText}>{isStatusSaving ? 'Saving…' : 'Change'}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.row}>
                <Text style={styles.label}>Scheduled Date:</Text>
                <Text style={styles.value}>{scheduled}</Text>
              </View>
            </View>

            <TouchableOpacity style={[styles.buttonBase, styles.backBtn]} onPress={safeGoBack}>
              <Text style={styles.backText}>Back to List</Text>
            </TouchableOpacity>

            {/* Quick actions */}
            <View style={{ marginTop: 8 }}>
              <TouchableOpacity style={[styles.buttonBase, styles.attachBtn]} onPress={openAnnotator}>
                <Text style={styles.attachText}>Annotate & Sign WO PDF</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.buttonBase, styles.attachBtn]} onPress={() => setSketchVisible(true)}>
                <Text style={styles.attachText}>Draw Note (Sketch)</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.buttonBase, styles.photoBtn]} onPress={openCamera}>
                <Text style={styles.photoText}>Take Photo (Camera)</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.buttonBase, styles.photoBtn]} onPress={uploadPhotos}>
                <Text style={styles.photoText}>Upload Photo(s) from Library</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.buttonBase, styles.attachBtn]} onPress={() => setViewAttachmentsVisible(true)}>
                <Text style={styles.attachText}>View Attachments</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.buttonBase, styles.noteBtn]} onPress={() => setShowAddNoteModal(true)}>
                <Text style={styles.noteText}>Add Note</Text>
              </TouchableOpacity>
            </View>

            {/* PENDING CAMERA PHOTOS */}
            {pendingCameraPhotos.length > 0 && (
              <View style={styles.pendingSection}>
                <View style={styles.pendingHeaderRow}>
                  <Text style={styles.pendingTitle}>Pending Camera Photos</Text>
                  <Text style={styles.pendingCount}>{pendingCameraPhotos.length} ready</Text>
                </View>

                <FlatList
                  data={pendingCameraPhotos}
                  keyExtractor={(item) => item.id}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.pendingList}
                  renderItem={({ item, index }) => (
                    <View style={styles.pendingThumbWrapper}>
                      <TouchableOpacity
                        onPress={() => {
                          setPendingViewerIndex(index);
                          setPendingViewerVisible(true);
                        }}
                      >
                        <Image source={{ uri: item.uri }} style={styles.pendingThumb} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.pendingDeleteIcon}
                        onPress={() => removePendingCameraPhoto(item.id)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={styles.pendingDeleteText}>×</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                />

                <View style={styles.pendingActionsRow}>
                  <TouchableOpacity style={[styles.buttonBase, styles.pendingUploadBtn]} onPress={uploadPendingCameraPhotos}>
                    <Text style={styles.pendingUploadText}>
                      Upload {pendingCameraPhotos.length} Photo{pendingCameraPhotos.length > 1 ? 's' : ''}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.buttonBase, styles.pendingDiscardBtn]} onPress={clearPendingCameraPhotos}>
                    <Text style={styles.pendingDiscardText}>Discard All</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

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
          </>
        )}
      </ScrollView>

      {/* Camera Modal */}
      <Modal visible={cameraVisible} animationType="slide" onRequestClose={() => setCameraVisible(false)}>
        <SafeAreaView style={styles.cameraContainer}>
          <View style={styles.cameraTopBar}>
            <TouchableOpacity onPress={() => setCameraVisible(false)} style={styles.cameraTopBtn}>
              <Text style={styles.cameraTopBtnText}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.cameraTitle}>Take Photos</Text>
            <TouchableOpacity onPress={toggleCameraType} style={styles.cameraTopBtn}>
              <Text style={styles.cameraTopBtnText}>Flip</Text>
            </TouchableOpacity>
          </View>

          {hasCameraPermission === false ? (
            <View style={styles.center}>
              <Text style={styles.cameraErrorText}>Camera permission not granted.</Text>
            </View>
          ) : (
            <>
              <Camera ref={cameraRef} style={styles.camera} type={cameraType} />

              <View style={styles.cameraBottomPanel}>
                <View style={styles.cameraThumbStrip}>
                  <FlatList
                    horizontal
                    data={pendingCameraPhotos}
                    keyExtractor={(item) => item.id}
                    showsHorizontalScrollIndicator={false}
                    renderItem={({ item }) => (
                      <View style={styles.cameraThumbWrapper}>
                        <Image source={{ uri: item.uri }} style={styles.cameraThumb} />
                        <TouchableOpacity
                          style={styles.cameraThumbDelete}
                          onPress={() => removePendingCameraPhoto(item.id)}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Text style={styles.cameraThumbDeleteText}>×</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    ListEmptyComponent={
                      <Text style={styles.cameraHintText}>
                        Snap photos — they’ll show up here before upload.
                      </Text>
                    }
                  />
                </View>

                <View style={styles.cameraControlsRow}>
                  <TouchableOpacity
                    style={styles.cameraMiniBtn}
                    onPress={clearPendingCameraPhotos}
                    disabled={!pendingCameraPhotos.length}
                  >
                    <Text style={styles.cameraMiniBtnText}>Clear</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.shutterOuter} onPress={capturePhoto} disabled={isCapturing}>
                    <View style={[styles.shutterInner, isCapturing && { opacity: 0.7, transform: [{ scale: 0.9 }] }]} />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.cameraMiniBtn, !pendingCameraPhotos.length && { opacity: 0.6 }]}
                    onPress={uploadPendingCameraPhotos}
                    disabled={!pendingCameraPhotos.length}
                  >
                    <Text style={styles.cameraMiniBtnText}>Upload</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}
        </SafeAreaView>
      </Modal>

      {/* Pending Photo Fullscreen Viewer */}
      <Modal visible={pendingViewerVisible} transparent animationType="fade" onRequestClose={closePendingViewer}>
        <View style={styles.viewerOverlay}>
          <SafeAreaView style={styles.viewerSafe}>
            <View style={styles.viewerTop}>
              <TouchableOpacity onPress={closePendingViewer} style={styles.viewerTopBtn}>
                <Text style={styles.viewerTopBtnText}>Close</Text>
              </TouchableOpacity>
              <Text style={styles.viewerTitle}>
                Pending {pendingCount ? pendingViewerIndex + 1 : 0} / {pendingCount || 0}
              </Text>
              <TouchableOpacity onPress={deleteCurrentPendingFromViewer} style={styles.viewerTopBtn}>
                <Text style={[styles.viewerTopBtnText, { color: '#fca5a5' }]}>Delete</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.viewerBody}>
              {pendingActive ? (
                <Image source={{ uri: pendingActive }} style={styles.viewerImage} resizeMode="contain" />
              ) : (
                <Text style={{ color: '#fff' }}>No image</Text>
              )}
            </View>

            <View style={styles.viewerBottom}>
              <TouchableOpacity onPress={prevPending} style={styles.viewerNavBtn} disabled={pendingCount <= 1}>
                <Text style={styles.viewerNavText}>Prev</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={uploadPendingCameraPhotos} style={styles.viewerNavBtn} disabled={!pendingCount}>
                <Text style={styles.viewerNavText}>Upload All</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={nextPending} style={styles.viewerNavBtn} disabled={pendingCount <= 1}>
                <Text style={styles.viewerNavText}>Next</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>
      </Modal>

      {/* Uploaded Photo Viewer */}
      <Modal visible={photoViewerVisible} transparent animationType="fade" onRequestClose={closePhotoViewer}>
        <View style={styles.viewerOverlay}>
          <SafeAreaView style={styles.viewerSafe}>
            <View style={styles.viewerTop}>
              <TouchableOpacity onPress={closePhotoViewer} style={styles.viewerTopBtn}>
                <Text style={styles.viewerTopBtnText}>Close</Text>
              </TouchableOpacity>
              <Text style={styles.viewerTitle}>
                Photo {photos.length ? viewerIndex + 1 : 0} / {photos.length || 0}
              </Text>
              <TouchableOpacity onPress={handleShare} style={styles.viewerTopBtn}>
                <Text style={styles.viewerTopBtnText}>Share</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.viewerBody}>
              {photos[viewerIndex] ? (
                <Image source={{ uri: photos[viewerIndex] }} style={styles.viewerImage} resizeMode="contain" />
              ) : (
                <Text style={{ color: '#fff' }}>No image</Text>
              )}
            </View>

            <View style={styles.viewerBottom}>
              <TouchableOpacity onPress={prevPhoto} style={styles.viewerNavBtn} disabled={photos.length <= 1}>
                <Text style={styles.viewerNavText}>Prev</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  // map viewerIndex into attachmentKeys for delete
                  // photos[] was built from photoPath image urls order; safest delete by searching key
                  const url = photos[viewerIndex];
                  const idx = attachmentUrls.findIndex((u) => u === url);
                  const key = idx >= 0 ? attachmentKeys[idx] : null;
                  if (!key) return Alert.alert('Error', 'Could not locate attachment key to delete.');
                  handleDeleteAttachmentByKey(key);
                }}
                style={styles.viewerNavBtn}
                disabled={!photos.length}
              >
                <Text style={[styles.viewerNavText, { color: '#fca5a5' }]}>Delete</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={nextPhoto} style={styles.viewerNavBtn} disabled={photos.length <= 1}>
                <Text style={styles.viewerNavText}>Next</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>
      </Modal>

      {/* Add Note Modal */}
      <Modal visible={showAddNoteModal} transparent animationType="fade" onRequestClose={() => setShowAddNoteModal(false)}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalCenter}
          >
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Add Note</Text>
              <TextInput
                value={newNoteText}
                onChangeText={setNewNoteText}
                placeholder="Type your note…"
                placeholderTextColor="#94a3b8"
                multiline
                style={styles.modalInput}
              />
              <View style={styles.modalRow}>
                <TouchableOpacity style={[styles.modalBtn, styles.modalBtnGray]} onPress={() => setShowAddNoteModal(false)}>
                  <Text style={styles.modalBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalBtn, styles.modalBtnGreen]} onPress={addNote}>
                  <Text style={styles.modalBtnTextDark}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Status Modal */}
      <Modal visible={showStatusModal} transparent animationType="fade" onRequestClose={() => setShowStatusModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCenter}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Change Status</Text>
              <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ paddingVertical: 6 }}>
                {STATUS_OPTIONS.map((s) => {
                  const active = s === pendingStatus;
                  return (
                    <TouchableOpacity
                      key={s}
                      style={[styles.statusOption, active && styles.statusOptionActive]}
                      onPress={() => setPendingStatus(s)}
                    >
                      <Text style={[styles.statusOptionText, active && styles.statusOptionTextActive]}>{s}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <View style={styles.modalRow}>
                <TouchableOpacity style={[styles.modalBtn, styles.modalBtnGray]} onPress={() => setShowStatusModal(false)}>
                  <Text style={styles.modalBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalBtn, styles.modalBtnGreen]} onPress={applyStatus}>
                  <Text style={styles.modalBtnTextDark}>Apply</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Attachments Modal */}
      <Modal visible={viewAttachmentsVisible} animationType="slide" onRequestClose={() => setViewAttachmentsVisible(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#0b1220' }}>
          <View style={styles.attachTopBar}>
            <TouchableOpacity onPress={() => setViewAttachmentsVisible(false)} style={styles.attachTopBtn}>
              <Text style={styles.attachTopBtnText}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.attachTopTitle}>Attachments</Text>
            <View style={{ width: 64 }} />
          </View>

          <ScrollView contentContainerStyle={{ padding: 14 }}>
            {/* WO / Estimate / PO quick buttons */}
            <View style={styles.attachGroup}>
              <Text style={styles.attachHeader}>Documents</Text>

              <TouchableOpacity style={styles.attachDocBtn} onPress={() => openDocGroup('WO', 0)}>
                <Text style={styles.attachDocText}>View Work Order PDF</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.attachDocBtn} onPress={() => openDocGroup('EST', 0)} disabled={!estimateUrls.length}>
                <Text style={[styles.attachDocText, !estimateUrls.length && { opacity: 0.55 }]}>
                  View Estimate PDFs ({estimateUrls.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.attachDocBtn} onPress={() => openDocGroup('PO', 0)} disabled={!poUrls.length}>
                <Text style={[styles.attachDocText, !poUrls.length && { opacity: 0.55 }]}>
                  View PO PDFs ({poUrls.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.attachDocBtn}
                onPress={() => openDocGroup('ATTACH', 0)}
                disabled={!attachmentPdfUrls.length}
              >
                <Text style={[styles.attachDocText, !attachmentPdfUrls.length && { opacity: 0.55 }]}>
                  View Attached PDFs ({attachmentPdfUrls.length})
                </Text>
              </TouchableOpacity>
            </View>

            {/* Photo attachments */}
            <View style={styles.attachGroup}>
              <Text style={styles.attachHeader}>Photos</Text>
              {attachmentPhotoUrls.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {attachmentPhotoUrls.map((u, idx) => (
                    <TouchableOpacity
                      key={u + idx}
                      style={styles.attachThumbWrap}
                      onPress={() => openPhotoViewerFromAttachments(idx)}
                    >
                      <Image source={{ uri: u }} style={styles.attachThumb} />
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <Text style={styles.attachEmpty}>No photo attachments.</Text>
              )}
            </View>

            {/* PDF attachments list (delete individual) */}
            <View style={styles.attachGroup}>
              <Text style={styles.attachHeader}>PDF Attachments</Text>
              {attachmentPdfUrls.length ? (
                attachmentPdfUrls.map((u, idx) => {
                  // map pdf url -> original key for delete
                  const keyIndex = attachmentUrls.findIndex((x) => x === u);
                  const key = keyIndex >= 0 ? attachmentKeys[keyIndex] : null;
                  return (
                    <View key={u + idx} style={styles.attachPdfRow}>
                      <TouchableOpacity style={{ flex: 1 }} onPress={() => openAttachmentPdfByIndex(idx)}>
                        <Text style={styles.attachPdfName}>Attachment PDF {idx + 1}</Text>
                        <Text style={styles.attachPdfSub} numberOfLines={1}>
                          {u}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.attachPdfDelete}
                        onPress={() => handleDeleteAttachmentByKey(key)}
                        disabled={!key}
                      >
                        <Text style={styles.attachPdfDeleteText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })
              ) : (
                <Text style={styles.attachEmpty}>No PDF attachments.</Text>
              )}
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* PDF Lightbox Modal (multi-page viewer) */}
      <Modal visible={docModalVisible} animationType="slide" onRequestClose={() => setDocModalVisible(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#0b1220' }}>
          <View style={styles.attachTopBar}>
            <TouchableOpacity onPress={() => setDocModalVisible(false)} style={styles.attachTopBtn}>
              <Text style={styles.attachTopBtnText}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.attachTopTitle}>
              {docItems[docIndex]?.title || 'Document'} ({docIndex + 1}/{docItems.length || 1})
            </Text>
            <View style={{ flexDirection: 'row' }}>
              <TouchableOpacity onPress={prevDoc} style={[styles.attachTopBtn, { marginRight: 8 }]} disabled={docItems.length <= 1}>
                <Text style={[styles.attachTopBtnText, docItems.length <= 1 && { opacity: 0.55 }]}>Prev</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={nextDoc} style={styles.attachTopBtn} disabled={docItems.length <= 1}>
                <Text style={[styles.attachTopBtnText, docItems.length <= 1 && { opacity: 0.55 }]}>Next</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ flex: 1, padding: 10 }}>
            {docLoading ? (
              <View style={styles.center}>
                <ActivityIndicator size="large" />
                <Text style={{ color: '#cbd5e1', marginTop: 10, fontWeight: '700' }}>Loading PDF…</Text>
              </View>
            ) : docError ? (
              <View style={styles.center}>
                <Text style={{ color: '#fecaca', fontWeight: '700' }}>{docError}</Text>
              </View>
            ) : !docB64 ? (
              <View style={styles.center}>
                <Text style={{ color: '#cbd5e1' }}>No PDF data.</Text>
              </View>
            ) : (
              <WebView
                originWhitelist={['*']}
                source={{ html: PDF_VIEWER_HTML }}
                injectedJavaScript={injectedPdfViewerJS}
                javaScriptEnabled
                domStorageEnabled
                allowFileAccess
                style={{ width: '100%', height: docHeight, backgroundColor: '#0b1220' }}
                onMessage={(e) => {
                  const msg = e?.nativeEvent?.data || '';
                  if (msg.startsWith('HEIGHT:')) {
                    const h = Number(msg.replace('HEIGHT:', '').trim());
                    if (!Number.isNaN(h) && h > 200) setDocHeight(Math.min(h + 40, screenHeight));
                  } else if (msg.startsWith('ERROR:')) {
                    setDocError(msg.replace('ERROR:', '').trim());
                  }
                }}
              />
            )}
          </View>
        </SafeAreaView>
      </Modal>

      {/* Annotate & Sign Modal */}
      <Modal visible={annotateVisible} animationType="slide" onRequestClose={() => setAnnotateVisible(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#0b1220' }}>
          <View style={styles.attachTopBar}>
            <TouchableOpacity onPress={() => setAnnotateVisible(false)} style={styles.attachTopBtn}>
              <Text style={styles.attachTopBtnText}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.attachTopTitle}>Annotate & Sign</Text>
            <View style={{ width: 64 }} />
          </View>

          {!pdfBase64 ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" />
              <Text style={{ color: '#cbd5e1', marginTop: 10, fontWeight: '700' }}>Preparing PDF…</Text>
            </View>
          ) : (
            <WebView
              originWhitelist={['*']}
              source={{ html: ANNOTATOR_HTML }}
              injectedJavaScript={injectedAnnotatorJS}
              javaScriptEnabled
              domStorageEnabled
              allowFileAccess
              style={{ flex: 1, backgroundColor: '#0b1220' }}
              onMessage={(e) => {
                const msg = e?.nativeEvent?.data || '';
                if (msg.startsWith('PDF_BASE64:')) {
                  const b64 = msg.replace('PDF_BASE64:', '');
                  setAnnotateVisible(false);
                  uploadSignedPdfBase64(b64);
                } else if (msg.startsWith('ERROR:')) {
                  Alert.alert('Annotator Error', msg.replace('ERROR:', '').trim());
                }
              }}
            />
          )}
        </SafeAreaView>
      </Modal>

      {/* Sketch Modal */}
      <Modal visible={sketchVisible} animationType="slide" onRequestClose={() => setSketchVisible(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#0b1220' }}>
          <View style={styles.attachTopBar}>
            <TouchableOpacity onPress={() => setSketchVisible(false)} style={styles.attachTopBtn}>
              <Text style={styles.attachTopBtnText}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.attachTopTitle}>Draw Note</Text>
            <View style={{ width: 64 }} />
          </View>

          <WebView
            originWhitelist={['*']}
            source={{ html: SKETCH_HTML }}
            javaScriptEnabled
            domStorageEnabled
            style={{ flex: 1, backgroundColor: '#0b1220' }}
            onMessage={(e) => {
              const msg = e?.nativeEvent?.data || '';
              if (msg.startsWith('PNG_BASE64:')) {
                const b64 = msg.replace('PNG_BASE64:', '');
                setSketchVisible(false);
                uploadSketchPngBase64(b64);
              } else if (msg.startsWith('ERROR:')) {
                Alert.alert('Sketch Error', msg.replace('ERROR:', '').trim());
              }
            }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

/** Styles */
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F1F5F9' },
  details: { padding: 16, paddingBottom: 24 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#2B2D42',
    textAlign: 'center',
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 3,
  },
  row: { flexDirection: 'row', marginBottom: 8, flexWrap: 'wrap' },
  label: { width: 140, fontWeight: '600', color: '#3D5A80' },
  value: { flex: 1, color: '#2B2D42' },
  linkText: { color: '#007bff', textDecorationLine: 'underline' },

  buttonBase: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  backBtn: { backgroundColor: '#6c757d' },
  backText: { color: '#FFF', fontWeight: '600', fontSize: 16 },
  photoBtn: { backgroundColor: '#17a2b8' },
  photoText: { color: '#FFF', fontWeight: '600', fontSize: 16 },
  attachBtn: { backgroundColor: '#343a40' },
  attachText: { color: '#FFF', fontWeight: '600', fontSize: 16 },
  noteBtn: { backgroundColor: '#ffc107' },
  noteText: { color: '#000', fontWeight: '700', fontSize: 16 },

  smallBtn: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#0ea5e9',
    borderRadius: 8,
  },
  smallBtnText: { color: '#fff', fontWeight: '700' },

  sectionHeader: { fontSize: 18, fontWeight: '700', marginVertical: 8, color: '#2B2D42' },

  noteCard: {
    backgroundColor: '#FFF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  noteTimestamp: { fontSize: 12, color: '#8D99AE', marginBottom: 4 },
  noteBody: { fontSize: 14, color: '#2B2D42' },

  // Pending section
  pendingSection: {
    marginTop: 12,
    marginBottom: 8,
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  pendingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  pendingTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  pendingCount: { fontSize: 13, fontWeight: '600', color: '#4B5563' },
  pendingList: { paddingVertical: 4 },
  pendingThumbWrapper: { width: 120, height: 120, marginRight: 10 },
  pendingThumb: { width: '100%', height: '100%', borderRadius: 10, backgroundColor: '#E5E7EB' },
  pendingDeleteIcon: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingDeleteText: { color: '#fff', fontSize: 14, lineHeight: 18 },
  pendingActionsRow: { marginTop: 12 },
  pendingUploadBtn: { backgroundColor: '#15803D' },
  pendingUploadText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  pendingDiscardBtn: { backgroundColor: '#DC2626', marginTop: 6 },
  pendingDiscardText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },

  // Camera styles
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  cameraTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: 'space-between',
    backgroundColor: 'rgba(15,23,42,0.95)',
  },
  cameraTopBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#64748b',
  },
  cameraTopBtnText: { color: '#e5e7eb', fontWeight: '600', fontSize: 13 },
  cameraTitle: { color: '#e5e7eb', fontWeight: '700', fontSize: 16 },
  camera: { flex: 1 },
  cameraBottomPanel: { paddingBottom: 16, paddingTop: 8, backgroundColor: 'rgba(15,23,42,0.96)' },
  cameraThumbStrip: { minHeight: 70, paddingHorizontal: 10, marginBottom: 8 },
  cameraThumbWrapper: { width: 60, height: 60, borderRadius: 8, overflow: 'hidden', marginRight: 8 },
  cameraThumb: { width: '100%', height: '100%', backgroundColor: '#1f2937' },
  cameraThumbDelete: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraThumbDeleteText: { color: '#fff', fontSize: 11, lineHeight: 14 },
  cameraHintText: { color: '#9ca3af', fontSize: 12, paddingVertical: 16 },
  cameraControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 32,
    paddingTop: 4,
  },
  shutterOuter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#f97316' },
  cameraMiniBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#6b7280',
    backgroundColor: '#111827',
  },
  cameraMiniBtnText: { color: '#e5e7eb', fontWeight: '600', fontSize: 13 },
  cameraErrorText: { color: '#f97373', fontSize: 14 },

  // Generic modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCenter: { alignItems: 'center', justifyContent: 'center' },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#0b1220',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.25)',
  },
  modalTitle: { color: '#e5e7eb', fontWeight: '800', fontSize: 16, marginBottom: 10 },
  modalInput: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.25)',
    borderRadius: 12,
    padding: 12,
    color: '#e5e7eb',
    backgroundColor: 'rgba(15,23,42,0.85)',
    textAlignVertical: 'top',
  },
  modalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
  modalBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, marginLeft: 10 },
  modalBtnGray: { backgroundColor: 'rgba(148,163,184,0.2)' },
  modalBtnGreen: { backgroundColor: '#16a34a' },
  modalBtnText: { color: '#e5e7eb', fontWeight: '800' },
  modalBtnTextDark: { color: '#03120a', fontWeight: '900' },

  // Status
  statusOption: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(148,163,184,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.18)',
    marginBottom: 8,
  },
  statusOptionActive: { backgroundColor: 'rgba(34,197,94,0.25)', borderColor: 'rgba(34,197,94,0.5)' },
  statusOptionText: { color: '#e5e7eb', fontWeight: '800' },
  statusOptionTextActive: { color: '#bbf7d0' },

  // Attachments top bar
  attachTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(2,6,23,0.98)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148,163,184,0.18)',
  },
  attachTopBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.3)',
  },
  attachTopBtnText: { color: '#e5e7eb', fontWeight: '800', fontSize: 12 },
  attachTopTitle: { color: '#e5e7eb', fontWeight: '900', fontSize: 14, maxWidth: screenWidth * 0.55 },

  attachGroup: {
    marginBottom: 16,
    backgroundColor: 'rgba(15,23,42,0.85)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.18)',
    padding: 12,
  },
  attachHeader: { color: '#e5e7eb', fontWeight: '900', fontSize: 14, marginBottom: 10 },
  attachDocBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(148,163,184,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.18)',
    marginBottom: 10,
  },
  attachDocText: { color: '#e5e7eb', fontWeight: '800' },
  attachEmpty: { color: '#94a3b8', fontWeight: '700' },

  attachThumbWrap: {
    width: (screenWidth - 14 * 2 - 12 * 2 - 10) / 3,
    height: (screenWidth - 14 * 2 - 12 * 2 - 10) / 3,
    marginRight: 5,
    marginBottom: 5,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(148,163,184,0.12)',
  },
  attachThumb: { width: '100%', height: '100%' },

  attachPdfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(148,163,184,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.18)',
    marginBottom: 10,
  },
  attachPdfName: { color: '#e5e7eb', fontWeight: '900' },
  attachPdfSub: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  attachPdfDelete: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(220,38,38,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(220,38,38,0.5)',
    marginLeft: 10,
  },
  attachPdfDeleteText: { color: '#fecaca', fontWeight: '900', fontSize: 12 },

  // Viewer overlay (photos)
  viewerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' },
  viewerSafe: { flex: 1 },
  viewerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  viewerTopBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  viewerTopBtnText: { color: '#e5e7eb', fontWeight: '900' },
  viewerTitle: { color: '#e5e7eb', fontWeight: '900' },
  viewerBody: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  viewerImage: { width: screenWidth, height: screenHeight * 0.72 },
  viewerBottom: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(148,163,184,0.18)',
  },
  viewerNavBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.25)',
    backgroundColor: 'rgba(15,23,42,0.85)',
  },
  viewerNavText: { color: '#e5e7eb', fontWeight: '900' },
});
