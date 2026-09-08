// Lapisan penyimpanan lokal (IndexedDB) — semua data tersimpan di perangkat,
// sehingga input data tetap berfungsi tanpa koneksi internet.

const DB_NAME = "ringing_burung_db";
const DB_VERSION = 2;
const STORE = "catatan";
const SETTINGS_STORE = "pengaturan";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("nomor_cincin", "nomor_cincin", { unique: false });
        store.createIndex("nama_spesies", "nama_spesies", { unique: false });
        store.createIndex("tanggal", "tanggal", { unique: false });
        store.createIndex("pencincin_pengukur", "pencincin_pengukur", { unique: false });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

function tx(storeName, storeMode) {
  return openDb().then((db) => db.transaction(storeName, storeMode).objectStore(storeName));
}

export async function addRecord(record) {
  const store = await tx(STORE, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function updateRecord(record) {
  const store = await tx(STORE, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteRecord(id) {
  const store = await tx(STORE, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getRecord(id) {
  const store = await tx(STORE, "readonly");
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllRecords() {
  const store = await tx(STORE, "readonly");
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function clearAll() {
  const store = await tx(STORE, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function bulkAdd(records) {
  const store = await tx(STORE, "readwrite");
  return new Promise((resolve, reject) => {
    let count = 0;
    records.forEach((r) => {
      const { id, ...rest } = r;
      const req = store.add(rest);
      req.onsuccess = () => {
        count++;
        if (count === records.length) resolve(count);
      };
      req.onerror = () => reject(req.error);
    });
    if (records.length === 0) resolve(0);
  });
}

// ---------- Pengaturan (key-value, dipakai untuk menyimpan handle folder backup, dll.) ----------
export async function saveSetting(key, value) {
  const store = await tx(SETTINGS_STORE, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put({ key, value });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getSetting(key) {
  const store = await tx(SETTINGS_STORE, "readonly");
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
    req.onerror = () => reject(req.error);
  });
}
