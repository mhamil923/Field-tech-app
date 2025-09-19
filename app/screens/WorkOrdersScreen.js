// File: app/screens/WorkOrdersScreen.js
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  Linking,
  RefreshControl,
  Modal,
  Pressable,
} from 'react-native';
import moment from 'moment';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DraggableFlatList from 'react-native-draggable-flatlist';
import api from '../../constants/api';

const STATUSES = [
  'Needs to be Scheduled',
  'Scheduled',
  'Waiting for Approval',
  'Waiting on Parts',
  'Parts In',
  'Completed',
];

export default function WorkOrdersScreen() {
  const router = useRouter();

  const [me, setMe] = useState(null); // { id, username, role }
  const [workOrders, setWorkOrders] = useState([]);
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingFirst, setLoadingFirst] = useState(true);

  // Modal state for changing status
  const [statusModal, setStatusModal] = useState({
    id: null,   // work order id whose status we're changing
    value: null // temp chosen status
  });

  // ---------- Today drag-order persistence ----------
  const todayKey = `woOrder:${moment().format('YYYY-MM-DD')}`;
  const [todayOrderIds, setTodayOrderIds] = useState([]);

  const loadTodayOrder = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(todayKey);
      if (raw) setTodayOrderIds(JSON.parse(raw));
      else setTodayOrderIds([]);
    } catch {
      setTodayOrderIds([]);
    }
  }, [todayKey]);

  const saveTodayOrder = useCallback(async (ids) => {
    try {
      setTodayOrderIds(ids);
      await AsyncStorage.setItem(todayKey, JSON.stringify(ids));
    } catch {
      // ignore
    }
  }, [todayKey]);

  // ---------- load current user (for Jeff-only button)
  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/auth/me');
        setMe(r.data || null);
      } catch {
        // not fatal if /auth/me fails
      }
    })();
  }, []);

  const fetchWorkOrders = useCallback(async () => {
    try {
      const res = await api.get('/work-orders');
      const data = Array.isArray(res.data) ? res.data : [];
      setWorkOrders(data);
    } catch (err) {
      console.error('Error fetching work orders:', err);
      if (err?.response?.status === 401) {
        Alert.alert('Session expired', 'Please log in again.', [
          { text: 'OK', onPress: () => router.replace('/screens/LoginScreen') },
        ]);
      } else {
        Alert.alert('Error', 'Failed to fetch work orders.');
      }
    } finally {
      setLoadingFirst(false);
      setRefreshing(false);
    }
  }, [router]);

  // Initial load + on focus refresh
  useEffect(() => {
    fetchWorkOrders();
  }, [fetchWorkOrders]);
  useFocusEffect(
    useCallback(() => {
      fetchWorkOrders();
    }, [fetchWorkOrders])
  );

  // Load saved order whenever the day (key) or list changes
  useEffect(() => {
    loadTodayOrder();
  }, [loadTodayOrder, workOrders.length]);

  // ---------- counts
  const counts = useMemo(() => {
    const map = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    let today = 0;
    for (const o of workOrders) {
      if (o?.status && map[o.status] !== undefined) map[o.status] += 1;
      if (o?.scheduledDate && moment(o.scheduledDate).isSame(moment(), 'day')) today += 1;
    }
    return { byStatus: map, all: workOrders.length, today };
  }, [workOrders]);

  // ---------- helpers
  const openInGoogleMaps = async (query) => {
    const q = encodeURIComponent(query || '');
    const gmScheme = `comgooglemaps://?q=${q}`;
    const webUrl = `https://www.google.com/maps/search/?api=1&query=${q}`;
    try {
      const supportsGm = await Linking.canOpenURL(gmScheme);
      if (supportsGm) return Linking.openURL(gmScheme);
      return Linking.openURL(webUrl);
    } catch {
      Alert.alert('Error', 'Failed to open map.');
    }
  };

  const getLatestNote = (item) => {
    try {
      let arr = [];
      if (Array.isArray(item?.notes)) arr = item.notes;
      else if (typeof item?.notes === 'string') {
        try { arr = JSON.parse(item.notes); } catch { arr = []; }
      }
      if (!arr.length) return null;
      const sorted = [...arr].sort((a, b) => {
        const ta = new Date(a?.createdAt || 0).getTime();
        const tb = new Date(b?.createdAt || 0).getTime();
        return tb - ta;
      });
      const n = sorted[0] || {};
      const time = n?.createdAt ? moment(n.createdAt).format('YYYY-MM-DD HH:mm') : '';
      const by = n?.by ? ` • ${n.by}` : '';
      const text = String(n?.text || '').trim().replace(/\s+/g, ' ');
      return { time, by, text };
    } catch {
      return null;
    }
  };

  // ---------- filtered & ordered lists
  const filteredOrders = useMemo(() => {
    if (selectedStatus === 'All') return workOrders;
    if (selectedStatus === 'Today') {
      const todayStr = moment().format('YYYY-MM-DD');
      return workOrders.filter(
        (o) => o?.scheduledDate && moment(o.scheduledDate).format('YYYY-MM-DD') === todayStr
      );
    }
    return workOrders.filter((o) => o?.status === selectedStatus);
  }, [workOrders, selectedStatus]);

  // Apply saved order for Today
  const orderedToday = useMemo(() => {
    if (selectedStatus !== 'Today') return filteredOrders;
    const map = new Map(filteredOrders.map((o) => [String(o?.id ?? ''), o]));
    const ordered = [];
    for (const id of todayOrderIds) {
      if (map.has(id)) {
        ordered.push(map.get(id));
        map.delete(id);
      }
    }
    return [...ordered, ...Array.from(map.values())];
  }, [filteredOrders, selectedStatus, todayOrderIds]);

  // ---------- actions
  const onRefresh = () => {
    setRefreshing(true);
    fetchWorkOrders();
  };

  const handleUpdateStatus = async (id, newStatus) => {
    const prev = workOrders;
    const next = prev.map((o) => (o.id === id ? { ...o, status: newStatus } : o));
    setWorkOrders(next);
    try {
      await api.put(`/work-orders/${id}`, { status: newStatus });
    } catch (err) {
      console.error('Error updating status:', err);
      setWorkOrders(prev);
      Alert.alert('Error', err?.response?.data?.error || 'Failed to update status.');
    }
  };

  // ---------- chips
  const TopChip = ({ label, active, onPress, count }) => (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
      <View style={[styles.badge, active && styles.badgeActive]}>
        <Text style={[styles.badgeText, active && styles.badgeTextActive]}>{count}</Text>
      </View>
    </TouchableOpacity>
  );

  const renderChips = () => {
    const chips = [
      { key: 'All', label: 'All', count: counts.all },
      { key: 'Today', label: 'Today', count: counts.today },
      ...STATUSES.map((s) => ({ key: s, label: s, count: counts.byStatus[s] || 0 })),
    ];
    return (
      <View style={styles.chipsWrap}>
        {chips.map((c) => (
          <TopChip
            key={c.key}
            label={c.label}
            count={c.count}
            active={selectedStatus === c.key}
            onPress={() => setSelectedStatus(c.key)}
          />
        ))}
      </View>
    );
  };

  // ---------- card UI (shared by regular & draggable lists)
  const Card = ({ item, drag }) => {
    const latest = getLatestNote(item);

    return (
      <View style={styles.card}>
        {/* Title row with optional drag handle in Today view */}
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>WO/PO #: {item?.poNumber || 'N/A'}</Text>
          {selectedStatus === 'Today' ? (
            <TouchableOpacity onLongPress={drag} delayLongPress={120} style={styles.dragHandle}>
              <Text style={styles.dragGlyph}>≡</Text>
              <Text style={styles.dragHint}>Hold to drag</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <Text style={styles.cardText}>Customer: {item?.customer ?? 'N/A'}</Text>

        <TouchableOpacity onPress={() => openInGoogleMaps(item?.siteLocation || '')}>
          <Text style={styles.linkText}>Site Location: {item?.siteLocation ?? 'N/A'}</Text>
        </TouchableOpacity>

        <Text style={styles.cardText}>Problem: {item?.problemDescription ?? 'N/A'}</Text>
        <Text style={styles.cardText}>
          Scheduled:{' '}
          {item?.scheduledDate
            ? moment(item.scheduledDate).format('YYYY-MM-DD HH:mm')
            : 'Not Scheduled'}
        </Text>

        {/* ✨ New line: Status, shown between Schedule and latest note */}
        <Text style={[styles.cardText, { marginBottom: 8 }]}>
          Status: {item?.status || '—'}
        </Text>

        {/* Latest note + right-side actions */}
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
              style={[styles.statusBtn, { marginBottom: 8 }]}
              onPress={() =>
                setStatusModal({
                  id: item?.id,
                  value: item?.status || STATUSES[0],
                })
              }
            >
              <Text style={styles.statusBtnText}>Status</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.viewButton}
              onPress={() => router.push(`/screens/ViewWorkOrder?id=${item?.id}`)}
            >
              <Text style={styles.viewButtonText}>View Details</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  // ---------- renderers
  const renderItemRegular = ({ item }) => <Card item={item} />;
  const renderItemDraggable = ({ item, drag }) => <Card item={item} drag={drag} />;

  // ---------- lists
  const keyExtractor = (it, index) => String(it?.id ?? it?.poNumber ?? index);

  const ListComponent =
    selectedStatus === 'Today' ? (
      <>
        <Text style={styles.dragBanner}>Long-press a card and drag to set today’s order.</Text>
        <DraggableFlatList
          data={orderedToday}
          keyExtractor={keyExtractor}
          activationDistance={12}
          onDragEnd={({ data }) => {
            const newIds = data.map((d) => String(d?.id ?? ''));
            saveTodayOrder(newIds);
          }}
          renderItem={renderItemDraggable}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            !loadingFirst ? (
              <View style={styles.center}>
                <Text style={styles.noData}>No work orders today.</Text>
              </View>
            ) : null
          }
        />
      </>
    ) : (
      <FlatList
        data={filteredOrders}
        keyExtractor={keyExtractor}
        renderItem={renderItemRegular}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          !loadingFirst ? (
            <View style={styles.center}>
              <Text style={styles.noData}>No work orders to display.</Text>
            </View>
          ) : null
        }
      />
    );

  // ---------- modal actions
  const closeStatusModal = () => setStatusModal({ id: null, value: null });
  const applyStatusModal = () => {
    if (statusModal.id != null && statusModal.value) {
      handleUpdateStatus(statusModal.id, statusModal.value);
    }
    closeStatusModal();
  };

  return (
    <View style={styles.container}>
      {/* Header row with Jeff-only Add button */}
      <View style={styles.headerRow}>
        <Text style={styles.header}>Work Orders</Text>
        {me?.username === 'Jeff' && (
          <TouchableOpacity
            onPress={() => router.push('/screens/AddWorkOrder')}
            style={styles.addBtn}
          >
            <Text style={styles.addBtnText}>+ Add Work Order</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Fixed status bar */}
      <View style={styles.filterBar}>{renderChips()}</View>

      {/* The list (regular or draggable) */}
      {ListComponent}

      {/* Status selection modal */}
      <Modal
        transparent
        visible={statusModal.id != null}
        animationType="fade"
        onRequestClose={closeStatusModal}
      >
        <Pressable style={styles.modalOverlay} onPress={closeStatusModal}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Change Status</Text>

            <View style={{ marginTop: 8 }}>
              {STATUSES.map((s) => {
                const active = statusModal.value === s;
                return (
                  <TouchableOpacity
                    key={s}
                    style={[styles.statusOption, active && styles.statusOptionActive]}
                    onPress={() => setStatusModal((m) => ({ ...m, value: s }))}
                  >
                    <Text
                      style={[styles.statusOptionText, active && styles.statusOptionTextActive]}
                      numberOfLines={1}
                    >
                      {s}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.modalButtonsRow}>
              <TouchableOpacity style={styles.modalBtnCancel} onPress={closeStatusModal}>
                <Text style={styles.modalBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalBtnApply} onPress={applyStatusModal}>
                <Text style={styles.modalBtnText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F5F9', padding: 16 },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    color: '#2B2D42',
  },
  addBtn: {
    backgroundColor: '#17a2b8',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  addBtnText: { color: '#fff', fontWeight: '700' },

  /* Fixed chip/filter bar */
  filterBar: {
    paddingTop: 6,
    paddingBottom: 6,
    backgroundColor: '#F1F5F9',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#CBD5E1',
  },

  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginRight: -8,
    marginBottom: -8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#17a2b8',
    backgroundColor: '#fff',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
  },
  chipActive: { backgroundColor: '#17a2b8', borderColor: '#17a2b8' },
  chipText: { color: '#17a2b8', fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  badge: {
    marginLeft: 8,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#17a2b8',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  badgeActive: { backgroundColor: '#0f6a79', borderColor: '#0f6a79' },
  badgeText: { color: '#17a2b8', fontSize: 12, fontWeight: '700' },
  badgeTextActive: { color: '#fff' },

  list: { paddingTop: 8, paddingBottom: 16 },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    padding: 16,
    marginBottom: 12,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  dragHandle: { flexDirection: 'row', alignItems: 'center' },
  dragGlyph: { fontSize: 20, color: '#64748b', marginRight: 6 },
  dragHint: { fontSize: 12, color: '#94a3b8' },

  cardTitle: { fontSize: 18, fontWeight: '600', color: '#2B2D42' },
  cardText: { fontSize: 14, color: '#2B2D42', marginBottom: 4 },
  linkText: { color: '#17a2b8', textDecorationLine: 'underline', marginBottom: 4 },

  actionsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: 12,
  },

  leftCol: { flex: 1, paddingRight: 10 },

  rightCol: {
    flexShrink: 1,
    alignItems: 'flex-end',
    maxWidth: '60%',
  },

  statusBtn: {
    backgroundColor: '#0ea5a6',
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignSelf: 'flex-end',
  },
  statusBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: 'bold' },

  viewButton: {
    backgroundColor: '#17a2b8',
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignSelf: 'flex-end',
  },
  viewButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: 'bold' },

  latestNoteBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    maxWidth: '100%',
  },
  latestNoteMeta: { fontSize: 11, color: '#64748B', marginBottom: 4 },
  latestNoteText: { fontSize: 13, color: '#0F172A' },

  center: { alignItems: 'center', marginTop: 24 },
  noData: { fontStyle: 'italic', color: '#8D99AE' },

  dragBanner: {
    textAlign: 'center',
    color: '#64748b',
    marginTop: 8,
    marginBottom: 6,
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E2E8F0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 8,
  },
  statusOption: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
  },
  statusOptionActive: { backgroundColor: '#17a2b8', borderColor: '#17a2b8' },
  statusOptionText: { color: '#0F172A', fontWeight: '600' },
  statusOptionTextActive: { color: '#FFFFFF', fontWeight: '700' },
  modalButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 12,
  },
  modalBtnCancel: {
    flex: 1,
    backgroundColor: '#EF4444',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalBtnApply: {
    flex: 1,
    backgroundColor: '#22C55E',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalBtnText: { color: '#fff', fontWeight: '700' },
});
