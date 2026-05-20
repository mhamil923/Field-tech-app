// File: app/screens/OverviewScreen.js
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Linking,
} from 'react-native';
import moment from 'moment';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../../constants/api';

// Same tech list the rest of the app uses for assignment dropdowns
const TECHS = ['Jeff', 'Adin', 'jeffsr', 'Mikey'];

const TECH_COLOR = {
  Jeff: '#0d6efd',   // blue
  Adin: '#16a34a',   // green
  jeffsr: '#f97316', // orange
  Mikey: '#9333ea',  // purple
};

const norm = (v) => (v ?? '').toString().trim();
const eqCi = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();

function displayPO(wo, po) {
  if (!norm(po)) return '';
  if (norm(po) === norm(wo)) return '';
  return norm(po);
}

// Same toCanonicalStatus shape used in WorkOrdersScreen — keep it lightweight here.
const statusKey = (s) =>
  norm(s).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

const STATUS_COLOR = {
  new: '#64748b',
  scheduled: '#0d6efd',
  'needs to be quoted': '#9333ea',
  'waiting for approval': '#f59e0b',
  declined: '#dc2626',
  approved: '#16a34a',
  'waiting on parts': '#ea580c',
  'needs to be scheduled': '#64748b',
  'needs to be invoiced': '#0891b2',
  'invoiced waiting for payment': '#f59e0b',
  completed: '#16a34a',
};

function statusBg(s) {
  return STATUS_COLOR[statusKey(s)] || '#64748b';
}

/**
 * Decide which tech bucket a work order belongs to.
 * Returns the matching name from TECHS, or null if no match.
 */
function bucketForOrder(order) {
  const names = [
    order.assignedToName,
    order.assignedToUsername,
    order.assignedToUser,
    order.assignedTech,
    order.techName,
    order.tech_name,
    ...(Array.isArray(order.techNames) ? order.techNames : []),
  ]
    .filter(Boolean)
    .map((s) => String(s));

  for (const tech of TECHS) {
    if (names.some((n) => eqCi(n, tech))) return tech;
  }
  return null;
}

export default function OverviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [workOrders, setWorkOrders] = useState([]);
  const [pickups, setPickups] = useState([]);
  const [collapsed, setCollapsed] = useState({}); // { [techName]: bool }

  const todayKey = moment().format('YYYY-MM-DD');
  const todayPretty = moment().format('dddd, MMM D, YYYY');

  const loadData = useCallback(async () => {
    try {
      const [woRes, pickupRes] = await Promise.all([
        api.get('/work-orders'),
        api.get('/supplier-pickups', { params: { date: todayKey } }).catch(() => ({ data: [] })),
      ]);
      setWorkOrders(Array.isArray(woRes.data) ? woRes.data : []);
      setPickups(Array.isArray(pickupRes.data) ? pickupRes.data : []);
    } catch (err) {
      console.warn('[Overview] load failed', err?.message || err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [todayKey]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  // Filter today's WOs and group by tech.
  const groups = useMemo(() => {
    const todaysOrders = workOrders.filter((o) => {
      if (!o.scheduledDate) return false;
      return moment(o.scheduledDate).format('YYYY-MM-DD') === todayKey;
    });

    const buckets = Object.fromEntries(TECHS.map((t) => [t, { orders: [], pickups: [] }]));

    for (const o of todaysOrders) {
      const tech = bucketForOrder(o);
      if (tech) buckets[tech].orders.push(o);
    }

    for (const p of pickups) {
      const t = TECHS.find((x) => eqCi(p.assignedTech, x));
      if (t) buckets[t].pickups.push(p);
    }

    return buckets;
  }, [workOrders, pickups, todayKey]);

  const openInMaps = (addr) => {
    if (!addr) return;
    const q = encodeURIComponent(addr);
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`).catch(() => {});
  };

  const toggle = (tech) =>
    setCollapsed((prev) => ({ ...prev, [tech]: !prev[tech] }));

  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + 40 }]}>
        <ActivityIndicator size="large" color="#0d6efd" />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.headerWrap}>
        <Text style={styles.title}>Team Overview</Text>
        <Text style={styles.subtitle}>{todayPretty}</Text>
      </View>

      {TECHS.map((tech) => {
        const bucket = groups[tech];
        const count = bucket.orders.length + bucket.pickups.length;
        const isCollapsed = !!collapsed[tech];
        const accent = TECH_COLOR[tech] || '#0d6efd';

        return (
          <View key={tech} style={[styles.section, { borderLeftColor: accent }]}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => toggle(tech)}
              style={styles.sectionHeader}
            >
              <View style={styles.sectionHeaderLeft}>
                <Text style={[styles.techName, { color: accent }]}>{tech}</Text>
                <View style={[styles.countBadge, { backgroundColor: accent }]}>
                  <Text style={styles.countBadgeText}>{count}</Text>
                </View>
              </View>
              <Text style={[styles.chevron, { color: accent }]}>
                {isCollapsed ? '▸' : '▾'}
              </Text>
            </TouchableOpacity>

            {!isCollapsed && (
              <View style={styles.sectionBody}>
                {bucket.orders.length === 0 && bucket.pickups.length === 0 && (
                  <Text style={styles.emptyText}>No work orders scheduled</Text>
                )}

                {bucket.orders.map((order) => {
                  const rawLoc = norm(order.siteLocation);
                  const explicitName = norm(order.siteName) || norm(order.siteLocationName);
                  let siteLocationName = explicitName;
                  let siteAddress =
                    norm(order.siteAddress) ||
                    norm(order.serviceAddress) ||
                    norm(order.address);
                  if (!siteAddress && rawLoc) siteAddress = rawLoc;
                  else if (!siteLocationName && rawLoc) siteLocationName = rawLoc;

                  const poText = displayPO(order.workOrderNumber, order.poNumber);

                  return (
                    <TouchableOpacity
                      key={order.id}
                      style={styles.card}
                      onPress={() =>
                        router.push(`/screens/ViewWorkOrder?id=${order.id}`)
                      }
                    >
                      <View style={styles.cardTopRow}>
                        <Text style={styles.customer} numberOfLines={1}>
                          {order.customer || 'N/A'}
                        </Text>
                        <View
                          style={[
                            styles.statusBadge,
                            { backgroundColor: statusBg(order.status) },
                          ]}
                        >
                          <Text style={styles.statusBadgeText} numberOfLines={1}>
                            {order.status || 'New'}
                          </Text>
                        </View>
                      </View>

                      <Text style={styles.idLine}>
                        WO: {order.workOrderNumber || '—'}
                        {poText ? `  •  PO: ${poText}` : ''}
                      </Text>

                      {!!siteLocationName && (
                        <Text style={styles.siteLoc} numberOfLines={1}>
                          {siteLocationName}
                        </Text>
                      )}

                      {!!siteAddress && (
                        <TouchableOpacity onPress={() => openInMaps(siteAddress)}>
                          <Text style={styles.linkText} numberOfLines={1}>
                            {siteAddress}
                          </Text>
                        </TouchableOpacity>
                      )}

                      {!!order.problemDescription && (
                        <Text style={styles.problem} numberOfLines={2}>
                          {order.problemDescription}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}

                {bucket.pickups.map((p) => (
                  <View key={`pickup-${p.id}`} style={[styles.card, styles.pickupCard]}>
                    <View style={styles.cardTopRow}>
                      <Text style={styles.customer} numberOfLines={1}>
                        Supplier Pickup: {p.supplier || '—'}
                      </Text>
                      <View style={[styles.statusBadge, { backgroundColor: '#0891b2' }]}>
                        <Text style={styles.statusBadgeText}>PICKUP</Text>
                      </View>
                    </View>
                    {!!p.notes && (
                      <Text style={styles.problem} numberOfLines={2}>
                        {p.notes}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollContent: {
    padding: 16,
    backgroundColor: '#f1f5f9',
    flexGrow: 1,
  },
  headerWrap: {
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
  },
  section: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderLeftWidth: 6,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  techName: {
    fontSize: 18,
    fontWeight: '700',
  },
  countBadge: {
    minWidth: 26,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  chevron: {
    fontSize: 18,
    fontWeight: '700',
  },
  sectionBody: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 10,
  },
  emptyText: {
    color: '#9ca3af',
    fontStyle: 'italic',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  pickupCard: {
    backgroundColor: '#ecfeff',
    borderColor: '#a5f3fc',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  customer: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    flexShrink: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    maxWidth: 180,
  },
  statusBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  idLine: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 2,
  },
  siteLoc: {
    fontSize: 13,
    color: '#0f172a',
    marginTop: 2,
  },
  linkText: {
    fontSize: 13,
    color: '#0d6efd',
    textDecorationLine: 'underline',
    marginTop: 2,
  },
  problem: {
    fontSize: 12,
    color: '#475569',
    marginTop: 6,
    lineHeight: 16,
  },
});
