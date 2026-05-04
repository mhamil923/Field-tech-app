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
  'Declined',
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
  const myName = (me.username || me.name || '').toString().trim().toLowerCase();

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
    if (Array.isArray(order.techIds) && order.techIds.some((tid) => String(tid) === String(myId))) {
      return true;
    }
  }

  if (myName && assignedName && myName === assignedName) return true;

  if (myName && Array.isArray(order.techNames)) {
    if (order.techNames.some((n) => String(n).trim().toLowerCase() === myName)) return true;
  }

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

  const hasOffset = /[zZ]$/.test(s) || /([+-]\d{2}:?\d{2})$/.test(s);

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
  const loc = norm(o.siteLocation) || norm(o.siteName) || norm(o.siteLocationName) || '';
  return `WO ${wo}${po ? ` • PO ${po}` : ''} • ${cust}${loc ? ` • ${loc}` : ''}`;
};

const metersToMiles = (m) => (m == null ? null : m / 1609.344);
const secondsToMinutes = (s) => (s == null ? null : s / 60);
const fmtMiles = (miles) => (miles == null ? '' : `${miles.toFixed(miles >= 10 ? 1 : 2)} mi`);
const fmtMinutes = (mins) => (mins == null ? '' : `${Math.round(mins)} min`);

// Build a Google Maps directions URL (waypoints limit-friendly)
const buildGoogleMapsDirectionsUrl = (origin, destination, waypointAddrs) => {
  const enc = encodeURIComponent;
  const base = 'https://www.google.com/maps/dir/?api=1';
  const wp = (waypointAddrs || []).filter(Boolean);

  // Note: Google supports up to 23 waypoints for api=1
  const wpStr = wp.slice(0, 23).map(enc).join('|');

  return [
    `${base}&origin=${enc(origin)}`,
    `&destination=${enc(destination)}`,
    wpStr ? `&waypoints=${wpStr}` : '',
    '&travelmode=driving',
  ].join('');
};

// ✅ Detect HTML error pages (classic "<!DOCTYPE html>..." problem)
const isHtmlLike = (data) => {
  if (typeof data !== 'string') return false;
  const s = data.trim().slice(0, 200).toLowerCase();
  return s.startsWith('<!doctype html') || s.startsWith('<html') || s.includes('<head');
};
const isHtmlResponse = (res) => {
  const ct = (res?.headers?.['content-type'] || res?.headers?.['Content-Type'] || '')
    .toString()
    .toLowerCase();
  return ct.includes('text/html') || isHtmlLike(res?.data);
};

export default function WorkOrdersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [me, setMe] = useState(null);
  const [meLoading, setMeLoading] = useState(true);

  const [workOrders, setWorkOrders] = useState([]);
  const [supplierPickups, setSupplierPickups] = useState([]);
  const [selectedStatus, setSelectedStatus] = useState('Today');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingFirst, setLoadingFirst] = useState(true);

  // single-status change modal
  const [statusModal, setStatusModal] = useState({ id: null, value: null });

  // Drag order for Today
  const todayKey = `woOrder:${moment().format('YYYY-MM-DD')}`;
  const [todayOrderIds, setTodayOrderIds] = useState([]);

  // ✅ Route generation UI/state
  const [routeWorking, setRouteWorking] = useState(false);
  const [routeModalOpen, setRouteModalOpen] = useState(false);
  const [routeResult, setRouteResult] = useState(null);

  /**
   * ✅ IMPORTANT FIX #1 (401):
   * Ensure JWT header is applied BEFORE EVERY API CALL.
   * This prevents random 401s when the axios instance was created before token is available,
   * or when app resumes, etc.
   */
  const ensureAuthHeader = useCallback(async () => {
    const token = await AsyncStorage.getItem('jwt');
    if (token) {
      api.defaults.headers.common.Authorization = `Bearer ${token}`;
      return token;
    }
    delete api.defaults.headers.common.Authorization;
    return null;
  }, []);

  /**
   * ✅ IMPORTANT FIX #2 (Google Maps "%20" showing / can't find address):
   * iOS Linking can re-encode already-encoded URLs. If we pass an encoded URL, it may become double-encoded.
   * So we decode once right before opening.
   */
  const openUrlSafely = useCallback(async (url) => {
    if (!url) return;

    // If iOS re-encodes, we want to give it a "decoded once" URL
    let candidate = url;
    try {
      candidate = decodeURIComponent(url);
    } catch {
      candidate = url;
    }

    try {
      const can = await Linking.canOpenURL(candidate);
      if (!can) {
        // fallback: try original
        await Linking.openURL(url);
        return;
      }
      await Linking.openURL(candidate);
    } catch (e) {
      // last resort: try original
      try {
        await Linking.openURL(url);
      } catch {
        Alert.alert('Error', 'Failed to open Maps.');
      }
    }
  }, []);

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

  // Load current user (me)
  useEffect(() => {
    (async () => {
      try {
        setMeLoading(true);
        const token = await ensureAuthHeader();
        if (!token) {
          setMe(null);
          return;
        }
        const r = await api.get('/auth/me');
        setMe(r.data || null);
      } catch {
        setMe(null);
      } finally {
        setMeLoading(false);
      }
    })();
  }, [ensureAuthHeader]);

  const handle401 = useCallback(() => {
    Alert.alert(
      'Session expired',
      'Your login token is missing or expired. Please log in again.',
      [{ text: 'OK', onPress: () => router.replace('/screens/Login') }]
    );
  }, [router]);

  const fetchWorkOrders = useCallback(async () => {
    try {
      const token = await ensureAuthHeader();
      if (!token) {
        setWorkOrders([]);
        setLoadingFirst(false);
        setRefreshing(false);
        handle401();
        return;
      }

      const [res, pickupRes] = await Promise.all([
        api.get('/work-orders'),
        api.get('/supplier-pickups').catch(() => ({ data: [] })),
      ]);
      const canon = (res.data || []).map((o) => ({
        ...o,
        status: toCanonicalStatus(o.status),
      }));
      setWorkOrders(canon);
      setSupplierPickups(Array.isArray(pickupRes.data) ? pickupRes.data : []);
    } catch (err) {
      const status = err?.response?.status;
      console.error('Error fetching work orders:', status, err?.response?.data || err?.message);

      if (status === 401) {
        setWorkOrders([]);
        handle401();
      } else {
        Alert.alert('Error', 'Failed to fetch work orders.');
      }
    } finally {
      setLoadingFirst(false);
      setRefreshing(false);
    }
  }, [ensureAuthHeader, handle401]);

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

    const today = me
      ? workOrders.filter((o) => isAssignedToMe(o, me) && isScheduledToday(o)).length
      : 0;

    return { byStatus, today };
  }, [workOrders, me]);

  const openInGoogleMaps = useCallback(
    async (query) => {
      const qRaw = (query || '').toString().trim();
      if (!qRaw) {
        Alert.alert('Maps', 'No address to open.');
        return;
      }

      // Important: do NOT pre-encode the whole URL for Linking.
      // We encode only the q param here, then openUrlSafely() decodes once to prevent double-encoding.
      const q = encodeURIComponent(qRaw);
      const gm = `comgooglemaps://?q=${q}`;
      const web = `https://www.google.com/maps/search/?api=1&query=${q}`;

      try {
        const can = await Linking.canOpenURL(gm);
        await openUrlSafely(can ? gm : web);
      } catch {
        Alert.alert('Error', 'Failed to open maps');
      }
    },
    [openUrlSafely]
  );

  // ---------- FILTERED ORDERS ----------
  const filteredOrders = useMemo(() => {
    const base = workOrders;

    if (selectedStatus === 'Today') {
      if (!me) return [];
      return base.filter((o) => isAssignedToMe(o, me) && isScheduledToday(o));
    }

    return base.filter((o) => normStatus(o.status) === normStatus(selectedStatus));
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

  // Today's supplier pickups assigned to me (or unassigned).
  const todayPickups = useMemo(() => {
    if (selectedStatus !== 'Today') return [];
    const todayStr = moment().format('YYYY-MM-DD');
    const myName = (me?.name || me?.username || '').toString().trim().toLowerCase();
    return supplierPickups.filter((p) => {
      const day = (p.scheduledDate || '').toString().split('T')[0];
      if (day !== todayStr) return false;
      const tech = (p.assignedTech || '').toString().trim().toLowerCase();
      return !tech || tech === myName;
    });
  }, [supplierPickups, selectedStatus, me]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchWorkOrders();
  };

  /* ---------------- Status update: PUT /work-orders/:id/status ---------------- */
  const putStatus = async (id, newStatus) => {
    await ensureAuthHeader();
    await api.put(
      `/work-orders/${id}/status`,
      { status: newStatus },
      { headers: { 'Content-Type': 'application/json' } }
    );
  };

  const handleUpdateStatus = async (id, newStatus) => {
    const prev = workOrders;
    setWorkOrders(prev.map((o) => (o.id === id ? { ...o, status: newStatus } : o)));

    try {
      await putStatus(id, newStatus);
      await fetchWorkOrders();
    } catch (err) {
      console.error(err?.response?.status, err?.response?.data || err?.message);
      setWorkOrders(prev);

      if (err?.response?.status === 401) {
        handle401();
        return;
      }

      const msg = err?.response?.data?.error || err?.message || 'Failed to update status.';
      Alert.alert('Error', msg);
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

    // Log route generation details for debugging
    console.log('[ROUTE] Generating route with', stops.length, 'stops');
    console.log('[ROUTE] Shop address:', SHOP_ADDRESS);
    stops.forEach((s, i) => console.log(`[ROUTE] Stop ${i + 1}:`, s.address));

    if (stops.length < 2) {
      Alert.alert(
        'Route',
        stops.length === 0
          ? 'No usable addresses found in Today work orders.\n\nMake sure work orders have a Site Address filled in.'
          : 'Need at least 2 stops with valid addresses to generate a route.'
      );
      return;
    }

    if (missingCount > 0) {
      // Find which work orders are missing addresses
      const missingOrders = candidates
        .filter((o) => !bestAddressForOrder(o))
        .map((o) => `WO ${o.workOrderNumber || o.id}`)
        .slice(0, 3);
      const moreText = missingCount > 3 ? `\n...and ${missingCount - 3} more` : '';

      Alert.alert(
        'Missing Addresses',
        `${missingCount} work order(s) skipped (no address):\n${missingOrders.join('\n')}${moreText}\n\nGenerating route for the rest.`
      );
    }

    const fallbackUrl = buildGoogleMapsDirectionsUrl(
      SHOP_ADDRESS,
      SHOP_ADDRESS,
      stops.map((s) => s.address)
    );

    setRouteWorking(true);
    try {
      const token = await ensureAuthHeader();
      if (!token) {
        handle401();
        return;
      }

      const payload = {
        start: SHOP_ADDRESS,
        end: SHOP_ADDRESS,
        stops,
        travelMode: 'driving',
      };

      const res = await api.post('/routes/best', payload, {
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        timeout: 20000,
        responseType: 'text',
        transformResponse: [(data) => data],
        validateStatus: (status) => status >= 200 && status < 500,
      });

      if (res?.status === 401) {
        handle401();
        return;
      }

      // If we got HTML, route isn't implemented yet OR baseURL points to a web server.
      if (isHtmlResponse(res)) {
        Alert.alert(
          'Route (Backend not ready)',
          'Your app hit /routes/best but the server returned an HTML page. That means the route is missing on the backend (or API base URL is wrong).\n\nOpening Google Maps using your current stop order instead.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Maps', onPress: () => openUrlSafely(fallbackUrl) },
          ]
        );
        return;
      }

      // Parse JSON safely
      let data = res?.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          Alert.alert(
            'Route (Unexpected response)',
            'The route service responded, but not with JSON. Opening Google Maps with the stops in the current order instead.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Maps', onPress: () => openUrlSafely(fallbackUrl) },
            ]
          );
          return;
        }
      }

      const orderedIds = Array.isArray(data?.orderedIds) ? data.orderedIds : [];
      if (!orderedIds.length) {
        Alert.alert(
          'Route (No ordered list)',
          'The route service responded but did not return an ordered stop list. Opening Google Maps with the stops in the current order instead.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Maps', onPress: () => openUrlSafely(fallbackUrl) },
          ]
        );
        return;
      }

      await saveTodayOrder(orderedIds.map((x) => String(x)));

      let orderedStops = Array.isArray(data?.orderedStops) ? data.orderedStops : null;
      if (!orderedStops) {
        const byId = new Map(stops.map((s) => [String(s.id), s]));
        orderedStops = orderedIds.map((id) => byId.get(String(id))).filter(Boolean);
      }

      const totalDistanceMiles = metersToMiles(data?.totalDistanceMeters);
      const totalDurationMinutes = secondsToMinutes(data?.totalDurationSeconds);
      const totalDurationInTrafficMinutes = secondsToMinutes(data?.totalDurationInTrafficSeconds);

      const mapsUrl =
        data?.googleMapsUrl ||
        buildGoogleMapsDirectionsUrl(
          SHOP_ADDRESS,
          SHOP_ADDRESS,
          orderedStops.map((s) => s.address)
        );

      // Log optimization results
      console.log('[ROUTE] Optimization complete');
      console.log('[ROUTE] Optimized:', data?.optimized);
      console.log('[ROUTE] Total distance:', fmtMiles(totalDistanceMiles));
      console.log('[ROUTE] Total duration:', fmtMinutes(totalDurationMinutes));
      if (totalDurationInTrafficMinutes) {
        console.log('[ROUTE] Duration with traffic:', fmtMinutes(totalDurationInTrafficMinutes));
      }
      console.log('[ROUTE] Waypoint order:', data?.google?.waypoint_order);

      setRouteResult({
        orderedIds,
        orderedStops,
        totalDistanceMeters: data?.totalDistanceMeters ?? null,
        totalDurationSeconds: data?.totalDurationSeconds ?? null,
        totalDurationInTrafficSeconds: data?.totalDurationInTrafficSeconds ?? null,
        totalDistanceMiles,
        totalDurationMinutes,
        totalDurationInTrafficMinutes,
        googleMapsUrl: mapsUrl,
        optimized: data?.optimized ?? false,
        warning: data?.warning || null,
      });

      setRouteModalOpen(true);
    } catch (e) {
      console.error('Route generation failed:', e?.response?.status, e?.response?.data || e?.message);

      if (e?.response?.status === 401) {
        handle401();
        return;
      }

      Alert.alert(
        'Route',
        'Could not generate the “best route” (backend not added or returned an error).\n\nOpening Google Maps with the stops in the current order as a fallback.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Maps', onPress: () => openUrlSafely(fallbackUrl) },
        ]
      );
    } finally {
      setRouteWorking(false);
    }
  };

  const applyStatusModal = () => {
    if (statusModal.id && statusModal.value) {
      handleUpdateStatus(statusModal.id, statusModal.value);
    }
    setStatusModal({ id: null, value: null });
  };

  const TodayRouteActions = () => {
    if (selectedStatus !== 'Today') return null;

    const todaysStopsCount = orderedToday.filter((o) => !!bestAddressForOrder(o)).length;

    return (
      <View style={styles.todayHeaderRow}>
        <TouchableOpacity
          onPress={generateBestRoute}
          style={[styles.routeBtn, (routeWorking || todaysStopsCount < 2) && styles.routeBtnDisabled]}
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
            <Text style={[styles.chipText, selectedStatus === s && styles.chipTextActive]}>{s}</Text>
            <View style={[styles.badge, selectedStatus === s && styles.badgeActive]}>
              <Text style={[styles.badgeText, selectedStatus === s && styles.badgeTextActive]}>
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
          {getScheduledRaw(item)
            ? parseScheduledMoment(getScheduledRaw(item))?.format('YYYY-MM-DD HH:mm') || 'Not Scheduled'
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
      <View style={{ flex: 1 }}>
        <TodayRouteActions />
        {todayPickups.length > 0 && (
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            {todayPickups.map((p) => (
              <TouchableOpacity
                key={'sp-' + p.id}
                onPress={() =>
                  router.push({
                    pathname: '/screens/PurchaseOrdersScreen',
                    params: { supplierFilter: p.supplier },
                  })
                }
                style={{
                  backgroundColor: '#fff7ed',
                  borderLeftWidth: 4,
                  borderLeftColor: '#f97316',
                  borderRadius: 8,
                  padding: 16,
                  marginBottom: 12,
                }}
              >
                <Text style={{ fontWeight: 'bold', fontSize: 16 }}>📦 {p.supplier} — Supplier Pickup</Text>
                {p.notes ? (
                  <Text style={{ color: '#6b7280', marginTop: 4 }}>{p.notes}</Text>
                ) : null}
                <Text style={{ color: '#f97316', marginTop: 4, fontWeight: '600' }}>
                  Tap to view Purchase Orders →
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <Text style={styles.dragBanner}>Long-press to drag order.</Text>
        <DraggableFlatList
          data={orderedToday}
          keyExtractor={(it) => String(it.id)}
          activationDistance={12}
          onDragEnd={({ data }) => saveTodayOrder(data.map((d) => String(d.id)))}
          renderItem={({ item, drag }) => <Card item={item} drag={drag} />}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 160 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListFooterComponent={<View style={{ height: insets.bottom + 80 }} />}
          ListEmptyComponent={!loadingFirst ? <TodayEmpty /> : null}
        />
      </View>
    ) : (
      <FlatList
        style={{ flex: 1 }}
        data={filteredOrders}
        keyExtractor={(it) => String(it.id)}
        renderItem={({ item }) => <Card item={item} />}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 160 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListFooterComponent={<View style={{ height: insets.bottom + 80 }} />}
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
              <>
                <Text style={[styles.routeMeta, { marginTop: 6, fontWeight: '700' }]}>
                  Stops: {routeResult.orderedStops?.length || 0}
                  {routeResult.totalDistanceMiles != null || routeResult.totalDurationMinutes != null
                    ? ` • ${fmtMiles(routeResult.totalDistanceMiles)} • ${fmtMinutes(
                        routeResult.totalDurationMinutes
                      )}`
                    : ''}
                </Text>
                {routeResult.totalDurationInTrafficMinutes != null &&
                  routeResult.totalDurationInTrafficMinutes !== routeResult.totalDurationMinutes && (
                    <Text style={[styles.routeMeta, { marginTop: 2, color: '#e67e22' }]}>
                      🚗 With current traffic: {fmtMinutes(routeResult.totalDurationInTrafficMinutes)}
                    </Text>
                  )}
                {!!routeResult.warning && (
                  <Text style={[styles.routeMeta, { marginTop: 4, color: '#c0392b' }]}>
                    ⚠️ {routeResult.warning}
                  </Text>
                )}
              </>
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
                  openUrlSafely(url);
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
              <TouchableOpacity
                style={styles.modalBtnCancel}
                onPress={() => setStatusModal({ id: null, value: null })}
              >
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
  container: { flex: 1, backgroundColor: '#f1f5f9', padding: 16 },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  header: { fontSize: 22, fontWeight: '800', color: '#0f172a' },

  addBtn: {
    backgroundColor: '#0d6efd',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    shadowColor: 'rgba(13,110,253,1)',
    shadowOpacity: 0.24,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  addBtnText: { color: '#fff', fontWeight: '700' },

  filterBar: {
    paddingTop: 6,
    paddingBottom: 6,
    backgroundColor: '#f1f5f9',
  },

  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(13,110,253,0.22)',
    backgroundColor: 'rgba(13,110,253,0.06)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  chipActive: {
    backgroundColor: '#0d6efd',
    borderColor: '#0d6efd',
    shadowColor: 'rgba(13,110,253,1)',
    shadowOpacity: 0.25,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  chipText: { color: '#0d6efd', fontWeight: '700', fontSize: 12 },
  chipTextActive: { color: '#fff' },
  badge: {
    marginLeft: 8,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(13,110,253,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  badgeActive: { backgroundColor: 'rgba(15,23,42,0.15)', borderColor: 'rgba(255,255,255,0.22)' },
  badgeText: { color: '#0d6efd', fontSize: 12, fontWeight: '700' },
  badgeTextActive: { color: '#fff' },

  todayHeaderRow: {
    paddingTop: 10,
    paddingBottom: 6,
    gap: 8,
  },
  routeBtn: {
    backgroundColor: '#0d6efd',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: 'rgba(13,110,253,1)',
    shadowOpacity: 0.24,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  routeBtnDisabled: { backgroundColor: '#94a3b8', shadowOpacity: 0 },
  routeBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  routeHint: {
    color: '#0f172a',
    fontSize: 12,
    textAlign: 'center',
  },

  list: { paddingTop: 8, paddingBottom: 16 },
  bottomSpacer: { height: 96 },

  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#eef2f7',
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  dragHandle: { flexDirection: 'row', alignItems: 'center' },
  dragGlyph: { fontSize: 20, color: '#0f172a' },

  cardTitle: { fontSize: 15, fontWeight: '900', color: '#0f172a' },
  cardText: { fontSize: 13, color: '#0f172a', marginBottom: 4 },
  linkText: {
    color: '#2563eb',
    textDecorationLine: 'underline',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },

  noteLine: { fontSize: 13, color: '#0f172a', marginBottom: 4 },

  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    alignItems: 'center',
    gap: 8,
  },

  statusBtn: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statusBtnText: { color: '#0f172a', fontWeight: '700' },

  viewButton: {
    backgroundColor: '#0d6efd',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    shadowColor: 'rgba(13,110,253,1)',
    shadowOpacity: 0.24,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  viewButtonText: { color: '#fff', fontWeight: '700' },

  center: { alignItems: 'center', marginTop: 24 },
  noData: { fontStyle: 'italic', color: '#0f172a', textAlign: 'center' },

  dragBanner: {
    textAlign: 'center',
    color: '#0f172a',
    fontSize: 12,
    marginVertical: 6,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(16,24,40,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#eef2f7',
  },
  routeModalCard: {
    width: '100%',
    maxWidth: 680,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#eef2f7',
  },
  routeMeta: { color: '#0f172a', fontSize: 12, textAlign: 'center' },
  routeStopRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
    alignItems: 'flex-start',
  },
  routeStopIdx: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0d6efd',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  routeStopIdxText: { color: '#fff', fontWeight: '900', fontSize: 12 },
  routeStopTitle: { fontWeight: '800', color: '#0f172a', marginBottom: 2 },
  routeStopAddr: { color: '#0f172a', fontSize: 12 },
  routeStopLeg: { color: '#0f172a', fontSize: 12, marginTop: 2 },
  routeMiniBtn: {
    backgroundColor: '#f8fafc',
    paddingHorizontal: 10,
    height: 34,
    borderRadius: 12,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  routeMiniBtnText: { fontWeight: '700', color: '#0f172a' },
  routeFootnote: { marginTop: 10, color: '#0f172a', fontSize: 12, textAlign: 'center' },

  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 8,
  },
  statusOption: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 8,
    backgroundColor: '#ffffff',
  },
  statusOptionActive: { backgroundColor: '#0d6efd', borderColor: '#0d6efd' },
  statusOptionText: { color: '#0f172a', fontWeight: '600' },
  statusOptionTextActive: { color: '#ffffff', fontWeight: '700' },
  modalButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 12,
  },
  modalBtnCancel: {
    flex: 1,
    backgroundColor: '#64748b',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalBtnApply: {
    flex: 1,
    backgroundColor: '#0d6efd',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalBtnText: { color: '#fff', fontWeight: '700' },

});
