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
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as DocumentPicker from 'expo-document-picker';
import Constants from 'expo-constants';

import api, * as API_CONST from '../../constants/api';
import { getMe } from '../../constants/api';

/**
 * Google Places config
 * We try a few common locations for the key so you don't have to change this file:
 * - export from ../../constants/api (googlePlacesKey or GOOGLE_PLACES_API_KEY)
 * - app.json/app.config.js extra.googlePlacesApiKey
 * - EXPO_PUBLIC_GOOGLE_PLACES_KEY env
 */
const GOOGLE_PLACES_KEY =
  API_CONST.googlePlacesKey ||
  API_CONST.GOOGLE_PLACES_API_KEY ||
  Constants?.expoConfig?.extra?.googlePlacesApiKey ||
  process.env?.EXPO_PUBLIC_GOOGLE_PLACES_KEY ||
  '';

export default function AddWorkOrder() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [busy, setBusy] = useState(false);

  // ── form fields ────────────────────────────────────────────────────────────
  const [customer, setCustomer] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [siteLocation, setSiteLocation] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [problemDescription, setProblemDescription] = useState('');

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

  // ── helpers ────────────────────────────────────────────────────────────────
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
    if (me?.username !== 'Jeff') {
      return Alert.alert('Not allowed', 'Only Jeff can add work orders from the app.');
    }
    if (!customer.trim() || !billingAddress.trim() || !problemDescription.trim()) {
      return Alert.alert('Missing info', 'Customer, Billing Address, and Problem Description are required.');
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.append('customer', customer.trim());
      form.append('customerPhone', customerPhone.trim());
      form.append('customerEmail', customerEmail.trim());

      // Automatically assign to Jeff and set status to "Needs to be Scheduled"
      if (me?.id != null) form.append('assignedTo', String(me.id));
      form.append('status', 'Needs to be Scheduled');

      form.append('poNumber', poNumber.trim());
      form.append('siteLocation', siteLocation.trim());
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

  if (me && me.username !== 'Jeff') {
    return (
      <View style={styles.center}>
        <Text style={{ color: '#ef4444', fontWeight: '700' }}>
          You are not authorized to add work orders.
        </Text>
      </View>
    );
  }

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

      {/* Order details */}
      <LabeledInput label="PO Number" value={poNumber} onChangeText={setPoNumber} placeholder="Optional" />

      {/* Site Location with Google Places autocomplete */}
      {GOOGLE_PLACES_KEY ? (
        <PlacesAutocompleteInput
          label="Site Location"
          value={siteLocation}
          onChangeValue={setSiteLocation}
          googleKey={GOOGLE_PLACES_KEY}
          required
        />
      ) : (
        <>
          <LabeledInput
            required
            label="Site Location"
            value={siteLocation}
            onChangeText={setSiteLocation}
            placeholder="Start typing address…"
          />
          <Text style={styles.helperText}>
            (Tip: Add your Google Places API key to enable address autocomplete.)
          </Text>
        </>
      )}

      <LabeledInput required label="Billing Address" value={billingAddress} onChangeText={setBillingAddress} multiline />
      <LabeledInput required label="Problem Description" value={problemDescription} onChangeText={setProblemDescription} multiline />

      {/* Attachments */}
      <Text style={styles.label}>Upload PDF</Text>
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

/**
 * Simple labeled input
 */
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
 * Google Places Autocomplete Input (no extra libs)
 * - Shows a dropdown of suggestions
 * - On selection, fetches place details and fills the formatted address
 */
function PlacesAutocompleteInput({ label, value, onChangeValue, googleKey, required }) {
  const [query, setQuery] = useState(value || '');
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showList, setShowList] = useState(false);
  const debounceRef = useRef(null);
  const sessionToken = useMemo(() => Math.random().toString(36).slice(2), []);

  useEffect(() => {
    setQuery(value || '');
  }, [value]);

  const runAutocomplete = async (text) => {
    if (!text || text.length < 3) {
      setPredictions([]);
      return;
    }
    try {
      setLoading(true);
      const url =
        'https://maps.googleapis.com/maps/api/place/autocomplete/json' +
        `?input=${encodeURIComponent(text)}` +
        `&types=address` +
        `&sessiontoken=${sessionToken}` +
        `&key=${googleKey}`;
      const resp = await fetch(url);
      const json = await resp.json();
      if (json?.status === 'OK' && Array.isArray(json?.predictions)) {
        setPredictions(json.predictions.slice(0, 6));
      } else {
        setPredictions([]);
      }
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

  const choosePrediction = async (p) => {
    setShowList(false);
    setLoading(true);
    try {
      // Fetch details to get the fully formatted address
      const url =
        'https://maps.googleapis.com/maps/api/place/details/json' +
        `?place_id=${encodeURIComponent(p.place_id)}` +
        `&fields=formatted_address` +
        `&sessiontoken=${sessionToken}` +
        `&key=${googleKey}`;
      const resp = await fetch(url);
      const json = await resp.json();
      const formatted = json?.result?.formatted_address || p.description || '';
      setQuery(formatted);
      onChangeValue?.(formatted);
    } catch {
      setQuery(p.description || '');
      onChangeValue?.(p.description || '');
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
          onFocus={() => setShowList(true)}
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
              <TouchableOpacity key={p.place_id} onPress={() => choosePrediction(p)} style={styles.autocompleteItem}>
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

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },

  // Autocomplete styles
  autocompleteList: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 50,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    zIndex: 10,
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

  helperText: {
    color: '#64748b',
    fontSize: 12,
    marginTop: -6,
    marginBottom: 10,
  },
});
