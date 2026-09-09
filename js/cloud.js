// Lapisan cloud opsional: login/registrasi (Firebase Auth) + sinkronisasi
// data tim (Firestore). Kalau firebase-config.js belum diisi, semua fungsi
// di sini aman dipanggil tapi tidak melakukan apa-apa -- aplikasi tetap
// jalan 100% offline-lokal seperti sebelumnya.

import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

const SDK_VERSION = "10.14.1";
const CDN = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;
const COLLECTION = "catatan_penandaan";

let firebaseApp = null;
let authInstance = null;
let dbInstance = null;
let sdk = null; // { auth: {...fns}, firestore: {...fns} }
let initPromise = null;

const LOAD_TIMEOUT_MS = 10000;

function timeout(ms, message) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}

function loadSdk() {
  if (!isFirebaseConfigured()) return Promise.resolve(null);
  if (initPromise) return initPromise;
  const attempt = (async () => {
    const [{ initializeApp }, authMod, storeMod] = await Promise.all([
      import(`${CDN}/firebase-app.js`),
      import(`${CDN}/firebase-auth.js`),
      import(`${CDN}/firebase-firestore.js`),
    ]);
    firebaseApp = initializeApp(firebaseConfig);
    authInstance = authMod.getAuth(firebaseApp);
    try {
      // Simpan sesi login secara lokal di perangkat (default sudah begini,
      // tapi diset eksplisit supaya jelas): sekali login saat ada sinyal,
      // sesi ini tetap "diingat" walau nanti dipakai tanpa internet.
      await authMod.setPersistence(authInstance, authMod.browserLocalPersistence);
    } catch (err) {
      console.warn("Gagal set auth persistence:", err.message);
    }
    dbInstance = storeMod.getFirestore(firebaseApp);
    try {
      await storeMod.enableIndexedDbPersistence(dbInstance);
    } catch (err) {
      // Gagal aktifkan persistence (mis. banyak tab terbuka) -- tetap
      // lanjut, cuma cache offline Firestore-nya yang tidak aktif.
      console.warn("Firestore offline persistence tidak aktif:", err.message);
    }
    sdk = { auth: authMod, store: storeMod };
    return sdk;
  })();

  // Kalau gagal atau kelamaan (mis. jaringan lambat/putus saat memuat SDK),
  // JANGAN simpan promise yang gagal itu -- reset supaya panggilan berikutnya
  // (retry) mencoba lagi dari awal, bukan macet permanen.
  initPromise = Promise.race([attempt, timeout(LOAD_TIMEOUT_MS, "Waktu tunggu habis saat memuat layanan cloud. Periksa koneksi internet Anda.")]).catch(
    (err) => {
      initPromise = null;
      throw err;
    }
  );
  return initPromise;
}

export function isEnabled() {
  return isFirebaseConfigured();
}

export async function onAuthChange(callback) {
  const s = await loadSdk();
  if (!s) {
    callback(null);
    return () => {};
  }
  return s.auth.onAuthStateChanged(authInstance, callback);
}

export function currentUser() {
  return authInstance ? authInstance.currentUser : null;
}

export async function register(email, password) {
  const s = await loadSdk();
  if (!s) throw new Error("Fitur cloud belum dikonfigurasi.");
  const cred = await s.auth.createUserWithEmailAndPassword(authInstance, email, password);
  return cred.user;
}

export async function login(email, password) {
  const s = await loadSdk();
  if (!s) throw new Error("Fitur cloud belum dikonfigurasi.");
  const cred = await s.auth.signInWithEmailAndPassword(authInstance, email, password);
  return cred.user;
}

export async function logout() {
  const s = await loadSdk();
  if (!s) return;
  await s.auth.signOut(authInstance);
}

function stripLocalOnlyFields(record) {
  // id (auto-increment lokal) tidak boleh ikut ke cloud; cloud_id dikelola terpisah.
  const { id, cloud_id, ...rest } = record;
  return rest;
}

export async function pushRecord(record) {
  const s = await loadSdk();
  if (!s || !authInstance.currentUser) return null;
  const { collection, doc, setDoc, serverTimestamp } = s.store;
  const ref = record.cloud_id ? doc(dbInstance, COLLECTION, record.cloud_id) : doc(collection(dbInstance, COLLECTION));
  await setDoc(ref, {
    ...stripLocalOnlyFields(record),
    owner_email: authInstance.currentUser.email,
    synced_at: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteCloudRecord(cloudId) {
  const s = await loadSdk();
  if (!s || !authInstance.currentUser || !cloudId) return;
  const { doc, deleteDoc } = s.store;
  await deleteDoc(doc(dbInstance, COLLECTION, cloudId));
}

export async function fetchAllCloudRecords() {
  const s = await loadSdk();
  if (!s || !authInstance.currentUser) return [];
  const { collection, getDocs } = s.store;
  const snap = await getDocs(collection(dbInstance, COLLECTION));
  return snap.docs.map((d) => ({ cloud_id: d.id, ...d.data() }));
}
