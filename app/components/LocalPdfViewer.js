// File: app/components/LocalPdfViewer.js
//
// Previews a PDF that exists only on this device.
//
// Why this exists: the recovered-sign-offs list used
//   WebBrowser.openBrowserAsync(entry.file)
// with a file:// URI. expo-web-browser's iOS module hard-rejects any scheme that
// isn't http/https (WebBrowserModule.swift: `url.scheme == "http" || "https"`,
// otherwise WebBrowserInvalidURLException), so EVERY local preview failed — not
// because of a bad path or a damaged file, but because that viewer structurally
// cannot open local files.
//
// The app's own pattern for showing a PDF without a server is the pdf.js WebView fed
// base64 (the work-order attachment lightbox). That is reused here, so preview works
// offline and needs no upload, no share sheet and no server round-trip.
import React, { useEffect, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import { loadPdfSources, buildPdfScriptBlock } from '../lib/pdfAssets';
import { PDF_VIEWER_HTML } from '../lib/pdfHtml';

const fmtBytes = (n) => {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} bytes`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
};

/**
 * @param {{ uri:string, title?:string }|null} file  null = closed
 * @param {() => void} onClose
 */
export default function LocalPdfViewer({ file, onClose }) {
  const [state, setState] = useState({ status: 'idle' });

  useEffect(() => {
    if (!file?.uri) { setState({ status: 'idle' }); return; }
    let alive = true;
    (async () => {
      setState({ status: 'loading' });
      try {
        const info = await FileSystem.getInfoAsync(file.uri);
        if (!info.exists) {
          if (alive) setState({ status: 'missing' });
          return;
        }
        const b64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });

        // A file can exist and still not be a PDF (a truncated write, or bytes that
        // never finished being produced). Say so with the size instead of failing
        // into a dead end — and never delete it; a damaged sign-off is still evidence.
        const header = b64 ? atobSafe(b64.slice(0, 12)) : '';
        if (!header.startsWith('%PDF')) {
          if (alive) setState({ status: 'damaged', size: info.size || 0, header: header.replace(/[^\x20-\x7e]/g, '.').slice(0, 8) });
          return;
        }

        const sources = await loadPdfSources();
        // Function replacement: pdf-lib/pdf.js sources contain "$&", which a string
        // replacement would expand. Same hazard as in ViewWorkOrder.
        const html = PDF_VIEWER_HTML.replace('<!--PDF_LIBS-->', () => buildPdfScriptBlock(sources, { withPdfLib: false }));
        if (alive) setState({ status: 'ready', html, b64, size: info.size || 0 });
      } catch (e) {
        if (alive) setState({ status: 'error', message: e?.message || String(e) });
      }
    })();
    return () => { alive = false; };
  }, [file?.uri]);

  return (
    <Modal visible={!!file} animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>{file?.title || 'Document'}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.close}>Close</Text>
          </TouchableOpacity>
        </View>

        {state.status === 'loading' && (
          <View style={styles.center}><ActivityIndicator color="#fff" /><Text style={styles.msg}>Opening…</Text></View>
        )}

        {state.status === 'missing' && (
          <View style={styles.center}>
            <Text style={styles.msgWarn}>This file is no longer on the device.</Text>
            <Text style={styles.msgDim}>The manifest entry was kept so nothing disappears silently.</Text>
          </View>
        )}

        {state.status === 'damaged' && (
          <View style={styles.center}>
            <Text style={styles.msgWarn}>This file appears damaged.</Text>
            <Text style={styles.msgDim}>
              It is {fmtBytes(state.size)} on disk but does not start with a PDF header
              {state.header ? ` (found "${state.header}")` : ''}, so it cannot be displayed.
            </Text>
            <Text style={styles.msgDim}>
              It has NOT been deleted. It stays in the list and can still be attached to a
              work order or pulled off the iPad over USB.
            </Text>
          </View>
        )}

        {state.status === 'error' && (
          <View style={styles.center}>
            <Text style={styles.msgWarn}>Could not read this file.</Text>
            <Text style={styles.msgDim}>{state.message}</Text>
          </View>
        )}

        {state.status === 'ready' && (
          <WebView
            originWhitelist={['*']}
            source={{ html: state.html }}
            javaScriptEnabled
            scrollEnabled
            nestedScrollEnabled
            showsVerticalScrollIndicator
            onError={(e) => setState({ status: 'error', message: e?.nativeEvent?.description || 'WebView failed to load' })}
            onHttpError={(e) => setState({ status: 'error', message: `WebView HTTP ${e?.nativeEvent?.statusCode}` })}
            injectedJavaScriptBeforeContentLoaded={`window.PDF_BASE64 = ${JSON.stringify(state.b64)}; true;`}
            style={{ flex: 1, backgroundColor: '#000' }}
          />
        )}
      </View>
    </Modal>
  );
}

// atob exists in Hermes; guard anyway so a missing global degrades to "damaged"
// rather than throwing.
function atobSafe(b64) {
  try {
    if (typeof atob === 'function') return atob(b64);
    return Buffer.from(b64, 'base64').toString('binary');
  } catch { return ''; }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000', paddingTop: Platform.OS === 'ios' ? 54 : 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 },
  title: { color: '#fff', fontWeight: '700', fontSize: 16, flex: 1, marginRight: 12 },
  close: { color: '#60a5fa', fontWeight: '700', fontSize: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },
  msg: { color: '#fff', marginTop: 10 },
  msgWarn: { color: '#fbbf24', fontWeight: '700', fontSize: 16, textAlign: 'center' },
  msgDim: { color: '#d1d5db', fontSize: 13, textAlign: 'center', lineHeight: 19 },
});
