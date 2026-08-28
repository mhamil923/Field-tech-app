// File: app/components/PendingUploads.js
//
// Visible surface for the upload queue. The sign-off that was lost failed silently:
// one dismissable alert and then nothing anywhere in the UI. A queued document must
// be impossible to miss, so the badge renders on the main screens whenever anything
// is waiting, and it never auto-hides.
//
// Deliberate omission: there is no delete control. The only way an entry leaves the
// queue is a successful upload (see uploadQueue.attemptEntry).
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, ScrollView, ActivityIndicator, Alert, TextInput, StyleSheet,
} from 'react-native';
import api from '../../constants/api';
import LocalPdfViewer from './LocalPdfViewer';
import {
  subscribe, drainQueue, attemptEntry, assignWorkOrder, KIND, readManifest,
  checkDuplicates, clearDuplicate, clearAllDuplicates, duplicateCount, fileUriFor,
  dismissRecovered, dismissAllRecovered, isRecovered, recoveredCount,
} from '../lib/uploadQueue';

const fmtWhen = (iso) => {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso || ''; }
};

const labelFor = (e) => {
  if (e.woId == null) return `Recovered signed document — ${fmtWhen(e.createdAt)}`;
  if (e.kind === KIND.CONTRACT_SIGNED) return `Signed contract — WO #${e.woId}`;
  return `Sign-off — WO #${e.woId}`;
};

const dupStatus = (e) => e.dupCheck?.status || null;

// Promise-wrapped confirm so the destructive paths read linearly.
const confirmAsync = (title, message) => new Promise((resolve) => {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
    { text: 'Clear', style: 'destructive', onPress: () => resolve(true) },
  ]);
});

const readManifestSafe = async () => {
  try { return await readManifest(); } catch { return []; }
};

/* ─────────────────── badge (drop into any screen header) ─────────────────── */

export function PendingUploadsBadge({ style }) {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => subscribe(setList), []);

  if (!list.length) return null;
  const n = list.length;

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={[styles.badge, style]}
        accessibilityRole="button"
        accessibilityLabel={`${n} document${n === 1 ? '' : 's'} waiting to upload`}
      >
        <Text style={styles.badgeText}>
          ⬆︎ {n} {n === 1 ? 'sign-off waiting to upload' : 'sign-offs waiting to upload'}
        </Text>
        <Text style={styles.badgeCta}>View</Text>
      </TouchableOpacity>
      <PendingUploadsPanel visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

/* ─────────────────────────── the panel ─────────────────────────── */

export function PendingUploadsPanel({ visible, onClose }) {
  const [list, setList] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [draining, setDraining] = useState(false);
  const [assignFor, setAssignFor] = useState(null); // entry awaiting a WO pick
  const [preview, setPreview] = useState(null);     // { uri, title } for LocalPdfViewer
  const [scanning, setScanning] = useState(null);   // 'n/total' while hashing
  const [spotChecked, setSpotChecked] = useState(false); // bulk clear gated on this

  useEffect(() => subscribe(setList), []);

  // Hash every recovered file and ask the server which already exist. Runs when the
  // panel opens, and on demand.
  const runDuplicateCheck = useCallback(async () => {
    if (scanning) return;
    setScanning('0/0');
    try {
      const r = await checkDuplicates({ onProgress: (i, n) => setScanning(`${i}/${n}`) });
      Alert.alert(
        'Duplicate check complete',
        `${r.checked} document${r.checked === 1 ? '' : 's'} checked. ` +
        `${r.matched} already on the server; ${r.checked - r.matched} not found.`
      );
    } catch (e) {
      Alert.alert('Could not check for duplicates', e?.response?.data?.error || e?.message || 'Request failed.');
    } finally {
      setScanning(null);
    }
  }, [scanning]);

  useEffect(() => {
    if (!visible) return;
    // Only auto-scan when something has not been checked yet.
    readManifestSafe().then((l) => {
      if (l.some((e) => e.kind !== KIND.CONTRACT_SIGNED && !e.dupCheck)) runDuplicateCheck();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const clearOne = useCallback(async (entry) => {
    const label = entry.dupCheck?.workOrderLabel || 'the server';
    if (!(await confirmAsync(
      'Clear this duplicate?',
      `These exact bytes are already stored on ${label}. Only the copy on this iPad will be removed.`
    ))) return;
    const r = await clearDuplicate(entry.id);
    if (!r.ok) Alert.alert('Not cleared', r.error);
    else setSpotChecked(true);
  }, []);

  const dismissOne = useCallback(async (entry) => {
    if (!(await confirmAsync(
      'Permanently remove this recovered document from the device?',
      'It was recovered from the old cache and is not attached to any work order. This cannot be undone.'
    ))) return;
    const r = await dismissRecovered(entry.id);
    if (!r.ok) Alert.alert('Not removed', r.error);
  }, []);

  // Two confirmations, because this is the fresh-start button and it is irreversible.
  const dismissAll = useCallback(async (n) => {
    if (!(await confirmAsync(
      `Dismiss all ${n} recovered document${n === 1 ? '' : 's'}?`,
      'These were recovered from the old cache. Pending sign-offs captured by the app are NOT affected — they can only leave the queue by uploading.'
    ))) return;
    if (!(await confirmAsync(
      'Last check — this cannot be undone',
      `${n} recovered document${n === 1 ? '' : 's'} will be permanently deleted from this iPad. Confirm only if you have reviewed them.`
    ))) return;
    const r = await dismissAllRecovered();
    Alert.alert('Recovered documents dismissed', `${r.dismissed} of ${r.attempted} removed from this device.`);
  }, []);

  const clearAll = useCallback(async (n) => {
    if (!spotChecked) {
      Alert.alert(
        'Spot-check one first',
        'Open one duplicate with View and confirm it is a document you recognise, then clear it individually. ' +
        'After that this button will clear the rest.'
      );
      return;
    }
    if (!(await confirmAsync(
      `Clear ${n} confirmed duplicate${n === 1 ? '' : 's'}?`,
      'Every one of these was matched byte-for-byte against a document already on the server. ' +
      'Nothing that failed to match will be touched.'
    ))) return;
    const r = await clearAllDuplicates();
    Alert.alert('Duplicates cleared', `${r.cleared} of ${r.attempted} removed from this device.`);
  }, [spotChecked]);

  const retryOne = useCallback(async (entry) => {
    setBusyId(entry.id);
    try {
      const r = await attemptEntry(entry.id);
      if (r.ok) Alert.alert('Uploaded', 'The document is now attached to the work order.');
      else Alert.alert('Still not uploaded', `${r.error}\n\nIt stays saved on this device and will keep retrying.`);
    } finally {
      setBusyId(null);
    }
  }, []);

  const retryAll = useCallback(async () => {
    setDraining(true);
    try {
      const { attempted, uploaded } = await drainQueue({ force: true });
      Alert.alert('Retry finished', `Attempted ${attempted}, uploaded ${uploaded}.`);
    } finally {
      setDraining(false);
    }
  }, []);

  // Preview is rendered in-app. expo-web-browser cannot open file:// at all (its iOS
  // module only accepts http/https), which is why every recovered preview failed.
  const viewOne = useCallback((entry) => {
    // Resolve against today's container — the stored path is relative.
    setPreview({ uri: fileUriFor(entry), title: labelFor(entry) });
  }, []);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Waiting to upload</Text>
          <TouchableOpacity onPress={onClose}><Text style={styles.close}>Done</Text></TouchableOpacity>
        </View>

        <Text style={styles.sheetNote}>
          These documents are saved on this device and will upload automatically when
          there is a connection. They are removed only after a successful upload — or,
          for documents the server confirms it already has, by clearing them below.
        </Text>

        {scanning ? (
          <View style={styles.scanBar}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.scanText}>Checking against the server… {scanning}</Text>
          </View>
        ) : (
          <View style={styles.scanRow}>
            <TouchableOpacity style={styles.linkBtn} onPress={runDuplicateCheck}>
              <Text style={styles.linkBtnText}>Check for duplicates</Text>
            </TouchableOpacity>
            {(() => {
              const n = duplicateCount(list);
              if (!n) return null;
              return (
                <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={() => clearAll(n)}>
                  <Text style={[styles.btnText, styles.btnDangerText]}>
                    Clear {n} confirmed duplicate{n === 1 ? '' : 's'}
                  </Text>
                </TouchableOpacity>
              );
            })()}
            {(() => {
              const n = recoveredCount(list);
              if (!n) return null;
              return (
                <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={() => dismissAll(n)}>
                  <Text style={[styles.btnText, styles.btnDangerText]}>
                    Dismiss all recovered documents ({n})
                  </Text>
                </TouchableOpacity>
              );
            })()}
          </View>
        )}

        <ScrollView style={{ flex: 1 }}>
          {list.length === 0 && (
            <Text style={styles.empty}>Nothing waiting. Everything has uploaded. 🎉</Text>
          )}
          {list.map((e) => (
            <View key={e.id} style={styles.card}>
              <Text style={styles.cardTitle}>{labelFor(e)}</Text>
              <Text style={styles.cardMeta}>Captured {fmtWhen(e.createdAt)}</Text>
              {e.attempts > 0 && (
                <Text style={styles.cardErr}>
                  {e.attempts} attempt{e.attempts === 1 ? '' : 's'}
                  {e.lastError ? ` · last error: ${e.lastError}` : ''}
                </Text>
              )}

              {dupStatus(e) === 'duplicate' && (
                <Text style={styles.cardDup}>
                  ✓ Already uploaded — on WO {e.dupCheck.workOrderLabel || `#${e.dupCheck.workOrderId}`}
                </Text>
              )}
              {dupStatus(e) === 'orphan' && (
                <Text style={styles.cardOrphan}>
                  ⚠ Not found on server — genuine orphan
                </Text>
              )}
              {e.pathMissing && (
                <Text style={styles.cardWarn}>
                  File not found on this device. The entry is kept rather than deleted —
                  the document may still be recoverable from a backup.
                </Text>
              )}
              {dupStatus(e) === 'unreadable' && (
                <Text style={styles.cardWarn}>
                  Could not read this file to check it ({e.dupCheck.error}). It stays put.
                </Text>
              )}

              {e.woId == null && dupStatus(e) !== 'duplicate' && (
                <Text style={styles.cardWarn}>
                  Not linked to a work order yet — open it to identify the signature, then attach it.
                </Text>
              )}

              <View style={styles.cardActions}>
                <TouchableOpacity style={styles.btn} onPress={() => viewOne(e)}>
                  <Text style={styles.btnText}>View</Text>
                </TouchableOpacity>

                {isRecovered(e) && dupStatus(e) !== 'duplicate' && (
                  <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={() => dismissOne(e)}>
                    <Text style={[styles.btnText, styles.btnDangerText]}>Dismiss</Text>
                  </TouchableOpacity>
                )}
                {dupStatus(e) === 'duplicate' ? (
                  <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={() => clearOne(e)}>
                    <Text style={[styles.btnText, styles.btnDangerText]}>Clear</Text>
                  </TouchableOpacity>
                ) : e.woId == null ? (
                  <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => setAssignFor(e)}>
                    <Text style={[styles.btnText, styles.btnPrimaryText]}>Attach to work order…</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.btn, styles.btnPrimary]}
                    disabled={busyId === e.id}
                    onPress={() => retryOne(e)}
                  >
                    <Text style={[styles.btnText, styles.btnPrimaryText]}>
                      {busyId === e.id ? 'Uploading…' : 'Retry now'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}
        </ScrollView>

        {list.length > 0 && (
          <TouchableOpacity style={styles.retryAll} onPress={retryAll} disabled={draining}>
            {draining ? <ActivityIndicator color="#fff" /> : <Text style={styles.retryAllText}>Retry all now</Text>}
          </TouchableOpacity>
        )}
      </View>

      <AttachToWorkOrder
        entry={assignFor}
        onClose={() => setAssignFor(null)}
        onAttached={async (entry) => {
          setAssignFor(null);
          await retryOne(entry);
        }}
      />

      <LocalPdfViewer file={preview} onClose={() => { setPreview(null); setSpotChecked(true); }} />
    </Modal>
  );
}

/* ───────────── WO picker for unknown-WO orphans ───────────── */

function AttachToWorkOrder({ entry, onClose, onAttached }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);

  const captureDate = entry?.createdAt ? String(entry.createdAt).slice(0, 10) : null;

  useEffect(() => {
    if (!entry) { setQ(''); setRows([]); setSuggestions([]); return; }
    let alive = true;
    setLoading(true);

    // Two sources: the date-proximate suggestions (what actually identifies an
    // orphan — the capture timestamp is the strongest signal available) and the full
    // list behind the search box as a fallback.
    const near = captureDate
      ? api.get('/api/work-orders/near', { params: { date: captureDate, days: 5 } })
          .then((r) => (Array.isArray(r.data) ? r.data : []))
          .catch(() => [])
      : Promise.resolve([]);

    Promise.all([near, api.get('/work-orders').then((r) => (Array.isArray(r.data) ? r.data : [])).catch(() => [])])
      .then(([n, all]) => { if (!alive) return; setSuggestions(n); setRows(all); })
      .finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; };
  }, [entry, captureDate]);

  const needle = q.trim().toLowerCase();
  const filtered = !needle ? rows.slice(0, 40) : rows.filter((w) => {
    const hay = `${w.id} ${w.customer || ''} ${w.siteLocation || ''} ${w.siteAddress || ''} ${w.poNumber || ''}`.toLowerCase();
    return hay.includes(needle);
  }).slice(0, 40);

  const attach = async (woId) => {
    const updated = await assignWorkOrder(entry.id, woId);
    if (updated) onAttached(updated);
  };

  const dayLabel = (d) => (d === 0 ? 'same day' : `${d} day${d === 1 ? '' : 's'} away`);

  return (
    <Modal visible={!!entry} animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Attach to work order</Text>
          <TouchableOpacity onPress={onClose}><Text style={styles.close}>Cancel</Text></TouchableOpacity>
        </View>

        {captureDate ? (
          <Text style={styles.sheetNote}>
            Captured {fmtWhen(entry?.createdAt)}. Work orders scheduled or updated within
            five days of that are listed first — open the document with View to read the
            signature page, then tap the match.
          </Text>
        ) : null}

        {loading ? <ActivityIndicator style={{ marginTop: 24 }} /> : (
          <ScrollView style={{ flex: 1 }}>
            {suggestions.length > 0 && (
              <>
                <Text style={styles.sectionHead}>Likely matches</Text>
                {suggestions.map((w) => (
                  <TouchableOpacity key={`s-${w.id}`} style={[styles.woRow, styles.woRowSuggest]} onPress={() => attach(w.id)}>
                    <Text style={styles.woTitle}>{w.customer || '(no customer)'} — #{w.id}</Text>
                    <Text style={styles.woMeta}>{w.siteLocation || w.siteAddress || ''}</Text>
                    <Text style={styles.woWhen}>
                      {w.scheduledDate ? new Date(w.scheduledDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'no scheduled date'}
                      {' · '}{dayLabel(Number(w.daysAway) || 0)}
                    </Text>
                  </TouchableOpacity>
                ))}
                <Text style={styles.sectionHead}>Or search all work orders</Text>
              </>
            )}

            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search customer, site, WO #, PO #"
              placeholderTextColor="#9ca3af"
              style={styles.search}
              autoCorrect={false}
            />

            {filtered.map((w) => (
              <TouchableOpacity key={w.id} style={styles.woRow} onPress={() => attach(w.id)}>
                <Text style={styles.woTitle}>{w.customer || '(no customer)'} — #{w.id}</Text>
                <Text style={styles.woMeta}>{w.siteLocation || w.siteAddress || ''}</Text>
              </TouchableOpacity>
            ))}
            {!filtered.length && <Text style={styles.empty}>No matching work orders.</Text>}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#b45309', paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 8, marginHorizontal: 12, marginTop: 8,
  },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 13, flexShrink: 1 },
  badgeCta: { color: '#fff', fontWeight: '700', fontSize: 13, textDecorationLine: 'underline', marginLeft: 10 },

  sheet: { flex: 1, backgroundColor: '#f3f4f6', paddingTop: 54 },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 10,
  },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: '#111827' },
  close: { color: '#2563EB', fontWeight: '700', fontSize: 16 },
  sheetNote: { paddingHorizontal: 16, paddingBottom: 12, color: '#4b5563', fontSize: 13, lineHeight: 18 },
  empty: { textAlign: 'center', color: '#6b7280', marginTop: 32, paddingHorizontal: 24 },

  card: {
    backgroundColor: '#fff', marginHorizontal: 12, marginBottom: 10, borderRadius: 10,
    padding: 12, borderWidth: 1, borderColor: '#e5e7eb',
  },
  cardTitle: { fontWeight: '700', fontSize: 15, color: '#111827' },
  cardMeta: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  cardErr: { color: '#b45309', fontSize: 12, marginTop: 6 },
  cardWarn: { color: '#b91c1c', fontSize: 12, marginTop: 6 },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  btn: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6,
    backgroundColor: '#e5e7eb', borderWidth: 1, borderColor: '#d1d5db',
  },
  btnText: { fontWeight: '700', fontSize: 13, color: '#111827' },
  btnPrimary: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  btnPrimaryText: { color: '#fff' },
  btnDanger: { backgroundColor: '#b91c1c', borderColor: '#b91c1c' },
  btnDangerText: { color: '#fff' },

  cardDup: { color: '#15803d', fontSize: 12, marginTop: 6, fontWeight: '700' },
  cardOrphan: { color: '#b45309', fontSize: 12, marginTop: 6, fontWeight: '700' },

  scanRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10, flexWrap: 'wrap' },
  scanBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10 },
  scanText: { color: '#374151', fontSize: 13, fontWeight: '600' },
  linkBtn: { paddingVertical: 8 },
  linkBtnText: { color: '#2563EB', fontWeight: '700', fontSize: 13, textDecorationLine: 'underline' },

  retryAll: {
    margin: 12, backgroundColor: '#111827', borderRadius: 8,
    paddingVertical: 14, alignItems: 'center',
  },
  retryAllText: { color: '#fff', fontWeight: '800' },

  search: {
    marginHorizontal: 16, marginBottom: 10, backgroundColor: '#fff', borderRadius: 8,
    borderWidth: 1, borderColor: '#d1d5db', paddingHorizontal: 12, paddingVertical: 10, color: '#111827',
  },
  woRow: { backgroundColor: '#fff', marginHorizontal: 12, marginBottom: 8, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  woRowSuggest: { borderColor: '#2563EB', borderWidth: 2 },
  woWhen: { color: '#2563EB', fontSize: 12, marginTop: 4, fontWeight: '600' },
  sectionHead: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 6, fontSize: 12, fontWeight: '800', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 },
  woTitle: { fontWeight: '700', color: '#111827' },
  woMeta: { color: '#6b7280', fontSize: 12, marginTop: 2 },
});
