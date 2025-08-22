// constants/API_BASE_URL.js

// Elastic Beanstalk (your chosen prod endpoint)
// NOTE: This EB env currently serves HTTP (no SSL). Keep "http://" unless you add a cert.
const EB = 'http://FCGG.us-east-2.elasticbeanstalk.com';

// Optional dev helpers (uncomment if needed)
// const LAN   = 'http://10.1.10.253:5001';
// const NGROK = 'https://c6af5d14a52c.ngrok-free.app';

// Prefer an env override if provided (Expo: EXPO_PUBLIC_API_BASE_URL)
const API_BASE_URL =
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_API_BASE_URL) ||
  EB;

export default API_BASE_URL;
