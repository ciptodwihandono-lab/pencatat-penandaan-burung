// Konfigurasi project Firebase — bukan rahasia, aman untuk kode client-side
// (keamanan data sesungguhnya diatur lewat Firestore Security Rules, bukan
// dengan menyembunyikan nilai-nilai ini).
//
// Cara isi: buat project di https://console.firebase.google.com, aktifkan
// Authentication (Email/Password) & Firestore Database, lalu salin config
// dari halaman "Project settings > General > Your apps > SDK setup".
//
// Selama masih kosong seperti ini, fitur login/sinkronisasi otomatis
// dimatikan dan aplikasi tetap berjalan normal 100% offline-lokal.

export const firebaseConfig = {
  apiKey: "AIzaSyAzUAs7YEhI31wGWPwE-f5aGEIAV-_F9bQ",
  authDomain: "tally-sheet-burung.firebaseapp.com",
  projectId: "tally-sheet-burung",
  storageBucket: "tally-sheet-burung.firebasestorage.app",
  messagingSenderId: "438211481394",
  appId: "1:438211481394:web:ed11c4c5eaf4ef32e4112b",
};

export function isFirebaseConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}
