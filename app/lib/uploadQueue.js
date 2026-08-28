// File: app/lib/uploadQueue.js
//
// Persistent, crash-surviving upload queue for signed documents.
//
// Why this exists: a signed sign-off was captured in the field, the upload failed,
// and the document was gone — the app wrote the signed PDF to cacheDirectory (which
// iOS may purge), attempted exactly one upload with a 15s timeout, showed a
// dismissable alert, and kept no record. Nothing retried, and nothing was visible
// afterwards.
//
// The rules here follow from that:
//   1. Signed PDFs live in documentDirectory, never cacheDirectory. Caches are
//      OS-purgeable; a customer signature is not disposable.
//   2. A manifest entry is written BEFORE the first upload attempt, so a document
//      that never uploads is still recorded.
//   3. An entry and its file are removed ONLY on HTTP 2xx. There is no other delete
//      path — not on error, not on user action, not on "cleanup".
//   4. Queued work is visible in the UI. Silence is what lost the last one.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import api, { uploadConfig } from '../../constants/api';
import * as Crypto from 'expo-crypto';

const MANIFEST_KEY = 'uploadQueue.v1';

// documentDirectory survives OS cache eviction and (with UIFileSharingEnabled) is
// reachable from Finder/Files if a document ever needs manual recovery.
export const QUEUE_DIR = FileSystem.documentDirectory + 'pending-uploads/';

export const KIND = {
  SIGNED_PDF: 'signed_pdf',           // annotator "Annotate & Sign PDF" output
  CONTRACT_SIGNED: 'contract_signed', // residential contract in-field signature
};

// Backoff between AUTOMATIC attempts. Manual "Retry now" always runs immediately.
const BACKOFF_MS = [0, 15e3, 60e3, 5 * 60e3, 15 * 60e3, 60 * 60e3];
const backoffFor = (attempts) => BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];

let _listeners = new Set();
let _draining = false;

/* ───────────────────────── manifest primitives ───────────────────────── */

export async function readManifest() {
  try {
    const raw = await AsyncStorage.getItem(MANIFEST_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeManifest(list) {
  await AsyncStorage.setItem(MANIFEST_KEY, JSON.stringify(list));
  notify(list);
}

function notify(list) {
  for (const fn of _listeners) { try { fn(list); } catch {} }
}

export function subscribe(fn) {
  _listeners.add(fn);
  readManifest().then(fn).catch(() => {});
  return () => _listeners.delete(fn);
}

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(QUEUE_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(QUEUE_DIR, { intermediates: true });
}

/* ───────────────────────── enqueue ───────────────────────── */

/**
 * Persist a signed document and record it BEFORE any upload is attempted.
 * @param {object} p
 * @param {string} p.base64       signed PDF bytes, base64
 * @param {number|string|null} p.woId  work order id, or null when unknown (orphan)
 * @param {string} p.kind         KIND.*
 * @param {string} [p.filename]   override (orphan recovery reuses the found name)
 * @param {object} [p.meta]       kind-specific payload (contract signer name, etc.)
 * @returns {Promise<object>} the created manifest entry
 */
export async function enqueueSignedDocument({ base64, woId = null, kind = KIND.SIGNED_PDF, filename, meta = {} }) {
  await ensureDir();
  const ts = Date.now();
  const name = filename || `signed_${woId == null ? 'unknown' : woId}_${ts}.pdf`;
  const file = QUEUE_DIR + name;

  if (base64 != null) {
    await FileSystem.writeAsStringAsync(file, base64, { encoding: FileSystem.EncodingType.Base64 });
  }

  const entry = {
    id: `${ts}_${Math.random().toString(36).slice(2, 8)}`,
    file,
    filename: name,
    woId: woId == null ? null : String(woId),
    kind,
    meta,
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
    createdAt: new Date(ts).toISOString(),
  };

  const list = await readManifest();
  list.push(entry);
  await writeManifest(list);
  return entry;
}

/** Adopt an already-on-disk file (orphan recovery) without rewriting its bytes. */
export async function enqueueExistingFile({ file, filename, woId = null, kind = KIND.SIGNED_PDF, createdAt, meta = {} }) {
  const list = await readManifest();
  if (list.some((e) => e.file === file)) return null; // already tracked
  const ts = Date.now();
  const entry = {
    id: `${ts}_${Math.random().toString(36).slice(2, 8)}`,
    file,
    filename,
    woId: woId == null ? null : String(woId),
    kind,
    meta: { ...meta, recovered: true },
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
    createdAt: createdAt || new Date(ts).toISOString(),
  };
  list.push(entry);
  await writeManifest(list);
  return entry;
}

/** Assign a work order to a recovered orphan so it can be uploaded. */
export async function assignWorkOrder(entryId, woId) {
  const list = await readManifest();
  const e = list.find((x) => x.id === entryId);
  if (!e) return null;
  e.woId = String(woId);
  e.lastError = null;
  e.attempts = 0;
  await writeManifest(list);
  return e;
}

/* ───────────────────────── upload ───────────────────────── */

async function uploadEntry(entry) {
  if (entry.woId == null) throw new Error('No work order assigned yet.');

  if (entry.kind === KIND.CONTRACT_SIGNED) {
    // Contract signing posts JSON (name + signature image), not a file part.
    await api.post(
      `/work-orders/${entry.woId}/residential-contract/sign-infield`,
      { signerName: entry.meta?.signerName, signatureData: entry.meta?.signatureData },
      uploadConfig()
    );
    return;
  }

  const form = new FormData();
  form.append('pdfFile', { uri: entry.file, name: entry.filename, type: 'application/pdf' });
  await api.put(`/work-orders/${entry.woId}/edit`, form, uploadConfig({
    headers: { 'Content-Type': 'multipart/form-data' },
  }));
}

/**
 * Attempt one entry. Removes entry + file ONLY on success.
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function attemptEntry(entryId) {
  let list = await readManifest();
  const entry = list.find((e) => e.id === entryId);
  if (!entry) return { ok: false, error: 'Entry not found' };

  try {
    await uploadEntry(entry);
  } catch (e) {
    const msg =
      e?.response?.data?.error ||
      (e?.response?.status ? `HTTP ${e.response.status}` : null) ||
      e?.message ||
      'Upload failed';
    list = await readManifest();
    const cur = list.find((x) => x.id === entryId);
    if (cur) {
      cur.attempts += 1;
      cur.lastError = String(msg);
      cur.lastAttemptAt = new Date().toISOString();
      await writeManifest(list);
    }
    return { ok: false, error: String(msg) };
  }

  // 2xx only — axios rejects on non-2xx, so reaching here IS the success signal.
  list = await readManifest();
  const remaining = list.filter((x) => x.id !== entryId);
  await writeManifest(remaining);
  try { await FileSystem.deleteAsync(entry.file, { idempotent: true }); } catch {}
  return { ok: true };
}

/** Work the whole queue. Skips entries still inside their backoff window. */
export async function drainQueue({ force = false } = {}) {
  if (_draining) return { attempted: 0, uploaded: 0 };
  _draining = true;
  let attempted = 0, uploaded = 0;
  try {
    const list = await readManifest();
    for (const entry of list) {
      if (entry.woId == null) continue;              // orphan: needs a WO first
      if (!force && entry.lastAttemptAt) {
        const due = new Date(entry.lastAttemptAt).getTime() + backoffFor(entry.attempts);
        if (Date.now() < due) continue;
      }
      attempted += 1;
      const r = await attemptEntry(entry.id);
      if (r.ok) uploaded += 1;
    }
  } finally {
    _draining = false;
  }
  return { attempted, uploaded };
}

/* ───────────────────────── orphan recovery ───────────────────────── */

const RECOVERY_FLAG = 'uploadQueue.cacheScan.v1';

/**
 * One-time sweep of the OLD cacheDirectory location for signed PDFs that were
 * written before this queue existed (or by a build that still used the cache).
 * Anything found is MOVED into the queue directory and enqueued — never deleted.
 * `signed_<woId>_<ts>.pdf` yields a work order; the legacy `signed_<ts>.pdf` shape
 * has no WO in it and enters as an unknown-WO orphan for a human to identify.
 */
export async function recoverCachedOrphans({ force = false } = {}) {
  const found = [];
  try {
    if (!force) {
      const done = await AsyncStorage.getItem(RECOVERY_FLAG);
      if (done) return found;
    }
    await ensureDir();
    const dir = FileSystem.cacheDirectory;
    if (!dir) return found;

    let names = [];
    try { names = await FileSystem.readDirectoryAsync(dir); } catch { names = []; }

    for (const name of names) {
      if (!/^signed_.*\.pdf$/i.test(name)) continue;
      const from = dir + name;
      const to = QUEUE_DIR + name;
      try {
        const info = await FileSystem.getInfoAsync(from);
        if (!info.exists || !info.size) continue;

        // signed_<woId>_<ts>.pdf  ->  woId ;  signed_<ts>.pdf (legacy) -> unknown
        const m = name.match(/^signed_(\d+)_(\d+)\.pdf$/i);
        const legacy = name.match(/^signed_(\d+)\.pdf$/i);
        const woId = m ? m[1] : null;
        const stampMs = m ? Number(m[2]) : legacy ? Number(legacy[1]) : null;

        const dstInfo = await FileSystem.getInfoAsync(to);
        if (dstInfo.exists) {
          // Don't clobber a queued file that already owns this name.
          const alt = QUEUE_DIR + name.replace(/\.pdf$/i, `_${Date.now()}.pdf`);
          await FileSystem.moveAsync({ from, to: alt });
          found.push(await enqueueExistingFile({
            file: alt, filename: alt.split('/').pop(), woId,
            createdAt: stampMs ? new Date(stampMs).toISOString() : undefined,
          }));
        } else {
          await FileSystem.moveAsync({ from, to });
          found.push(await enqueueExistingFile({
            file: to, filename: name, woId,
            createdAt: stampMs ? new Date(stampMs).toISOString() : undefined,
          }));
        }
      } catch {
        // A single unreadable file must not abort the sweep.
      }
    }
    await AsyncStorage.setItem(RECOVERY_FLAG, new Date().toISOString());
  } catch {
    // Recovery is best-effort; never block app start.
  }
  return found.filter(Boolean);
}

/* ─────────────────── duplicate detection ───────────────────
 *
 * The pre-failsafe app wrote every signed PDF to the OS cache and never cleaned up —
 * on success as well as on failure — so the recovery sweep pulled in roughly ten
 * months of signed documents, most of which uploaded fine at the time. Telling those
 * apart from genuine orphans by eye is not feasible; asking the server whether it
 * already holds these exact bytes is.
 *
 * A confirmed hash match is the ONLY delete path besides a successful upload. It is
 * safe precisely because it is exact-bytes: a match means the server demonstrably has
 * this document, so the local copy is redundant rather than lost.
 */

const b64ToBytes = (b64) => {
  const bin = globalThis.atob ? globalThis.atob(b64) : '';
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const toHex = (buf) =>
  Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');

/** SHA-256 of a queued file's raw bytes — the same bytes the server hashes. */
export async function hashEntryFile(entry) {
  const b64 = await FileSystem.readAsStringAsync(entry.file, { encoding: FileSystem.EncodingType.Base64 });
  const bytes = b64ToBytes(b64);
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return { hash: toHex(digest), size: bytes.length };
}

/**
 * Hash every file-backed entry and ask the server which already exist.
 * Results are written back onto the manifest so the UI can show them and so
 * clearDuplicate() has something to check against.
 */
export async function checkDuplicates({ onProgress } = {}) {
  const list = await readManifest();
  const targets = list.filter((e) => e.kind !== KIND.CONTRACT_SIGNED);
  const payload = [];
  const byHash = new Map();

  for (let i = 0; i < targets.length; i++) {
    const e = targets[i];
    try {
      const { hash, size } = await hashEntryFile(e);
      payload.push({ hash, size });
      if (!byHash.has(hash)) byHash.set(hash, []);
      byHash.get(hash).push(e.id);
      e.__hash = hash;
    } catch (err) {
      // Unreadable/damaged file: leave it alone and un-checked. Never clearable.
      e.__hash = null;
      e.__hashError = err?.message || String(err);
    }
    onProgress?.(i + 1, targets.length);
  }

  if (!payload.length) return { checked: 0, matched: 0 };

  const res = await api.post('/api/signoffs/hashes', payload, { timeout: 120000 });
  const results = res?.data?.results || [];
  const lookup = new Map(results.map((r) => [r.hash, r]));

  const fresh = await readManifest();
  const checkedAt = new Date().toISOString();
  let matched = 0;
  for (const e of fresh) {
    const t = targets.find((x) => x.id === e.id);
    if (!t) continue;
    if (!t.__hash) {
      e.dupCheck = { status: 'unreadable', error: t.__hashError || 'could not read file', checkedAt };
      continue;
    }
    const hit = lookup.get(t.__hash);
    if (hit?.matched) {
      matched += 1;
      e.dupCheck = {
        status: 'duplicate',
        hash: t.__hash,
        workOrderId: hit.workOrderId ?? null,
        workOrderLabel: hit.workOrderLabel || null,
        s3Key: hit.s3Key || null,
        checkedAt,
      };
    } else {
      e.dupCheck = { status: 'orphan', hash: t.__hash, checkedAt };
    }
  }
  await writeManifest(fresh);
  return { checked: payload.length, matched };
}

/**
 * Delete a hash-confirmed duplicate. Refuses anything not confirmed by the server —
 * the guard lives here rather than in the UI so no future caller can bypass it.
 */
export async function clearDuplicate(entryId) {
  const list = await readManifest();
  const entry = list.find((e) => e.id === entryId);
  if (!entry) return { ok: false, error: 'Entry not found' };
  if (entry.dupCheck?.status !== 'duplicate') {
    return { ok: false, error: 'Not a confirmed duplicate — refusing to delete.' };
  }
  await writeManifest(list.filter((e) => e.id !== entryId));
  try { await FileSystem.deleteAsync(entry.file, { idempotent: true }); } catch {}
  return { ok: true };
}

/** Bulk clear. Only touches entries the server confirmed; returns how many went. */
export async function clearAllDuplicates() {
  const list = await readManifest();
  const dupes = list.filter((e) => e.dupCheck?.status === 'duplicate');
  let cleared = 0;
  for (const e of dupes) {
    const r = await clearDuplicate(e.id);
    if (r.ok) cleared += 1;
  }
  return { cleared, attempted: dupes.length };
}

export const duplicateCount = (list) =>
  (Array.isArray(list) ? list : []).filter((e) => e.dupCheck?.status === 'duplicate').length;

export const pendingCount = (list) => (Array.isArray(list) ? list.length : 0);
