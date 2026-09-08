// Backup otomatis ke folder lokal yang disinkronkan cloud (mis. folder
// "Google Drive" atau "OneDrive" milik Google Drive/OneDrive Desktop).
// Memakai File System Access API (Chrome/Edge) — tidak perlu login/OAuth,
// karena upload ke cloud dilakukan oleh aplikasi sinkronisasi yang sudah
// berjalan di komputer, bukan oleh aplikasi ini.

import { getSetting, saveSetting } from "./db.js";
import { recordsToCsv } from "./export.js";

const HANDLE_KEY = "backup_folder_handle";
const AUTO_BACKUP_KEY = "auto_backup_enabled";

export function isSupported() {
  return typeof window.showDirectoryPicker === "function";
}

export async function pickBackupFolder() {
  if (!isSupported()) {
    throw new Error("Browser ini tidak mendukung pemilihan folder (butuh Chrome/Edge versi terbaru).");
  }
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  await saveSetting(HANDLE_KEY, handle);
  return handle;
}

export async function getBackupFolder() {
  return getSetting(HANDLE_KEY);
}

export async function clearBackupFolder() {
  await saveSetting(HANDLE_KEY, undefined);
}

export async function isAutoBackupEnabled() {
  const v = await getSetting(AUTO_BACKUP_KEY);
  return !!v;
}

export async function setAutoBackupEnabled(enabled) {
  await saveSetting(AUTO_BACKUP_KEY, enabled);
}

async function ensurePermission(handle) {
  const opts = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  if ((await handle.requestPermission(opts)) === "granted") return true;
  return false;
}

async function writeFile(dirHandle, filename, content) {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function runBackup(records) {
  const handle = await getBackupFolder();
  if (!handle) throw new Error("Belum ada folder backup yang dipilih.");
  const ok = await ensurePermission(handle);
  if (!ok) throw new Error("Izin akses folder backup ditolak/dicabut. Pilih ulang folder backup.");

  const csv = "﻿" + recordsToCsv(records);
  const json = JSON.stringify(records, null, 2);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  await writeFile(handle, `ringing-backup-${stamp}.csv`, csv);
  await writeFile(handle, "ringing-backup-terbaru.json", json);
  return { count: records.length, folderName: handle.name, timestamp: stamp };
}
