// File: app/index.js
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import axios from 'axios';
import moment from 'moment';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import API_BASE_URL from '../constants/API_BASE_URL';

export default function HomeScreen() {
  const router = useRouter();

  // nav-once guard to avoid stacking Login or Details
  const navLockRef = useRef(false);
  const navigateOnce = (fn) => {
    if (navLockRef.current) return;
    navLockRef.current = true;
    try {
      fn();
    } finally {
      setTimeout(() => {
        navLockRef.current = false;
      }, 400);
    }
  };

  const [orders, setOrders] = useState([]);
  const [todayOrderIds, setTodayOrderIds] = useState([]);
  const [notesExpanded, setNotesExpanded] = useState(false);

  const norm = (v) => (v ?? '').toString().trim();

  // ----- Notes-notification local state (AsyncStorage-backed) -----
  const DISMISSED_KEY = 'ftapp:dismissedNotes:v1';
  const [dismissedKeys, setDismissedKeys] = useState(new Set());
  const [notesRefreshTick, setNotesRefreshTick] = useState(0); // force recompute after write

  const loadDismissed = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(DISMISSED_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      setDismissedKeys(new Set(Array.isArray(arr) ? arr : []));
    } catch {
      setDismissedKeys(new Set());
    }
  }, []);

  const writeDismissed = useCallback(async (nextSet) => {
    try {
      await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(nextSet)));
      setDismissedKeys(new Set(nextSet));
      setNotesRefreshTick((t) => t + 1);
    } catch {}
  }, []);

  // more stable key: orderId + createdISO + text prefix
  const makeNoteKey = (orderId, createdISO, text) =>
    `${orderId}:${createdISO}:${(text || '').slice(0, 64)}`;

  // key shared with WorkOrdersScreen
  const todayKey = `woOrder:${moment().format('YYYY-MM-DD')}`;

  const loadTodayOrder = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(todayKey);
      setTodayOrderIds(raw ? JSON.parse(raw) : []);
    } catch {
      setTodayOrderIds([]);
    }
  }, [todayKey]);

  const fetchOrders = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('jwt');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const { data } = await axios.get(`${API_BASE_URL}/work-orders`, { headers });
      setOrders(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching work orders:', error);
      if (error.response?.status === 401) {
        // Top-level route => replace (not push) and guard
        navigateOnce(() => router.replace('/screens/LoginScreen'));
      }
    }
  }, [router]);

  // Initial load
  useEffect(() => {
    fetchOrders();
    loadTodayOrder();
    loadDismissed();
  }, [fetchOrders, loadTodayOrder, loadDismissed]);

  // Refresh when returning to Home
  useFocusEffect(
    useCallback(() => {
      fetchOrders();
      loadTodayOrder();
      loadDismissed();
    }, [fetchOrders, loadTodayOrder, loadDismissed])
  );

  /* =========================
     Helpers
  ========================= */

  const orderBySavedIds = (list, idOrder) => {
    if (!idOrder?.length) return list;
    const map = new Map(list.map((o) => [String(o?.id ?? ''), o]));
    const ordered = [];
    for (const id of idOrder) {
      if (map.has(id)) {
        ordered.push(map.get(id));
        map.delete(id);
      }
    }
    return [...ordered, ...Array.from(map.values())];
  };

  // Time windows
  const startOfToday = moment().startOf('day');
  const endOfToday = moment().endOf('day');
  const endOf7Days = moment().add(7, 'days').endOf('day');

  // Today (agenda) — then apply saved drag order
  const agendaOrders = useMemo(() => {
    const todays = orders.filter((o) => {
      if (!o?.scheduledDate) return false;
      const d = moment(o.scheduledDate);
      return d.isValid() && d.isBetween(startOfToday, endOfToday, null, '[]');
    });
    return orderBySavedIds(todays, todayOrderIds);
  }, [orders, todayOrderIds, startOfToday, endOfToday]);

  // Upcoming: next 7 days (tomorrow .. +7)
  const upcomingOrders = useMemo(
    () =>
      orders
        .filter((o) => {
          if (!o?.scheduledDate) return false;
          const d = moment(o.scheduledDate);
          return d.isValid() && d.isAfter(endOfToday) && d.isSameOrBefore(endOf7Days);
        })
        .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate)),
    [orders, endOfToday, endOf7Days]
  );

  /* =========================
     Notes helpers (robust)
  ========================= */

  // 1) Parse a notes-like field into an array of note objects/strings
  const parseNotesField = (notesLike) => {
    if (!notesLike) return [];
    if (Array.isArray(notesLike)) return notesLike;

    if (typeof notesLike === 'string') {
      // Try JSON first
      try {
        const arr = JSON.parse(notesLike);
        if (Array.isArray(arr)) return arr;
      } catch {
        // Not JSON; treat as plain text blob
        const lines = notesLike
          .split(/\r?\n\r?\n|\r?\n/g)
          .map((s) => s.trim())
          .filter(Boolean);
        return lines.map((line) => ({ text: line }));
      }
      return [];
    }

    if (typeof notesLike === 'object') {
      if (Array.isArray(notesLike.items)) return notesLike.items;
      if (Array.isArray(notesLike.list)) return notesLike.list;
      if (Array.isArray(notesLike.notes)) return notesLike.notes;
    }

    return [];
  };

  // 2) Gather all possible notes arrays on an order
  const getAllNotesForOrder = (order) => {
    const candidates = [
      order?.notes,
      order?.internalNotes,
      order?.comments,
      order?.noteLog,
      order?.activity?.notes,
      order?.latestNotes,
    ];
    const all = [];
    for (const c of candidates) {
      const arr = parseNotesField(c);
      if (arr?.length) all.push(...arr);
    }
    return all;
  };

  // 3) Extract a moment() timestamp from a note & its order context
  const extractNoteMoment = (note, order) => {
    let raw =
      note?.createdAt ??
      note?.created_at ??
      note?.date ??
      note?.timestamp ??
      note?.time ??
      null;

    // If missing, try to pull a date-like token from the note text
    if (raw == null && typeof note?.text === 'string') {
      const t = note.text;
      const isoMatch =
        t.match(/\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?(?:Z|[+\-]\d{2}:?\d{2})?\b/) ||
        t.match(/\b\d{4}-\d{2}-\d{2}\b/);
      const usMatch =
        t.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}(?:[ T]\d{1,2}:\d{2}(?:\s?[AP]M)?)?\b/i);
      raw = (isoMatch && isoMatch[0]) || (usMatch && usMatch[0]) || null;
    }

    // Fallbacks: order-level timestamps
    if (raw == null) {
      raw = order?.lastNoteAt || order?.updatedAt || order?.createdAt || null;
    }

    if (raw == null) return null;

    if (typeof raw === 'number') {
      if (raw < 10_000_000_000) raw = raw * 1000; // seconds -> ms
      return moment(raw);
    }

    if (typeof raw === 'string') {
      if (moment(raw, moment.ISO_8601, true).isValid()) return moment(raw);
      const m = moment(raw, ['YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD', 'M/D/YYYY h:mm A', 'M/D/YYYY'], true);
      return m.isValid() ? m : moment(raw);
    }

    return null;
  };

  // ===== Weekly Notes panel (last 7 days, inclusive) =====
  const weeklyNotes = useMemo(() => {
    const oneWeekAgo = moment().subtract(7, 'days');
    const items = [];

    for (const o of orders) {
      const rawNotes = getAllNotesForOrder(o);
      if (!rawNotes.length) continue;

      for (const n of rawNotes) {
        const created = extractNoteMoment(n, o);
        if (!created || !created.isValid()) continue;
        if (!created.isSameOrAfter(oneWeekAgo)) continue;

        const createdISO = created.toISOString();
        const text = n?.text || n?.note || n?.message || String(n || '');
        const by = n?.by || n?.user || n?.author || '';

        const key = makeNoteKey(o.id, createdISO, text);
        if (dismissedKeys.has(key)) continue;

        items.push({
          key,
          orderId: o.id,
          workOrderNumber: o.workOrderNumber || null,
          customer: o.customer || '—',
          site: norm(o.siteLocation) || norm(o.siteName) || norm(o.siteLocationName) || '—',
          text,
          by,
          createdAt: createdISO,
        });
      }
    }

    items.sort((a, b) => moment(b.createdAt).valueOf() - moment(a.createdAt).valueOf());
    return items;
  }, [orders, dismissedKeys, notesRefreshTick]);

  const markNoteReadAndOpen = async (note) => {
    const next = new Set(dismissedKeys);
    next.add(note.key);
    await writeDismissed(next);
    navigateOnce(() => router.push(`/screens/ViewWorkOrder?id=${note.orderId}`));
  };

  const markAllWeeklyNotesRead = async () => {
    if (!weeklyNotes.length) return;
    const next = new Set(dismissedKeys);
    for (const n of weeklyNotes) next.add(n.key);
    await writeDismissed(next);
  };

  const woNumber = (o) => (o?.workOrderNumber ? String(o.workOrderNumber) : '—');

  // Same as before: card for agenda/upcoming
  const getLatestNote = (item) => {
    try {
      const arr = getAllNotesForOrder(item);
      if (!arr.length) return null;

      const sorted = [...arr].sort((a, b) => {
        const ta = extractNoteMoment(a, item);
        const tb = extractNoteMoment(b, item);
        return (tb ? tb.valueOf() : 0) - (ta ? ta.valueOf() : 0);
      });
      const n = sorted[0] || {};
      const created = extractNoteMoment(n, item);
      const time = created && created.isValid() ? created.format('YYYY-MM-DD HH:mm') : '';
      const by = n?.by || n?.user || n?.author || '';
      const bySuffix = by ? ` • ${by}` : '';
      const text = String(n?.text || n?.note || n?.message || '').trim().replace(/\s+/g, ' ');
      return { time, by: bySuffix, text };
    } catch {
      return null;
    }
  };

  const renderCard = (order) => {
    const latest = getLatestNote(order);
    return (
      <View key={order.id} style={styles.card}>
        <Text style={styles.cardTitle}>WO #: {woNumber(order)}</Text>

        <Text style={styles.cardText}>Customer: {order.customer ?? '—'}</Text>
        <Text style={styles.cardText}>Site: {order.siteLocation ?? '—'}</Text>
        <Text style={styles.cardText}>Problem: {order.problemDescription ?? '—'}</Text>
        {order.scheduledDate && (
          <Text style={styles.cardText}>
            Scheduled: {moment(order.scheduledDate).format('YYYY-MM-DD HH:mm')}
          </Text>
        )}

        <View style={styles.actionsRow}>
          <View style={styles.leftCol}>
            {latest ? (
              <View style={styles.latestNoteBox}>
                <Text style={styles.latestNoteMeta} numberOfLines={1}>
                  {latest.time}
                  {latest.by}
                </Text>
                <Text style={styles.latestNoteText} numberOfLines={3}>
                  {latest.text}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.rightCol}>
            <TouchableOpacity
              style={styles.viewButton}
              onPress={() =>
                navigateOnce(() => router.push(`/screens/ViewWorkOrder?id=${order.id}`))
              }
            >
              <Text style={styles.viewButtonText}>View Details</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.header}>Welcome to the CRM Dashboard</Text>

      {/* ===== Notes (This Week) - Collapsible ===== */}
      <View style={styles.notesContainer}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setNotesExpanded((prev) => !prev);
          }}
          style={styles.notesHeaderRow}
        >
          <View style={styles.notesHeaderLeft}>
            <Text style={styles.notesChevron}>{notesExpanded ? '▼' : '▶'}</Text>
            <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Notes (This Week)</Text>
            {weeklyNotes.length > 0 && (
              <View style={styles.noteCountBadge}>
                <Text style={styles.noteCountText}>{weeklyNotes.length}</Text>
              </View>
            )}
          </View>
          {weeklyNotes.length > 0 && (
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation?.();
                markAllWeeklyNotesRead();
              }}
              style={styles.markAllBtn}
            >
              <Text style={styles.markAllText}>Mark All Read</Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>

        {notesExpanded && (
          <View style={styles.notesBody}>
            {weeklyNotes.length ? (
              weeklyNotes.map((n) => (
                <TouchableOpacity
                  key={n.key}
                  style={styles.noteCard}
                  onPress={() => markNoteReadAndOpen(n)}
                  activeOpacity={0.7}
                >
                  <View style={styles.noteHeaderRow}>
                    <Text style={styles.noteWo}>WO: {n.workOrderNumber || n.orderId}</Text>
                    <Text style={styles.noteMeta}>
                      {moment(n.createdAt).fromNow()} {n.by ? `• ${n.by}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.noteSubMeta} numberOfLines={1}>
                    {n.customer} • {n.site}
                  </Text>
                  <Text style={styles.noteText} numberOfLines={3}>
                    {n.text}
                  </Text>
                </TouchableOpacity>
              ))
            ) : (
              <Text style={styles.noData}>No new notes from the past 7 days.</Text>
            )}
          </View>
        )}
      </View>

      {/* ===== Agenda for Today ===== */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Agenda for Today ({startOfToday.format('YYYY-MM-DD')})
        </Text>
        {agendaOrders.length ? (
          agendaOrders.map(renderCard)
        ) : (
          <Text style={styles.noData}>No work orders scheduled for today.</Text>
        )}
      </View>

      {/* ===== Upcoming (next 7 days) ===== */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Upcoming Work Orders (next 7 days)</Text>
        {upcomingOrders.length ? (
          upcomingOrders.map(renderCard)
        ) : (
          <Text style={styles.noData}>No work orders in the next 7 days.</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f1f5f9',
    padding: 16,
    flexGrow: 1,
  },
  header: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 16,
    textAlign: 'center',
    color: '#0f172a',
  },

  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0d6efd',
    marginBottom: 12,
  },

  // Collapsible notes container
  notesContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#eef2f7',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
    overflow: 'hidden',
  },
  notesHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  notesHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  notesChevron: {
    fontSize: 14,
    color: '#0d6efd',
  },
  noteCountBadge: {
    backgroundColor: 'rgba(13,110,253,0.08)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
  },
  noteCountText: {
    color: '#0d6efd',
    fontSize: 12,
    fontWeight: '700',
  },
  markAllBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  markAllText: {
    color: '#0f172a',
    fontWeight: '700',
    fontSize: 12,
  },
  notesBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },

  // Note card styles
  noteCard: {
    backgroundColor: '#ffffff',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#eef2f7',
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  noteHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  noteWo: { fontWeight: '900', color: '#0f172a' },
  noteMeta: { color: '#0f172a', fontSize: 12 },
  noteSubMeta: { color: '#0f172a', fontSize: 13, marginBottom: 6 },
  noteText: { color: '#0f172a', fontSize: 14 },

  // Existing card list styles
  card: {
    backgroundColor: '#ffffff',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#eef2f7',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  cardTitle: {
    fontWeight: '900',
    marginBottom: 6,
    color: '#0f172a',
    fontSize: 15,
  },
  cardText: {
    fontSize: 13,
    marginBottom: 4,
    color: '#0f172a',
  },

  actionsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  leftCol: { flex: 1, paddingRight: 10 },
  rightCol: { flexShrink: 1, alignItems: 'flex-end', maxWidth: '60%' },

  latestNoteBox: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#eef2f7',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    maxWidth: '100%',
  },
  latestNoteMeta: { fontSize: 12, color: '#0f172a', marginBottom: 4 },
  latestNoteText: { fontSize: 13, color: '#0f172a' },

  viewButton: {
    backgroundColor: '#0d6efd',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignSelf: 'flex-end',
    shadowColor: 'rgba(13,110,253,1)',
    shadowOpacity: 0.24,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  viewButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },

  noData: { fontStyle: 'italic', color: '#0f172a' },
});
