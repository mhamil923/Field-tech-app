// File: app/screens/AddWorkOrder.js
import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
  Modal,
  FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as DocumentPicker from 'expo-document-picker';

import api, { getMe } from '../../constants/api';

/** Keep in sync with web/server */
const STATUS_OPTIONS = [
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

/** Google Places API key */
const GOOGLE_PLACES_KEY = 'AIzaSyCVEFeBpSVhhhct5ILlOXAvEZip0B9tC4M';

export default function AddWorkOrder() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [busy, setBusy] = useState(false);

  // ── form fields ────────────────────────────────────────────
  const [customer, setCustomer] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [poNumber, setPoNumber] = useState('');

  // NEW: split location name vs address
  const [siteLocation, setSiteLocation] = useState(''); // location name (e.g., "Panda Express")
  const [siteAddress, setSiteAddress] = useState('');   // street address

  const [billingAddress, setBillingAddress] = useState('');
  const [problemDescription, setProblemDescription] = useState('');

  // NEW: pick status from full list
  const [status, setStatus] = useState('Needs to be Scheduled');
  const [showStatusPicker, setShowStatusPicker] = useState(false);

  // attachments
  const [photoUri, setPhotoUri] = useState(null);
  const [pdfUri, setPdfUri] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const u = await getMe();
        setMe(u || null);
      } catch {
        setMe(null);
      }
    })();
  }, []);

  // ── helpers ────────────────────────────────────────────────
  const processImageForUpload = async (uri) => {
    try {
      const out = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1600 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
      );
      return out.uri;
    } catch {
      return uri;
    }
  };

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      return Alert.alert('Permission needed', 'Photos access is required.');
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (res.canceled) return;
    const processed = await processImageForUpload(res.assets[0].uri);
    setPhotoUri(processed);
  };

  const pickPdf = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      multiple: false,
    });
    if (res.canceled || !res.assets?.length) return;
    setPdfUri(res.assets[0].uri);
  };

  const submit = async () => {
    if (!customer.trim() || !billingAddress.trim() || !problemDescription.trim()) {
      return Alert.alert('Missing info', 'Customer, Billing Address, and Problem Description are required.');
    }
    if (!siteLocation.trim()) {
      return Alert.alert('Missing info', 'Site Location (name) is required.');
    }
    if (!siteAddress.trim()) {
      return Alert.alert('Missing info', 'Site Address is required.');
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.append('customer', customer.trim());
      form.append('customerPhone', customerPhone.trim());
      form.append('customerEmail', customerEmail.trim());

      if (me?.id != null) form.append('assignedTo', String(me.id));
      form.append('status', status); // use picked status

      form.append('poNumber', poNumber.trim());
      form.append('siteLocation', siteLocation.trim()); // name
      form.append('siteAddress', siteAddress.trim());   // address
      form.append('billingAddress', billingAddress);
      form.append('problemDescription', problemDescription);

      if (pdfUri) {
        form.append('pdfFile', {
          uri: pdfUri,
          name: `workorder-${Date.now()}.pdf`,
          type: 'application/pdf',
        });
      }
      if (photoUri) {
        form.append('photoFile', {
          uri: photoUri,
          name: `photo-${Date.now()}.jpg`,
          type: 'image/jpeg',
        });
      }

      await api.post('/work-orders', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      Alert.alert('Success', 'Work order created.');
      router.back();
    } catch (e) {
      Alert.alert('Error', e?.response?.data?.error || e?.message || 'Failed to create work order.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Add Work Order</Text>

      {/* Customer block */}
      <LabeledInput required label="Customer Name" value={customer} onChangeText={setCustomer} />
      <LabeledInput
        label="Customer Phone (optional)"
        value={customerPhone}
        onChangeText={setCustomerPhone}
        placeholder="(###) ###-####"
        keyboardType="phone-pad"
      />
      <LabeledInput
        label="Customer Email (optional)"
        value={customerEmail}
        onChangeText={setCustomerEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      {/* PO */}
      <LabeledInput label="PO Number" value={poNumber} onChangeText={setPoNumber} placeholder="Optional" />

      {/* NEW: Site Location Name */}
      <LabeledInput
        required
        label="Site Location (name)"
        value={siteLocation}
        onChangeText={setSiteLocation}
        placeholder="e.g., Panda Express"
      />

      {/* NEW: Site Address with Google Places autocomplete */}
      <PlacesAutocompleteInput
        label="Site Address"
        value={siteAddress}
        onChangeValue={setSiteAddress}
        googleKey={GOOGLE_PLACES_KEY}
        required
      />

      {/* Billing & Problem */}
      <LabeledInput required label="Billing Address" value={billingAddress} onChangeText={setBillingAddress} multiline />
      <LabeledInput required label="Problem Description" value={problemDescription} onChangeText={setProblemDescription} multiline />

      {/* NEW: Status picker */}
      <Text style={styles.label}>Status</Text>
      <TouchableOpacity
        onPress={() => setShowStatusPicker(true)}
        style={[styles.input, { justifyContent: 'center', minHeight: 48 }]}
      >
        <Text style={{ color: '#111827' }}>{status}</Text>
      </TouchableOpacity>

      <Modal visible={showStatusPicker} transparent animationType="fade" onRequestClose={() => setShowStatusPicker(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Choose Status</Text>
            <FlatList
              data={STATUS_OPTIONS}
              keyExtractor={(s) => s}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.statusOption, item === status && styles.statusActive]}
                  onPress={() => {
                    setStatus(item);
                    setShowStatusPicker(false);
                  }}
                >
                  <Text style={[styles.statusText, item === status && styles.statusTextActive]}>{item}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.modalClose} onPress={() => setShowStatusPicker(false)}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Attachments */}
      <Text style={[styles.label, { marginTop: 8 }]}>Upload PDF</Text>
      <TouchableOpacity onPress={pickPdf} style={[styles.btn, styles.pdfBtn]}>
        <Text style={styles.btnText}>{pdfUri ? 'Change PDF' : 'Choose PDF'}</Text>
      </TouchableOpacity>

      <Text style={[styles.label, { marginTop: 10 }]}>Upload Photo</Text>
      <TouchableOpacity onPress={pickPhoto} style={[styles.btn, styles.photoBtn]}>
        <Text style={styles.btnText}>{photoUri ? 'Change Photo' : 'Choose Photo'}</Text>
      </TouchableOpacity>

      <TouchableOpacity disabled={busy} onPress={submit} style={[styles.submit, busy && { opacity: 0.7 }]}>
        <Text style={styles.submitText}>{busy ? 'Saving…' : 'Add Work Order'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

/** Simple labeled input */
function LabeledInput({ label, required, multiline, style, ...props }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>
        {label} {required ? <Text style={{ color: '#ef4444' }}>*</Text> : null}
      </Text>
      <TextInput
        style={[styles.input, multiline && { height: 110, textAlignVertical: 'top' }, style]}
        placeholder={label}
        multiline={!!multiline}
        {...props}
      />
    </View>
  );
}

/**
 * Google Places Autocomplete Input
 * - v1 API first, legacy API as fallback
 */
function PlacesAutocompleteInput({ label, value, onChangeValue, googleKey, required }) {
  const [query, setQuery] = useState(value || '');
  const [predictions, setPredictions] = useState([]); // [{place_id, description}]
  const [loading, setLoading] = useState(false);
  const [showList, setShowList] = useState(false);
  const debounceRef = useRef(null);
  const sessionToken = useMemo(() => Math.random().toString(36).slice(2), []);

  useEffect(() => {
    setQuery(value || '');
  }, [value]);

  // --- v1 Autocomplete
  const runAutocompleteV1 = async (text) => {
    const resp = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': googleKey,
        'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text',
      },
      body: JSON.stringify({
        input: text,
        sessionToken,
        languageCode: 'en',
        includedPrimaryTypes: ['address'],
        regionCode: 'US',
      }),
    });
    const json = await resp.json();
    if (!Array.isArray(json?.suggestions)) return [];
    return json.suggestions
      .map((s) => s?.placePrediction)
      .filter(Boolean)
      .map((p) => ({
        place_id: p.placeId,
        description: p?.text?.text || '',
      }))
      .filter((x) => x.description);
  };

  // --- Legacy Autocomplete
  const runAutocompleteLegacy = async (text) => {
    const url =
      'https://maps.googleapis.com/maps/api/place/autocomplete/json' +
      `?input=${encodeURIComponent(text)}` +
      `&types=address` +
      `&components=country:us` +
      `&sessiontoken=${sessionToken}` +
      `&key=${googleKey}`;
    const resp = await fetch(url);
    const json = await resp.json();
    if (json?.status === 'OK' && Array.isArray(json?.predictions)) {
      return json.predictions.slice(0, 8).map((p) => ({
        place_id: p.place_id,
        description: p.description,
      }));
    }
    return [];
  };

  const runAutocomplete = async (text) => {
    if (!googleKey) return setPredictions([]);
    if (!text || text.length < 3) {
      setPredictions([]);
      return;
    }
    try {
      setLoading(true);
      let preds = await runAutocompleteV1(text);
      if (!preds.length) preds = await runAutocompleteLegacy(text);
      setPredictions(preds);
    } catch {
      setPredictions([]);
    } finally {
      setLoading(false);
    }
  };

  const onChangeText = (text) => {
    setQuery(text);
    setShowList(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runAutocomplete(text), 250);
  };

  // --- v1 Details
  const fetchDetailsV1 = async (placeId) => {
    const rid = placeId.startsWith('places/') ? placeId : `places/${placeId}`;
    const url = `https://places.googleapis.com/v1/${encodeURIComponent(rid)}?fields=formattedAddress`;
    const resp = await fetch(url, { headers: { 'X-Goog-Api-Key': googleKey } });
    const json = await resp.json();
    return json?.formattedAddress || '';
  };

  // --- Legacy Details
  const fetchDetailsLegacy = async (placeId) => {
    const url =
      'https://maps.googleapis.com/maps/api/place/details/json' +
      `?place_id=${encodeURIComponent(placeId)}` +
      `&fields=formatted_address` +
      `&key=${googleKey}`;
    const resp = await fetch(url);
    const json = await resp.json();
    return json?.result?.formatted_address || '';
  };

  const choosePrediction = async (p) => {
    setShowList(false);
    setLoading(true);
    try {
      let formatted = await fetchDetailsV1(p.place_id);
      if (!formatted) formatted = await fetchDetailsLegacy(p.place_id);
      const addr = formatted || p.description || '';
      setQuery(addr);
      onChangeValue?.(addr);
    } catch {
      const addr = p.description || '';
      setQuery(addr);
      onChangeValue?.(addr);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>
        {label} {required ? <Text style={{ color: '#ef4444' }}>*</Text> : null}
      </Text>
      <View style={{ position: 'relative' }}>
        <TextInput
          style={[styles.input]}
          value={query}
          onChangeText={onChangeText}
          onFocus={() => {
            setShowList(true);
            if (query && query.length >= 3) runAutocomplete(query);
          }}
          placeholder="Start typing address…"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {loading ? (
          <View style={styles.autocompleteLoading}>
            <ActivityIndicator />
          </View>
        ) : null}

        {showList && predictions.length > 0 && (
          <View style={styles.autocompleteList}>
            {predictions.map((p) => (
              <TouchableOpacity
                key={p.place_id}
                onPress={() => choosePrediction(p)}
                style={styles.autocompleteItem}
              >
                <Text style={styles.autocompleteText}>{p.description}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    padding: 16,
    backgroundColor: '#F1F5F9',
    paddingBottom: 48,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#2B2D42',
    textAlign: 'center',
    marginBottom: 12,
  },
  label: { color: '#334155', marginBottom: 6, fontWeight: '700' },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },

  btn: {
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  pdfBtn: { backgroundColor: '#6b7280' },
  photoBtn: { backgroundColor: '#0ea5e9' },
  btnText: { color: '#fff', fontWeight: '800' },

  submit: {
    marginTop: 16,
    backgroundColor: '#3D5A80',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  submitText: { color: '#fff', fontWeight: '900' },

  // Autocomplete styles
  autocompleteList: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 50,
    maxHeight: 260,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    zIndex: 999,
    elevation: 6,
    overflow: 'hidden',
  },
  autocompleteItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  autocompleteText: {
    color: '#111827',
  },
  autocompleteLoading: {
    position: 'absolute',
    right: 10,
    top: 12,
  },

  // Status picker modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    maxHeight: '70%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8, color: '#2B2D42' },
  statusOption: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 8,
  },
  statusActive: { backgroundColor: '#0ea5e9', borderColor: '#0ea5e9' },
  statusText: { color: '#111827', fontWeight: '600' },
  statusTextActive: { color: '#fff' },
  modalClose: {
    marginTop: 6,
    backgroundColor: '#111827',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
});
