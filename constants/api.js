// File: constants/api.js
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import API_BASE_URL from './API_BASE_URL';

// normalize base URL to avoid double slashes
const BASE = (API_BASE_URL || '').replace(/\/+$/, '');

/**
 * Axios instance pointed at your EB backend.
 * NOTE: If your EB is HTTP (not HTTPS), remember:
 *  - iOS: add ATS exceptions in Info.plist for your EB host
 *  - Android: set android:usesCleartextTraffic="true" or host allowlist
 */
const api = axios.create({
  baseURL: BASE,
  timeout: 15000,
  headers: { Accept: 'application/json' },
});

// Attach JWT from storage to every request
api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('jwt');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Optional: auto-logout on 401
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err?.response?.status === 401) {
      try { await AsyncStorage.removeItem('jwt'); } catch {}
    }
    throw err;
  }
);

/**
 * Build a URL for files stored via your backend.
 * - For S3-backed uploads, your server redirects /files?key=uploads/... to a presigned URL.
 * - For local disk, it serves the file directly.
 *
 * Accepts:
 *  - absolute URL: "https://..." (passed through)
 *  - resolver path: "/files?key=uploads/abc.pdf"
 *  - key with prefix: "uploads/abc.pdf"
 *  - bare filename: "abc.pdf" (auto-prefixed to uploads/)
 */
export function fileUrl(key) {
  if (!key) return null;

  const str = String(key);

  // already absolute
  if (/^https?:\/\//i.test(str)) return str;

  // already looks like the resolver
  if (str.startsWith('/files?key=')) {
    return `${BASE}${str}`;
  }

  // normalize to uploads/… if it's just a bare name
  const normalizedKey = str.startsWith('uploads/')
    ? str
    : `uploads/${str.replace(/^\/+/, '')}`;

  return `${BASE}/files?key=${encodeURIComponent(normalizedKey)}`;
}

/**
 * Upload one or more photos to a work order.
 * Server route: PUT /work-orders/:id/edit
 * Field name must be "photoFile" (server accepts multiple).
 *
 * @param {number|string} workOrderId
 * @param {Array<{ uri:string, name?:string, type?:string }>} assets
 */
export async function uploadPhotos(workOrderId, assets = []) {
  const form = new FormData();

  assets.forEach((asset, idx) => {
    if (!asset?.uri) return;
    const guessedExt = (asset.uri.split('.').pop() || 'jpg').toLowerCase();
    const name = asset.name || `photo-${Date.now()}-${idx}.${guessedExt}`;
    const type = asset.type || guessMimeFromName(name) || 'image/jpeg';

    form.append('photoFile', {
      uri: asset.uri,
      name,
      type,
    });
  });

  return api.put(`/work-orders/${workOrderId}/edit`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

/** Simple mime guesser for common image types. */
function guessMimeFromName(name = '') {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png'))  return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif'))  return 'image/gif';
  if (lower.endsWith('.pdf'))  return 'application/pdf';
  return null;
}

export default api;
