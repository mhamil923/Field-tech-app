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
  PanResponder,
  SafeAreaView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import Canvas from 'react-native-canvas';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import moment from 'moment';
import { useLocalSearchParams, useRouter } from 'expo-router';

import api, { fileUrl } from '../../constants/api';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

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

    function b64ToUint8(b64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }

    async function renderPDF() {
      try {
        const b64 = window.PDF_BASE64 || '';
        if (!b64) throw new Error('Missing PDF data.');
        const doc = await pdfjsLib.getDocument({ data: b64ToUint8(b64) }).promise;
        const container = document.getElementById('pages');
        container.innerHTML = '';

        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          const targetWidth = Math.min(1100, Math.max(600, vp.width));
          const scale = targetWidth / vp.width;
          const viewport = page.getViewport({ scale });

          const wrap = document.createElement('div'); wrap.className = 'pageWrap';
          const pageCanvas = document.createElement('canvas'); pageCanvas.className = 'page';
          pageCanvas.width = Math.floor(viewport.width); pageCanvas.height = Math.floor(viewport.height);
          wrap.appendChild(pageCanvas);
          container.appendChild(wrap);

          const ctx = pageCanvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport }).promise;
        }

        setTimeout(() => {
          const h = Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight
          );
          window.ReactNativeWebView?.postMessage('HEIGHT:' + h);
        }, 50);
      } catch (e) {
        window.ReactNativeWebView?.postMessage('ERROR:' + (e?.message || String(e)));
      }
    }

    window.addEventListener('DOMContentLoaded', renderPDF);
  </script>
</body>
</html>
`;

/**
 * Annotator HTML (PDF signer/annotator) with white-paint eraser
 */
const ANNOTATOR_HTML = `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>Annotate PDF</title>
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
    <button id="save" class="primary">Save & Upload</button>
  </div>
  <div id="pages"></div>
  <div class="hint">Turn OFF “Draw Mode” to scroll. Turn it ON to sign/annotate.</div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <script>pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";</script>
  <script src="https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js"></script>

  <script>
    function b64ToUint8(b64){const bin=atob(b64);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return bytes;}
    function dataURLFromCanvas(c){return c.toDataURL('image/png');}

    const state = { tool: 'pen', drawEnabled: false, pages: [] };

    function applyPointerMode() {
      for (const p of state.pages) {
        p.overlayCanvas.style.pointerEvents = state.drawEnabled ? 'auto' : 'none';
        p.overlayCanvas.style.touchAction = state.drawEnabled ? 'none' : 'auto';
        p.overlayCanvas.style.cursor = state.drawEnabled
          ? (state.tool === 'erase' ? 'cell' : 'crosshair')
          : 'default';
      }
    }
    function setTool(t){ state.tool=t; applyPointerMode(); }
    function setDrawEnabled(on){ state.drawEnabled=!!on; applyPointerMode(); }

    function pushUndo(p){
      try{
        const snap=p.overlayCtx.getImageData(0,0,p.overlayCanvas.width,p.overlayCanvas.height);
        p.strokes.push(snap); if(p.strokes.length>50) p.strokes.shift();
      }catch(e){}
    }
    function undo(p){ if(p.strokes.length) p.overlayCtx.putImageData(p.strokes.pop(),0,0); }
    function clearPage(p){ pushUndo(p); p.overlayCtx.clearRect(0,0,p.overlayCanvas.width,p.overlayCanvas.height); }

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
          octx.lineWidth=3; octx.lineCap='round'; octx.lineJoin='round'; octx.strokeStyle='#000'; octx.globalCompositeOperation='source-over';

          const pState={pageCanvas,overlayCanvas:overlay,overlayCtx:octx,strokes:[]};
          state.pages.push(pState);

          let drawing=false,lastX=0,lastY=0;
          function pos(ev){
            const r=overlay.getBoundingClientRect();
            const x=(ev.touches?ev.touches[0].clientX:ev.clientX)-r.left;
            const y=(ev.touches?ev.touches[0].clientY:ev.clientY)-r.top;
            const sx=overlay.width/r.width, sy=overlay.height/r.height;
            return {x:x*sx,y:y*sy};
          }
          function start(ev){
            if(!state.drawEnabled) return;
            ev.preventDefault();
            pushUndo(pState);
            drawing=true;
            const {x,y}=pos(ev); lastX=x; lastY=y;
          }
          function move(ev){
            if(!state.drawEnabled || !drawing) return;
            ev.preventDefault();
            const {x,y}=pos(ev);
            if(state.tool==='erase'){
              // White-paint eraser to avoid full-canvas clears on some devices
              octx.save();
              octx.globalCompositeOperation='source-over';
              octx.strokeStyle='#FFFFFF';
              octx.lineWidth=18;
              octx.beginPath(); octx.moveTo(lastX,lastY); octx.lineTo(x,y); octx.stroke();
              octx.restore();
            } else {
              octx.save();
              octx.globalCompositeOperation='source-over';
              octx.strokeStyle='#000000';
              octx.lineWidth=3;
              octx.beginPath(); octx.moveTo(lastX,lastY); octx.lineTo(x,y); octx.stroke();
              octx.restore();
            }
            lastX=x; lastY=y;
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
          const dataUrl=dataURLFromCanvas(view.overlayCanvas);
          const pngBytes=await (await fetch(dataUrl)).arrayBuffer();
          const png=await pdfDoc.embedPng(pngBytes);

          const pageW=p.getWidth(), pageH=p.getHeight();
          const scaleX=pageW/view.overlayCanvas.width;
          const scaleY=pageH/view.overlayCanvas.height;

          p.drawImage(png,{x:0,y:0,width:view.overlayCanvas.width*scaleX,height:view.overlayCanvas.height*scaleY,opacity:1});
        }

        const outB64 = pdfDoc.saveAsBase64 ? await pdfDoc.saveAsBase64({dataUri:false}) : btoa(String.fromCharCode(...(await pdfDoc.save())));
        window.ReactNativeWebView?.postMessage('SIGNED:'+outB64);
      }catch(e){
        window.ReactNativeWebView?.postMessage('ERROR:'+(e?.message||String(e)));
      }
    }

    window.addEventListener('DOMContentLoaded',()=>{
      document.getElementById('pen').addEventListener('click',()=>setTool('pen'));
      document.getElementById('erase').addEventListener('click',()=>setTool('erase'));
      document.getElementById('save').addEventListener('click',saveAndUpload);
      document.getElementById('undo').addEventListener('click',()=>{
        const winTop=window.scrollY; let target=state.pages[0];
        for(const p of state.pages){
          const top=p.overlayCanvas.getBoundingClientRect().top+window.scrollY;
          if(top<=winTop+100) target=p;
        }
        undo(target);
      });
      document.getElementById('clear').addEventListener('click',()=>{
        const winTop=window.scrollY; let target=state.pages[0];
        for(const p of state.pages){
          const top=p.overlayCanvas.getBoundingClientRect().top+window.scrollY;
          if(top<=winTop+100) target=p;
        }
        clearPage(target);
      });
      document.getElementById('drawToggle').addEventListener('change',e=>setDrawEnabled(e.target.checked));
      renderPDF();
    });
  </script>
</body>
</html>
`;

export default function ViewWorkOrder() {
  const params = useLocalSearchParams();
  const workOrderId = params?.id ? (Array.isArray(params.id) ? params.id[0] : params.id) : null;
  const router = useRouter();

  // Draw-note canvas refs
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);

  // Draw-note tool state
  const [drawTool, setDrawTool] = useState('pen'); // 'pen' | 'erase'
  const lastPt = useRef({ x: 0, y: 0, has: false });
  const PEN_WIDTH = 4;
  const ERASER_WIDTH = 20;

  // Draw a single segment based on tool (eraser paints white)
  const drawSegment = (x1, y1, x2, y2) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = drawTool === 'erase' ? '#FFFFFF' : '#000000';
    ctx.lineWidth = drawTool === 'erase' ? ERASER_WIDTH : PEN_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  };

  // PanResponder for drawing/erasing
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: e => {
        const { locationX, locationY } = e.nativeEvent;
        lastPt.current = { x: locationX, y: locationY, has: true };
        // Dot on tap
        drawSegment(locationX, locationY, locationX + 0.01, locationY + 0.01);
      },
      onPanResponderMove: e => {
        const { locationX, locationY } = e.nativeEvent;
        if (lastPt.current.has) {
          drawSegment(lastPt.current.x, lastPt.current.y, locationX, locationY);
        }
        lastPt.current = { x: locationX, y: locationY, has: true };
      },
      onPanResponderRelease: () => { lastPt.current.has = false; },
      onPanResponderTerminate: () => { lastPt.current.has = false; },
    })
  ).current;

  const [workOrder, setWorkOrder] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [notes, setNotes] = useState([]);

  const [showAddNoteModal, setShowAddNoteModal] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');

  const [showDrawModal, setShowDrawModal] = useState(false);
  const [viewAttachmentsVisible, setViewAttachmentsVisible] = useState(false);
  const [photoViewerVisible, setPhotoViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  // Annotator modal state
  const [annotateVisible, setAnnotateVisible] = useState(false);
  const [pdfBase64, setPdfBase64] = useState(null);
  const annotatorRef = useRef(null);

  // Inline viewer state (multi-page pdf.js)
  const [pdfInlineB64, setPdfInlineB64] = useState(null);
  const [pdfPreviewError, setPdfPreviewError] = useState(null);
  const [pdfInlineHeight, setPdfInlineHeight] = useState(Math.max(600, screenHeight * 0.8));

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

      setPdfInlineB64(null);
      setPdfPreviewError(null);
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
    } catch {
      Alert.alert('Error', 'Failed to load work order.');
    }
  }, [workOrderId]);

  useEffect(() => {
    fetchWorkOrder();
  }, [fetchWorkOrder]);

  // Canvas setup for Draw Notes
  const handleCanvas = (canvas) => {
    if (!canvas) return;
    canvas.width = screenWidth;
    canvas.height = screenHeight;
    const ctx = canvas.getContext('2d');

    // Solid white background so eraser (white paint) restores the page
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    ctxRef.current = ctx;
    canvasRef.current = canvas;
  };

  const clearCanvas = () => {
    if (!canvasRef.current || !ctxRef.current) return;
    const ctx = ctxRef.current;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    ctx.restore();
  };

  const saveDrawing = async () => {
    try {
      if (!canvasRef.current) throw new Error('Canvas not ready.');
      const dataUrl = await canvasRef.current.toDataURL();
      const base64Png = dataUrl.split(',')[1];

      const pngPath = FileSystem.cacheDirectory + `drawing_${Date.now()}.png`;
      await FileSystem.writeAsStringAsync(pngPath, base64Png, { encoding: FileSystem.EncodingType.Base64 });

      // Compress to JPEG to keep uploads small
      let uploadUri = pngPath;
      let uploadType = 'image/png';
      let uploadName = 'drawing.png';
      try {
        const jpeg = await ImageManipulator.manipulateAsync(
          pngPath,
          [],
          { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
        );
        uploadUri = jpeg.uri;
        uploadType = 'image/jpeg';
        uploadName = 'drawing.jpg';
      } catch {}

      const form = new FormData();
      form.append('photoFile', { uri: uploadUri, name: uploadName, type: uploadType });

      await api.put(`/work-orders/${workOrderId}/edit`, form, { headers: { 'Content-Type': 'multipart/form-data' } });

      setShowDrawModal(false);
      fetchWorkOrder();
    } catch (err) {
      Alert.alert('Error', err.message || 'Error uploading drawing');
      setShowDrawModal(false);
    }
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
      { text: 'Cancel', style: 'cancel' },
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

  const onAnnotatorMessage = async (ev) => {
    const msg = ev?.nativeEvent?.data || '';
    if (msg.startsWith('ERROR:')) {
      Alert.alert('Annotator Error', msg.slice(6));
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

  // ------- derived fields for display (with fallbacks) -------
  const poNumber = workOrder?.poNumber || '—';
  const customer = workOrder?.customer || workOrder?.customerName || '—';
  const siteLocation = workOrder?.siteLocation || workOrder?.serviceAddress || workOrder?.address || '—';
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

  // Try a few common shapes for billing address
  const billingAddress =
    workOrder?.billingAddress ||
    [workOrder?.billingAddress1, workOrder?.billingAddress2, workOrder?.billingCity, workOrder?.billingState, workOrder?.billingZip]
      .filter(Boolean)
      .join(', ') ||
    '';

  // -----------------------------------------------------------

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.details}>
        <Text style={styles.title}>Work Order Details</Text>

        <View style={styles.card}>
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
            {siteLocation && siteLocation !== '—' ? (
              <TouchableOpacity onPress={() => openMap(siteLocation)}>
                <Text style={[styles.value, styles.linkText]}>{siteLocation}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.value}>—</Text>
            )}
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Billing Address:</Text>
            {billingAddress ? (
              <TouchableOpacity onPress={() => openMap(billingAddress)}>
                <Text style={[styles.value, styles.linkText]}>{billingAddress}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.value}>—</Text>
            )}
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Problem Description:</Text>
            <Text style={styles.value}>{problem}</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Status:</Text>
            <Text style={styles.value}>{status}</Text>
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
        <TouchableOpacity style={[styles.buttonBase, styles.drawBtn]} onPress={() => setShowDrawModal(true)}>
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
      </ScrollView>

      {/* Photo Viewer */}
      <Modal visible={photoViewerVisible} animationType="fade" onRequestClose={() => setPhotoViewerVisible(false)}>
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
            <TouchableOpacity style={[styles.viewerButton, styles.exitBtn]} onPress={() => setPhotoViewerVisible(false)}>
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
                      setPhotoViewerVisible(true);
                    }}
                  >
                    <Image source={{ uri: item }} style={styles.thumbnail} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.deleteIcon} onPress={() => handleDeletePhoto(index)}>
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

      {/* Add Note Modal */}
      <Modal
        visible={showAddNoteModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAddNoteModal(false)}
      >
        <View style={styles.addNoteOverlay}>
          <View style={styles.addNoteContainer}>
            <Text style={styles.addNoteTitle}>New Note</Text>
            <TextInput
              style={styles.addNoteInput}
              multiline
              placeholder="Enter your note…"
              value={newNoteText}
              onChangeText={setNewNoteText}
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
        </View>
      </Modal>

      {/* Draw Note Modal */}
      <Modal visible={showDrawModal} animationType="slide" onRequestClose={() => setShowDrawModal(false)}>
        <View style={styles.drawContainer}>
          <Canvas ref={handleCanvas} style={styles.canvas} />
          <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers} />

          <View style={styles.drawToolbar}>
            <TouchableOpacity
              style={[styles.toolBtn, drawTool === 'pen' ? styles.toolBtnActive : null]}
              onPress={() => setDrawTool('pen')}
            >
              <Text style={[styles.toolText, drawTool === 'pen' ? styles.toolTextActive : null]}>Pen</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toolBtn, drawTool === 'erase' ? styles.toolBtnActive : null]}
              onPress={() => setDrawTool('erase')}
            >
              <Text style={[styles.toolText, drawTool === 'erase' ? styles.toolTextActive : null]}>Eraser</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.toolBtn, styles.clearBtn]} onPress={clearCanvas}>
              <Text style={[styles.toolText, styles.clearText]}>Clear</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.drawFooter}>
            <TouchableOpacity style={styles.saveDrawBtn} onPress={saveDrawing}>
              <Text style={styles.saveDrawText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.closeDrawBtn} onPress={() => setShowDrawModal(false)}>
              <Text style={styles.closeDrawText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
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
          <View style={{ position:'absolute', top: 8, right: 16 }}>
            <TouchableOpacity onPress={() => setAnnotateVisible(false)} style={{ backgroundColor:'#dc3545', padding:10, borderRadius:8 }}>
              <Text style={{ color:'#fff', fontWeight:'700' }}>Close</Text>
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
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: 18, color: '#3D5A80' },
  title: { fontSize: 24, fontWeight: '700', color: '#2B2D42', textAlign: 'center', marginBottom: 12 },
  card: { backgroundColor: '#FFF', borderRadius: 8, padding: 16, marginBottom: 16, elevation: 3 },
  row: { flexDirection: 'row', marginBottom: 8 },
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

  sectionHeader: { fontSize: 18, fontWeight: '600', marginVertical: 8, color: '#2B2D42' },
  noteCard: { backgroundColor: '#FFF', borderRadius: 6, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  noteTimestamp: { fontSize: 12, color: '#8D99AE', marginBottom: 4 },
  noteBody: { fontSize: 14, color: '#2B2D42' },

  drawContainer: { flex: 1, backgroundColor: '#FFF' },
  canvas: { width: screenWidth, height: screenHeight, backgroundColor: '#FFF' },

  drawToolbar: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.9)',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EEE',
  },
  toolBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  toolBtnActive: {
    backgroundColor: '#0d6efd',
    borderColor: '#0d6efd',
  },
  toolText: { color: '#2B2D42', fontWeight: '600' },
  toolTextActive: { color: '#fff' },
  clearBtn: { backgroundColor: '#dc3545', borderColor: '#dc3545' },
  clearText: { color: '#fff' },

  drawFooter: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 16,
    backgroundColor: '#FFF',
    borderTopWidth: 1,
    borderColor: '#EEE'
  },
  saveDrawBtn: { backgroundColor: '#28a745', padding: 12, borderRadius: 6 },
  saveDrawText: { color: '#FFF', fontWeight: '600', fontSize: 16 },
  closeDrawBtn: { backgroundColor: '#dc3545', padding: 12, borderRadius: 6 },
  closeDrawText: { color: '#FFF', fontWeight: '600', fontSize: 16 },

  viewerContainer: { flex: 1, backgroundColor: '#000' },
  fullScreenImage: { width: screenWidth, height: screenHeight, resizeMode: 'contain' },
  viewerButtons: { position: 'absolute', bottom: 40, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-around' },
  viewerButton: { flex: 1, marginHorizontal: 8, padding: 12, borderRadius: 6, alignItems: 'center' },
  shareBtn: { backgroundColor: 'rgba(255,255,255,0.3)' },
  shareText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  exitBtn: { backgroundColor: 'rgba(220,53,69,0.8)' },

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
});
