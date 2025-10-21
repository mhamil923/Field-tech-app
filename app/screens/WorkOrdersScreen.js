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
  TextInput,
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

/** notes utilities */
const parseNotes = (notesLike) => {
  if (Array.isArray(notesLike)) return notesLike;
  if (!notesLike) return [];
  try {
    const parsed = JSON.parse(notesLike);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
const latestNoteText = (notesLike) => {
  const arr = parseNotes(notesLike);
  if (!arr.length) return '';
  const sorted = [...arr].sort((a, b) => {
    const ta = new Date(a?.createdAt || 0).getTime();
    const tb = new Date(b?.createdAt || 0).getTime();
    return tb - ta;
  });
  const top = sorted[0] || {};
  return top.text || '';
};

export default function WorkOrdersScreen() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [workOrders, setWorkOrders] = useState([]);
  const [selectedStatus, setSelectedStatus] = useState('Today');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingFirst, setLoadingFirst] = useState(true);

  // single-status change modal
  const [statusModal, setStatusModal] = useState({ id: null, value: null });

  // ----- BULK "Parts In" (web parity) -----
  const [bulkVisible, setBulkVisible] = useState(false);
  const [bulkSearch, setBulkSearch] = useState('');
  const [bulkSelected, setBulkSelected] = useState(() => new Set());
  const [bulkNote, setBulkNote] = useState('Parts In');
  const [bulkWorking, setBulkWorking] = useState(false);

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

  const addNote = async (id, text) => {
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    try {
      await api.post(`/work-orders/${id}/notes`, { text: trimmed });
    } catch (e) {
      console.error('Failed to add note:', e?.message || e);
    }
  };

  // ----- BULK "Parts In" helpers -----
  const waitingOrders = useMemo(
    () => workOrders.filter((o) => normStatus(o.status) === normStatus(PARTS_WAITING)),
    [workOrders]
  );

  const [bulkDefaultSeed, setBulkDefaultSeed] = useState(0); // forces FlatList to refresh selection defaults

  const filteredWaitingForModal = useMemo(() => {
    const q = bulkSearch.trim().toLowerCase();
    if (!q) return waitingOrders;
    return waitingOrders.filter((o) => {
      const hay = [
        o.workOrderNumber,
        o.poNumber,
        o.customer,
        o.siteLocation,
        o.siteName,
        o.siteLocationName,
        o.siteAddress,
        o.serviceAddress,
        o.address,
        o.problemDescription,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [waitingOrders, bulkSearch]);

  const toggleBulkSelect = (id) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAll = () => setBulkSelected(new Set(filteredWaitingForModal.map((o) => o.id)));
  const selectNone = () => setBulkSelected(new Set());

  const openBulkModal = () => {
    setBulkSearch('');
    setBulkNote('Parts In');
    setBulkSelected(new Set(waitingOrders.map((o) => o.id))); // default select all
    setBulkDefaultSeed((s) => s + 1);
    setBulkVisible(true);
  };
  const closeBulkModal = () => {
    if (bulkWorking) return;
    setBulkVisible(false);
    setBulkSelected(new Set());
    setBulkNote('Parts In');
    setBulkSearch('');
  };

  const applyBulkPartsIn = async () => {
    const ids = Array.from(bulkSelected);
    if (!ids.length) {
      Alert.alert('Nothing selected', 'Choose at least one work order.');
      return;
    }
    try {
      setBulkWorking(true);
      for (const id of ids) {
        await api.put(`/work-orders/${id}`, { status: PARTS_NEXT });
        if (bulkNote && bulkNote.trim()) {
          await addNote(id, bulkNote.trim());
        }
      }
      Alert.alert('Success', `Marked parts in for ${ids.length} work order(s).`);
      closeBulkModal();
      fetchWorkOrders();
    } catch (e) {
      Alert.alert('Error', 'Failed to apply updates.');
    } finally {
      setBulkWorking(false);
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
    // Legacy-safe Site Location / Address handling
    const rawLoc = norm(item.siteLocation);
    const explicitName = norm(item.siteName) || norm(item.siteLocationName);
    let siteLocationName = explicitName;
    let siteAddress = norm(item.siteAddress) || norm(item.serviceAddress) || norm(item.address);

    if (!siteAddress && rawLoc) {
      siteAddress = rawLoc;
    } else if (!siteLocationName && rawLoc) {
      siteLocationName = rawLoc;
    }

    const hasAddress = !!siteAddress;
    const latest = latestNoteText(item.notes);

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
        <Text style={styles.cardText}>Site Location: {siteLocationName || '—'}</Text>

        {hasAddress ? (
          <TouchableOpacity onPress={() => openInGoogleMaps(siteAddress || siteLocationName)}>
            <Text style={styles.linkText}>Site Address: {siteAddress}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.cardText}>Site Address: N/A</Text>
        )}

        <Text style={styles.cardText}>Problem: {item.problemDescription || 'N/A'}</Text>
        {!!latest && (
          <Text numberOfLines={2} style={styles.noteLine}>
            Latest Note: {latest}
          </Text>
        )}
        <Text style={styles.cardText}>
          Scheduled:{' '}
          {item.scheduledDate ? moment(item.scheduledDate).format('YYYY-MM-DD HH:mm') : 'Not Scheduled'}
        </Text>
        <Text style={styles.cardText}>Status: {item.status}</Text>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.statusBtn}
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
        keyExtractor={(it) => String(it.id)}   // ← FIXED: removed stray ")"
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

  const HeaderActions = () => {
    if (normStatus(selectedStatus) !== normStatus(PARTS_WAITING)) return null;
    return (
      <View style={styles.partsHeaderRow}>
        <TouchableOpacity onPress={openBulkModal} style={styles.partsHeaderBtn}>
          <Text style={styles.partsHeaderBtnText}>
            Mark Parts In ({waitingOrders.length})
          </Text>
        </TouchableOpacity>
      </View>
    );
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

      {/* Web-parity bulk "Mark Parts In" button shown only on Waiting on Parts */}
      <HeaderActions />

      {ListComponent}

      {/* Status Modal */}
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

      {/* BULK Parts In Modal */}
      <Modal
        transparent
        visible={bulkVisible}
        animationType="fade"
        onRequestClose={closeBulkModal}
      >
        <Pressable style={styles.modalOverlay} onPress={closeBulkModal}>
          <Pressable style={styles.partsModalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Mark Parts as Received</Text>

            {/* Search + Select all/none */}
            <View style={styles.bulkTopRow}>
              <TextInput
                style={styles.searchInput}
                placeholder='Search WO #, PO #, customer, or site...'
                value={bulkSearch}
                onChangeText={setBulkSearch}
              />
              <TouchableOpacity style={styles.bulkTopBtn} onPress={selectAll}>
                <Text style={styles.bulkTopBtnText}>Select All</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.bulkTopBtn} onPress={selectNone}>
                <Text style={styles.bulkTopBtnText}>Select None</Text>
              </TouchableOpacity>
            </View>

            {/* List */}
            <FlatList
              data={filteredWaitingForModal}
              keyExtractor={(it) => String(it.id)}
              style={{ maxHeight: 380 }}
              ItemSeparatorComponent={() => <View style={styles.rowDivider} />}
              extraData={bulkDefaultSeed}
              renderItem={({ item }) => {
                const checked = bulkSelected.has(item.id);
                const site =
                  norm(item.siteAddress) ||
                  norm(item.serviceAddress) ||
                  norm(item.address) ||
                  norm(item.siteLocation) ||
                  '';
                return (
                  <TouchableOpacity
                    onPress={() => toggleBulkSelect(item.id)}
                    style={styles.partsRow}
                  >
                    <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                      {checked ? <Text style={styles.checkboxGlyph}>✓</Text> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.partsRowTitle}>
                        WO: {item.workOrderNumber || '—'} {item.poNumber ? ` • PO: ${item.poNumber}` : ''}
                      </Text>
                      <Text style={styles.partsRowSub}>{item.customer || '—'}</Text>
                      {!!site && <Text style={styles.partsRowSub} numberOfLines={1}>{site}</Text>}
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={{ paddingVertical: 12 }}>
                  <Text style={{ textAlign: 'center', color: '#64748b' }}>
                    No matching work orders.
                  </Text>
                </View>
              }
            />

            {/* Optional note */}
            <Text style={[styles.inputLabel, { marginTop: 10 }]}>Optional note</Text>
            <TextInput
              value={bulkNote}
              onChangeText={setBulkNote}
              placeholder="e.g., Parts In"
              style={styles.textInput}
              multiline
            />

            {/* Action buttons */}
            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={[styles.modalBtnCancel, bulkWorking && { opacity: 0.7 }]}
                onPress={closeBulkModal}
                disabled={bulkWorking}
              >
                <Text style={styles.modalBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalBtnApply,
                  !bulkSelected.size && { backgroundColor: '#94a3b8' },
                ]}
                onPress={applyBulkPartsIn}
                disabled={!bulkSelected.size || bulkWorking}
              >
                <Text style={styles.modalBtnText}>
                  {bulkWorking ? 'Updating…' : `Mark Parts In (${bulkSelected.size})`}
                </Text>
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

  /* chip/filter bar */
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

  // waiting tab header action
  partsHeaderRow: {
    paddingTop: 8,
    paddingBottom: 4,
    alignItems: 'flex-start',
  },
  partsHeaderBtn: {
    backgroundColor: '#22c55e',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  partsHeaderBtnText: { color: '#fff', fontWeight: '700' },

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

  noteLine: {
    fontSize: 13,
    color: '#475569',
    marginBottom: 4,
  },

  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    alignItems: 'center',
    gap: 8,
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
  partsModalCard: {
    width: '100%',
    maxWidth: 640,
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
  inputLabel: {
    fontSize: 12,
    color: '#475569',
    marginBottom: 4,
    fontWeight: '600',
  },
  textInput: {
    minHeight: 60,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    padding: 10,
    textAlignVertical: 'top',
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

  // bulk modal specifics
  bulkTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 40,
  },
  bulkTopBtn: {
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 10,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
  },
  bulkTopBtnText: { color: '#0f172a', fontWeight: '600' },

  partsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
  },
  rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#e5e7eb' },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#94a3b8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  checkboxGlyph: { color: '#fff', fontWeight: '900', fontSize: 13 },
  partsRowTitle: { fontWeight: '700', color: '#111827' },
  partsRowSub: { color: '#475569', fontSize: 12 },
});
