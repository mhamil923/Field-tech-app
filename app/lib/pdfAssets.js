// File: app/lib/pdfAssets.js
//
// Offline PDF libraries for the signing/viewing WebViews.
//
// These used to be three <script src> tags pointing at cdnjs and unpkg, fetched
// live every time a tech opened a document. That made signing impossible without
// working internet to BOTH CDNs, and a dead CDN surfaced as "pdfjsLib is not
// defined" — or worse, with pdf.js up and pdf-lib down, as a signature that
// rendered perfectly and could never be saved. A sign-off was lost that way.
//
// The exact same versions are now vendored under assets/pdflibs/ and inlined into
// the WebView HTML at runtime. Nothing in the signing path touches the network.
//
// Why runtime assembly instead of a static template literal: the minified sources
// are full of backticks, ${...} and backslashes. Embedding them in a JS template
// literal would mean escaping ~1.9MB of third-party code correctly. Reading them as
// asset text and concatenating sidesteps that entirely, and costs nothing at startup
// because the read is lazy — it happens the first time a document is opened.
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

// Pinned versions — keep these in sync with the filenames if they are ever bumped.
export const PDFJS_VERSION = '3.11.174';
export const PDFLIB_VERSION = '1.17.1';

const MODULES = {
  pdfJs: require('../../assets/pdflibs/pdf.min.js.txt'),
  pdfWorker: require('../../assets/pdflibs/pdf.worker.min.js.txt'),
  pdfLib: require('../../assets/pdflibs/pdf-lib.min.js.txt'),
};

let _sources = null;      // { pdfJs, pdfWorker, pdfLib }
let _loading = null;      // in-flight promise, so concurrent opens share one read

async function readAssetText(mod) {
  const asset = Asset.fromModule(mod);
  // downloadAsync() resolves the dev-server URL in Expo Go / dev client and the
  // on-device bundle path in a release build, so localUri is correct either way.
  if (!asset.downloaded) await asset.downloadAsync();
  const uri = asset.localUri || asset.uri;
  if (!uri) throw new Error('PDF library asset has no URI');
  if (/^https?:/i.test(uri)) {
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`Failed to read PDF library asset (${res.status})`);
    return res.text();
  }
  return FileSystem.readAsStringAsync(uri);
}

// Guard against a source that could terminate the enclosing <script> block. None of
// the three pinned files contain this today (verified at vendoring time); this keeps
// that true if a version is ever bumped.
const scriptSafe = (src) => String(src).split('</script').join('<\\/script');

export async function loadPdfSources() {
  if (_sources) return _sources;
  if (!_loading) {
    _loading = (async () => {
      const [pdfJs, pdfWorker, pdfLib] = await Promise.all([
        readAssetText(MODULES.pdfJs),
        readAssetText(MODULES.pdfWorker),
        readAssetText(MODULES.pdfLib),
      ]);
      _sources = { pdfJs, pdfWorker, pdfLib };
      return _sources;
    })().catch((e) => { _loading = null; throw e; });
  }
  return _loading;
}

// pdf.js needs its worker from a URL. Offline that means a Blob URL built from the
// inlined worker source — the standard no-network pdf.js setup.
function workerBootstrap(workerSrc) {
  return `
<script id="pdfjs-worker-src" type="text/plain">${scriptSafe(workerSrc)}</script>
<script>
  (function(){
    try {
      var src = document.getElementById('pdfjs-worker-src').textContent;
      var blob = new Blob([src], { type: 'application/javascript' });
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
    } catch (e) {
      window.__PDF_BOOT_ERROR = 'worker init failed: ' + (e && e.message ? e.message : e);
    }
  })();
</script>`;
}

/**
 * Build the <head> script block that replaces the old CDN tags.
 * @param {{pdfJs:string,pdfWorker:string,pdfLib:string}} sources from loadPdfSources()
 * @param {{ withPdfLib?: boolean }} opts  viewer needs pdf.js only; annotator needs both
 */
export function buildPdfScriptBlock(sources, { withPdfLib = true } = {}) {
  return [
    `<script>${scriptSafe(sources.pdfJs)}</script>`,
    workerBootstrap(sources.pdfWorker),
    withPdfLib ? `<script>${scriptSafe(sources.pdfLib)}</script>` : '',
    // Surface a missing global as itself rather than as a downstream ReferenceError
    // thrown from deep inside render/save.
    `<script>
      (function(){
        var missing = [];
        if (typeof pdfjsLib === 'undefined') missing.push('pdf.js');
        ${withPdfLib ? "if (typeof PDFLib === 'undefined') missing.push('pdf-lib');" : ''}
        if (missing.length || window.__PDF_BOOT_ERROR) {
          window.__PDF_BOOT_ERROR = window.__PDF_BOOT_ERROR ||
            ('bundled PDF library failed to initialise: ' + missing.join(', '));
        }
      })();
    </script>`,
  ].join('\n');
}
