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
import * as WebBrowser from 'expo-web-browser';
import api from '../../constants/api';
import {
  subscribe, drainQueue, attemptEntry, assignWorkOrder, KIND,
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

  useEffect(() => subscribe(setList), []);

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

  const viewOne = useCallback(async (entry) => {
    try { await WebBrowser.openBrowserAsync(entry.file); }
    catch { Alert.alert('Cannot open', 'This document could not be previewed on-device.'); }
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
          there is a connection. They are removed only after a successful upload.
        </Text>

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
              {e.woId == null && (
                <Text style={styles.cardWarn}>
                  Not linked to a work order yet — open it to identify the signature, then attach it.
                </Text>
              )}

              <View style={styles.cardActions}>
                <TouchableOpacity style={styles.btn} onPress={() => viewOne(e)}>
                  <Text style={styles.btnText}>View</Text>
                </TouchableOpacity>

                {e.woId == null ? (
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
    </Modal>
  );
}

/* ───────────── WO picker for unknown-WO orphans ───────────── */

function AttachToWorkOrder({ entry, onClose, onAttached }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!entry) { setQ(''); setRows([]); return; }
    let alive = true;
    setLoading(true);
    api.get('/work-orders')
      .then((r) => { if (alive) setRows(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [entry]);

  const needle = q.trim().toLowerCase();
  const filtered = !needle ? rows.slice(0, 40) : rows.filter((w) => {
    const hay = `${w.id} ${w.customer || ''} ${w.siteLocation || ''} ${w.siteAddress || ''} ${w.poNumber || ''}`.toLowerCase();
    return hay.includes(needle);
  }).slice(0, 40);

  return (
    <Modal visible={!!entry} animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Attach to work order</Text>
          <TouchableOpacity onPress={onClose}><Text style={styles.close}>Cancel</Text></TouchableOpacity>
        </View>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search customer, site, WO #, PO #"
          placeholderTextColor="#9ca3af"
          style={styles.search}
          autoCorrect={false}
        />
        {loading ? <ActivityIndicator style={{ marginTop: 24 }} /> : (
          <ScrollView style={{ flex: 1 }}>
            {filtered.map((w) => (
              <TouchableOpacity
                key={w.id}
                style={styles.woRow}
                onPress={async () => {
                  const updated = await assignWorkOrder(entry.id, w.id);
                  if (updated) onAttached(updated);
                }}
              >
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
  woTitle: { fontWeight: '700', color: '#111827' },
  woMeta: { color: '#6b7280', fontSize: 12, marginTop: 2 },
});
