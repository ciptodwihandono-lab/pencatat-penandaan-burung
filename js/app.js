import { FIELDS, SECTIONS } from "./fields.js";
import { addRecord, updateRecord, deleteRecord, getRecord, getAllRecords, bulkAdd, clearAll, getUnsyncedRecords, findByCloudId } from "./db.js";
import { downloadCsv, csvToRecords, downloadKml, downloadGpx } from "./export.js";
import { latLonToUtm, formatUtm } from "./utm.js";
import * as backup from "./backup.js";
import { barChartHorizontal, lineChartTrend, barChartCategorical, topCounts, monthlyTrend } from "./charts.js";
import * as cloud from "./cloud.js";

const state = {
  view: "list",
  records: [],
  editingId: null,
  detailId: null,
  photoDataUrl: null,
};

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toast.hidden = true), 3200);
}

function setView(view) {
  state.view = view;
  document.querySelectorAll(".view").forEach((el) => (el.hidden = true));
  const map = { list: "view-list", form: "view-form", detail: "view-detail", stats: "view-stats", tools: "view-tools", akun: "view-akun", admin: "view-admin" };
  document.getElementById(map[view]).hidden = false;
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.view === "form") openForm(null);
    else setView(btn.dataset.view);
    if (btn.dataset.view === "stats") renderStats();
    if (btn.dataset.view === "tools") refreshBackupUi();
    if (btn.dataset.view === "akun") renderAkunUi();
    if (btn.dataset.view === "admin") renderAdminUi();
  });
});

// ---------- Data loading ----------
async function reload() {
  state.records = await getAllRecords();
  state.records.sort((a, b) => (b.tanggal || "").localeCompare(a.tanggal || "") || (b.id - a.id));
  renderList();
  renderSpeciesFilter();
  renderLokasiFilter();
}

// ---------- List view ----------
function renderSpeciesFilter() {
  const sel = document.getElementById("filter-species");
  const current = sel.value;
  const species = [...new Set(state.records.map((r) => r.nama_spesies).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Semua spesies</option>' + species.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  sel.value = current;
}

function renderLokasiFilter() {
  const sel = document.getElementById("filter-lokasi");
  const current = sel.value;
  const lokasi = [...new Set(state.records.map((r) => r.kode_lokasi).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Semua lokasi</option>' + lokasi.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join("");
  sel.value = current;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function matchesFilters(r, query, species, lokasi) {
  if (species && r.nama_spesies !== species) return false;
  if (lokasi && r.kode_lokasi !== lokasi) return false;
  if (!query) return true;
  const q = query.toLowerCase();
  return ["nomor_cincin", "nama_spesies", "kode_lokasi", "pencincin_pengukur", "catat"].some((k) => (r[k] || "").toLowerCase().includes(q));
}

function isRetrap(r) {
  return /^(y|ya|r|retrap)/i.test((r.retrap || "").trim());
}

function badgeFor(r) {
  return isRetrap(r) ? '<span class="badge badge-recapture">Retrap</span>' : '<span class="badge">Baru</span>';
}

function recordCardHtml(r) {
  return `
    <div class="record-card" data-id="${r.id}">
      <div class="record-main">
        <strong>${escapeHtml(r.nama_spesies || "(spesies belum diisi)")}</strong> — ${escapeHtml(r.nomor_cincin || "-")}
        <div class="record-sub">${escapeHtml(r.tanggal || "-")} ${escapeHtml(r.waktu || "")} &middot; ${escapeHtml(r.kode_lokasi || "-")} &middot; ${escapeHtml(r.pencincin_pengukur || "-")}</div>
      </div>
      ${badgeFor(r)}
    </div>`;
}

function renderList() {
  const query = document.getElementById("search-box").value.trim();
  const species = document.getElementById("filter-species").value;
  const lokasi = document.getElementById("filter-lokasi").value;
  const groupByLokasi = document.getElementById("group-by-lokasi-toggle").checked;
  const filtered = state.records.filter((r) => matchesFilters(r, query, species, lokasi));
  document.getElementById("record-count").textContent = `${filtered.length} dari ${state.records.length} catatan`;

  const container = document.getElementById("list-container");
  if (filtered.length === 0) {
    container.innerHTML = '<p class="empty-state">Belum ada data yang cocok. Klik "+ Tambah Data" untuk mulai mencatat.</p>';
    return;
  }

  if (!groupByLokasi) {
    container.innerHTML = filtered.map(recordCardHtml).join("");
  } else {
    const groups = new Map();
    filtered.forEach((r) => {
      const key = r.kode_lokasi || "(lokasi belum diisi)";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    const sortedKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b, "id"));
    container.innerHTML = sortedKeys
      .map((key) => {
        const recs = groups.get(key);
        return `<div class="lokasi-group">
          <div class="lokasi-group-header"><span>${escapeHtml(key)}</span><span class="lokasi-group-count">${recs.length} catatan</span></div>
          ${recs.map(recordCardHtml).join("")}
        </div>`;
      })
      .join("");
  }

  container.querySelectorAll(".record-card").forEach((card) => {
    card.addEventListener("click", () => openDetail(Number(card.dataset.id)));
  });
}

document.getElementById("search-box").addEventListener("input", renderList);
document.getElementById("filter-species").addEventListener("change", renderList);
document.getElementById("filter-lokasi").addEventListener("change", renderList);
document.getElementById("group-by-lokasi-toggle").addEventListener("change", renderList);

// ---------- Form view ----------
function fieldHtml(f) {
  const req = f.required ? '<span class="req"> *</span>' : "";
  const hint = f.hint ? `<div class="field-hint">${escapeHtml(f.hint)}</div>` : "";
  let input;
  if (f.type === "textarea") {
    input = `<textarea id="f_${f.key}" name="${f.key}"></textarea>`;
  } else if (f.type === "suggest") {
    input = `<input id="f_${f.key}" type="text" name="${f.key}" list="dl_${f.key}" autocomplete="off" /><datalist id="dl_${f.key}">${f.options.map((o) => `<option value="${escapeHtml(o)}">`).join("")}</datalist>`;
  } else {
    const extra = [
      f.step !== undefined ? `step="${f.step}"` : "",
      f.min !== undefined ? `min="${f.min}"` : "",
      f.max !== undefined ? `max="${f.max}"` : "",
    ].join(" ");
    input = `<input id="f_${f.key}" type="${f.type}" name="${f.key}" ${extra} />`;
  }
  return `<div class="field${f.type === "textarea" ? " full" : ""}"><label for="f_${f.key}">${escapeHtml(f.label)}${req}</label>${input}${hint}</div>`;
}

function buildForm() {
  const form = document.getElementById("record-form");
  const sectionsHtml = SECTIONS.map((sec) => {
    const fields = FIELDS.filter((f) => f.section === sec.key).map(fieldHtml).join("");
    let extra = "";
    if (sec.key === "gps") {
      extra = `<div class="field"><label>&nbsp;</label><button type="button" id="gps-btn" class="btn">📍 Ambil Lokasi GPS Sekarang</button></div>
        <div class="field full"><label>Koordinat UTM (otomatis, untuk UTM Geo Map)</label><div id="utm-preview" class="utm-preview">Isi latitude/longitude untuk melihat koordinat UTM.</div></div>`;
    }
    if (sec.key === "tambahan") {
      extra = `<div class="field full"><label>Lampirkan Foto (opsional, tambahan digital selain kolom "Photo")</label><input type="file" id="f_foto" accept="image/*" capture="environment" /><img id="photo-preview" class="photo-preview" hidden /></div>`;
    }
    return `<div class="form-section"><h3>${escapeHtml(sec.title)}</h3><div class="form-grid">${fields}${extra}</div></div>`;
  }).join("");
  form.innerHTML =
    sectionsHtml +
    `<div class="form-actions">
      <button type="submit" class="btn btn-primary">Simpan Catatan</button>
      <button type="button" id="form-cancel-btn" class="btn btn-ghost">Batal</button>
    </div>`;

  document.getElementById("gps-btn").addEventListener("click", fetchGps);
  document.getElementById("f_foto").addEventListener("change", handlePhotoInput);
  document.getElementById("form-cancel-btn").addEventListener("click", () => setView("list"));
  form.addEventListener("submit", handleFormSubmit);
  document.getElementById("f_latitude").addEventListener("input", updateUtmPreview);
  document.getElementById("f_longitude").addEventListener("input", updateUtmPreview);
}

function updateUtmPreview() {
  const lat = document.getElementById("f_latitude").value;
  const lon = document.getElementById("f_longitude").value;
  const preview = document.getElementById("utm-preview");
  const utm = latLonToUtm(lat, lon);
  preview.textContent = utm ? formatUtm(utm) : "Isi latitude/longitude untuk melihat koordinat UTM.";
}

function fetchGps() {
  if (!navigator.geolocation) {
    showToast("Perangkat ini tidak mendukung GPS.");
    return;
  }
  showToast("Mengambil lokasi GPS...");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById("f_latitude").value = pos.coords.latitude.toFixed(6);
      document.getElementById("f_longitude").value = pos.coords.longitude.toFixed(6);
      if (pos.coords.altitude) document.getElementById("f_ketinggian_m").value = Math.round(pos.coords.altitude);
      updateUtmPreview();
      showToast("Lokasi GPS berhasil diambil.");
    },
    (err) => showToast("Gagal mengambil GPS: " + err.message),
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function handlePhotoInput(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.photoDataUrl = reader.result;
    const img = document.getElementById("photo-preview");
    img.src = state.photoDataUrl;
    img.hidden = false;
  };
  reader.readAsDataURL(file);
}

function openForm(id) {
  state.editingId = id;
  state.photoDataUrl = null;
  buildForm();
  document.getElementById("form-title").textContent = id ? "Edit Catatan Penandaan" : "Tambah Catatan Penandaan";

  if (id) {
    getRecord(id).then((rec) => {
      if (!rec) return;
      FIELDS.forEach((f) => {
        const el = document.getElementById(`f_${f.key}`);
        if (el && rec[f.key] !== undefined) el.value = rec[f.key];
      });
      if (rec.foto) {
        state.photoDataUrl = rec.foto;
        const img = document.getElementById("photo-preview");
        img.src = rec.foto;
        img.hidden = false;
      }
      updateUtmPreview();
    });
  } else {
    const today = new Date();
    document.getElementById("f_tanggal").value = today.toISOString().slice(0, 10);
    document.getElementById("f_waktu").value = today.toTimeString().slice(0, 5);
  }
  setView("form");
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const record = {};
  let missing = [];
  FIELDS.forEach((f) => {
    const el = document.getElementById(`f_${f.key}`);
    const val = el ? el.value.trim() : "";
    if (f.required && !val) missing.push(f.label);
    record[f.key] = f.type === "number" ? (val === "" ? "" : Number(val)) : val;
  });
  if (missing.length) {
    showToast("Lengkapi dulu: " + missing.join(", "));
    return;
  }
  const utm = latLonToUtm(record.latitude, record.longitude);
  record.utm_zone = utm ? utm.zone : "";
  record.utm_hemisphere = utm ? utm.hemisphere : "";
  record.utm_easting = utm ? utm.easting : "";
  record.utm_northing = utm ? utm.northing : "";

  if (state.photoDataUrl) record.foto = state.photoDataUrl;
  const now = new Date().toISOString();
  record.updated_at = now;

  let savedId;
  try {
    if (state.editingId) {
      record.id = state.editingId;
      const existing = await getRecord(state.editingId);
      record.created_at = existing?.created_at || now;
      if (existing?.cloud_id) record.cloud_id = existing.cloud_id;
      await updateRecord(record);
      savedId = state.editingId;
      showToast("Catatan berhasil diperbarui.");
    } else {
      record.created_at = now;
      savedId = await addRecord(record);
      showToast("Catatan berhasil disimpan.");
    }
  } catch (err) {
    showToast("Gagal menyimpan: " + err.message);
    return;
  }
  await reload();
  setView("list");
  maybeAutoBackup();
  maybeCloudPush(savedId);
}

async function maybeCloudPush(id) {
  if (!cloud.currentUser()) return;
  try {
    const rec = await getRecord(id);
    const cloudId = await cloud.pushRecord(rec);
    if (cloudId && cloudId !== rec.cloud_id) {
      await updateRecord({ ...rec, cloud_id: cloudId });
    }
  } catch (err) {
    showToast("Sinkron ke cloud gagal (tersimpan lokal): " + err.message);
  }
}

async function maybeAutoBackup() {
  try {
    if (await backup.isAutoBackupEnabled()) {
      const folder = await backup.getBackupFolder();
      if (!folder) return;
      const result = await backup.runBackup(state.records);
      showToast(`Backup otomatis tersimpan ke folder "${result.folderName}".`);
    }
  } catch (err) {
    showToast("Backup otomatis gagal: " + err.message);
  }
}

// ---------- Detail view ----------
async function openDetail(id) {
  state.detailId = id;
  const rec = await getRecord(id);
  if (!rec) return;
  const container = document.getElementById("detail-container");
  const photo = rec.foto ? `<img src="${rec.foto}" class="photo-preview" style="max-width:280px;max-height:280px" />` : "";
  const utmLine =
    rec.utm_zone !== undefined && rec.utm_zone !== ""
      ? `<div class="detail-item"><dt>Koordinat UTM</dt><dd>${escapeHtml(formatUtm({ zone: rec.utm_zone, hemisphere: rec.utm_hemisphere, easting: rec.utm_easting, northing: rec.utm_northing }))}</dd></div>`
      : "";
  container.innerHTML =
    `<h2>${escapeHtml(rec.nama_spesies || "(tanpa nama)")} ${badgeFor(rec)}</h2><dl class="detail-grid">` +
    FIELDS.filter((f) => rec[f.key] !== undefined && rec[f.key] !== "")
      .map((f) => `<div class="detail-item"><dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(rec[f.key])}</dd></div>`)
      .join("") +
    utmLine +
    `</dl>${photo}`;
  setView("detail");
}

document.getElementById("detail-back-btn").addEventListener("click", () => setView("list"));
document.getElementById("detail-edit-btn").addEventListener("click", () => openForm(state.detailId));
document.getElementById("detail-delete-btn").addEventListener("click", async () => {
  if (!confirm("Hapus catatan ini secara permanen?")) return;
  const rec = await getRecord(state.detailId);
  await deleteRecord(state.detailId);
  if (rec?.cloud_id && cloud.currentUser()) {
    cloud.deleteCloudRecord(rec.cloud_id).catch((err) => showToast("Gagal hapus di cloud: " + err.message));
  }
  await reload();
  showToast("Catatan dihapus.");
  setView("list");
});

// ---------- Stats view ----------
function renderStats() {
  const recs = state.records;
  const container = document.getElementById("stats-container");
  const total = recs.length;
  const bySpecies = {};
  const byLokasi = {};
  let baru = 0;
  let retrap = 0;
  const byRinger = {};
  recs.forEach((r) => {
    if (r.nama_spesies) bySpecies[r.nama_spesies] = (bySpecies[r.nama_spesies] || 0) + 1;
    if (r.kode_lokasi) byLokasi[r.kode_lokasi] = (byLokasi[r.kode_lokasi] || 0) + 1;
    if (isRetrap(r)) retrap++;
    else baru++;
    if (r.pencincin_pengukur) byRinger[r.pencincin_pengukur] = (byRinger[r.pencincin_pengukur] || 0) + 1;
  });
  const topSpecies = Object.entries(bySpecies).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topLokasi = Object.entries(byLokasi).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topRinger = Object.entries(byRinger).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const speciesChartData = topCounts(recs, "nama_spesies", 10).sort((a, b) => a.value - b.value);
  const lokasiChartData = topCounts(recs, "kode_lokasi", 10).sort((a, b) => a.value - b.value);
  const trendData = monthlyTrend(recs);
  const ageData = topCounts(recs, "umur", 6);
  const sexData = topCounts(recs, "kelamin", 6);

  container.innerHTML = `
    <div class="stat-card"><div class="num">${total}</div><div class="label">Total Catatan</div></div>
    <div class="stat-card"><div class="num">${baru}</div><div class="label">Tangkap Baru</div></div>
    <div class="stat-card"><div class="num">${retrap}</div><div class="label">Retrap</div></div>
    <div class="stat-card"><div class="num">${Object.keys(bySpecies).length}</div><div class="label">Jumlah Spesies</div></div>
    <div class="stat-card"><div class="num">${Object.keys(byLokasi).length}</div><div class="label">Jumlah Lokasi</div></div>

    <div class="stat-card wide chart-card">
      <div class="label">Grafik: 10 Spesies Terbanyak</div>
      ${barChartHorizontal(speciesChartData)}
      <p class="chart-caption">Jumlah individu tercatat per spesies (10 tertinggi).</p>
    </div>

    <div class="stat-card wide chart-card">
      <div class="label">Grafik: Tren Penangkapan per Bulan</div>
      ${lineChartTrend(trendData)}
      <p class="chart-caption">Jumlah catatan penandaan per bulan, seluruh periode data.</p>
    </div>

    <div class="stat-card wide chart-card">
      <div class="label">Grafik: 10 Lokasi Terbanyak</div>
      ${barChartHorizontal(lokasiChartData)}
      <p class="chart-caption">Jumlah catatan per kode lokasi (10 tertinggi).</p>
    </div>

    <div class="chart-row wide">
      <div class="stat-card chart-card">
        <div class="label">Grafik: Komposisi Umur</div>
        ${barChartCategorical(ageData)}
      </div>
      <div class="stat-card chart-card">
        <div class="label">Grafik: Komposisi Jenis Kelamin</div>
        ${barChartCategorical(sexData)}
      </div>
    </div>

    <div class="stat-card wide">
      <div class="label">Tabel: Spesies Terbanyak</div>
      <ul class="stat-list">${topSpecies.map(([k, v]) => `<li><span>${escapeHtml(k)}</span><strong>${v}</strong></li>`).join("") || "<li>Belum ada data</li>"}</ul>
    </div>
    <div class="stat-card wide">
      <div class="label">Tabel: Lokasi Terbanyak</div>
      <ul class="stat-list">${topLokasi.map(([k, v]) => `<li><span>${escapeHtml(k)}</span><strong>${v}</strong></li>`).join("") || "<li>Belum ada data</li>"}</ul>
    </div>
    <div class="stat-card wide">
      <div class="label">Pencincin/Pengukur Paling Aktif</div>
      <ul class="stat-list">${topRinger.map(([k, v]) => `<li><span>${escapeHtml(k)}</span><strong>${v}</strong></li>`).join("") || "<li>Belum ada data</li>"}</ul>
    </div>
  `;
}

// ---------- Tools view: ekspor ----------
document.getElementById("export-btn").addEventListener("click", async () => {
  const recs = await getAllRecords();
  if (recs.length === 0) return showToast("Belum ada data untuk diekspor.");
  downloadCsv(recs);
  showToast(`Mengekspor ${recs.length} catatan ke CSV.`);
});

document.getElementById("export-kml-btn").addEventListener("click", async () => {
  const recs = await getAllRecords();
  const n = downloadKml(recs);
  showToast(n > 0 ? `Mengekspor ${n} titik ke KML (Google Earth).` : "Belum ada catatan dengan koordinat GPS.");
});

document.getElementById("export-gpx-btn").addEventListener("click", async () => {
  const recs = await getAllRecords();
  const n = downloadGpx(recs);
  showToast(n > 0 ? `Mengekspor ${n} titik ke GPX (GPS/UTM Geo Map).` : "Belum ada catatan dengan koordinat GPS.");
});

document.getElementById("import-btn").addEventListener("click", async () => {
  const fileInput = document.getElementById("import-file");
  const status = document.getElementById("import-status");
  const file = fileInput.files[0];
  if (!file) {
    status.textContent = "Pilih file CSV terlebih dahulu.";
    return;
  }
  const text = await file.text();
  const records = csvToRecords(text);
  const cleaned = records.map((r) => {
    const out = { ...r };
    FIELDS.forEach((f) => {
      if (f.type === "number" && out[f.key] !== "" && out[f.key] !== undefined) {
        out[f.key] = Number(out[f.key]);
      }
    });
    return out;
  });
  await bulkAdd(cleaned);
  status.textContent = `${cleaned.length} catatan berhasil diimpor.`;
  await reload();
  showToast(`${cleaned.length} catatan diimpor.`);
});

// ---------- Tools view: backup ----------
async function refreshBackupUi() {
  const statusEl = document.getElementById("backup-folder-status");
  const toggle = document.getElementById("auto-backup-toggle");
  if (!backup.isSupported()) {
    statusEl.textContent = "Browser ini tidak mendukung pemilihan folder backup (butuh Chrome/Edge terbaru di desktop).";
    document.getElementById("pick-backup-folder-btn").disabled = true;
    document.getElementById("run-backup-btn").disabled = true;
    toggle.disabled = true;
    return;
  }
  const folder = await backup.getBackupFolder();
  statusEl.textContent = folder ? `Folder backup terpilih: "${folder.name}".` : "Belum ada folder backup yang dipilih.";
  toggle.checked = await backup.isAutoBackupEnabled();
}

document.getElementById("pick-backup-folder-btn").addEventListener("click", async () => {
  try {
    const handle = await backup.pickBackupFolder();
    showToast(`Folder backup diset ke "${handle.name}".`);
    await refreshBackupUi();
  } catch (err) {
    showToast("Gagal memilih folder: " + err.message);
  }
});

document.getElementById("run-backup-btn").addEventListener("click", async () => {
  try {
    const recs = await getAllRecords();
    const result = await backup.runBackup(recs);
    document.getElementById("backup-status").textContent = `Backup berhasil: ${result.count} catatan disimpan ke folder "${result.folderName}" (${result.timestamp}).`;
    showToast("Backup berhasil.");
  } catch (err) {
    document.getElementById("backup-status").textContent = "Backup gagal: " + err.message;
    showToast("Backup gagal: " + err.message);
  }
});

document.getElementById("auto-backup-toggle").addEventListener("change", async (e) => {
  await backup.setAutoBackupEnabled(e.target.checked);
  showToast(e.target.checked ? "Backup otomatis diaktifkan." : "Backup otomatis dimatikan.");
});

document.getElementById("clear-all-btn").addEventListener("click", async () => {
  if (!confirm("Yakin ingin menghapus SEMUA data di perangkat ini? Tindakan ini tidak bisa dibatalkan.")) return;
  await clearAll();
  await reload();
  showToast("Semua data telah dihapus.");
});

// ---------- Akun & sinkronisasi cloud ----------
let akunBusy = false;

async function renderAkunUi() {
  const notConfigured = document.getElementById("akun-not-configured");
  const loggedIn = document.getElementById("akun-logged-in");
  const user = cloud.currentUser();
  if (user) {
    notConfigured.hidden = true;
    loggedIn.hidden = false;
    document.getElementById("akun-email-display").textContent = user.email;
    document.getElementById("akun-shared-display").textContent = cloud.isShared()
      ? "Gabung Tim (data digabung dengan akun tim lain yang juga digabungkan admin)"
      : "Privat (hanya Anda yang lihat)";
  } else {
    notConfigured.hidden = !cloud.isEnabled() ? false : true;
    loggedIn.hidden = true;
  }
  document.getElementById("nav-admin").hidden = !cloud.isAdmin();
  document.getElementById("header-logout-btn").hidden = !(cloud.isEnabled() && user);
}

// ---------- Gerbang login (wajib, tampil sebelum masuk ke aplikasi) ----------
function showApp() {
  document.getElementById("auth-gate").hidden = true;
  document.getElementById("app-header").hidden = false;
  document.getElementById("app").hidden = false;
}

function showGate() {
  document.getElementById("auth-gate").hidden = false;
  document.getElementById("app-header").hidden = true;
  document.getElementById("app").hidden = true;
  document.getElementById("gate-checking").hidden = true;
  document.getElementById("gate-error").hidden = true;
  document.getElementById("gate-pending").hidden = true;
  document.getElementById("gate-login-form").hidden = false;
  document.getElementById("gate-login-form").reset();
  document.getElementById("gate-status").textContent = "";
}

function showGateError(message) {
  document.getElementById("auth-gate").hidden = false;
  document.getElementById("app-header").hidden = true;
  document.getElementById("app").hidden = true;
  document.getElementById("gate-checking").hidden = true;
  document.getElementById("gate-login-form").hidden = true;
  document.getElementById("gate-pending").hidden = true;
  document.getElementById("gate-error").hidden = false;
  document.getElementById("gate-error-message").textContent = message;
}

function showPendingApproval(email) {
  document.getElementById("auth-gate").hidden = false;
  document.getElementById("app-header").hidden = true;
  document.getElementById("app").hidden = true;
  document.getElementById("gate-checking").hidden = true;
  document.getElementById("gate-error").hidden = true;
  document.getElementById("gate-login-form").hidden = true;
  document.getElementById("gate-pending").hidden = false;
  document.getElementById("gate-pending-email").textContent = email;
}

document.getElementById("gate-login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (akunBusy) return;
  akunBusy = true;
  const email = document.getElementById("gate-email").value.trim();
  const password = document.getElementById("gate-password").value;
  const status = document.getElementById("gate-status");
  try {
    status.textContent = "Memproses login...";
    await cloud.login(email, password);
    status.textContent = "";
  } catch (err) {
    status.textContent = "Gagal masuk: " + err.message;
  } finally {
    akunBusy = false;
  }
});

document.getElementById("gate-register-btn").addEventListener("click", async () => {
  if (akunBusy) return;
  akunBusy = true;
  const email = document.getElementById("gate-email").value.trim();
  const password = document.getElementById("gate-password").value;
  const status = document.getElementById("gate-status");
  if (!email || password.length < 6) {
    status.textContent = "Isi email dan password (minimal 6 karakter) dulu.";
    akunBusy = false;
    return;
  }
  try {
    status.textContent = "Mendaftarkan akun...";
    await cloud.register(email, password);
    status.textContent = "";
  } catch (err) {
    status.textContent = "Gagal daftar: " + err.message;
  } finally {
    akunBusy = false;
  }
});

async function syncAll(silent) {
  if (!cloud.currentUser()) return;
  const syncStatus = document.getElementById("akun-sync-status");
  try {
    if (!silent && syncStatus) syncStatus.textContent = "Menyinkronkan data...";

    const unsynced = await getUnsyncedRecords();
    for (const rec of unsynced) {
      const cloudId = await cloud.pushRecord(rec);
      if (cloudId) await updateRecord({ ...rec, cloud_id: cloudId });
    }

    const cloudRecords = await cloud.fetchAllCloudRecords();
    let pulled = 0;
    for (const cr of cloudRecords) {
      const existing = await findByCloudId(cr.cloud_id);
      if (existing) continue;
      const { cloud_id, synced_at, owner_email, ...rest } = cr;
      await addRecord({ ...rest, cloud_id, owner_email });
      pulled++;
    }

    await reload();
    const msg = `Sinkron selesai: ${unsynced.length} terkirim, ${pulled} diterima dari tim.`;
    if (syncStatus) syncStatus.textContent = msg;
    if (!silent) showToast(msg);
  } catch (err) {
    const msg = "Sinkron gagal: " + err.message;
    if (syncStatus) syncStatus.textContent = msg;
    if (!silent) showToast(msg);
  }
}

document.getElementById("akun-logout-btn").addEventListener("click", async () => {
  await cloud.logout();
  showToast("Berhasil keluar.");
});

document.getElementById("header-logout-btn").addEventListener("click", async () => {
  if (!confirm("Keluar dari akun ini?")) return;
  await cloud.logout();
  showToast("Berhasil keluar.");
});

document.getElementById("akun-sync-btn").addEventListener("click", () => syncAll(false));

document.getElementById("gate-pending-logout-btn").addEventListener("click", async () => {
  await cloud.logout();
});

document.getElementById("gate-pending-refresh-btn").addEventListener("click", async () => {
  const btn = document.getElementById("gate-pending-refresh-btn");
  btn.disabled = true;
  try {
    await cloud.refreshProfile();
    await handleAuthedUser(cloud.currentUser());
  } catch (err) {
    showToast("Gagal memeriksa status: " + err.message);
  } finally {
    btn.disabled = false;
  }
});

async function handleAuthedUser(user) {
  await renderAkunUi();
  if (cloud.isApproved()) {
    showApp();
    syncAll(true);
  } else {
    showPendingApproval(user.email);
  }
}

function initAuthWatch() {
  document.getElementById("gate-checking").hidden = false;
  document.getElementById("gate-error").hidden = true;
  document.getElementById("gate-pending").hidden = true;
  document.getElementById("gate-login-form").hidden = true;

  cloud
    .onAuthChange(async (user) => {
      if (!cloud.isEnabled()) {
        // Fitur cloud belum dikonfigurasi -- jangan kunci pengguna, langsung
        // masuk ke aplikasi seperti mode offline-lokal biasa.
        showApp();
        return;
      }
      if (user) {
        await handleAuthedUser(user);
      } else {
        await renderAkunUi();
        showGate();
      }
    })
    .catch((err) => {
      showGateError("Gagal memuat layanan login: " + err.message);
    });
}

document.getElementById("gate-retry-btn").addEventListener("click", initAuthWatch);

initAuthWatch();

// ---------- Panel Admin ----------
function adminUserRow(u) {
  const label = u.role === "admin" ? "Admin" : u.approved ? (u.shared ? "Disetujui · Gabung Tim" : "Disetujui · Privat") : "Menunggu persetujuan";
  const approveBtn = u.approved
    ? `<button class="btn admin-unapprove-btn" data-uid="${u.uid}">Cabut Persetujuan</button>`
    : `<button class="btn btn-primary admin-approve-btn" data-uid="${u.uid}">Setujui</button>`;
  const sharedBtn =
    u.approved && u.role !== "admin"
      ? `<button class="btn admin-shared-btn" data-uid="${u.uid}" data-next="${!u.shared}">${u.shared ? "Keluarkan dari Tim" : "Gabungkan ke Tim"}</button>`
      : "";
  return `<div class="admin-user-row">
    <div>
      <div class="admin-user-email">${escapeHtml(u.email)}</div>
      <div class="admin-user-meta">${escapeHtml(label)}</div>
    </div>
    <div class="admin-user-actions">${approveBtn}${sharedBtn}</div>
  </div>`;
}

async function renderAdminUi() {
  if (!cloud.isAdmin()) return;
  const pendingEl = document.getElementById("admin-pending-list");
  const allEl = document.getElementById("admin-all-list");
  pendingEl.innerHTML = "<p class=\"hint\">Memuat&hellip;</p>";
  allEl.innerHTML = "<p class=\"hint\">Memuat&hellip;</p>";
  try {
    const users = await cloud.listAllProfiles();
    const pending = users.filter((u) => !u.approved);
    pendingEl.innerHTML = pending.length ? pending.map(adminUserRow).join("") : '<p class="hint">Tidak ada akun yang menunggu.</p>';
    allEl.innerHTML = users.length ? users.map(adminUserRow).join("") : '<p class="hint">Belum ada akun.</p>';
  } catch (err) {
    pendingEl.innerHTML = allEl.innerHTML = `<p class="hint">Gagal memuat: ${escapeHtml(err.message)}</p>`;
  }
}

document.getElementById("view-admin").addEventListener("click", async (e) => {
  const approveBtn = e.target.closest(".admin-approve-btn");
  const unapproveBtn = e.target.closest(".admin-unapprove-btn");
  const sharedBtn = e.target.closest(".admin-shared-btn");
  try {
    if (approveBtn) {
      await cloud.setApproved(approveBtn.dataset.uid, true);
      showToast("Akun disetujui.");
      await renderAdminUi();
    } else if (unapproveBtn) {
      if (!confirm("Cabut persetujuan akun ini? Pemilik akun tidak akan bisa masuk lagi sampai disetujui ulang.")) return;
      await cloud.setApproved(unapproveBtn.dataset.uid, false);
      showToast("Persetujuan dicabut.");
      await renderAdminUi();
    } else if (sharedBtn) {
      const next = sharedBtn.dataset.next === "true";
      await cloud.setShared(sharedBtn.dataset.uid, next);
      showToast(next ? "Akun digabungkan ke tim." : "Akun dikeluarkan dari tim.");
      await renderAdminUi();
    }
  } catch (err) {
    showToast("Gagal: " + err.message);
  }
});

document.getElementById("admin-wipe-btn").addEventListener("click", async () => {
  if (!confirm("Hapus SEMUA catatan di koleksi cloud yang sedang aktif untuk akun Anda (privat atau tim)? Tindakan ini tidak bisa dibatalkan.")) return;
  const status = document.getElementById("admin-wipe-status");
  status.textContent = "Menghapus...";
  try {
    const n = await cloud.deleteAllCloudRecords((done) => (status.textContent = `Menghapus... (${done})`));
    status.textContent = `Selesai: ${n} dokumen dihapus.`;
    showToast(`${n} dokumen cloud dihapus.`);
  } catch (err) {
    status.textContent = "Gagal: " + err.message;
  }
});

// ---------- Online/offline indicator ----------
function updateOnlineStatus() {
  document.getElementById("offline-banner").hidden = navigator.onLine;
}
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

// ---------- PWA install prompt ----------
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById("install-btn").hidden = false;
});
document.getElementById("install-btn").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById("install-btn").hidden = true;
});

// ---------- Service worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch((err) => console.warn("SW register gagal:", err));
  });
}

// ---------- Init ----------
reload();
