// File: app/screens/HistoryScreen.js
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, Linking, Platform, RefreshControl, Alert, ScrollView,
} from 'react-native';
import moment from 'moment';
import { useRouter } from 'expo-router';
import api from '../../constants/api';

// ---------- Status canon (match Field-tech-app + backend) ----------
const STATUSES = [
  'New',
  'Needs to be Quoted',
  'Needs to be Scheduled',
  'Scheduled',
  'Waiting for Approval',
  'Waiting on Parts',
  'Parts In',
  'Completed',
];

const norm = (v) => (v ?? '').toString().trim();
const statusKey = (s) =>
  norm(s).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

const CANON = new Map(STATUSES.map((label) => [statusKey(label), label]));
const STATUS_SYNONYMS = new Map([
  // Parts In
  ['part in','Parts In'],['parts in','Parts In'],['parts  in','Parts In'],
  ['parts-in','Parts In'],['parts_in','Parts In'],['partsin','Parts In'],['part s in','Parts In'],
  // Waiting on Parts
  ['waiting on part','Waiting on Parts'],['waiting on parts','Waiting on Parts'],
  ['waiting-on-parts','Waiting on Parts'],['waiting_on_parts','Waiting on Parts'],['waitingonparts','Waiting on Parts'],
  // Needs to be Scheduled
  ['needs to be schedule','Needs to be Scheduled'],['need to be scheduled','Needs to be Scheduled'],
  // New (permissive)
  ['new','New'],['fresh','New'],['just created','New'],
  // Needs to be Quoted
  ['needs quote','Needs to be Quoted'],['need quote','Needs to be Quoted'],
  ['quote needed','Needs to be Quoted'],['to be quoted','Needs to be Quoted'],
  ['needs quotation','Needs to be Quoted'],
  ['needs-to-be-quoted','Needs to be Quoted'],
  ['needs_to_be_quoted','Needs to be Quoted'],
  ['needstobequoted','Needs to be Quoted'],
]);
const toCanonicalStatus = (s) =>
  CANON.get(statusKey(s)) || STATUS_SYNONYMS.get(statusKey(s)) || norm(s);

// Hide legacy PO values that equal WO
const isLegacyWoInPo = (wo, po) => !!norm(wo) && norm(wo) === norm(po);
const displayPO = (wo, po) => (isLegacyWoInPo(wo, po) ? '' : norm(po));

// --------------------------------------------

export default function HistoryScreen() {
  const router = useRouter();

  const [customer, setCustomer] = useState('');
  const [poOrWo, setPoOrWo] = useState('');          // single input -> sends to both params
  const [siteLocation, setSiteLocation] = useState('');

  const [statusFilter, setStatusFilter] = useState('Any'); // new status filter

  const [results, setResults] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);

  const runSearch = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        customer,
        poNumber: poOrWo,         // server will LIKE-match PO
        workOrderNumber: poOrWo,  // and also WO
        siteLocation,
      };
      const { data } = await api.get('/work-orders/search', { params });

      // Canonicalize status consistently
      const list = (Array.isArray(data) ? data : []).map((o) => ({
        ...o,
        status: toCanonicalStatus(o.status),
      }));

      // Apply status filter client-side (server doesn't take status)
      const filtered =
        statusFilter === 'Any'
          ? list
          : list.filter((o) => statusKey(o.status) === statusKey(statusFilter));

      setResults(filtered);
    } catch (e) {
      console.error(e);
      Alert.alert('Search Error', 'Could not fetch results.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [customer, poOrWo, siteLocation, statusFilter]);

  // initial load (empty params returns all)
  useEffect(() => { runSearch(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = () => {
    setRefreshing(true);
    runSearch();
  };

  const clearFilters = () => {
    setCustomer('');
    setPoOrWo('');
    setSiteLocation('');
    setStatusFilter('Any');
    setTimeout(runSearch, 0);
  };

  const openInGoogleMaps = async (loc) => {
    if (!loc) return;
    const q = encodeURIComponent(loc);
    const app = Platform.select({
      ios: `comgooglemaps://?q=${q}`,
      android: `geo:0,0?q=${q}`,
      default: `https://www.google.com/maps/search/?api=1&query=${q}`,
    });
    const web = `https://www.google.com/maps/search/?api=1&query=${q}`;
    try {
      const can = await Linking.canOpenURL(app);
      await Linking.openURL(can ? app : web);
    } catch {}
  };

  const renderItem = ({ item }) => {
    const wo = norm(item.workOrderNumber) || 'N/A';
    const po = displayPO(item.workOrderNumber, item.poNumber) || (norm(item.poNumber) ? item.poNumber : 'N/A');
    return (
      <View style={styles.card}>
        <Text style={styles.title}>WO: {wo}   •   PO: {po}</Text>
        <Text style={styles.line}>Customer: {item.customer || '—'}</Text>
        <Text style={styles.line}>
          Site:{' '}
          <Text style={styles.link} onPress={() => openInGoogleMaps(item.siteLocation)}>
            {item.siteLocation || '—'}
          </Text>
        </Text>
        <Text style={styles.line}>Problem: {item.problemDescription || '—'}</Text>
        <Text style={styles.line}>Status: {item.status || '—'}</Text>
        <Text style={styles.line}>
          Scheduled:{' '}
          {item.scheduledDate
            ? moment(item.scheduledDate).format('YYYY-MM-DD HH:mm')
            : 'Not Scheduled'}
        </Text>

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.button, styles.viewBtn]}
            onPress={() => router.push(`/screens/ViewWorkOrder?id=${item.id}`)}
          >
            <Text style={styles.viewBtnText}>View Details</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // Status filter chips (Any + all statuses)
  const StatusChips = () => {
    const options = useMemo(() => ['Any', ...STATUSES], []);
    return (
      <View style={styles.chipsWrap}>
        {options.map((opt) => {
          const active = statusFilter === opt;
          return (
            <TouchableOpacity
              key={opt}
              onPress={() => setStatusFilter(opt)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                {opt}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.header}>History Report</Text>

      <View style={styles.filters}>
        <TextInput
          placeholder="Customer name"
          value={customer}
          onChangeText={setCustomer}
          style={styles.input}
          autoCapitalize="words"
        />
        <TextInput
          placeholder="WO # or PO #"
          value={poOrWo}
          onChangeText={setPoOrWo}
          style={styles.input}
          autoCapitalize="characters"
        />
        <TextInput
          placeholder="Site location"
          value={siteLocation}
          onChangeText={setSiteLocation}
          style={styles.input}
          autoCapitalize="words"
        />

        <Text style={styles.subLabel}>Status</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <StatusChips />
        </ScrollView>

        <View style={styles.filterButtons}>
          <TouchableOpacity style={[styles.button, styles.searchBtn]} onPress={runSearch} disabled={loading}>
            <Text style={styles.searchBtnText}>{loading ? 'Searching…' : 'Search'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.clearBtn]} onPress={clearFilters} disabled={loading}>
            <Text style={styles.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={results}
        keyExtractor={(it) => String(it.id)}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          !loading ? <Text style={styles.empty}>No results.</Text> : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F1F5F9', padding: 16 },
  header: { fontSize: 22, fontWeight: '700', color: '#2B2D42', marginBottom: 10 },

  filters: { backgroundColor: '#fff', padding: 12, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 8,
    color: '#0F172A',
  },
  subLabel: { marginTop: 4, marginBottom: 6, color: '#475569', fontWeight: '600' },

  chipsWrap: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  chip: {
    borderWidth: 1,
    borderColor: '#17a2b8',
    backgroundColor: '#fff',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 18,
    marginRight: 8,
  },
  chipActive: { backgroundColor: '#17a2b8', borderColor: '#17a2b8' },
  chipText: { color: '#17a2b8', fontWeight: '600' },
  chipTextActive: { color: '#fff', fontWeight: '700' },

  filterButtons: { flexDirection: 'row', gap: 8, marginTop: 8 },

  button: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 6, alignItems: 'center' },
  searchBtn: { backgroundColor: '#17a2b8', flex: 1 },
  searchBtnText: { color: '#fff', fontWeight: '700' },
  clearBtn: { backgroundColor: '#e5e7eb', flexBasis: 110 },
  clearBtnText: { color: '#111827', fontWeight: '700' },

  card: { backgroundColor: '#fff', borderRadius: 8, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  title: { fontSize: 16, fontWeight: '700', color: '#2B2D42', marginBottom: 6 },
  line: { color: '#2B2D42', marginBottom: 4 },
  link: { color: '#17a2b8', textDecorationLine: 'underline' },
  row: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
  viewBtn: { backgroundColor: '#17a2b8' },
  viewBtnText: { color: '#fff', fontWeight: '700' },

  empty: { textAlign: 'center', color: '#8D99AE', marginTop: 16, fontStyle: 'italic' },
});
