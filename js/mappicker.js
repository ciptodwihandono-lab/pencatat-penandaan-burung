// Modal peta untuk memilih koordinat dengan sentuh/klik, memakai citra
// satelit Esri World Imagery (lebih membantu menandai titik pemasangan
// jaring secara presisi dibanding GPS perangkat saja, terutama di bawah
// kanopi hutan yang bikin GPS kurang akurat). Perlu koneksi internet untuk
// memuat citra petanya -- tidak bisa dipakai offline seperti fitur lain.

let map = null;
let marker = null;
let resolveFn = null;
let picked = null;

function ensureMap() {
  if (map) return map;
  map = L.map("map-picker-map");
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics" }
  ).addTo(map);
  map.on("click", (e) => setPoint(e.latlng.lat, e.latlng.lng));
  return map;
}

function setPoint(lat, lng) {
  if (marker) marker.setLatLng([lat, lng]);
  else marker = L.marker([lat, lng]).addTo(map);
  picked = { lat, lng };
  document.getElementById("map-picker-coord").textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  document.getElementById("map-picker-use-btn").disabled = false;
}

function closeModal(result) {
  document.getElementById("map-picker-modal").hidden = true;
  if (resolveFn) {
    resolveFn(result);
    resolveFn = null;
  }
}

// Kembalikan Promise<{lat, lng} | null> -- null kalau dibatalkan.
export function openMapPicker(initialLat, initialLng) {
  ensureMap();
  marker = null;
  picked = null;
  document.getElementById("map-picker-use-btn").disabled = true;
  document.getElementById("map-picker-coord").textContent = "Belum ada titik dipilih.";
  document.getElementById("map-picker-modal").hidden = false;

  const lat = Number(initialLat);
  const lng = Number(initialLng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
    map.setView([lat, lng], 17);
    setPoint(lat, lng);
  } else {
    map.setView([-2.5, 118], 5); // pusat Indonesia
  }
  // Leaflet butuh ukuran kontainer yang sudah pasti -- modal baru saja
  // ditampilkan (dari hidden), jadi ukurannya perlu di-refresh.
  setTimeout(() => map.invalidateSize(), 0);

  return new Promise((resolve) => {
    resolveFn = resolve;
  });
}

let wired = false;
export function initMapPicker() {
  if (wired) return;
  wired = true;
  document.getElementById("map-picker-close-btn").addEventListener("click", () => closeModal(null));
  document.getElementById("map-picker-cancel-btn").addEventListener("click", () => closeModal(null));
  document.getElementById("map-picker-use-btn").addEventListener("click", () => closeModal(picked));
}
