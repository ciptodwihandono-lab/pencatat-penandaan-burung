// Lapisan penyimpanan lokal (IndexedDB) — semua data tersimpan di perangkat,
// sehingga input data tetap berfungsi tanpa koneksi internet.

const DB_NAME = "ringing_burung_db";
const DB_VERSION = 4;
const STORE = "catatan";
const SETTINGS_STORE = "pengaturan";
const LOGNET_STORE = "log_banding";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const tx = e.target.transaction;
      let store;
      if (!db.objectStoreNames.contains(STORE)) {
        store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("nomor_cincin", "nomor_cincin", { unique: false });
        store.createIndex("nama_spesies", "nama_spesies", { unique: false });
        store.createIndex("tanggal", "tanggal", { unique: false });
        store.createIndex("pencincin_pengukur", "pencincin_pengukur", { unique: false });
      } else {
        store = tx.objectStore(STORE);
      }
      if (!store.indexNames.contains("cloud_id")) {
        store.createIndex("cloud_id", "cloud_id", { unique: false });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(LOGNET_STORE)) {
        const lognetStore = db.createObjectStore(LOGNET_STORE, { keyPath: "id", autoIncrement: true });
        lognetStore.createIndex("net_tanggal", "net_tanggal", { unique: false });
        lognetStore.createIndex("net_lokasi", "net_lokasi", { unique: false });
        lognetStore.createIndex("net_kode", "net_kode", { unique: false });
      }
    };
    req.onsuccess = (e) => {
      const db = e.target.result;
      // Kalau tab lain minta upgrade versi (mis. setelah update aplikasi),
      // tutup koneksi ini supaya tab itu tidak macet menunggu, alih-alih
      // membiarkan tab lain hang tanpa batas waktu.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = (e) => reject(e.target.error);
    req.onblocked = () => {
      console.warn("Pembukaan database tertunda -- tutup tab lain aplikasi ini lalu muat ulang.");
    };
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

// ---------- Log Mist Net (Log Banding) — penyimpanan terpisah ----------
export async function addLognet(record) {
  const store = await tx(LOGNET_STORE, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function updateLognet(record) {
  const store = await tx(LOGNET_STORE, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteLognet(id) {
  const store = await tx(LOGNET_STORE, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getLognet(id) {
  const store = await tx(LOGNET_STORE, "readonly");
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllLognet() {
  const store = await tx(LOGNET_STORE, "readonly");
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function clearAllLognet() {
  const store = await tx(LOGNET_STORE, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function bulkAddLognet(records) {
  const store = await tx(LOGNET_STORE, "readwrite");
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

// ---------- Bantu sinkronisasi cloud ----------
export async function getUnsyncedRecords() {
  const all = await getAllRecords();
  return all.filter((r) => !r.cloud_id);
}

export async function findByCloudId(cloudId) {
  const store = await tx(STORE, "readonly");
  return new Promise((resolve, reject) => {
    const req = store.index("cloud_id").get(cloudId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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
