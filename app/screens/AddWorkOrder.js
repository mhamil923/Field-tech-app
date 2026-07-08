// File: app/screens/AddWorkOrder.js
import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
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
  Platform,
  Image,
  KeyboardAvoidingView,
} from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as DocumentPicker from 'expo-document-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';

import api, { getMe } from '../../constants/api';
import MultiPhotoCamera from '../components/MultiPhotoCamera';

/** Keep in sync with web/server */
const STATUS_OPTIONS = [
  'New',
  'Scheduled',
  'Needs to be Quoted',
  'Waiting for Approval',
  'Declined',
  'Approved',
  'Waiting on Parts',
  'Needs to be Scheduled',
  'Needs to be Invoiced',
  'Invoiced Waiting for Payment',
  'Completed',
];

/** Google Places API key (mobile uses HTTP endpoints, not JS SDK) */
const GOOGLE_PLACES_KEY = 'AIzaSyCVEFeBpSVhhhct5ILlOXAvEZip0B9tC4M';

/** Format helpers */
const pad2 = (n) => String(n).padStart(2, '0');
const toLocalYYYYMMDD = (d = new Date()) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const toLocalHHMM = (d = new Date()) =>
  `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const fmtSched = (d) =>
  d
    ? d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    : '';

export default function AddWorkOrder() {
  const router = useRouter();
  const navigation = useNavigation();
  const [me, setMe] = useState(null);
  const [busy, setBusy] = useState(false);
  const submitLock = useRef(false);   // single-submit guard (double-tap)
  const submittedOk = useRef(false);  // let navigation proceed after success
  const [submitError, setSubmitError] = useState('');

  // ── form fields ────────────────────────────────────────────
  const [customer, setCustomer] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [referralSource, setReferralSource] = useState('');

  // Split location name vs address
  const [siteLocation, setSiteLocation] = useState(''); // location name (e.g., "Panda Express")
  const [siteAddress, setSiteAddress] = useState('');   // street address

  const [billingAddress, setBillingAddress] = useState('');
  const [problemDescription, setProblemDescription] = useState('');

  // Mutually exclusive: copy one address into the other and lock that field.
  const [siteFromBilling, setSiteFromBilling] = useState(false);
  const [billingFromSite, setBillingFromSite] = useState(false);
  useEffect(() => {
    if (siteFromBilling && siteAddress !== billingAddress) {
      setSiteAddress(billingAddress);
    }
  }, [siteFromBilling, billingAddress]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (billingFromSite && billingAddress !== siteAddress) {
      setBillingAddress(siteAddress);
    }
  }, [billingFromSite, siteAddress]); // eslint-disable-line react-hooks/exhaustive-deps

  // Status
  const [status, setStatus] = useState('Needs to be Scheduled');
  const [showStatusPicker, setShowStatusPicker] = useState(false);

  // Scheduled date/time — single Date (null = not scheduled). Sent as "YYYY-MM-DDTHH:mm".
  const [schedDate, setSchedDate] = useState(null);
  const [showDateTime, setShowDateTime] = useState(false);
  const [tempDate, setTempDate] = useState(new Date());

  // attachments
  const [photos, setPhotos] = useState([]);            // [{ id, uri }]
  const [showCamera, setShowCamera] = useState(false);
  const [workOrderPdf, setWorkOrderPdf] = useState(null);  // { uri, name }
  const [estimatePdf, setEstimatePdf] = useState(null);    // { uri, name }

  // field-to-field keyboard flow
  const phoneRef = useRef(null);
  const emailRef = useRef(null);
  const siteLocRef = useRef(null);
  const poRef = useRef(null);
  const referralRef = useRef(null);

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

  // ── Draft guard: warn before losing a half-filled form on back-swipe/back ──
  const isDirty =
    [customer, customerPhone, customerEmail, poNumber, referralSource,
     siteLocation, siteAddress, billingAddress, problemDescription].some((v) => v && v.trim()) ||
    photos.length > 0 || !!workOrderPdf || !!estimatePdf || !!schedDate;
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (!dirtyRef.current || submittedOk.current) return; // nothing to lose
      e.preventDefault();
      Alert.alert(
        'Discard work order?',
        'You have unsaved changes. Discard this work order?',
        [
          { text: 'Keep Editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ]
      );
    });
    return unsub;
  }, [navigation]);

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
      allowsMultipleSelection: true,
    });
    if (res.canceled) return;
    const assets = res.assets || [];
    const processed = [];
    for (const a of assets) {
      const uri = await processImageForUpload(a.uri);
      processed.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, uri });
    }
    setPhotos((prev) => [...prev, ...processed]);
  };

  // Photos captured via the in-app camera modal (reused from ViewWorkOrder).
  // For the *create* flow we just collect the URIs into the payload (no upload yet).
  const onCameraPhotos = useCallback(async (captured) => {
    const mapped = [];
    for (const c of captured || []) {
      const uri = await processImageForUpload(c.uri);
      mapped.push({ id: c.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`, uri });
    }
    setPhotos((prev) => [...prev, ...mapped]);
  }, []);

  const removePhoto = (id) => setPhotos((prev) => prev.filter((p) => p.id !== id));

  const pickPdf = async (setter) => {
    const res = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    setter({ uri: a.uri, name: a.name || 'document.pdf' });
  };

  const validate = () => {
    const missing = [];
    if (!customer.trim()) missing.push('Customer');
    if (!siteLocation.trim()) missing.push('Site Location (name)');
    if (!siteAddress.trim()) missing.push('Site Address');
    if (!billingAddress.trim()) missing.push('Billing Address');
    if (!problemDescription.trim()) missing.push('Problem Description');

    if (missing.length) {
      setSubmitError(`Please fill required: ${missing.join(', ')}`);
      Alert.alert('Missing info', `Please fill required: ${missing.join(', ')}`);
      return false;
    }
    return true;
  };

  const submit = async () => {
    if (submitLock.current || busy) return; // double-tap guard
    setSubmitError('');
    if (!validate()) return;

    // Build scheduledDate string like "YYYY-MM-DDTHH:mm" (unchanged payload shape)
    let scheduledDate = '';
    if (schedDate) {
      scheduledDate = `${toLocalYYYYMMDD(schedDate)}T${toLocalHHMM(schedDate)}`;
    }

    submitLock.current = true;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('customer', customer.trim());
      form.append('customerPhone', customerPhone.trim());
      form.append('customerEmail', customerEmail.trim());
      if (me?.id != null) form.append('assignedTo', String(me.id));

      form.append('status', status);
      form.append('poNumber', poNumber.trim());
      form.append('referralSource', referralSource.trim());
      form.append('siteLocation', siteLocation.trim()); // name
      form.append('siteAddress', siteAddress.trim());   // address
      form.append('billingAddress', billingAddress);
      form.append('problemDescription', problemDescription);

      if (scheduledDate) {
        // server normalizes this like the web app's <input type="datetime-local">
        form.append('scheduledDate', scheduledDate);
      }

      // Use the SAME field names as the web CRM so the backend routes are consistent
      if (workOrderPdf) {
        form.append('workOrderPdf', {
          uri: workOrderPdf.uri,
          name: `workorder-${Date.now()}.pdf`,
          type: 'application/pdf',
        });
      }
      if (estimatePdf) {
        form.append('estimatePdf', {
          uri: estimatePdf.uri,
          name: `estimate-${Date.now()}.pdf`,
          type: 'application/pdf',
        });
      }
      // Multiple photos: backend upload.any() + images filter stores all (first ->
      // attachments, rest appended to photoPath). Same field name as before.
      photos.forEach((p, i) => {
        form.append('photoFile', {
          uri: p.uri,
          name: `photo-${Date.now()}-${i}.jpg`,
          type: 'image/jpeg',
        });
      });

      await api.post('/work-orders', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      submittedOk.current = true; // allow navigation without discard prompt
      Alert.alert('Success', 'Work order created.');
      router.back();
    } catch (e) {
      setSubmitError(e?.response?.data?.error || e?.message || 'Failed to create work order.');
    } finally {
      setBusy(false);
      submitLock.current = false;
    }
  };

  // ── date/time picker handlers ──────────────────────────────
  const openDateTime = () => {
    setTempDate(schedDate || new Date());
    setShowDateTime(true);
  };
  const quickSetNow = () => setSchedDate(new Date());
  const clearSched = () => setSchedDate(null);

  // Toggle handlers for the "Same as" checkboxes (mutually exclusive)
  const toggleSiteFromBilling = () => {
    setSiteFromBilling((prev) => {
      const next = !prev;
      if (next) { setBillingFromSite(false); setSiteAddress(billingAddress); }
      else { setSiteAddress(''); }
      return next;
    });
  };
  const toggleBillingFromSite = () => {
    setBillingFromSite((prev) => {
      const next = !prev;
      if (next) { setSiteFromBilling(false); setBillingAddress(siteAddress); }
      else { setBillingAddress(''); }
      return next;
    });
  };

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.form}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Add Work Order</Text>

          {/* ── CUSTOMER ─────────────────────────────── */}
          <Card title="Customer" icon="person-outline">
            <LabeledInput
              required
              label="Customer Name"
              value={customer}
              onChangeText={setCustomer}
              placeholder="Business or person"
              returnKeyType="next"
              onSubmitEditing={() => phoneRef.current?.focus()}
              blurOnSubmit={false}
            />
            <LabeledInput
              ref={phoneRef}
              label="Phone"
              value={customerPhone}
              onChangeText={setCustomerPhone}
              placeholder="(###) ###-####"
              keyboardType="phone-pad"
              returnKeyType="next"
              onSubmitEditing={() => emailRef.current?.focus()}
              blurOnSubmit={false}
            />
            <LabeledInput
              ref={emailRef}
              label="Email"
              value={customerEmail}
              onChangeText={setCustomerEmail}
              placeholder="name@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              last
            />
          </Card>

          {/* ── LOCATION ─────────────────────────────── */}
          <Card title="Location" icon="location-outline">
            <LabeledInput
              ref={siteLocRef}
              required
              label="Site Location (name)"
              value={siteLocation}
              onChangeText={setSiteLocation}
              placeholder="e.g., Panda Express"
              returnKeyType="next"
            />

            <View style={{ marginBottom: 12 }}>
              <View style={styles.rowBetween}>
                <FieldLabel required>Site Address</FieldLabel>
                <CheckRow
                  checked={siteFromBilling}
                  label="Same as billing"
                  onPress={toggleSiteFromBilling}
                />
              </View>
              <PlacesAutocompleteInput
                value={siteAddress}
                onChangeValue={setSiteAddress}
                googleKey={GOOGLE_PLACES_KEY}
                editable={!siteFromBilling}
              />
            </View>

            <View style={{ marginBottom: 4 }}>
              <View style={styles.rowBetween}>
                <FieldLabel required>Billing Address</FieldLabel>
                <CheckRow
                  checked={billingFromSite}
                  label="Same as site"
                  onPress={toggleBillingFromSite}
                />
              </View>
              <TextInput
                style={[
                  styles.input,
                  { height: 84, textAlignVertical: 'top' },
                  billingFromSite && styles.inputDisabled,
                ]}
                value={billingAddress}
                onChangeText={setBillingAddress}
                editable={!billingFromSite}
                multiline
                placeholder="Street, City, State ZIP"
                placeholderTextColor="#9ca3af"
              />
            </View>
          </Card>

          {/* ── JOB ──────────────────────────────────── */}
          <Card title="Job" icon="construct-outline">
            <LabeledInput
              required
              label="Problem Description"
              value={problemDescription}
              onChangeText={setProblemDescription}
              placeholder="What needs to be done?"
              multiline
            />
            <LabeledInput
              ref={poRef}
              label="PO Number"
              value={poNumber}
              onChangeText={setPoNumber}
              placeholder="Optional"
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={() => referralRef.current?.focus()}
              blurOnSubmit={false}
            />
            <LabeledInput
              ref={referralRef}
              label="Referral Source"
              value={referralSource}
              onChangeText={setReferralSource}
              placeholder="How did they hear about us?"
              autoCorrect={false}
              returnKeyType="done"
              last
            />
          </Card>

          {/* ── SCHEDULE ─────────────────────────────── */}
          <Card title="Schedule" icon="calendar-outline">
            <FieldLabel>Status</FieldLabel>
            <TouchableOpacity
              onPress={() => setShowStatusPicker(true)}
              style={[styles.input, styles.selectRow]}
            >
              <Text style={styles.selectText}>{status}</Text>
              <Ionicons name="chevron-down" size={18} color="#6b7280" />
            </TouchableOpacity>

            <View style={{ height: 12 }} />

            <FieldLabel>Scheduled Date &amp; Time</FieldLabel>
            <View style={styles.rowGap}>
              <TouchableOpacity onPress={openDateTime} style={[styles.input, styles.selectRow, { flex: 1 }]}>
                <Text style={[styles.selectText, !schedDate && { color: '#9ca3af' }]}>
                  {schedDate ? fmtSched(schedDate) : 'Not scheduled'}
                </Text>
                <Ionicons name="calendar-outline" size={18} color="#6b7280" />
              </TouchableOpacity>
              <TouchableOpacity onPress={quickSetNow} style={[styles.chip, { backgroundColor: '#22c55e' }]}>
                <Text style={styles.chipText}>Now</Text>
              </TouchableOpacity>
              {schedDate ? (
                <TouchableOpacity onPress={clearSched} style={[styles.chip, { backgroundColor: '#94a3b8' }]}>
                  <Text style={styles.chipText}>Clear</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </Card>

          {/* ── ATTACHMENTS ──────────────────────────── */}
          <Card title="Attachments" icon="attach-outline">
            <AttachRow
              label="Work Order PDF"
              file={workOrderPdf}
              onPick={() => pickPdf(setWorkOrderPdf)}
              onRemove={() => setWorkOrderPdf(null)}
            />
            <AttachRow
              label="Estimate PDF"
              file={estimatePdf}
              onPick={() => pickPdf(setEstimatePdf)}
              onRemove={() => setEstimatePdf(null)}
              helper="Appears under Estimates on the Work Order."
            />

            <FieldLabel>Photos</FieldLabel>
            <View style={styles.rowGap}>
              <TouchableOpacity onPress={() => setShowCamera(true)} style={[styles.attachBtn, styles.photoBtn]}>
                <Ionicons name="camera" size={18} color="#fff" />
                <Text style={styles.attachBtnText}>Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={pickPhoto} style={[styles.attachBtn, styles.photoBtnAlt]}>
                <Ionicons name="images-outline" size={18} color="#fff" />
                <Text style={styles.attachBtnText}>Library</Text>
              </TouchableOpacity>
            </View>

            {photos.length > 0 && (
              <View style={styles.thumbGrid}>
                {photos.map((p) => (
                  <View key={p.id} style={styles.thumbWrap}>
                    <Image source={{ uri: p.uri }} style={styles.thumb} />
                    <TouchableOpacity style={styles.thumbX} onPress={() => removePhoto(p.id)}>
                      <Ionicons name="close" size={14} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </Card>

          {submitError ? (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={18} color="#b91c1c" />
              <Text style={styles.errorText}>{submitError}</Text>
            </View>
          ) : null}

          <View style={{ height: 12 }} />
        </ScrollView>

        {/* ── Sticky submit ─────────────────────────── */}
        <View style={styles.footer}>
          <TouchableOpacity
            disabled={busy}
            onPress={submit}
            style={[styles.submit, busy && { opacity: 0.6 }]}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>Add Work Order</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Status picker modal */}
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

      {/* Native date & time picker modal */}
      <Modal visible={showDateTime} transparent animationType="fade" onRequestClose={() => setShowDateTime(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Scheduled Date &amp; Time</Text>
            <DateTimePicker
              value={tempDate}
              mode="datetime"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(e, d) => {
                if (d) setTempDate(d);
                if (Platform.OS === 'android') {
                  setShowDateTime(false);
                  if (e.type === 'set' && d) setSchedDate(d);
                }
              }}
            />
            <View style={[styles.rowGap, { marginTop: 8 }]}>
              <TouchableOpacity style={[styles.modalClose, { flex: 1, backgroundColor: '#6b7280' }]} onPress={() => setShowDateTime(false)}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalClose, { flex: 1 }]}
                onPress={() => { setSchedDate(tempDate); setShowDateTime(false); }}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>Set</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* In-app camera (reused multi-photo modal) */}
      <MultiPhotoCamera
        visible={showCamera}
        onClose={() => setShowCamera(false)}
        onUpload={onCameraPhotos}
        workOrderId={null}
      />
    </View>
  );
}

/** Card section wrapper */
function Card({ title, icon, children }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        {icon ? <Ionicons name={icon} size={18} color="#3D5A80" /> : null}
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

/** Field label with optional required asterisk */
function FieldLabel({ children, required }) {
  return (
    <Text style={styles.label}>
      {children} {required ? <Text style={{ color: '#ef4444' }}>*</Text> : null}
    </Text>
  );
}

/** Checkbox row (compact, for "Same as" toggles) */
function CheckRow({ checked, label, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.checkRow} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
      <View style={[styles.checkbox, checked && styles.checkboxOn]}>
        {checked && <Ionicons name="checkmark" size={12} color="#fff" />}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Simple labeled input (forwardRef for keyboard flow) */
const LabeledInput = React.forwardRef(function LabeledInput(
  { label, required, multiline, style, last, ...props },
  ref
) {
  return (
    <View style={{ marginBottom: last ? 2 : 12 }}>
      <FieldLabel required={required}>{label}</FieldLabel>
      <TextInput
        ref={ref}
        style={[styles.input, multiline && { height: 96, textAlignVertical: 'top' }, style]}
        placeholderTextColor="#9ca3af"
        multiline={!!multiline}
        {...props}
      />
    </View>
  );
});

/** Attachment picker row with filename chip + remove */
function AttachRow({ label, file, onPick, onRemove, helper }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <FieldLabel>{label}</FieldLabel>
      {file ? (
        <View style={styles.fileChip}>
          <Ionicons name="document-text-outline" size={18} color="#3D5A80" />
          <Text style={styles.fileName} numberOfLines={1}>{file.name || 'document.pdf'}</Text>
          <TouchableOpacity onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={20} color="#94a3b8" />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity onPress={onPick} style={[styles.attachBtn, styles.pdfBtn]}>
          <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
          <Text style={styles.attachBtnText}>Choose PDF</Text>
        </TouchableOpacity>
      )}
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
    </View>
  );
}

/**
 * Google Places Autocomplete Input
 * - Uses Places v1, falls back to legacy.
 * - Keeps form state (`onChangeValue`) in sync on each keystroke.
 */
function PlacesAutocompleteInput({ value, onChangeValue, googleKey, editable = true }) {
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
    onChangeValue?.(text); // keep parent state in sync while typing
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
    <View style={{ zIndex: Platform.OS === 'android' ? 10 : undefined }}>
      <View style={{ position: 'relative' }}>
        <TextInput
          style={[styles.input, !editable && styles.inputDisabled]}
          value={query}
          onChangeText={onChangeText}
          onFocus={() => {
            if (!editable) return;
            setShowList(true);
            if (query && query.length >= 3) runAutocomplete(query);
          }}
          onBlur={() => {
            onChangeValue?.(query);
            setShowList(false);
          }}
          placeholder="Start typing address…"
          placeholderTextColor="#9ca3af"
          autoCorrect={false}
          autoCapitalize="none"
          editable={editable}
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
  screen: { flex: 1, backgroundColor: '#F1F5F9' },
  form: {
    padding: 16,
    paddingBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 14,
  },

  // Card
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#3D5A80',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  label: { color: '#334155', marginBottom: 6, fontWeight: '700', fontSize: 13 },
  helper: { color: '#94a3b8', fontSize: 12, marginTop: 6 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 46,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    color: '#0f172a',
    fontSize: 15,
  },
  inputDisabled: { backgroundColor: '#f1f5f9', color: '#94a3b8' },

  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  selectRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectText: { color: '#0f172a', fontSize: 15 },

  // "Same as" checkbox
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  checkbox: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: '#cbd5e1',
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
  },
  checkboxOn: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  checkLabel: { color: '#64748b', fontSize: 12, fontWeight: '600' },

  // chips (Now / Clear)
  chip: { paddingHorizontal: 16, height: 46, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chipText: { color: '#fff', fontWeight: '800' },

  // attachments
  attachBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, flex: 1,
  },
  attachBtnText: { color: '#fff', fontWeight: '800' },
  pdfBtn: { backgroundColor: '#64748b', flex: 0, alignSelf: 'flex-start', paddingHorizontal: 20 },
  photoBtn: { backgroundColor: '#0ea5e9' },
  photoBtnAlt: { backgroundColor: '#3D5A80' },

  fileChip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#eef2f7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  fileName: { flex: 1, color: '#0f172a', fontWeight: '600' },

  thumbGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 84, height: 84, borderRadius: 10, backgroundColor: '#e2e8f0' },
  thumbX: {
    position: 'absolute', top: -6, right: -6, backgroundColor: '#ef4444',
    width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
  },

  // error banner
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fef2f2', borderColor: '#fecaca', borderWidth: 1,
    borderRadius: 10, padding: 12, marginTop: 4,
  },
  errorText: { color: '#b91c1c', fontWeight: '600', flex: 1 },

  // sticky footer
  footer: {
    padding: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  submit: {
    backgroundColor: '#3D5A80',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
  },
  submitText: { color: '#fff', fontWeight: '900', fontSize: 16 },

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
  autocompleteText: { color: '#111827' },
  autocompleteLoading: { position: 'absolute', right: 10, top: 12 },

  // Status picker modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    maxHeight: '70%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 10, color: '#0f172a' },
  statusOption: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 8,
  },
  statusActive: { backgroundColor: '#0ea5e9', borderColor: '#0ea5e9' },
  statusText: { color: '#111827', fontWeight: '600' },
  statusTextActive: { color: '#fff' },
  modalClose: {
    marginTop: 6,
    backgroundColor: '#3D5A80',
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
});
