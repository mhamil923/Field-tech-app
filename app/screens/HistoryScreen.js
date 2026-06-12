// File: app/screens/HistoryScreen.js
import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, Linking, Platform, RefreshControl, Alert, ScrollView,
} from 'react-native';
import moment from 'moment';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import api from '../../constants/api';

// ---------- Status canon (match Field-tech-app + backend) ----------
const STATUSES = [
  'New',
  'Needs to be Quoted',
  'Needs to be Scheduled',
  'Scheduled',
  'Waiting for Approval',
  'Declined',
  'Waiting on Parts',
  'Parts In',
  'Invoiced Waiting for Payment',
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
  // Invoiced Waiting for Payment
  ['invoiced waiting for payment','Invoiced Waiting for Payment'],
  ['invoiced-waiting-for-payment','Invoiced Waiting for Payment'],
  ['invoiced_waiting_for_payment','Invoiced Waiting for Payment'],
  ['waiting for payment','Invoiced Waiting for Payment'],
  ['waiting on payment','Invoiced Waiting for Payment'],
  ['awaiting payment','Invoiced Waiting for Payment'],
]);
const toCanonicalStatus = (s) =>
  CANON.get(statusKey(s)) || STATUS_SYNONYMS.get(statusKey(s)) || norm(s);

// Hide legacy PO values that equal WO
const isLegacyWoInPo = (wo, po) => !!norm(wo) && norm(wo) === norm(po);
const displayPO = (wo, po) => (isLegacyWoInPo(wo, po) ? '' : norm(po));

// Parse the latest note from the notes text field
// Notes are stored as: "[timestamp] username: note text" separated by \n\n
const parseLatestNote = (notesText) => {
  if (!notesText || typeof notesText !== 'string') return null;

  // Split by double newline to get individual notes
  const entries = notesText.split('\n\n').filter(e => e.trim());
  if (entries.length === 0) return null;

  // Get the last (most recent) entry
  const lastEntry = entries[entries.length - 1].trim();

  // Try to parse the format: [timestamp] username: note text
  const match = lastEntry.match(/^\[([^\]]+)\]\s*([^:]+):\s*(.*)$/s);
  if (match) {
    return {
      createdAt: match[1].trim(),
      author: match[2].trim(),
      text: match[3].trim(),
    };
  }

  // If format doesn't match, just return the raw text
  return {
    createdAt: null,
    author: null,
    text: lastEntry,
  };
};

// Format time ago for note display
const formatTimeAgo = (dateString) => {
  if (!dateString) return '';

  // Parse the timestamp format "YYYY-MM-DD HH:mm:ss"
  const date = new Date(dateString.replace(' ', 'T') + 'Z');
  if (isNaN(date.getTime())) return dateString; // Return as-is if can't parse

  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

// --------------------------------------------

export default function HistoryScreen() {
  const router = useRouter();

  // Single combined search query
  const [query, setQuery] = useState('');

  const [recentSearches, setRecentSearches] = useState([]);

  const [results, setResults] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);

  // Load recent searches from storage on mount; clear corrupted data
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem('recentSearches');
        if (stored) {
          const parsed = JSON.parse(stored);
          // Only keep entries that are plain strings (drop objects / broken data)
          const clean = Array.isArray(parsed)
            ? parsed.filter((s) => typeof s === 'string' && s.trim())
            : [];
          if (clean.length !== parsed.length) {
            await AsyncStorage.setItem('recentSearches', JSON.stringify(clean));
          }
          setRecentSearches(clean);
        }
      } catch {
        await AsyncStorage.removeItem('recentSearches');
      }
    })();
  }, []);

  const saveRecentSearch = async (term) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    const updated = [trimmed, ...recentSearches.filter((s) => s !== trimmed)].slice(0, 5);
    setRecentSearches(updated);
    await AsyncStorage.setItem('recentSearches', JSON.stringify(updated));
  };

  const clearSearchHistory = async () => {
    setRecentSearches([]);
    await AsyncStorage.removeItem('recentSearches');
  };

  const runSearch = useCallback(async (overrideQuery) => {
    // Only accept string overrides (ignore event objects from onPress)
    const searchTerm =
      typeof overrideQuery === 'string' ? overrideQuery : query;
    setLoading(true);
    try {
      // Pull all work orders, then filter on device (matches web History page behavior)
      const { data } = await api.get('/work-orders', { params: { mine: 'true' } });
      const listRaw = Array.isArray(data) ? data : [];

      // Canonicalize status consistently
      const list = listRaw.map((o) => ({
        ...o,
        status: toCanonicalStatus(o.status),
      }));

      const q = norm(searchTerm).toLowerCase();

      // Text search across Customer, WO, PO, Site Location
      const filtered = q
        ? list.filter((o) => {
            const customer = (o.customer || '').toString().toLowerCase();
            const wo = (o.workOrderNumber || '').toString().toLowerCase();
            const po = (o.poNumber || '').toString().toLowerCase();
            const site = (o.siteLocation || '').toString().toLowerCase();
            return (
              customer.includes(q) ||
              wo.includes(q) ||
              po.includes(q) ||
              site.includes(q)
            );
          })
        : list;

      setResults(filtered);

      // Save a meaningful label to recent searches
      if (q && filtered.length) {
        // Check if the query matched a WO number
        const woMatch = filtered.find(
          (o) => (o.workOrderNumber || '').toString().toLowerCase().includes(q)
        );
        if (woMatch && norm(woMatch.workOrderNumber)) {
          saveRecentSearch(norm(woMatch.workOrderNumber));
        } else {
          // Fall back to customer name of first result
          const custName = norm(filtered[0].customer);
          if (custName) saveRecentSearch(custName);
        }
      }
    } catch (e) {
      console.error(e);
      Alert.alert('Search Error', 'Could not fetch results.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [query]);

  // initial load (empty query returns all)
  useEffect(() => { runSearch(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = () => {
    setRefreshing(true);
    runSearch();
  };

  const clearFilters = () => {
    setQuery('');
    setTimeout(() => runSearch(''), 0);
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
    const po =
      displayPO(item.workOrderNumber, item.poNumber) ||
      (norm(item.poNumber) ? item.poNumber : 'N/A');
    const latestNote = parseLatestNote(item.notes);

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

        {/* Latest Note Section */}
        {latestNote && (
          <View style={styles.noteContainer}>
            <View style={styles.noteDivider} />
            <View style={styles.noteContent}>
              <View style={styles.noteHeader}>
                <Text style={styles.noteLabel}>Latest Note</Text>
                {latestNote.createdAt && (
                  <Text style={styles.noteTime}>{formatTimeAgo(latestNote.createdAt)}</Text>
                )}
              </View>
              <Text style={styles.noteText} numberOfLines={2}>
                {latestNote.text}
              </Text>
              {latestNote.author && (
                <Text style={styles.noteAuthor}>— {latestNote.author}</Text>
              )}
            </View>
          </View>
        )}

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

  const onRecentSearchTap = (term) => {
    setQuery(term);
    runSearch(term);
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.header}>History Report</Text>

      <View style={styles.filters}>
        {/* Single combined search box */}
        <TextInput
          placeholder="Search by Customer, WO #, PO #, or Site Location"
          value={query}
          onChangeText={setQuery}
          style={styles.input}
          autoCapitalize="none"
        />

        {recentSearches.length > 0 && (
          <View style={styles.recentSection}>
            <View style={styles.recentHeader}>
              <Text style={styles.recentLabel}>Recent Searches</Text>
              <TouchableOpacity onPress={clearSearchHistory}>
                <Text style={styles.clearHistoryText}>Clear History</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipsWrap}>
                {recentSearches.map((term) => (
                  <TouchableOpacity
                    key={term}
                    style={styles.chip}
                    onPress={() => onRecentSearchTap(term)}
                  >
                    <Text style={styles.chipText} numberOfLines={1}>{term}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        )}

        <View style={styles.filterButtons}>
          <TouchableOpacity
            style={[styles.button, styles.searchBtn]}
            onPress={() => runSearch()}
            disabled={loading}
          >
            <Text style={styles.searchBtnText}>{loading ? 'Searching…' : 'Search'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.clearBtn]}
            onPress={clearFilters}
            disabled={loading}
          >
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
  screen: { flex: 1, backgroundColor: '#f1f5f9', padding: 16 },
  header: { fontSize: 22, fontWeight: '800', color: '#0f172a', marginBottom: 10 },

  filters: {
    backgroundColor: '#ffffff',
    padding: 14,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#eef2f7',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  input: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    color: '#0f172a',
    fontSize: 14,
  },
  recentSection: { marginBottom: 4 },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  recentLabel: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  clearHistoryText: { fontSize: 12, fontWeight: '700', color: '#dc2626' },

  chipsWrap: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  chip: {
    borderWidth: 1,
    borderColor: 'rgba(13,110,253,0.22)',
    backgroundColor: 'rgba(13,110,253,0.06)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  chipText: { color: '#0d6efd', fontWeight: '700', fontSize: 12 },

  filterButtons: { flexDirection: 'row', gap: 8, marginTop: 8 },

  button: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center' },
  searchBtn: {
    backgroundColor: '#0d6efd',
    flex: 1,
    shadowColor: 'rgba(13,110,253,1)',
    shadowOpacity: 0.24,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  searchBtnText: { color: '#fff', fontWeight: '700' },
  clearBtn: {
    backgroundColor: '#f8fafc',
    flexBasis: 110,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  clearBtnText: { color: '#0f172a', fontWeight: '700' },

  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#eef2f7',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  title: { fontSize: 15, fontWeight: '900', color: '#0f172a', marginBottom: 6 },
  line: { color: '#0f172a', fontSize: 14, marginBottom: 4 },
  link: { color: '#0d6efd', textDecorationLine: 'underline', fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  viewBtn: {
    backgroundColor: '#0d6efd',
    shadowColor: 'rgba(13,110,253,1)',
    shadowOpacity: 0.24,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  viewBtnText: { color: '#fff', fontWeight: '700' },

  // Latest Note styles
  noteContainer: {
    marginTop: 12,
  },
  noteDivider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginBottom: 12,
  },
  noteContent: {
    paddingTop: 4,
  },
  noteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  noteLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  noteTime: {
    fontSize: 11,
    color: '#64748b',
  },
  noteText: {
    fontSize: 14,
    color: '#0f172a',
    lineHeight: 20,
    marginBottom: 4,
  },
  noteAuthor: {
    fontSize: 12,
    color: '#64748b',
    fontStyle: 'italic',
  },

  empty: { textAlign: 'center', color: '#0f172a', marginTop: 16, fontStyle: 'italic' },
});
