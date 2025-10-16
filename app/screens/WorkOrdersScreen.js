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

const PARTS_WAITING = 'Waiting on Parts';
const PARTS_NEXT = 'Needs to be Scheduled';

const norm = (v) => (v ?? '').toString().trim();
const statusKey = (s) =>
  norm(s).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
const normStatus = statusKey;
const CANON = new Map(STATUSES.map((label) => [statusKey(label), label]));

const STATUS_SYNONYMS = new Map([
  ['part in', PARTS_NEXT],
  ['parts in', PARTS_NEXT],
  ['waiting on parts', PARTS_WAITING],
  ['waiting-on-parts', PARTS_WAITING],
  ['waiting_on_parts', PARTS_WAITING],
  ['needs quote', 'Needs to be Quoted'],
  ['needs invoiced', 'Needs to be Invoiced'],
]);

const toCanonicalStatus = (s) =>
  CANON.get(statusKey(s)) || STATUS_SYNONYMS.get(statusKey(s)) || norm(s);

const displayPO = (wo, po) => (norm(wo) === norm(po) ? '' : norm(po));

export default function WorkOrdersScreen() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [workOrders, setWorkOrders] = useState([]);
  const [selectedStatus, setSelectedStatus] = useState('Today'); // no "All"
  const [refreshing, setRefreshing] = useState(false);
  const [loadingFirst, setLoadingFirst] = useState(true);
  const [statusModal, setStatusModal] = useState({ id: null, value: null });

  // Drag order for Today
  const todayKey = `woOrder:${moment().format('YYYY-MM-DD')}`;
  const [todayOrderIds, setTodayOrderIds] = useState([]);

  const loadTodayOrder = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(todayKey);
      setTodayOrderIds(raw ? JSON.parse(raw) : []);
    } catch {
      setTodayOrderIds([]);
    }
  }, [todayKey]);

  const saveTodayOrder = useCallback(
    async (ids) => {
      setTodayOrderIds(ids);
      await AsyncStorage.setItem(todayKey, JSON.stringify(ids));
    },
    [todayKey]
  );

  // current user (Add button)
  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/auth/me');
        setMe(r.data || null);
      } catch {}
    })();
  }, []);

  const fetchWorkOrders = useCallback(async () => {
    try {
      const res = await api.get('/work-orders');
      const canon = (res.data || []).map((o) => ({
        ...o,
        status: toCanonicalStatus(o.status),
      }));
      setWorkOrders(canon);
    } catch (err) {
      console.error('Error fetching work orders:', err);
      Alert.alert('Error', 'Failed to fetch work orders.');
    } finally {
      setLoadingFirst(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkOrders();
  }, [fetchWorkOrders]);
  useFocusEffect(useCallback(() => fetchWorkOrders(), [fetchWorkOrders]));
  useEffect(() => {
    loadTodayOrder();
  }, [loadTodayOrder, workOrders.length]);

  const counts = useMemo(() => {
    const map = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    let today = 0;
    for (const o of workOrders) {
      const label = toCanonicalStatus(o?.status);
      if (map[label] !== undefined) map[label] += 1;
      if (o?.scheduledDate && moment(o.scheduledDate).isSame(moment(), 'day')) today += 1;
    }
    return { byStatus: map, today };
  }, [workOrders]);

  const openInGoogleMaps = async (query) => {
    const q = encodeURIComponent(query || '');
    const gm = `comgooglemaps://?q=${q}`;
    const web = `https://www.google.com/maps/search/?api=1&query=${q}`;
    try {
      const can = await Linking.canOpenURL(gm);
      Linking.openURL(can ? gm : web);
    } catch {
      Alert.alert('Error', 'Failed to open maps');
    }
  };

  const filteredOrders = useMemo(() => {
    if (selectedStatus === 'Today') {
      const today = moment().format('YYYY-MM-DD');
      return workOrders.filter(
        (o) => o.scheduledDate && moment(o.scheduledDate).format('YYYY-MM-DD') === today
      );
    }
    return workOrders.filter((o) => normStatus(o.status) === normStatus(selectedStatus));
  }, [workOrders, selectedStatus]);

  const orderedToday = useMemo(() => {
    if (selectedStatus !== 'Today') return filteredOrders;
    const map = new Map(filteredOrders.map((o) => [String(o.id), o]));
    const ordered = [];
    for (const id of todayOrderIds) {
      if (map.has(id)) {
        ordered.push(map.get(id));
        map.delete(id);
      }
    }
    return [...ordered, ...Array.from(map.values())];
  }, [filteredOrders, selectedStatus, todayOrderIds]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchWorkOrders();
  };

  const handleUpdateStatus = async (id, newStatus) => {
    const prev = workOrders;
    setWorkOrders(prev.map((o) => (o.id === id ? { ...o, status: newStatus } : o)));
    try {
      await api.put(`/work-orders/${id}`, { status: newStatus });
    } catch (err) {
      console.error(err);
      setWorkOrders(prev);
      Alert.alert('Error', 'Failed to update status.');
    }
  };

  const renderChips = () => (
    <View style={styles.chipsWrap}>
      <TouchableOpacity
        onPress={() => setSelectedStatus('Today')}
        style={[styles.chip, selectedStatus === 'Today' && styles.chipActive]}
      >
        <Text style={[styles.chipText, selectedStatus === 'Today' && styles.chipTextActive]}>
          Today
        </Text>
        <View style={[styles.badge, selectedStatus === 'Today' && styles.badgeActive]}>
          <Text style={[styles.badgeText, selectedStatus === 'Today' && styles.badgeTextActive]}>
            {counts.today}
          </Text>
        </View>
      </TouchableOpacity>

      {STATUSES.map((s) => (
        <TouchableOpacity
          key={s}
          onPress={() => setSelectedStatus(s)}
          style={[styles.chip, selectedStatus === s && styles.chipActive]}
        >
          <Text style={[styles.chipText, selectedStatus === s && styles.chipTextActive]}>
            {s}
          </Text>
          <View style={[styles.badge, selectedStatus === s && styles.badgeActive]}>
            <Text style={[styles.badgeText, selectedStatus === s && styles.badgeTextActive]}>
              {counts.byStatus[s]}
            </Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );

  const Card = ({ item, drag }) => {
    // ----- Legacy-safe Site Location / Address handling (mirrors web) -----
    const rawLoc = norm(item.siteLocation);                 // may be name OR a full address (legacy)
    const explicitName = norm(item.siteName) || norm(item.siteLocationName);

    // Prefer explicit name for Site Location
    let siteLocationName = explicitName;

    // Build Site Address from dedicated address fields first
    let siteAddress = norm(item.siteAddress) || norm(item.serviceAddress) || norm(item.address);

    if (!siteAddress && rawLoc) {
      // Older records: siteLocation stored the full address
      siteAddress = rawLoc;
      // Leave siteLocationName blank so it doesn't duplicate the address
    } else if (!siteLocationName && rawLoc) {
      // Newer records: siteLocation is a location NAME
      siteLocationName = rawLoc;
    }

    const hasAddress = !!siteAddress;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>
            WO: {item.workOrderNumber || '—'} • PO: {displayPO(item.workOrderNumber, item.poNumber)}
          </Text>
          {selectedStatus === 'Today' && (
            <TouchableOpacity onLongPress={drag} delayLongPress={120} style={styles.dragHandle}>
              <Text style={styles.dragGlyph}>≡</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.cardText}>Customer: {item.customer || 'N/A'}</Text>

        {/* Site Location (name only) */}
        <Text style={styles.cardText}>Site Location: {siteLocationName || '—'}</Text>

        {/* Site Address (tap to open Maps) */}
        {hasAddress ? (
          <TouchableOpacity onPress={() => openInGoogleMaps(siteAddress || siteLocationName)}>
            <Text style={styles.linkText}>Site Address: {siteAddress}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.cardText}>Site Address: N/A</Text>
        )}

        <Text style={styles.cardText}>Problem: {item.problemDescription || 'N/A'}</Text>
        <Text style={styles.cardText}>
          Scheduled:{' '}
          {item.scheduledDate ? moment(item.scheduledDate).format('YYYY-MM-DD HH:mm') : 'Not Scheduled'}
        </Text>
        <Text style={styles.cardText}>Status: {item.status}</Text>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.statusBtn, { marginBottom: 8 }]}
            onPress={() => setStatusModal({ id: item.id, value: item.status || STATUSES[0] })}
          >
            <Text style={styles.statusBtnText}>Status</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.viewButton}
            onPress={() => router.push(`/screens/ViewWorkOrder?id=${item.id}`)}
          >
            <Text style={styles.viewButtonText}>View Details</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const ListComponent =
    selectedStatus === 'Today' ? (
      <>
        <Text style={styles.dragBanner}>Long-press to drag order.</Text>
        <DraggableFlatList
          data={orderedToday}
          keyExtractor={(it) => String(it.id)}
          activationDistance={12}
          onDragEnd={({ data }) => saveTodayOrder(data.map((d) => String(d.id)))}
          renderItem={({ item, drag }) => <Card item={item} drag={drag} />}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      </>
    ) : (
      <FlatList
        data={filteredOrders}
        keyExtractor={(it) => String(it.id)}
        renderItem={({ item }) => <Card item={item} />}
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

  const closeStatusModal = () => setStatusModal({ id: null, value: null });
  const applyStatusModal = () => {
    if (statusModal.id && statusModal.value) {
      handleUpdateStatus(statusModal.id, statusModal.value);
    }
    closeStatusModal();
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Work Orders</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {me?.username === 'Jeff' && (
            <TouchableOpacity
              onPress={() => router.push('/screens/AddWorkOrder')}
              style={styles.addBtn}
            >
              <Text style={styles.addBtnText}>+ Add Work Order</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.filterBar}>{renderChips()}</View>
      {ListComponent}

      <Modal
        transparent
        visible={statusModal.id != null}
        animationType="fade"
        onRequestClose={closeStatusModal}
      >
        <Pressable style={styles.modalOverlay} onPress={closeStatusModal}>
          <Pressable style={styles.modalCard}>
            <Text style={styles.modalTitle}>Change Status</Text>
            {STATUSES.map((s) => (
              <TouchableOpacity
                key={s}
                style={[styles.statusOption, statusModal.value === s && styles.statusOptionActive]}
                onPress={() => setStatusModal({ ...statusModal, value: s })}
              >
                <Text
                  style={[
                    styles.statusOptionText,
                    statusModal.value === s && styles.statusOptionTextActive,
                  ]}
                >
                  {s}
                </Text>
              </TouchableOpacity>
            ))}
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
  header: { fontSize: 22, fontWeight: '700', color: '#2B2D42' },

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
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    padding: 16,
    marginBottom: 12,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  dragHandle: { flexDirection: 'row', alignItems: 'center' },
  dragGlyph: { fontSize: 20, color: '#64748b' },

  cardTitle: { fontSize: 18, fontWeight: '600', color: '#2B2D42' },
  cardText: { fontSize: 14, color: '#2B2D42', marginBottom: 4 },
  linkText: { color: '#17a2b8', textDecorationLine: 'underline', marginBottom: 4 },

  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },

  statusBtn: {
    backgroundColor: '#0ea5a6',
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  statusBtnText: { color: '#fff', fontWeight: 'bold' },

  viewButton: {
    backgroundColor: '#17a2b8',
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  viewButtonText: { color: '#fff', fontWeight: 'bold' },

  center: { alignItems: 'center', marginTop: 24 },
  noData: { fontStyle: 'italic', color: '#8D99AE' },

  dragBanner: { textAlign: 'center', color: '#64748b', marginVertical: 6 },

  // Shared modal styles
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
