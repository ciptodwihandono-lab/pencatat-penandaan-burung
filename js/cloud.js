// Lapisan cloud opsional: login/registrasi (Firebase Auth) + sinkronisasi
// data tim (Firestore). Kalau firebase-config.js belum diisi, semua fungsi
// di sini aman dipanggil tapi tidak melakukan apa-apa -- aplikasi tetap
// jalan 100% offline-lokal seperti sebelumnya.
//
// Model akun: tiap akun baru butuh persetujuan admin sebelum bisa dipakai.
// Data tiap akun defaultnya PRIVAT (tersimpan di users/{uid}/catatan).
// Admin bisa menyalakan status "gabung tim" per akun -- kalau menyala,
// akun itu baca/tulis ke koleksi bersama catatan_penandaan (dilihat semua
// akun lain yang juga digabungkan admin).

import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

const SDK_VERSION = "10.14.1";
const CDN = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;
const SHARED_COLLECTION = "catatan_penandaan";
const ADMIN_EMAIL = "ciptodwihandono@gmail.com";

let firebaseApp = null;
let authInstance = null;
let dbInstance = null;
let sdk = null; // { auth: {...fns}, store: {...fns} }
let initPromise = null;
let cachedProfile = null; // profil pengguna yang sedang login (di-refresh tiap login/approve)

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
  return s.auth.onAuthStateChanged(authInstance, async (user) => {
    if (user) await ensureProfile(user);
    else cachedProfile = null;
    callback(user);
  });
}

export function currentUser() {
  return authInstance ? authInstance.currentUser : null;
}

export async function register(email, password) {
  const s = await loadSdk();
  if (!s) throw new Error("Fitur cloud belum dikonfigurasi.");
  const cred = await s.auth.createUserWithEmailAndPassword(authInstance, email, password);
  await ensureProfile(cred.user);
  return cred.user;
}

export async function login(email, password) {
  const s = await loadSdk();
  if (!s) throw new Error("Fitur cloud belum dikonfigurasi.");
  const cred = await s.auth.signInWithEmailAndPassword(authInstance, email, password);
  await ensureProfile(cred.user);
  return cred.user;
}

export async function logout() {
  const s = await loadSdk();
  cachedProfile = null;
  if (!s) return;
  await s.auth.signOut(authInstance);
}

// ---------- Profil pengguna (persetujuan admin, status gabung tim) ----------
function userDocRef(s, uid) {
  const { doc } = s.store;
  return doc(dbInstance, "users", uid);
}

async function ensureProfile(user) {
  const s = await loadSdk();
  const { getDoc, setDoc } = s.store;
  const ref = userDocRef(s, user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    cachedProfile = { uid: user.uid, ...snap.data() };
    return cachedProfile;
  }
  const isAdmin = user.email === ADMIN_EMAIL;
  const profile = {
    email: user.email,
    role: isAdmin ? "admin" : "member",
    approved: isAdmin,
    shared: false,
    created_at: new Date().toISOString(),
  };
  await setDoc(ref, profile);
  cachedProfile = { uid: user.uid, ...profile };
  return cachedProfile;
}

export async function refreshProfile() {
  const user = currentUser();
  if (!user) {
    cachedProfile = null;
    return null;
  }
  const s = await loadSdk();
  const { getDoc } = s.store;
  const snap = await getDoc(userDocRef(s, user.uid));
  cachedProfile = snap.exists() ? { uid: user.uid, ...snap.data() } : null;
  return cachedProfile;
}

export function getProfile() {
  return cachedProfile;
}

export function isApproved() {
  return !!cachedProfile?.approved;
}

export function isAdmin() {
  return cachedProfile?.role === "admin";
}

export function isShared() {
  return !!cachedProfile?.shared;
}

// ---------- Admin: kelola akun ----------
export async function listAllProfiles() {
  const s = await loadSdk();
  if (!s || !isAdmin()) return [];
  const { collection, getDocs } = s.store;
  const snap = await getDocs(collection(dbInstance, "users"));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

export async function setApproved(uid, approved) {
  const s = await loadSdk();
  if (!s || !isAdmin()) throw new Error("Hanya admin yang bisa melakukan ini.");
  const { updateDoc } = s.store;
  await updateDoc(userDocRef(s, uid), { approved });
}

export async function setShared(uid, shared) {
  const s = await loadSdk();
  if (!s || !isAdmin()) throw new Error("Hanya admin yang bisa melakukan ini.");
  const { updateDoc } = s.store;
  await updateDoc(userDocRef(s, uid), { shared });
}

// ---------- Sinkronisasi catatan ----------
// Privat (default): users/{uid}/catatan -- hanya pemilik akun yang lihat.
// Gabung tim (shared=true, diatur admin): catatan_penandaan -- semua akun
// yang juga digabungkan admin saling melihat.
function recordsCollection(s) {
  const { collection } = s.store;
  const user = currentUser();
  if (isShared()) return collection(dbInstance, SHARED_COLLECTION);
  return collection(dbInstance, "users", user.uid, "catatan");
}

function stripLocalOnlyFields(record) {
  // id (auto-increment lokal) tidak boleh ikut ke cloud; cloud_id dikelola terpisah.
  const { id, cloud_id, ...rest } = record;
  return rest;
}

export async function pushRecord(record) {
  const s = await loadSdk();
  if (!s || !authInstance.currentUser || !isApproved()) return null;
  const { doc, setDoc, serverTimestamp } = s.store;
  const col = recordsCollection(s);
  const ref = record.cloud_id ? doc(col, record.cloud_id) : doc(col);
  await setDoc(ref, {
    ...stripLocalOnlyFields(record),
    owner_email: authInstance.currentUser.email,
    synced_at: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteCloudRecord(cloudId) {
  const s = await loadSdk();
  if (!s || !authInstance.currentUser || !cloudId || !isApproved()) return;
  const { doc, deleteDoc } = s.store;
  await deleteDoc(doc(recordsCollection(s), cloudId));
}

export async function fetchAllCloudRecords() {
  const s = await loadSdk();
  if (!s || !authInstance.currentUser || !isApproved()) return [];
  const { getDocs } = s.store;
  const snap = await getDocs(recordsCollection(s));
  return snap.docs.map((d) => ({ cloud_id: d.id, ...d.data() }));
}

// Utilitas pembersihan darurat (mis. data sampah dari salah impor file
// mentah) -- hapus semua dokumen di koleksi aktif (privat atau tim,
// tergantung status akun saat ini), per 500 (batas batch Firestore).
export async function deleteAllCloudRecords(onProgress) {
  const s = await loadSdk();
  if (!s || !authInstance.currentUser || !isApproved()) return 0;
  const { getDocs, writeBatch, doc } = s.store;
  let deleted = 0;
  while (true) {
    const col = recordsCollection(s);
    const snap = await getDocs(col);
    if (snap.empty) break;
    const chunk = snap.docs.slice(0, 500);
    const batch = writeBatch(dbInstance);
    chunk.forEach((d) => batch.delete(doc(col, d.id)));
    await batch.commit();
    deleted += chunk.length;
    if (onProgress) onProgress(deleted);
  }
  return deleted;
}
