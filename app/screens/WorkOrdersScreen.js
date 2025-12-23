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
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import moment from 'moment';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DraggableFlatList from 'react-native-draggable-flatlist';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

// ✅ Shop address (start + end)
const SHOP_ADDRESS = '1513 Industrial Dr, Itasca, IL 60143';

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

/**
 * Helper: determine if a work order is assigned to the current user.
 * Tries ID match and several possible "assigned to" fields / names.
 */
const isAssignedToMe = (order, me) => {
  if (!me) return false;

  const myId = me.id;
  const myName = (me.username || me.name || '')
    .toString()
    .trim()
    .toLowerCase();

  const assignedId =
    order.assignedTo ??
    order.assignedToId ??
    order.assignedUserId ??
    order.assigned_user_id ??
    order.techId ??
    order.tech_id ??
    null;

  const assignedName = (
    order.assignedToName ||
    order.assignedToUsername ||
    order.assignedToUser ||
    order.assignedTech ||
    order.techName ||
    order.tech_name ||
    ''
  )
    .toString()
    .trim()
    .toLowerCase();

  if (myId != null) {
    if (assignedId === myId) return true;
    if (assignedId != null && String(assignedId) === String(myId)) return true;
  }

  if (myName && assignedName && myName === assignedName) return true;

  return false;
};

// ----- Scheduled date normalization -----
const getScheduledRaw = (o) =>
  o?.scheduledDate ??
  o?.scheduled_date ??
  o?.scheduledFor ??
  o?.scheduled_for ??
  o?.scheduledAt ??
  o?.scheduled_at ??
  o?.scheduleDate ??
  o?.schedule_date ??
  null;

/**
 * Robust parse:
 * - If backend gives "YYYY-MM-DD HH:mm:ss" (MySQL), treat as LOCAL time.
 * - If backend gives ISO with Z/offset, parseZone then local().
 */
const parseScheduledMoment = (raw) => {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const hasOffset =
    /[zZ]$/.test(s) || /([+-]\d{2}:?\d{2})$/.test(s);

  if (hasOffset) {
    const mz = moment.parseZone(s);
    return mz.isValid() ? mz.local() : null;
  }

  // MySQL DATETIME common formats (no timezone)
  const mLocal = moment(s, ['YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD HH:mm', 'YYYY-MM-DD'], true);
  if (mLocal.isValid()) return mLocal; // already local

  // fallback
  const mf = moment(s);
  return mf.isValid() ? mf.local() : null;
};

const isScheduledToday = (o) => {
  const raw = getScheduledRaw(o);
  const m = parseScheduledMoment(raw);
  if (!m) return false;
  return m.isSame(moment(), 'day');
};

// Build best-available address for routing from a WO
const bestAddressForOrder = (o) => {
  return (
    norm(o.siteAddress) ||
    norm(o.serviceAddress) ||
    norm(o.address) ||
    norm(o.siteLocation) ||
    norm(o.siteName) ||
    norm(o.siteLocationName) ||
    ''
  );
};

const niceLabelForOrder = (o) => {
  const wo = o.workOrderNumber || '—';
  const po = displayPO(o.workOrderNumber, o.poNumber);
  const cust = o.customer || '—';
  const loc =
    norm(o.siteLocation) || norm(o.siteName) || norm(o.siteLocationName) || '';
  return `WO ${wo}${po ? ` • PO ${po}` : ''} • ${cust}${loc ? ` • ${loc}` : ''}`;
};

const metersToMiles = (m) => (m == null ? null : m / 1609.344);
const secondsToMinutes = (s) => (s == null ? null : s / 60);
const fmtMiles = (miles) =>
  miles == null ? '' : `${miles.toFixed(miles >= 10 ? 1 : 2)} mi`;
const fmtMinutes = (mins) =>
  mins == null ? '' : `${Math.round(mins)} min`;

// Build a Google Maps directions URL (fallback) with waypoints (limit-friendly)
const buildGoogleMapsDirectionsUrl = (origin, destination, waypointAddrs) => {
  const enc = encodeURIComponent;
  const base = 'https://www.google.com/maps/dir/?api=1';
  const wp = (waypointAddrs || []).filter(Boolean);

  const wpStr = wp.slice(0, 23).map(enc).join('|');
  const parts = [
    `${base}&origin=${enc(origin)}`,
    `&destination=${enc(destination)}`,
    wpStr ? `&waypoints=${wpStr}` : '',
    '&travelmode=driving',
  ].join('');
  return parts;
};

export default function WorkOrdersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [me, setMe] = useState(null);
  const [meLoading, setMeLoading] = useState(true);

  const [workOrders, setWorkOrders] = useState([]);
  const [selectedStatus, setSelectedStatus] = useState('Today');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingFirst, setLoadingFirst] = useState(true);

  // single-status change modal
  const [statusModal, setStatusModal] = useState({ id: null, value: null });

  // ----- BULK "Parts In" -----
  const [bulkVisible, setBulkVisible] = useState(false);
  const [bulkSearch, setBulkSearch] = useState('');
  const [bulkSelected, setBulkSelected] = useState(() => new Set());
  const [bulkNote, setBulkNote] = useState('Parts In');
  const [bulkWorking, setBulkWorking] = useState(false);

  // Drag order for Today
  const todayKey = `woOrder:${moment().format('YYYY-MM-DD')}`;
  const [todayOrderIds, setTodayOrderIds] = useState([]);

  // ✅ Route generation UI/state
  const [routeWorking, setRouteWorking] = useState(false);
  const [routeModalOpen, setRouteModalOpen] = useState(false);
  const [routeResult, setRouteResult] = useState(null);

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

  // ✅ FIX: set Authorization header using AsyncStorage (React Native)
  useEffect(() => {
    (async () => {
      try {
        setMeLoading(true);
        const token = await AsyncStorage.getItem('jwt');
        if (token) {
          api.defaults.headers.common.Authorization = `Bearer ${token}`;
        } else {
          delete api.defaults.headers.common.Authorization;
        }

        const r = await api.get('/auth/me');
        setMe(r.data || null);
      } catch (e) {
        setMe(null);
      } finally {
        setMeLoading(false);
      }
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

  useFocusEffect(
    useCallback(() => {
      fetchWorkOrders();
      return undefined;
    }, [fetchWorkOrders])
  );

  useEffect(() => {
    loadTodayOrder();
  }, [loadTodayOrder, workOrders.length]);

  // ---------- COUNTS ----------
  const counts = useMemo(() => {
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const o of workOrders) {
      const label = toCanonicalStatus(o?.status);
      if (byStatus[label] !== undefined) byStatus[label] += 1;
    }

    const today =
      me
        ? workOrders.filter((o) => isAssignedToMe(o, me) && isScheduledToday(o)).length
        : 0;

    return { byStatus, today };
  }, [workOrders, me]);

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

  // ---------- FILTERED ORDERS ----------
  // ✅ Today tab: ONLY my work orders scheduled today.
  // Other tabs: status-based, global.
  const filteredOrders = useMemo(() => {
    const base = workOrders;

    if (selectedStatus === 'Today') {
      if (!me) return [];
      return base.filter((o) => isAssignedToMe(o, me) && isScheduledToday(o));
    }

    return base.filter(
      (o) => normStatus(o.status) === normStatus(selectedStatus)
    );
  }, [workOrders, selectedStatus, me]);

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

  /* ---------------- Status update: correct endpoint for your server.js ---------------- */
  const putStatus = async (id, newStatus) => {
    // ✅ your server.js has: PUT /work-orders/:id/status
    await api.put(
      `/work-orders/${id}/status`,
      { status: newStatus },
      { headers: { 'Content-Type': 'application/json' } }
    );
  };

  const handleUpdateStatus = async (id, newStatus) => {
    const prev = workOrders;
    setWorkOrders(
      prev.map((o) => (o.id === id ? { ...o, status: newStatus } : o))
    );

    try {
      await putStatus(id, newStatus);
      await fetchWorkOrders();
    } catch (err) {
      console.error(err);
      setWorkOrders(prev);
      const msg =
        err?.response?.data?.error ||
        err?.message ||
        'Failed to update status.';
      Alert.alert('Error', msg);
    }
  };

  /* ---------------- Notes: /work-orders/:id/notes ---------------- */
  const addNote = async (id, text) => {
    const trimmed = (text || '').trim();
    if (!trimmed) return;

    try {
      await api.put(
        `/work-orders/${id}/notes`,
        { notes: trimmed, append: true },
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (e1) {
      try {
        await api.put(
          `/work-orders/${id}/notes`,
          { text: trimmed, append: true },
          { headers: { 'Content-Type': 'application/json' } }
        );
      } catch (e2) {
        console.error(
          'Failed to add note:',
          e2?.response?.data?.error || e2?.message || e1?.message
        );
      }
    }
  };

  // ----- BULK "Parts In" helpers -----
  const waitingOrders = useMemo(
    () =>
      workOrders.filter(
        (o) => normStatus(o.status) === normStatus(PARTS_WAITING)
      ),
    [workOrders]
  );

  const [bulkDefaultSeed, setBulkDefaultSeed] = useState(0);

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
  const selectAll = () =>
    setBulkSelected(new Set(filteredWaitingForModal.map((o) => o.id)));
  const selectNone = () => setBulkSelected(new Set());

  const openBulkModal = () => {
    setBulkSearch('');
    setBulkNote('Parts In');
    setBulkSelected(new Set(waitingOrders.map((o) => o.id)));
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
        try {
          await putStatus(id, PARTS_NEXT);
          if (bulkNote && bulkNote.trim()) {
            await addNote(id, bulkNote.trim());
          }
        } catch (e) {
          console.error(
            'Bulk status error for id',
            id,
            e?.response?.data?.error || e?.message
          );
        }
      }
      Alert.alert('Success', `Marked parts in for ${ids.length} work order(s).`);
      closeBulkModal();
      fetchWorkOrders();
    } catch (e) {
      Alert.alert(
        'Error',
        e?.response?.data?.error || e?.message || 'Failed to apply updates.'
      );
    } finally {
      setBulkWorking(false);
    }
  };

  // ✅ ROUTE: generate + reorder Today list
  const generateBestRoute = async () => {
    if (selectedStatus !== 'Today') {
      Alert.alert('Route', 'Switch to the Today tab to generate a route.');
      return;
    }

    const candidates = orderedToday;

    const stops = candidates
      .map((o) => ({
        id: o.id,
        address: bestAddressForOrder(o),
        label: niceLabelForOrder(o),
      }))
      .filter((s) => s.address);

    const missingCount = candidates.length - stops.length;

    if (stops.length < 2) {
      Alert.alert(
        'Route',
        stops.length === 0
          ? 'No usable addresses found in Today work orders.'
          : 'Need at least 2 stops with valid addresses to generate a route.'
      );
      return;
    }

    if (missingCount > 0) {
      Alert.alert(
        'Route',
        `${missingCount} work order(s) were skipped because they are missing a usable address.\n\n(You can still generate a route for the others.)`
      );
    }

    setRouteWorking(true);
    try {
      const payload = {
        start: SHOP_ADDRESS,
        end: SHOP_ADDRESS,
        stops,
        travelMode: 'driving',
      };

      const res = await api.post('/routes/best', payload, {
        headers: { 'Content-Type': 'application/json' },
      });

      const data = res?.data || {};
      const orderedIds = Array.isArray(data.orderedIds) ? data.orderedIds : [];
      if (!orderedIds.length) {
        throw new Error('Route service did not return an ordered list.');
      }

      await saveTodayOrder(orderedIds.map((x) => String(x)));

      let orderedStops = Array.isArray(data.orderedStops) ? data.orderedStops : null;
      if (!orderedStops) {
        const byId = new Map(stops.map((s) => [String(s.id), s]));
        orderedStops = orderedIds
          .map((id) => byId.get(String(id)))
          .filter(Boolean);
      }

      const totalDistanceMiles = metersToMiles(data.totalDistanceMeters);
      const totalDurationMinutes = secondsToMinutes(data.totalDurationSeconds);

      const mapsUrl =
        data.googleMapsUrl ||
        buildGoogleMapsDirectionsUrl(
          SHOP_ADDRESS,
          SHOP_ADDRESS,
          orderedStops.map((s) => s.address)
        );

      setRouteResult({
        orderedIds,
        orderedStops,
        totalDistanceMeters: data.totalDistanceMeters ?? null,
        totalDurationSeconds: data.totalDurationSeconds ?? null,
        totalDistanceMiles,
        totalDurationMinutes,
        googleMapsUrl: mapsUrl,
      });

      setRouteModalOpen(true);
    } catch (e) {
      console.error('Route generation failed:', e?.response?.data || e?.message || e);

      const fallbackUrl = buildGoogleMapsDirectionsUrl(
        SHOP_ADDRESS,
        SHOP_ADDRESS,
        stops.map((s) => s.address)
      );

      Alert.alert(
        'Route',
        'Could not generate the “best route” yet (backend not added or returned an error).\n\nOpening Google Maps with the stops in the current order as a fallback.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open Maps',
            onPress: () => Linking.openURL(fallbackUrl),
          },
        ]
      );
    } finally {
      setRouteWorking(false);
    }
  };

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

  const TodayRouteActions = () => {
    if (selectedStatus !== 'Today') return null;

    const todaysStopsCount = orderedToday.filter((o) => !!bestAddressForOrder(o)).length;

    return (
      <View style={styles.todayHeaderRow}>
        <TouchableOpacity
          onPress={generateBestRoute}
          style={[
            styles.routeBtn,
            (routeWorking || todaysStopsCount < 2) && styles.routeBtnDisabled,
          ]}
          disabled={routeWorking || todaysStopsCount < 2}
        >
          {routeWorking ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ActivityIndicator />
              <Text style={styles.routeBtnText}>Generating…</Text>
            </View>
          ) : (
            <Text style={styles.routeBtnText}>🧭 Generate Best Route</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.routeHint}>Start/End: {SHOP_ADDRESS}</Text>
      </View>
    );
  };

  const renderChips = () => {
    return (
      <View style={styles.chipsWrap}>
        <TouchableOpacity
          onPress={() => setSelectedStatus('Today')}
          style={[styles.chip, selectedStatus === 'Today' && styles.chipActive]}
        >
          <Text
            style={[
              styles.chipText,
              selectedStatus === 'Today' && styles.chipTextActive,
            ]}
          >
            Today
          </Text>
          <View
            style={[
              styles.badge,
              selectedStatus === 'Today' && styles.badgeActive,
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                selectedStatus === 'Today' && styles.badgeTextActive,
              ]}
            >
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
            <Text
              style={[
                styles.chipText,
                selectedStatus === s && styles.chipTextActive,
              ]}
            >
              {s}
            </Text>
            <View
              style={[
                styles.badge,
                selectedStatus === s && styles.badgeActive,
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  selectedStatus === s && styles.badgeTextActive,
                ]}
              >
                {counts.byStatus[s]}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  const Card = ({ item, drag }) => {
    const rawLoc = norm(item.siteLocation);
    const explicitName = norm(item.siteName) || norm(item.siteLocationName);
    let siteLocationName = explicitName;
    let siteAddress =
      norm(item.siteAddress) || norm(item.serviceAddress) || norm(item.address);

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
          {getScheduledRaw(item)
            ? (parseScheduledMoment(getScheduledRaw(item))?.format('YYYY-MM-DD HH:mm') || 'Not Scheduled')
            : 'Not Scheduled'}
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

  const TodayEmpty = () => (
    <View style={styles.center}>
      <Text style={styles.noData}>
        {meLoading
          ? 'Loading your user…'
          : me
          ? 'No work orders assigned to you and scheduled for today.'
          : 'You are not logged in (missing/expired token).'}
      </Text>
    </View>
  );

  const ListComponent =
    selectedStatus === 'Today' ? (
      <>
        <TodayRouteActions />
        <Text style={styles.dragBanner}>Long-press to drag order.</Text>
        <DraggableFlatList
          data={orderedToday}
          keyExtractor={(it) => String(it.id)}
          activationDistance={12}
          onDragEnd={({ data }) => saveTodayOrder(data.map((d) => String(d.id)))}
          renderItem={({ item, drag }) => <Card item={item} drag={drag} />}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + 160 },
          ]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListFooterComponent={<View style={{ height: insets.bottom + 40 }} />}
          ListEmptyComponent={!loadingFirst ? <TodayEmpty /> : null}
        />
      </>
    ) : (
      <FlatList
        data={filteredOrders}
        keyExtractor={(it) => String(it.id)}
        renderItem={({ item }) => <Card item={item} />}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListFooterComponent={<View style={styles.bottomSpacer} />}
        ListEmptyComponent={
          !loadingFirst ? (
            <View style={styles.center}>
              <Text style={styles.noData}>No work orders to display.</Text>
            </View>
          ) : null
        }
      />
    );

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Work Orders</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {me?.username === 'Jeff' && (
            <TouchableOpacity onPress={() => router.push('/screens/AddWorkOrder')} style={styles.addBtn}>
              <Text style={styles.addBtnText}>+ Add Work Order</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.filterBar}>{renderChips()}</View>

      <HeaderActions />
      {ListComponent}

      {/* ROUTE RESULT MODAL */}
      <Modal
        transparent
        visible={routeModalOpen}
        animationType="fade"
        onRequestClose={() => setRouteModalOpen(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setRouteModalOpen(false)}>
          <Pressable style={styles.routeModalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Today’s Best Route</Text>

            <Text style={styles.routeMeta}>Start: {SHOP_ADDRESS}</Text>
            <Text style={styles.routeMeta}>End: {SHOP_ADDRESS}</Text>

            {!!routeResult && (
              <Text style={[styles.routeMeta, { marginTop: 6, fontWeight: '700' }]}>
                Stops: {routeResult.orderedStops?.length || 0}
                {routeResult.totalDistanceMiles != null || routeResult.totalDurationMinutes != null
                  ? ` • ${fmtMiles(routeResult.totalDistanceMiles)} • ${fmtMinutes(routeResult.totalDurationMinutes)}`
                  : ''}
              </Text>
            )}

            <View style={{ height: 10 }} />

            <ScrollView style={{ maxHeight: 420 }}>
              {(routeResult?.orderedStops || []).map((s, idx) => (
                <View key={`${s.id}-${idx}`} style={styles.routeStopRow}>
                  <View style={styles.routeStopIdx}>
                    <Text style={styles.routeStopIdxText}>{idx + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.routeStopTitle}>{s.label || `Stop ${idx + 1}`}</Text>
                    <Text style={styles.routeStopAddr} numberOfLines={2}>
                      {s.address || '—'}
                    </Text>

                    {(s.legDistanceMeters != null || s.legDurationSeconds != null) && (
                      <Text style={styles.routeStopLeg}>
                        Leg: {fmtMiles(metersToMiles(s.legDistanceMeters))}{' '}
                        {s.legDistanceMeters != null && s.legDurationSeconds != null ? '• ' : ''}
                        {fmtMinutes(secondsToMinutes(s.legDurationSeconds))}
                      </Text>
                    )}
                  </View>

                  <TouchableOpacity onPress={() => openInGoogleMaps(s.address)} style={styles.routeMiniBtn}>
                    <Text style={styles.routeMiniBtnText}>Map</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>

            <View style={styles.modalButtonsRow}>
              <TouchableOpacity style={styles.modalBtnCancel} onPress={() => setRouteModalOpen(false)}>
                <Text style={styles.modalBtnText}>Close</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalBtnApply}
                onPress={() => {
                  const url =
                    routeResult?.googleMapsUrl ||
                    buildGoogleMapsDirectionsUrl(
                      SHOP_ADDRESS,
                      SHOP_ADDRESS,
                      (routeResult?.orderedStops || []).map((s) => s.address)
                    );
                  Linking.openURL(url);
                }}
              >
                <Text style={styles.modalBtnText}>Open Route in Maps</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.routeFootnote}>
              ✅ The Today list has been reordered to match this route (Stop #1 at the top).
            </Text>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Status Modal */}
      <Modal
        transparent
        visible={statusModal.id != null}
        animationType="fade"
        onRequestClose={() => setStatusModal({ id: null, value: null })}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setStatusModal({ id: null, value: null })}>
          <Pressable style={styles.modalCard}>
            <Text style={styles.modalTitle}>Change Status</Text>
            {STATUSES.map((s) => (
              <TouchableOpacity
                key={s}
                style={[
                  styles.statusOption,
                  statusModal.value === s && styles.statusOptionActive,
                ]}
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
              <TouchableOpacity style={styles.modalBtnCancel} onPress={() => setStatusModal({ id: null, value: null })}>
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

            <View style={styles.bulkTopRow}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search WO #, PO #, customer, or site..."
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
                  <TouchableOpacity onPress={() => toggleBulkSelect(item.id)} style={styles.partsRow}>
                    <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                      {checked ? <Text style={styles.checkboxGlyph}>✓</Text> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.partsRowTitle}>
                        WO: {item.workOrderNumber || '—'} {item.poNumber ? ` • PO: ${item.poNumber}` : ''}
                      </Text>
                      <Text style={styles.partsRowSub}>{item.customer || '—'}</Text>
                      {!!site && (
                        <Text style={styles.partsRowSub} numberOfLines={1}>
                          {site}
                        </Text>
                      )}
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

            <Text style={[styles.inputLabel, { marginTop: 10 }]}>Optional note</Text>
            <TextInput
              value={bulkNote}
              onChangeText={setBulkNote}
              placeholder="e.g., Parts In"
              style={styles.textInput}
              multiline
            />

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

  todayHeaderRow: {
    paddingTop: 10,
    paddingBottom: 6,
    gap: 8,
  },
  routeBtn: {
    backgroundColor: '#111827',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  routeBtnDisabled: { backgroundColor: '#64748b' },
  routeBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  routeHint: {
    color: '#475569',
    fontSize: 12,
    textAlign: 'center',
  },

  list: { paddingTop: 8, paddingBottom: 16 },
  bottomSpacer: { height: 96 },

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
  linkText: {
    color: '#17a2b8',
    textDecorationLine: 'underline',
    marginBottom: 4,
  },

  noteLine: { fontSize: 13, color: '#475569', marginBottom: 4 },

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
  noData: { fontStyle: 'italic', color: '#8D99AE', textAlign: 'center' },

  dragBanner: {
    textAlign: 'center',
    color: '#64748b',
    marginVertical: 6,
  },

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

  routeModalCard: {
    width: '100%',
    maxWidth: 680,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E2E8F0',
  },
  routeMeta: { color: '#334155', fontSize: 12, textAlign: 'center' },
  routeStopRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2E8F0',
    alignItems: 'flex-start',
  },
  routeStopIdx: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  routeStopIdxText: { color: '#fff', fontWeight: '900', fontSize: 12 },
  routeStopTitle: { fontWeight: '800', color: '#111827', marginBottom: 2 },
  routeStopAddr: { color: '#475569', fontSize: 12 },
  routeStopLeg: { color: '#64748b', fontSize: 12, marginTop: 2 },
  routeMiniBtn: {
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 10,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
  },
  routeMiniBtnText: { fontWeight: '800', color: '#0f172a' },
  routeFootnote: { marginTop: 10, color: '#475569', fontSize: 12, textAlign: 'center' },

  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 8,
  },
  inputLabel: { fontSize: 12, color: '#475569', marginBottom: 4, fontWeight: '600' },
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

  bulkTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
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

  partsRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
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
