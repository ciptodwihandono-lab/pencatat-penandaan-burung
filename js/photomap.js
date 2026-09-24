// Tab "Peta" -- unggah foto ber-GPS (mis. foto survei KEHATI), baca lokasi
// dari EXIF-nya, simpan ke IndexedDB, lalu tampilkan sebagai pin di peta
// Leaflet/OpenStreetMap. Foto tanpa data GPS ditolak dengan pesan jelas.

import { readGpsFromJpeg } from "./exif-gps.js";
import { addFoto, getAllFoto, deleteFoto } from "./db.js";
import { latLonToUtm, formatUtm } from "./utm.js";

let map = null;
let markersLayer = null;

// ---------- GPS Saya (posisi perangkat, ditampilkan dalam UTM) ----------
let gpsLayer = null;
let gpsWatchId = null;
let gpsFirstFix = true;
let lastUtmText = "";

function gpsInfoEl() {
  return document.getElementById("peta-gps-info");
}

function showGpsPosition(pos) {
  const { latitude, longitude, accuracy, altitude } = pos.coords;
  const utm = latLonToUtm(latitude, longitude);
  lastUtmText = formatUtm(utm);

  gpsInfoEl().innerHTML = `
    <div class="gps-info-main">${lastUtmText}</div>
    <div>Lat/Lon: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}</div>
    <div>Akurasi: ±${Math.round(accuracy)} m${altitude != null ? ` · Ketinggian: ${Math.round(altitude)} m` : ""}</div>`;
  document.getElementById("peta-gps-copy-btn").hidden = false;

  ensureMap();
  if (!gpsLayer) gpsLayer = L.layerGroup().addTo(map);
  gpsLayer.clearLayers();
  L.circle([latitude, longitude], { radius: accuracy, color: "#2a78d6", weight: 1, fillOpacity: 0.12 }).addTo(gpsLayer);
  L.circleMarker([latitude, longitude], { radius: 8, color: "#fff", weight: 2, fillColor: "#2a78d6", fillOpacity: 1 }).addTo(gpsLayer);
  if (gpsFirstFix) {
    map.setView([latitude, longitude], Math.max(map.getZoom(), 17));
    gpsFirstFix = false;
  } else {
    map.panTo([latitude, longitude]);
  }
}

function showGpsError(err) {
  const reasons = {
    1: "Izin lokasi ditolak. Izinkan akses lokasi untuk aplikasi/browser ini di pengaturan HP.",
    2: "Posisi tidak tersedia. Coba pindah ke area terbuka.",
    3: "Waktu habis saat mencari sinyal GPS. Coba lagi di area terbuka.",
  };
  gpsInfoEl().textContent = reasons[err.code] || "Gagal mengambil GPS: " + err.message;
}

function fetchGpsOnce() {
  if (!navigator.geolocation) {
    gpsInfoEl().textContent = "Perangkat ini tidak mendukung GPS.";
    return;
  }
  gpsInfoEl().textContent = "Mencari sinyal GPS...";
  gpsFirstFix = true;
  navigator.geolocation.getCurrentPosition(showGpsPosition, showGpsError, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
}

function startGpsWatch() {
  if (!navigator.geolocation || gpsWatchId !== null) return;
  gpsInfoEl().textContent = "Mencari sinyal GPS...";
  gpsFirstFix = true;
  gpsWatchId = navigator.geolocation.watchPosition(showGpsPosition, showGpsError, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
}

// Dipanggil juga saat pindah dari tab Peta, supaya GPS tidak terus menyala
// (boros baterai) kalau pengguna sudah meninggalkan halaman ini.
export function stopGpsWatch() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
  const live = document.getElementById("peta-gps-live");
  if (live) live.checked = false;
}

function initGpsPanel() {
  const btn = document.getElementById("peta-gps-btn");
  if (!btn || btn._wired) return;
  btn._wired = true;

  btn.addEventListener("click", fetchGpsOnce);

  document.getElementById("peta-gps-live").addEventListener("change", (e) => {
    if (e.target.checked) startGpsWatch();
    else stopGpsWatch();
  });

  const copyBtn = document.getElementById("peta-gps-copy-btn");
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(lastUtmText);
      copyBtn.textContent = "Tersalin ✓";
    } catch (err) {
      copyBtn.textContent = "Gagal menyalin";
    }
    setTimeout(() => (copyBtn.textContent = "Salin UTM"), 1500);
  });

  // Otomatis ambil GPS begitu tab dibuka -- hanya kalau izin lokasi sudah
  // pernah diberikan, supaya tidak memunculkan permintaan izin tiba-tiba.
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        if (status.state === "granted") fetchGpsOnce();
      })
      .catch(() => {});
  }
}

function ensureMap() {
  if (map) return map;
  map = L.map("peta-map").setView([-2.5, 118], 5); // pusat Indonesia
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
  return map;
}

function formatTanggal(dateTimeOriginal) {
  if (!dateTimeOriginal) return "";
  // Format EXIF: "YYYY:MM:DD HH:MM:SS"
  const m = dateTimeOriginal.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}:\d{2}:\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}` : dateTimeOriginal;
}

async function renderMarkers() {
  const fotos = await getAllFoto();
  markersLayer.clearLayers();
  const bounds = [];
  fotos.forEach((foto) => {
    const url = URL.createObjectURL(foto.blob);
    const marker = L.marker([foto.latitude, foto.longitude]);
    const popup = document.createElement("div");
    popup.className = "peta-popup";
    popup.innerHTML = `
      <img src="${url}" alt="${escapeHtml(foto.filename)}" class="peta-popup-img" />
      <p class="peta-popup-name">${escapeHtml(foto.filename)}</p>
      ${foto.dateTimeOriginal ? `<p class="peta-popup-date">${escapeHtml(formatTanggal(foto.dateTimeOriginal))}</p>` : ""}
      <p class="peta-popup-coord">${foto.latitude.toFixed(6)}, ${foto.longitude.toFixed(6)}</p>
      <button type="button" class="btn btn-danger btn-small" data-delete-foto="${foto.id}">Hapus</button>
    `;
    marker.bindPopup(popup);
    marker.addTo(markersLayer);
    bounds.push([foto.latitude, foto.longitude]);
  });
  if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
  return fotos;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function setStatus(msg) {
  const el = document.getElementById("peta-upload-status");
  if (el) el.textContent = msg;
}

async function handleFiles(fileList) {
  const files = Array.from(fileList).filter((f) => /image\/jpe?g/i.test(f.type) || /\.jpe?g$/i.test(f.name));
  const skipped = fileList.length - files.length;
  let added = 0;
  let noGps = 0;

  for (const file of files) {
    setStatus(`Memproses ${file.name}...`);
    let gps;
    try {
      gps = await readGpsFromJpeg(file);
    } catch (err) {
      gps = null;
    }
    if (!gps) {
      noGps++;
      continue;
    }
    await addFoto({
      filename: file.name,
      blob: file,
      latitude: gps.latitude,
      longitude: gps.longitude,
      dateTimeOriginal: gps.dateTimeOriginal,
      addedAt: new Date().toISOString(),
    });
    added++;
  }

  await renderMarkers();

  const parts = [];
  if (added) parts.push(`${added} foto ditambahkan ke peta`);
  if (noGps) parts.push(`${noGps} foto tanpa data lokasi GPS dilewati`);
  if (skipped) parts.push(`${skipped} file bukan JPEG dilewati`);
  setStatus(parts.length ? parts.join(", ") + "." : "Tidak ada foto yang diproses.");
}

export function initPhotoMapView() {
  ensureMap();
  // Leaflet butuh ukuran kontainer yang sudah pasti -- refresh ukuran tiap
  // kali tab ini dibuka (kontainer sebelumnya bisa hidden=true, jadi 0x0).
  setTimeout(() => map.invalidateSize(), 0);
  renderMarkers();
  initGpsPanel();

  const input = document.getElementById("peta-file-input");
  if (input && !input._wired) {
    input._wired = true;
    input.addEventListener("change", async (e) => {
      if (e.target.files.length) await handleFiles(e.target.files);
      e.target.value = "";
    });
  }

  const mapEl = document.getElementById("peta-map");
  if (mapEl && !mapEl._wiredDelete) {
    mapEl._wiredDelete = true;
    mapEl.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-delete-foto]");
      if (!btn) return;
      const id = Number(btn.dataset.deleteFoto);
      await deleteFoto(id);
      await renderMarkers();
      setStatus("Foto dihapus dari peta.");
    });
  }
}
