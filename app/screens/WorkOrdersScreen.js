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
  ScrollView,
} from 'react-native';
import moment from 'moment';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DraggableFlatList from 'react-native-draggable-flatlist';
import api from '../../constants/api';

/** ───────────────────────────────────────────────────────────────────────────
 *  STATUS SET — keep in sync with server/web
 *  (Parts In removed; Approved added between Waiting for Approval & Waiting on Parts)
 *  Chip order matches web.
 *  ─────────────────────────────────────────────────────────────────────────── */
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
// Bulk “Mark Parts In” now routes these to Needs to be Scheduled
const PARTS_NEXT = 'Needs to be Scheduled';

// ---------- helpers (status/strings) ----------
const norm = (v) => (v ?? '').toString().trim();
const statusKey = (s) =>
  norm(s).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
const normStatus = statusKey;

const CANON = new Map(STATUSES.map((label) => [statusKey(label), label]));
const STATUS_SYNONYMS = new Map([
  // Legacy “Parts In” & variants → Needs to be Scheduled
  ['part in', PARTS_NEXT],
  ['parts in', PARTS_NEXT],
  ['parts  in', PARTS_NEXT],
  ['parts-in', PARTS_NEXT],
  ['parts_in', PARTS_NEXT],
  ['partsin', PARTS_NEXT],
  ['part s in', PARTS_NEXT],

  // Waiting on Parts
  ['waiting on part', 'Waiting on Parts'],
  ['waiting on parts', 'Waiting on Parts'],
  ['waiting-on-parts', 'Waiting on Parts'],
  ['waiting_on_parts', 'Waiting on Parts'],
  ['waitingonparts', 'Waiting on Parts'],

  // Waiting for Approval → Waiting for Approval (canonical), keep variants safe
  ['waiting-on-approval', 'Waiting for Approval'],
  ['waiting_on_approval', 'Waiting for Approval'],

  // Needs to be Quoted (common variants)
  ['needs quote', 'Needs to be Quoted'],
  ['need quote', 'Needs to be Quoted'],
  ['quote needed', 'Needs to be Quoted'],
  ['to be quoted', 'Needs to be Quoted'],
  ['needs quotation', 'Needs to be Quoted'],

  // Needs to be Scheduled variants
  ['needs to be schedule', 'Needs to be Scheduled'],
  ['need to be scheduled', 'Needs to be Scheduled'],

  // Needs to be Invoiced (common variants)
  ['needs to be invoiced', 'Needs to be Invoiced'],
  ['need to be invoiced', 'Needs to be Invoiced'],
  ['needs invoiced', 'Needs to be Invoiced'],
  ['needs-invoiced', 'Needs to be Invoiced'],
  ['needs_invoiced', 'Needs to be Invoiced'],
]);

const toCanonicalStatus = (s) =>
  CANON.get(statusKey(s)) || STATUS_SYNONYMS.get(statusKey(s)) || norm(s);

// Hide legacy PO values that equal WO
const isLegacyWoInPo = (wo, po) => !!norm(wo) && norm(wo) === norm(po);
const displayPO = (wo, po) => (isLegacyWoInPo(wo, po) ? '' : norm(po));

export default function WorkOrdersScreen() {
  const router = useRouter();

  const [me, setMe] = useState(null); // { id, username, role }
  const [workOrders, setWorkOrders] = useState([]);
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingFirst, setLoadingFirst] = useState(true);

  // Modal state for changing status (single)
  const [statusModal, setStatusModal] = useState({ id: null, value: null });

  // ---------- Parts modal state (repurposed to move to Needs to be Scheduled) ----------
  const [partsModalOpen, setPartsModalOpen] = useState(false);
  const [poSearch, setPoSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isUpdatingParts, setIsUpdatingParts] = useState(false);

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

  const saveTodayOrder = useCallback(
    async (ids) => {
      try {
        setTodayOrderIds(ids);
        await AsyncStorage.setItem(todayKey, JSON.stringify(ids));
      } catch {
        // ignore
      }
    },
    [todayKey]
  );

  // ---------- load current user (for Jeff-only add button)
  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/auth/me');
        setMe(r.data || null);
      } catch {
        // not fatal
      }
    })();
  }, []);

  const fetchWorkOrders = useCallback(async () => {
    try {
      const res = await api.get('/work-orders');
      const data = Array.isArray(res.data) ? res.data : [];
      // Normalize status like web does
      const canon = data.map((o) => ({ ...o, status: toCanonicalStatus(o.status) }));
      setWorkOrders(canon);
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
      const label = toCanonicalStatus(o?.status);
      if (map[label] !== undefined) map[label] += 1;
      if (o?.scheduledDate && moment(o.scheduledDate).isSame(moment(), 'day')) today += 1;
    }
    return { byStatus: map, all: workOrders.length, today };
  }, [workOrders]);

  // Do we have ANY “Waiting on Parts” items? (controls Parts button visibility globally)
  const anyWaitingOnParts = useMemo(
    () => workOrders.some((o) => normStatus(o.status) === normStatus(PARTS_WAITING)),
    [workOrders]
  );

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
        try {
          arr = JSON.parse(item.notes);
        } catch {
          arr = [];
        }
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
    return workOrders.filter((o) => normStatus(o?.status) === normStatus(selectedStatus));
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

  // ---------- “Mark Parts In” modal helpers (moves to Needs to be Scheduled) ----------
  const openPartsModal = () => {
    // Ensure we’re looking at the Waiting tab for context
    if (normStatus(selectedStatus) !== normStatus(PARTS_WAITING)) {
      setSelectedStatus(PARTS_WAITING);
    }
    const source = workOrders.filter(
      (o) => normStatus(o.status) === normStatus(PARTS_WAITING)
    );
    setSelectedIds(new Set(source.map((o) => o.id)));
    setPoSearch('');
    setPartsModalOpen(true);
  };

  const closePartsModal = () => {
    setPartsModalOpen(false);
    setSelectedIds(new Set());
    setPoSearch('');
  };

  const toggleId = (id) => {
    const copy = new Set(selectedIds);
    if (copy.has(id)) copy.delete(id);
    else copy.add(id);
    setSelectedIds(copy);
  };

  const setAll = (checked, visibleRows) => {
    setSelectedIds(checked ? new Set(visibleRows.map((o) => o.id)) : new Set());
  };

  const visibleWaitingRows = useMemo(() => {
    const base = workOrders.filter(
      (o) => normStatus(o.status) === normStatus(PARTS_WAITING)
    );
    const q = poSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((o) => {
      const wo = norm(o.workOrderNumber).toLowerCase();
      const po = displayPO(o.workOrderNumber, o.poNumber).toLowerCase();
      const cust = norm(o.customer).toLowerCase();
      const site = norm(o.siteLocation).toLowerCase();
      return wo.includes(q) || po.includes(q) || cust.includes(q) || site.includes(q);
    });
  }, [workOrders, poSearch]);

  const markSelectedAsPartsIn = async () => {
    if (!selectedIds.size) return;
    setIsUpdatingParts(true);

    const ids = Array.from(selectedIds);
    const prev = workOrders;

    // Optimistic UI: flip to Needs to be Scheduled
    const next = prev.map((o) => (ids.includes(o.id) ? { ...o, status: PARTS_NEXT } : o));
    setWorkOrders(next);

    try {
      const res = await api.put('/work-orders/bulk-status', { ids, status: PARTS_NEXT });
      const items = Array.isArray(res?.data?.items) ? res.data.items : [];
      if (items.length) {
        const byId = new Map(items.map((r) => [r.id, r]));
        setWorkOrders((cur) =>
          cur.map((o) =>
            byId.has(o.id)
              ? { ...o, ...byId.get(o.id), status: toCanonicalStatus(byId.get(o.id).status) }
              : o
          )
        );
      }

      setSelectedStatus(PARTS_NEXT);
      await fetchWorkOrders();
      closePartsModal();
      Alert.alert('Success', `Moved ${ids.length} work order(s) to “${PARTS_NEXT}”.`);
    } catch (err) {
      console.error('Bulk update failed:', err);
      setWorkOrders(prev);
      const status = err?.response?.status;
      const msg =
        err?.response?.data?.error ||
        (status === 401
          ? 'Missing or invalid token. Please sign in again.'
          : status === 403
          ? 'Forbidden: one or more selected items are not assigned to you.'
          : `Failed to move selected to “${PARTS_NEXT}”.`);
      Alert.alert('Error', msg);
    } finally {
      setIsUpdatingParts(false);
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
    const titleWo = norm(item?.workOrderNumber) || '—';
    const titlePo = displayPO(item?.workOrderNumber, item?.poNumber) || '—';

    return (
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>WO: {titleWo}  •  PO: {titlePo}</Text>
          {selectedStatus === 'Today' ? (
            <TouchableOpacity onLongPress={drag} delayLongPress={120} style={styles.dragHandle}>
              <Text style={styles.dragGlyph}>≡</Text>
              <Text style={styles.dragHint}>Hold to drag</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <Text style={styles.cardText}>Customer: {item?.customer ?? 'N/A'}</Text>

        <TouchableOpacity onPress={() => openInGoogleMaps(item?.siteLocation || '')}>
          <Text style={styles.linkText}>Site Address: {item?.siteLocation ?? 'N/A'}</Text>
        </TouchableOpacity>

        <Text style={styles.cardText}>Problem: {item?.problemDescription ?? 'N/A'}</Text>
        <Text style={styles.cardText}>
          Scheduled:{' '}
          {item?.scheduledDate
            ? moment(item.scheduledDate).format('YYYY-MM-DD HH:mm')
            : 'Not Scheduled'}
        </Text>

        <Text style={[styles.cardText, { marginBottom: 8 }]}>
          Status: {item?.status || '—'}
        </Text>

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

  // ---------- modal actions (single status)
  const closeStatusModal = () => setStatusModal({ id: null, value: null });
  const applyStatusModal = () => {
    if (statusModal.id != null && statusModal.value) {
      handleUpdateStatus(statusModal.id, statusModal.value);
    }
    closeStatusModal();
  };

  return (
    <View style={styles.container}>
      {/* Header row with Jeff-only Add button and Parts bulk button */}
      <View style={styles.headerRow}>
        <Text style={styles.header}>Work Orders</Text>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {/* Show 'Mark Parts In' (moves to Needs to be Scheduled) when any Waiting-on-Parts exist */}
          {anyWaitingOnParts && (
            <TouchableOpacity onPress={openPartsModal} style={styles.partsBtn}>
              <Text style={styles.partsBtnText}>Mark Parts In</Text>
            </TouchableOpacity>
          )}

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

      {/* Fixed status bar */}
      <View style={styles.filterBar}>{renderChips()}</View>

      {/* The list (regular or draggable) */}
      {ListComponent}

      {/* Status selection modal (single) */}
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

      {/* ---------- Parts bulk modal (moves to Needs to be Scheduled) ---------- */}
      <Modal
        transparent
        visible={partsModalOpen}
        animationType="fade"
        onRequestClose={closePartsModal}
      >
        <Pressable style={styles.modalOverlay} onPress={closePartsModal}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Mark Parts as Received</Text>

            {/* Controls */}
            <View style={styles.modalControls}>
              <TextInput
                style={styles.modalInput}
                placeholder="Search WO #, PO #, customer, or site…"
                value={poSearch}
                onChangeText={setPoSearch}
                placeholderTextColor="#94A3B8"
              />
              <View style={styles.modalActionsInline}>
                <TouchableOpacity
                  style={styles.btnGhost}
                  onPress={() => setAll(true, visibleWaitingRows)}
                >
                  <Text style={styles.btnGhostText}>Select All</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.btnGhost}
                  onPress={() => setAll(false, visibleWaitingRows)}
                >
                  <Text style={styles.btnGhostText}>Select None</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* List */}
            <View style={{ maxHeight: 420 }}>
              {visibleWaitingRows.length === 0 ? (
                <View style={styles.center}>
                  <Text style={styles.noData}>No POs in “Waiting on Parts”.</Text>
                </View>
              ) : (
                <ScrollView>
                  <View style={styles.miniHeaderRow}>
                    <Text style={[styles.miniHeaderCell, { width: 42 }]} />
                    <Text style={[styles.miniHeaderCell, { flex: 1 }]}>WO #</Text>
                    <Text style={[styles.miniHeaderCell, { flex: 1 }]}>PO #</Text>
                    <Text style={[styles.miniHeaderCell, { flex: 1.2 }]}>Customer</Text>
                    <Text style={[styles.miniHeaderCell, { flex: 1.5 }]}>Site</Text>
                  </View>
                  {visibleWaitingRows.map((o) => {
                    const checked = selectedIds.has(o.id);
                    return (
                      <Pressable
                        key={o.id}
                        onPress={() => toggleId(o.id)}
                        style={styles.miniRow}
                      >
                        <View style={styles.checkBox}>
                          {checked ? <Text style={styles.checkGlyph}>✓</Text> : null}
                        </View>
                        <Text style={[styles.miniCell, { flex: 1 }]} numberOfLines={1}>
                          {norm(o.workOrderNumber) || '—'}
                        </Text>
                        <Text style={[styles.miniCell, { flex: 1 }]} numberOfLines={1}>
                          {displayPO(o.workOrderNumber, o.poNumber) || '—'}
                        </Text>
                        <Text style={[styles.miniCell, { flex: 1.2 }]} numberOfLines={1}>
                          {o.customer || '—'}
                        </Text>
                        <Text style={[styles.miniCell, { flex: 1.5 }]} numberOfLines={1}>
                          {o.siteLocation || '—'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
            </View>

            {/* Footer */}
            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={[styles.modalBtnApply, isUpdatingParts && { opacity: 0.6 }]}
                disabled={isUpdatingParts || selectedIds.size === 0}
                onPress={markSelectedAsPartsIn}
              >
                <Text style={styles.modalBtnText}>
                  {isUpdatingParts ? 'Updating…' : `Mark Parts In (${selectedIds.size})`}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalBtnCancel} onPress={closePartsModal}>
                <Text style={styles.modalBtnText}>Cancel</Text>
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

  partsBtn: {
    backgroundColor: '#0ea5a6',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    marginRight: 8,
  },
  partsBtnText: { color: '#fff', fontWeight: '700' },

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

  // Parts modal specific
  modalControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  modalInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
  },
  modalActionsInline: {
    flexDirection: 'row',
    gap: 8,
  },
  btnGhost: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  btnGhostText: { color: '#0F172A', fontWeight: '600' },

  miniHeaderRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    marginBottom: 4,
  },
  miniHeaderCell: {
    fontWeight: '700',
    color: '#0F172A',
  },
  miniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2E8F0',
  },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  checkGlyph: {
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '700',
  },
  miniCell: {
    color: '#0F172A',
    paddingRight: 8,
  },
});
