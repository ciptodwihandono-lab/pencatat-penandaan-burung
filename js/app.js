import { FIELDS, SECTIONS, LOGNET_FIELDS, LOGNET_CSV_COLUMNS, SESSION_KEYS, CUACA_SUGGESTIONS } from "./fields.js";
import { addRecord, updateRecord, deleteRecord, getRecord, getAllRecords, bulkAdd, clearAll, getUnsyncedRecords, findByCloudId } from "./db.js";
import { addLognet, updateLognet, deleteLognet, getLognet, getAllLognet, clearAllLognet, bulkAddLognet, getSetting, saveSetting } from "./db.js";
import { downloadCsv, csvToRecords, downloadKml, downloadGpx, downloadLognetKml, downloadLognetGpx } from "./export.js";
import { latLonToUtm, formatUtm } from "./utm.js";
import * as backup from "./backup.js";
import { barChartHorizontal, lineChartTrend, barChartCategorical, topCounts, monthlyTrend } from "./charts.js";
import * as cloud from "./cloud.js";
import { initPhotoMapView, stopGpsWatch } from "./photomap.js";
import { openMapPicker, initMapPicker } from "./mappicker.js";
import { attachSpeciesPicker, attachHistory, nextBandNumber, findBurung } from "./autofill.js";

const state = {
  view: "list",
  records: [],
  editingId: null,
  detailId: null,
  photoDataUrl: null,
  lognetRecords: [],
  lognetEditingId: null,
  lognetDetailId: null,
};

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toast.hidden = true), 3200);
}

// ---------- Draft form otomatis (supaya isian tidak hilang kalau ke-refresh
// di lapangan, baik online maupun offline -- pakai localStorage, tidak
// butuh koneksi internet sama sekali) ----------
const DRAFT_PREFIX = "draft_v1_";

function draftKey(formName, id) {
  return `${DRAFT_PREFIX}${formName}_${id || "new"}`;
}

function saveDraft(formName, id, fields) {
  try {
    const data = {};
    fields.forEach((f) => {
      const el = document.getElementById(`f_${f.key}`);
      if (el) data[f.key] = el.value;
    });
    localStorage.setItem(draftKey(formName, id), JSON.stringify(data));
  } catch (err) {
    // localStorage penuh atau nonaktif -- draft otomatis dilewati, tidak fatal.
  }
}

function loadDraft(formName, id) {
  try {
    const raw = localStorage.getItem(draftKey(formName, id));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function clearDraft(formName, id) {
  // Batalkan juga autosave yang masih tertunda (debounce) supaya draft yang
  // baru dihapus tidak "hidup lagi" kalau user langsung Simpan/Batal tak lama
  // setelah ketikan terakhir.
  clearTimeout(draftAutosaveTimer);
  try {
    localStorage.removeItem(draftKey(formName, id));
  } catch (err) {
    // abaikan
  }
}

function applyDraftIfAny(formName, id, fields) {
  const draft = loadDraft(formName, id);
  if (!draft) return;
  fields.forEach((f) => {
    const el = document.getElementById(`f_${f.key}`);
    if (el && draft[f.key] !== undefined) el.value = draft[f.key];
  });
  showToast("Draft yang belum tersimpan berhasil dipulihkan.");
}

let draftAutosaveTimer = null;
function scheduleDraftSave(formName, id, fields) {
  clearTimeout(draftAutosaveTimer);
  draftAutosaveTimer = setTimeout(() => saveDraft(formName, id, fields), 400);
}

function setView(view) {
  state.view = view;
  if (view !== "peta") stopGpsWatch();
  document.querySelectorAll(".view").forEach((el) => (el.hidden = true));
  const map = {
    list: "view-list",
    form: "view-form",
    detail: "view-detail",
    stats: "view-stats",
    tools: "view-tools",
    akun: "view-akun",
    admin: "view-admin",
    lognet: "view-lognet",
    "lognet-form": "view-lognet-form",
    "lognet-detail": "view-lognet-detail",
    peta: "view-peta",
  };
  document.getElementById(map[view]).hidden = false;
  if (view === "list" || view === "lognet") renderSesiBanner(view);
  const navKey = view.startsWith("lognet") ? "lognet" : view;
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === navKey));
  window.scrollTo({ top: 0, behavior: "smooth" });
  saveLastView();
}

// ---------- Ingat halaman terakhir (supaya refresh/reload tidak selalu
// balik ke Daftar Data -- terutama penting saat sedang mengisi form di
// lapangan dan sinyal/baterai bikin halaman ke-reload tanpa sengaja) ----------
const LAST_VIEW_KEY = "last_view_v1";

function renderSesiBanner(view) {
  const host = document.getElementById(view === "list" ? "view-list" : "view-lognet");
  let el = host.querySelector(".sesi-banner");
  if (!el) { el = document.createElement("div"); el.className = "sesi-banner"; host.insertBefore(el, host.children[1] || null); }
  const v = sesiAktif();
  el.innerHTML = v ? `<div class="sesi-bar"><div><b>● Sesi berjalan:</b> ${escapeHtml(v.lokasi_nama)} · ${escapeHtml(v.tanggal)} · kode ${escapeHtml(v.kode_lokasi)} · ${sesiCount(v)} burung</div><div class="sesi-acts"><button type="button" class="btn btn-primary btn-sm" data-go="${view === "list" ? "burung" : "net"}">${view === "list" ? "+ Catat burung" : "+ Cek net"}</button></div></div>` : (view === "list" ? `<div class="sesi-bar"><div>Belum ada sesi berjalan. Mulai sesi untuk mengisi info kegiatan sekali saja.</div><div class="sesi-acts"><button type="button" class="btn btn-primary btn-sm" data-go="burung">Mulai sesi</button></div></div>` : "");
  el.onclick = (e) => { const b = e.target.closest("[data-go]"); if (!b) return; if (b.dataset.go === "burung") openForm(null); else openLognetForm(null); };
}

function saveLastView() {
  try {
    localStorage.setItem(
      LAST_VIEW_KEY,
      JSON.stringify({
        view: state.view,
        editingId: state.editingId,
        detailId: state.detailId,
        lognetEditingId: state.lognetEditingId,
        lognetDetailId: state.lognetDetailId,
      })
    );
  } catch (err) {
    // localStorage penuh atau nonaktif -- lewati, tidak fatal.
  }
}

function restoreLastView() {
  let last;
  try {
    const raw = localStorage.getItem(LAST_VIEW_KEY);
    last = raw ? JSON.parse(raw) : null;
  } catch (err) {
    last = null;
  }
  if (!last || last.view === "list") return;

  switch (last.view) {
    case "form":
      openForm(last.editingId ?? null);
      break;
    case "detail":
      if (last.detailId != null) openDetail(last.detailId);
      break;
    case "lognet-form":
      openLognetForm(last.lognetEditingId ?? null);
      break;
    case "lognet-detail":
      if (last.lognetDetailId != null) openLognetDetail(last.lognetDetailId);
      break;
    case "lognet":
      setView("lognet");
      break;
    case "stats":
      setView("stats");
      renderStats();
      break;
    case "tools":
      setView("tools");
      refreshBackupUi();
      break;
    case "akun":
      setView("akun");
      renderAkunUi();
      break;
    case "admin":
      // Hanya pulihkan kalau tombol nav Admin sedang tidak disembunyikan
      // (yaitu akun ini memang admin) -- kalau tidak, biarkan di Daftar Data.
      if (!document.getElementById("nav-admin").hidden) {
        setView("admin");
        renderAdminUi();
      }
      break;
    case "peta":
      initPhotoMapView();
      setView("peta");
      break;
  }
}

document.getElementById("brand-home-btn").addEventListener("click", () => setView("list"));
document.getElementById("brand-home-btn").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    setView("list");
  }
});

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.view === "form") openForm(null);
    else setView(btn.dataset.view);
    if (btn.dataset.view === "stats") renderStats();
    if (btn.dataset.view === "tools") refreshBackupUi();
    if (btn.dataset.view === "akun") renderAkunUi();
    if (btn.dataset.view === "admin") renderAdminUi();
    if (btn.dataset.view === "lognet") reloadLognet();
    if (btn.dataset.view === "peta") initPhotoMapView();
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

// Nama tampil: "Nama Indonesia (Nama ilmiah)" dengan nama ilmiah miring.
function speciesLabel(r) {
  if (!r.nama_spesies) return "(spesies belum diisi)";
  const b = findBurung(r.nama_spesies);
  const ind = r.nama_indonesia || (b && b.ind) || "";
  const sci = b ? b.sci : /^[A-Z][a-z]+ [a-z-]+/.test(r.nama_spesies) ? r.nama_spesies : "";
  if (sci && ind) return `${escapeHtml(ind)} <i>${escapeHtml(sci)}</i>`;
  return sci ? `<i>${escapeHtml(sci)}</i>` : escapeHtml(r.nama_spesies);
}

function recordCardHtml(r) {
  return `
    <div class="record-card" data-id="${r.id}">
      <div class="record-main">
        <strong>${speciesLabel(r)}</strong> — ${escapeHtml(r.nomor_cincin || "-")}
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
    // Pilihan cepat berupa tombol; kolom tetap boleh diketik bebas.
    input = `<input id="f_${f.key}" type="text" name="${f.key}" autocomplete="off" /><div class="chip-row">${f.options.map((o) => `<button type="button" class="chip-opt" data-chip="${f.key}" data-v="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join("")}</div>`;
  } else {
    const extra = [
      f.step !== undefined ? `step="${f.step}"` : "",
      f.min !== undefined ? `min="${f.min}"` : "",
      f.max !== undefined ? `max="${f.max}"` : "",
    ].join(" ");
    input = `<input id="f_${f.key}" type="${f.type}" name="${f.key}" ${extra} />`;
  }
  const auto = ["nama_indonesia", "nama_inggris", "famili"].includes(f.key) ? " field-auto" : "";
  return `<div class="field${f.type === "textarea" ? " full" : ""}${auto}"><label for="f_${f.key}">${escapeHtml(f.label)}${req}</label>${input}${hint}</div>`;
}

// ---------- Sesi penandaan: info kegiatan diisi sekali, dipakai semua catatan ----------
const SESI_KEY = "sesi_penandaan_v1";
const SESI_EXTRA = [
  { key: "cuaca", label: "Cuaca", type: "suggest", options: CUACA_SUGGESTIONS },
  { key: "habitat", label: "Habitat", type: "text" },
];
const GPS_KEYS = ["latitude", "longitude", "ketinggian_m"];
function getSesi() { try { return JSON.parse(localStorage.getItem(SESI_KEY) || "null"); } catch (e) { return null; } }
function setSesi(v) { try { if (v) localStorage.setItem(SESI_KEY, JSON.stringify(v)); else localStorage.removeItem(SESI_KEY); } catch (e) {} }
function sesiAktif() { const v = getSesi(); return v && v.aktif ? v : null; }
const sesiFieldDefs = () => [...FIELDS.filter((f) => SESSION_KEYS.includes(f.key) && !GPS_KEYS.includes(f.key)), ...SESI_EXTRA];
function sesiCount(v) { return state.records.filter((r) => r.tanggal === v.tanggal && r.kode_lokasi === v.kode_lokasi && (r.created_at || "") >= new Date(v.mulai || 0).toISOString()).length; }
function sesiBarHtml(v, ctx) {
  const n = sesiCount(v);
  return `<div class="sesi-bar"><div><b>Sesi:</b> ${escapeHtml(v.lokasi_nama)} · ${escapeHtml(v.tanggal)} · kode ${escapeHtml(v.kode_lokasi)} · bander ${escapeHtml(v.bander)} · pencincin ${escapeHtml(v.pencincin_pengukur)}${v.metode ? " · " + escapeHtml(v.metode) : ""}${ctx === "burung" ? ` · <b>${n}</b> burung tercatat di sesi ini` : ""}</div>
    <div class="sesi-acts"><button type="button" class="btn btn-ghost btn-sm" data-sesi="ubah">Ubah sesi</button><button type="button" class="btn btn-ghost btn-sm" data-sesi="akhiri">Akhiri sesi</button></div></div>`;
}
function wireChips(form) {
  form.addEventListener("click", (e) => {
    const b = e.target.closest("[data-chip]"); if (!b) return;
    const el = document.getElementById(`f_${b.dataset.chip}`); if (!el) return;
    el.value = el.value === b.dataset.v ? "" : b.dataset.v;
    el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  form.addEventListener("input", (e) => {
    const k = e.target.id && e.target.id.startsWith("f_") ? e.target.id.slice(2) : null; if (!k) return;
    form.querySelectorAll(`[data-chip="${k}"]`).forEach((c) => c.classList.toggle("on", c.dataset.v === e.target.value));
  });
}
function refreshChips(form) { form.querySelectorAll("[data-chip]").forEach((c) => { const el = document.getElementById(`f_${c.dataset.chip}`); c.classList.toggle("on", !!el && el.value === c.dataset.v); }); }
function gpsInto(latId, lonId, altId, after) {
  if (!navigator.geolocation) { showToast("Perangkat ini tidak mendukung GPS."); return; }
  showToast("Mengambil lokasi GPS...");
  navigator.geolocation.getCurrentPosition((pos) => {
    document.getElementById(latId).value = pos.coords.latitude.toFixed(6);
    document.getElementById(lonId).value = pos.coords.longitude.toFixed(6);
    if (altId && pos.coords.altitude != null && document.getElementById(altId)) document.getElementById(altId).value = Math.round(pos.coords.altitude);
    if (after) after(); showToast(`Lokasi GPS diambil (±${Math.round(pos.coords.accuracy)} m).`);
  }, (err) => showToast("Gagal mengambil GPS: " + err.message), { enableHighAccuracy: true, timeout: 15000 });
}
function utmPreview(lat, lon, el) { const u = latLonToUtm(lat, lon); el.textContent = u ? formatUtm(u) : "Isi latitude/longitude untuk melihat koordinat UTM."; }

/* Form sesi: diisi sekali di awal kegiatan. */
function buildSesiForm(fromBurung) {
  state.formMode = "sesi";
  const form = document.getElementById("record-form");
  const gpsFields = GPS_KEYS.map((k) => FIELDS.find((f) => f.key === k));
  form.innerHTML = `<div class="autofill-note">Isi <b>sekali</b> di awal kegiatan. Data ini otomatis dipakai untuk setiap burung yang dicatat dan untuk Log Banding, jadi tidak perlu diisi berulang.</div>
    <div class="form-section"><h3>Info Kegiatan</h3><div class="form-grid">${sesiFieldDefs().map(fieldHtml).join("")}</div></div>
    <div class="form-section"><h3>Lokasi GPS kegiatan</h3><div class="form-grid">${gpsFields.map(fieldHtml).join("")}
      <div class="field"><label>&nbsp;</label><button type="button" id="sesi-gps-btn" class="btn">📍 Ambil GPS sekarang</button></div>
      <div class="field"><label>&nbsp;</label><button type="button" id="sesi-map-btn" class="btn">🗺️ Pilih di Peta</button></div>
      <div class="field full"><div id="sesi-utm" class="utm-preview"></div></div></div></div>
    <div class="form-actions"><button type="submit" class="btn btn-primary">${fromBurung ? "Simpan sesi" : "Mulai sesi &amp; catat burung"}</button><button type="button" id="form-cancel-btn" class="btn btn-ghost">Batal</button></div>`;
  const prev = getSesi() || {};
  const last = [...state.records].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0] || {};
  [...sesiFieldDefs(), ...gpsFields].forEach((f) => { const v = prev[f.key] ?? last[f.key]; if (v !== undefined && v !== "") setVal(f.key, v); });
  if (!fromBurung) setVal("tanggal", new Date().toISOString().slice(0, 10));
  const others = state.records;
  sesiFieldDefs().filter((f) => f.type === "text" || f.type === "suggest").forEach((f) => attachHistory(document.getElementById(`f_${f.key}`), others, f.key, []));
  const up = () => utmPreview(getVal("latitude"), getVal("longitude"), document.getElementById("sesi-utm"));
  document.getElementById("sesi-gps-btn").addEventListener("click", () => gpsInto("f_latitude", "f_longitude", "f_ketinggian_m", up));
  document.getElementById("sesi-map-btn").addEventListener("click", () => pickFromMap("f_latitude", "f_longitude", up));
  ["f_latitude", "f_longitude"].forEach((id) => document.getElementById(id).addEventListener("input", up));
  up(); if (!getVal("latitude") && !fromBurung) gpsInto("f_latitude", "f_longitude", "f_ketinggian_m", up);
  document.getElementById("form-cancel-btn").addEventListener("click", () => setView(fromBurung ? "form" : "list") || (fromBurung && openForm(null)));
  refreshChips(form);
  form.oninput = null;
  form.onsubmit = (e) => {
    e.preventDefault();
    const v = { aktif: true, mulai: (fromBurung && prev.mulai) || Date.now() };
    const missing = [];
    [...sesiFieldDefs(), ...gpsFields].forEach((f) => { const val = getVal(f.key); if (f.required && !val) missing.push(f.label); v[f.key] = f.type === "number" ? (val === "" ? "" : Number(val)) : val; });
    if (missing.length) { showToast("Lengkapi dulu: " + missing.join(", ")); return; }
    setSesi(v); showToast(fromBurung ? "Sesi diperbarui." : "Sesi dimulai. Catat burung pertama."); openForm(null);
  };
}

function buildForm() {
  const form = document.getElementById("record-form");
  const sesi = !state.editingId ? sesiAktif() : null;
  state.formMode = sesi ? "burung" : "lengkap";
  form.classList.toggle("mode-burung", !!sesi);
  // Mode burung: hanya kolom per burung; info kegiatan diambil dari sesi. Mode lengkap (edit): semua kolom.
  const skip = sesi ? new Set(SESSION_KEYS) : new Set();
  const sectionsHtml = SECTIONS.map((sec) => {
    const fields = FIELDS.filter((f) => f.section === sec.key && !skip.has(f.key)).map(fieldHtml).join("");
    let extra = "";
    if (sec.key === "tambahan") {
      extra = `<div class="field full"><label>Lampirkan Foto (opsional, tambahan digital selain kolom "Photo")</label><input type="file" id="f_foto" accept="image/*" capture="environment" /><img id="photo-preview" class="photo-preview" hidden /></div>`;
    }
    if (sec.key === "gps" && !sesi) {
      extra = `<div class="field"><label>&nbsp;</label><button type="button" id="rec-gps-btn" class="btn">📍 Ambil GPS</button></div><div class="field"><label>&nbsp;</label><button type="button" id="rec-map-btn" class="btn">🗺️ Pilih di Peta</button></div>`;
    }
    if (!fields && !extra) return "";
    return `<div class="form-section"><h3>${escapeHtml(sec.title)}</h3><div class="form-grid">${fields}${extra}</div></div>`;
  }).join("");
  form.innerHTML =
    (sesi ? sesiBarHtml(sesi, "burung") : "") +
    sectionsHtml +
    `<div class="form-actions">
      ${sesi ? '<button type="submit" class="btn btn-primary" data-next="1">Simpan &amp; catat burung berikutnya</button><button type="submit" class="btn">Simpan &amp; selesai</button>' : '<button type="submit" class="btn btn-primary">Simpan Catatan</button>'}
      <button type="button" id="form-cancel-btn" class="btn btn-ghost">Batal</button>
    </div>`;

  document.getElementById("f_foto").addEventListener("change", handlePhotoInput);
  document.getElementById("form-cancel-btn").addEventListener("click", () => {
    clearDraft("record", state.editingId);
    setView("list");
  });
  if (document.getElementById("rec-gps-btn")) {
    document.getElementById("rec-gps-btn").addEventListener("click", () => gpsInto("f_latitude", "f_longitude", "f_ketinggian_m"));
    document.getElementById("rec-map-btn").addEventListener("click", () => pickFromMap("f_latitude", "f_longitude", () => {}));
  }
  form.querySelectorAll("[data-sesi]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.sesi === "ubah") buildSesiForm(true);
    else if (confirm("Akhiri sesi penandaan ini? Catatan yang sudah disimpan tidak berubah.")) { const v = getSesi(); if (v) { v.aktif = false; setSesi(v); } showToast("Sesi diakhiri."); setView("list"); }
  }));
  form.querySelectorAll("button[type=submit]").forEach((b) => b.addEventListener("click", () => { state.saveNext = !!b.dataset.next; }));
  // Pakai onsubmit/oninput (bukan addEventListener) karena elemen <form> ini
  // sendiri tidak diganti tiap buildForm() dipanggil -- innerHTML-nya saja
  // yang diganti -- jadi addEventListener akan menumpuk listener lama tiap
  // kali form dibuka ulang (submit/draft-save jadi terpicu berkali-kali).
  form.onsubmit = handleFormSubmit;
  form.oninput = () => scheduleDraftSave("record", state.editingId, FIELDS);
  setupRecordAutofill();
}

// ---------- Isian otomatis form catatan ----------
const setVal = (key, v) => { const el = document.getElementById(`f_${key}`); if (el && v !== undefined && v !== null) el.value = v; };
const getVal = (key) => (document.getElementById(`f_${key}`)?.value || "").trim();
// Kolom yang diisi otomatis dari catatan terakhir saat menambah catatan baru (info kegiatan yang biasanya sama).
const CARRY_KEYS = ["bander", "lokasi_nama", "catat", "pencincin_pengukur", "cek_trainer", "kode_lokasi", "metode", "latitude", "longitude", "ketinggian_m"];
const NO_HISTORY = new Set(["nama_spesies", "nama_indonesia", "nama_inggris", "famili", "nomor_cincin", "catatan", "photo_ref"]);

function setupRecordAutofill() {
  const others = state.records.filter((r) => r.id !== state.editingId);
  // Saran dari isian sebelumnya untuk kolom teks.
  FIELDS.filter((f) => (f.type === "text" || f.type === "suggest") && !NO_HISTORY.has(f.key)).forEach((f) =>
    attachHistory(document.getElementById(`f_${f.key}`), others, f.key, f.options || [])
  );
  // Nomor cincin: saran nomor berikutnya + nomor yang pernah dipakai (untuk retrap).
  const next = nextBandNumber(others);
  attachHistory(document.getElementById("f_nomor_cincin"), others, "nomor_cincin", next ? [next] : []);
  // Nama spesies: pencarian daftar burung Indonesia.
  attachSpeciesPicker(document.getElementById("f_nama_spesies"), (b) => {
    setVal("nama_indonesia", b.ind); setVal("nama_inggris", b.eng); setVal("famili", b.fam);
    if (!getVal("nomor_spesies")) {
      const prev = others.find((r) => r.nama_spesies === b.sci && r.nomor_spesies);
      if (prev) setVal("nomor_spesies", prev.nomor_spesies);
    }
    scheduleDraftSave("record", state.editingId, FIELDS);
  });
  // Retrap: nomor cincin yang sudah pernah dicatat.
  const ring = document.getElementById("f_nomor_cincin");
  ring.addEventListener("change", () => {
    const v = ring.value.trim().toLowerCase(); if (!v) return;
    const prev = others.filter((r) => String(r.nomor_cincin || "").trim().toLowerCase() === v)
      .sort((a, b) => (a.tanggal || "").localeCompare(b.tanggal || ""))[0];
    if (!prev) return;
    if (!getVal("retrap")) setVal("retrap", "Y");
    if (!getVal("nama_spesies") && prev.nama_spesies) {
      setVal("nama_spesies", prev.nama_spesies); setVal("nama_indonesia", prev.nama_indonesia || ""); setVal("nama_inggris", prev.nama_inggris || ""); setVal("famili", prev.famili || "");
      if (!getVal("nomor_spesies")) setVal("nomor_spesies", prev.nomor_spesies || "");
      document.getElementById("f_nama_spesies")._spShowInfo?.();
    }
    showToast(`Cincin ${ring.value.trim()} pernah dipasang ${prev.tanggal || ""} (${prev.nama_indonesia || prev.nama_spesies || "jenis ?"}). Retrap diisi Y.`);
    scheduleDraftSave("record", state.editingId, FIELDS);
  });
  // Berat burung = (burung + kantong) - kantong, selama kolom berat burung belum diketik sendiri.
  const bb = document.getElementById("f_berat_bird_bag"), bag = document.getElementById("f_berat_bag"), bird = document.getElementById("f_berat_bird");
  const calc = () => {
    if (bird.dataset.manual) return;
    const a = parseFloat(bb.value), c = parseFloat(bag.value);
    bird.value = isFinite(a) && isFinite(c) && a >= c ? (Math.round((a - c) * 10) / 10).toString() : bird.value;
  };
  bb.addEventListener("input", calc); bag.addEventListener("input", calc);
  bird.addEventListener("input", () => { bird.dataset.manual = bird.value ? "1" : ""; });
  bird.insertAdjacentHTML("afterend", '<div class="field-hint">Otomatis: (burung + kantong) − kantong</div>');
}

function prefillFromLastRecord() {
  const last = [...state.records].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "") || (b.id || 0) - (a.id || 0))[0];
  if (!last) return;
  let n = 0;
  CARRY_KEYS.forEach((k) => { if (last[k] !== undefined && last[k] !== "" && !getVal(k)) { setVal(k, last[k]); n++; } });
  if (n) {
    const note = document.createElement("div");
    note.className = "autofill-note";
    note.textContent = `Info kegiatan, pencatat, kode lokasi, metode, dan koordinat diisi otomatis dari catatan terakhir (${last.tanggal || ""} ${last.nomor_cincin || ""}). Ubah bila perlu.`;
    document.getElementById("record-form").prepend(note);
  }
}

// Dipakai oleh tombol "Pilih di Peta" di form catatan maupun form Log Mist
// Net -- buka modal peta Esri, isi field lat/lon kalau pengguna memilih titik.
async function pickFromMap(latFieldId, lonFieldId, onFilled) {
  const latField = document.getElementById(latFieldId);
  const lonField = document.getElementById(lonFieldId);
  const result = await openMapPicker(latField.value, lonField.value);
  if (!result) return;
  latField.value = result.lat.toFixed(6);
  lonField.value = result.lng.toFixed(6);
  onFilled();
  showToast("Koordinat dipilih dari peta.");
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
  state.saveNext = false;
  const form = document.getElementById("record-form");
  if (!form.dataset.chips) { wireChips(form); form.dataset.chips = "1"; }
  // Catatan baru tanpa sesi berjalan: isi info kegiatan sekali dulu.
  if (!id && !sesiAktif()) {
    buildSesiForm(false);
    document.getElementById("form-title").textContent = "Mulai Sesi Penandaan";
    setView("form");
    return;
  }
  buildForm();
  document.getElementById("form-title").textContent = id ? "Edit Catatan Penandaan" : "Catat Burung";

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
      applyDraftIfAny("record", id, FIELDS);
      document.getElementById("f_nama_spesies")._spShowInfo?.();
      refreshChips(form);
    });
  } else {
    const today = new Date();
    setVal("waktu", today.toTimeString().slice(0, 5));
    applyDraftIfAny("record", id, FIELDS);
    if (!getVal("nomor_cincin")) { const nx = nextBandNumber(state.records); if (nx) { setVal("nomor_cincin", nx); document.getElementById("f_nomor_cincin").select?.(); } }
    document.getElementById("f_nama_spesies")._spShowInfo?.();
    refreshChips(form);
  }
  setView("form");
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const record = {};
  let missing = [];
  const sesi = state.formMode === "burung" ? sesiAktif() : null;
  FIELDS.forEach((f) => {
    const el = document.getElementById(`f_${f.key}`);
    // Kolom kegiatan yang tidak tampil di form burung diambil dari sesi penandaan.
    const val = el ? el.value.trim() : sesi && sesi[f.key] !== undefined ? String(sesi[f.key]) : "";
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
  clearDraft("record", state.editingId);
  await reload();
  maybeAutoBackup();
  maybeCloudPush(savedId);
  if (state.saveNext && !state.editingId) { openForm(null); showToast(`Tersimpan: ${record.nomor_cincin} ${record.nama_indonesia || record.nama_spesies}. Catat burung berikutnya.`); return; }
  setView("list");
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
    `<h2>${rec.nama_spesies ? speciesLabel(rec) : "(tanpa nama)"} ${badgeFor(rec)}</h2><dl class="detail-grid">` +
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
  if (rec?.cloud_id) {
    await addTombs([rec.cloud_id], true);   // dihapus di cloud sekarang, atau saat ada sinyal
    flushCloudDeletes();
  }
  await reload();
  showToast("Catatan dihapus.");
  setView("list");
});

// ---------- Log Mist Net (Log Banding) — halaman terpisah ----------
async function reloadLognet() {
  state.lognetRecords = await getAllLognet();
  state.lognetRecords.sort((a, b) => (b.net_tanggal || "").localeCompare(a.net_tanggal || "") || (b.id - a.id));
  renderLognetList();
}

function lognetMatchesFilters(r, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return ["net_kode", "net_lokasi", "net_nama_burung", "net_no"].some((k) => (r[k] || "").toLowerCase().includes(q));
}

function lognetCardHtml(r) {
  return `
    <div class="record-card" data-id="${r.id}">
      <div class="record-main">
        <strong>${escapeHtml(r.net_kode || "(kode net belum diisi)")}</strong> — ${escapeHtml(r.net_nama_burung || "-")}
        <div class="record-sub">${escapeHtml(r.net_tanggal || "-")} ${escapeHtml(r.net_waktu || "")} &middot; ${escapeHtml(r.net_lokasi || "-")}</div>
      </div>
    </div>`;
}

function renderLognetList() {
  const query = document.getElementById("lognet-search-box").value.trim();
  const filtered = state.lognetRecords.filter((r) => lognetMatchesFilters(r, query));
  document.getElementById("lognet-count").textContent = `${filtered.length} dari ${state.lognetRecords.length} log`;
  const container = document.getElementById("lognet-list-container");
  if (filtered.length === 0) {
    container.innerHTML = '<p class="empty-state">Belum ada log mist net. Klik "+ Tambah Log Net" untuk mulai mencatat.</p>';
    return;
  }
  container.innerHTML = filtered.map(lognetCardHtml).join("");
  container.querySelectorAll(".record-card").forEach((card) => {
    card.addEventListener("click", () => openLognetDetail(Number(card.dataset.id)));
  });
}

document.getElementById("lognet-search-box").addEventListener("input", renderLognetList);
document.getElementById("lognet-add-btn").addEventListener("click", () => openLognetForm(null));

// Kolom Log Banding yang sama dengan info sesi penandaan (diambil otomatis bila sesi berjalan).
const LOGNET_FROM_SESI = { net_tanggal: "tanggal", net_lokasi: "lokasi_nama", net_cuaca: "cuaca", net_latitude: "latitude", net_longitude: "longitude", net_habitat: "habitat" };
const NET_SPEC = ["net_panjang", "net_jumlah_kantong", "net_ukuran_mesh", "net_tinggi"];
function buildLognetForm() {
  const form = document.getElementById("lognet-form");
  const sesi = !state.lognetEditingId ? sesiAktif() : null;
  state.lognetMode = sesi ? "sesi" : "lengkap";
  const fields = LOGNET_FIELDS.filter((f) => !(sesi && LOGNET_FROM_SESI[f.key])).map(fieldHtml).join("");
  const gpsExtra = sesi ? "" : `<div class="field"><label>&nbsp;</label><button type="button" id="lognet-gps-btn" class="btn">📍 Ambil Lokasi GPS Sekarang</button></div>
    <div class="field"><label>&nbsp;</label><button type="button" id="lognet-map-pick-btn" class="btn">🗺️ Pilih di Peta</button></div>
    <div class="field full"><label>Koordinat UTM (otomatis, untuk UTM Geo Map)</label><div id="lognet-utm-preview" class="utm-preview">Isi latitude/longitude untuk melihat koordinat UTM.</div></div>
    <div class="field full"><a id="lognet-gmaps-link" class="btn" href="#" target="_blank" rel="noopener" hidden>🗺️ Buka di Google Maps</a></div>`;
  form.innerHTML =
    (sesi ? sesiBarHtml(sesi, "net") : "") +
    `<div class="form-section"><div class="form-grid">${fields}${gpsExtra}</div></div>` +
    `<div class="form-actions">
      ${sesi ? '<button type="submit" class="btn btn-primary" data-next="1">Simpan &amp; cek berikutnya</button><button type="submit" class="btn">Simpan &amp; selesai</button>' : '<button type="submit" class="btn btn-primary">Simpan Log</button>'}
      <button type="button" id="lognet-form-cancel-btn" class="btn btn-ghost">Batal</button>
    </div>`;
  document.getElementById("lognet-form-cancel-btn").addEventListener("click", () => {
    clearDraft("lognet", state.lognetEditingId);
    setView("lognet");
  });
  if (!sesi) {
    document.getElementById("lognet-gps-btn").addEventListener("click", fetchLognetGps);
    document.getElementById("lognet-map-pick-btn").addEventListener("click", () => pickFromMap("f_net_latitude", "f_net_longitude", updateLognetUtmPreview));
    document.getElementById("f_net_latitude").addEventListener("input", updateLognetUtmPreview);
    document.getElementById("f_net_longitude").addEventListener("input", updateLognetUtmPreview);
  }
  form.querySelectorAll("[data-sesi]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.sesi === "ubah") { openForm(null); buildSesiForm(true); document.getElementById("form-title").textContent = "Ubah Sesi Penandaan"; }
    else if (confirm("Akhiri sesi penandaan ini? Catatan yang sudah disimpan tidak berubah.")) { const v = getSesi(); if (v) { v.aktif = false; setSesi(v); } showToast("Sesi diakhiri."); setView("lognet"); }
  }));
  form.querySelectorAll("button[type=submit]").forEach((b) => b.addEventListener("click", () => { state.lognetSaveNext = !!b.dataset.next; }));
  if (!form.dataset.chips) { wireChips(form); form.dataset.chips = "1"; }
  // Kode net yang pernah dicatat: panjang, kantong, mesh, dan tinggi diisi dari catatan terakhir net itu.
  const kode = document.getElementById("f_net_kode");
  kode.addEventListener("change", () => {
    const prev = [...state.lognetRecords].filter((r) => String(r.net_kode || "").trim().toLowerCase() === kode.value.trim().toLowerCase()).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
    if (!prev) return;
    let n = 0; NET_SPEC.forEach((k) => { const el = document.getElementById(`f_${k}`); if (el && !el.value && prev[k] !== undefined && prev[k] !== "") { el.value = prev[k]; n++; } });
    if (n) showToast(`Spesifikasi net ${kode.value} diisi dari catatan sebelumnya.`);
  });
  // onsubmit/oninput, bukan addEventListener -- lihat catatan yang sama di buildForm().
  form.onsubmit = handleLognetFormSubmit;
  form.oninput = () => scheduleDraftSave("lognet", state.lognetEditingId, LOGNET_FIELDS);
  const others = state.lognetRecords.filter((r) => r.id !== state.lognetEditingId);
  LOGNET_FIELDS.filter((f) => (f.type === "text" || f.type === "suggest") && f.key !== "net_nama_burung" && f.key !== "net_catatan").forEach((f) =>
    attachHistory(document.getElementById(`f_${f.key}`), others, f.key, f.options || [])
  );
  attachSpeciesPicker(document.getElementById("f_net_nama_burung"), () => scheduleDraftSave("lognet", state.lognetEditingId, LOGNET_FIELDS));
}

function updateLognetUtmPreview() {
  const lat = document.getElementById("f_net_latitude").value;
  const lon = document.getElementById("f_net_longitude").value;
  const preview = document.getElementById("lognet-utm-preview");
  const utm = latLonToUtm(lat, lon);
  preview.textContent = utm ? formatUtm(utm) : "Isi latitude/longitude untuk melihat koordinat UTM.";
  const link = document.getElementById("lognet-gmaps-link");
  if (utm) {
    link.href = `https://www.google.com/maps?q=${lat},${lon}`;
    link.hidden = false;
  } else {
    link.hidden = true;
  }
}

function fetchLognetGps() {
  if (!navigator.geolocation) {
    showToast("Perangkat ini tidak mendukung GPS.");
    return;
  }
  showToast("Mengambil lokasi GPS...");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById("f_net_latitude").value = pos.coords.latitude.toFixed(6);
      document.getElementById("f_net_longitude").value = pos.coords.longitude.toFixed(6);
      updateLognetUtmPreview();
      showToast("Lokasi GPS berhasil diambil.");
    },
    (err) => showToast("Gagal mengambil GPS: " + err.message),
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function openLognetForm(id) {
  state.lognetEditingId = id;
  buildLognetForm();
  document.getElementById("lognet-form-title").textContent = id ? "Edit Log Mist Net" : "Tambah Log Mist Net";
  if (id) {
    getLognet(id).then((rec) => {
      if (!rec) return;
      LOGNET_FIELDS.forEach((f) => {
        const el = document.getElementById(`f_${f.key}`);
        if (el && rec[f.key] !== undefined) el.value = rec[f.key];
      });
      applyDraftIfAny("lognet", id, LOGNET_FIELDS);
      updateLognetUtmPreview();
    });
  } else {
    const today = new Date();
    if (document.getElementById("f_net_tanggal")) document.getElementById("f_net_tanggal").value = today.toISOString().slice(0, 10);
    document.getElementById("f_net_waktu").value = today.toTimeString().slice(0, 5);
    applyDraftIfAny("lognet", id, LOGNET_FIELDS);
    const sesi = sesiAktif(), noEl = document.getElementById("f_net_no");
    if (sesi && noEl && !noEl.value) {
      const nos = state.lognetRecords.filter((r) => r.net_tanggal === sesi.tanggal && r.net_lokasi === sesi.lokasi_nama).map((r) => parseInt(r.net_no, 10)).filter((x) => !isNaN(x));
      noEl.value = String((nos.length ? Math.max(...nos) : 0) + 1);
    }
    if (document.getElementById("f_net_latitude")) updateLognetUtmPreview();
  }
  setView("lognet-form");
}

async function handleLognetFormSubmit(e) {
  e.preventDefault();
  const record = {};
  let missing = [];
  const sesi = state.lognetMode === "sesi" ? sesiAktif() : null;
  LOGNET_FIELDS.forEach((f) => {
    const el = document.getElementById(`f_${f.key}`);
    const sk = LOGNET_FROM_SESI[f.key];
    const val = el ? el.value.trim() : sesi && sk && sesi[sk] !== undefined ? String(sesi[sk]) : "";
    if (f.required && !val) missing.push(f.label);
    record[f.key] = f.type === "number" ? (val === "" ? "" : Number(val)) : val;
  });
  if (missing.length) {
    showToast("Lengkapi dulu: " + missing.join(", "));
    return;
  }
  const utm = latLonToUtm(record.net_latitude, record.net_longitude);
  record.utm_zone = utm ? utm.zone : "";
  record.utm_hemisphere = utm ? utm.hemisphere : "";
  record.utm_easting = utm ? utm.easting : "";
  record.utm_northing = utm ? utm.northing : "";

  const now = new Date().toISOString();
  record.updated_at = now;

  try {
    if (state.lognetEditingId) {
      record.id = state.lognetEditingId;
      const existing = await getLognet(state.lognetEditingId);
      record.created_at = existing?.created_at || now;
      await updateLognet(record);
      showToast("Log mist net berhasil diperbarui.");
    } else {
      record.created_at = now;
      await addLognet(record);
      showToast("Log mist net berhasil disimpan.");
    }
  } catch (err) {
    showToast("Gagal menyimpan: " + err.message);
    return;
  }
  clearDraft("lognet", state.lognetEditingId);
  await reloadLognet();
  if (state.lognetSaveNext && !state.lognetEditingId) { openLognetForm(null); showToast("Tersimpan. Catat cek net berikutnya."); return; }
  setView("lognet");
}

async function openLognetDetail(id) {
  state.lognetDetailId = id;
  const rec = await getLognet(id);
  if (!rec) return;
  const container = document.getElementById("lognet-detail-container");
  const utmLine =
    rec.utm_zone !== undefined && rec.utm_zone !== ""
      ? `<div class="detail-item"><dt>Koordinat UTM</dt><dd>${escapeHtml(formatUtm({ zone: rec.utm_zone, hemisphere: rec.utm_hemisphere, easting: rec.utm_easting, northing: rec.utm_northing }))}</dd></div>`
      : "";
  const gmapsLine =
    rec.net_latitude !== undefined && rec.net_latitude !== "" && rec.net_longitude !== undefined && rec.net_longitude !== ""
      ? `<div class="detail-item"><dt>Google Maps</dt><dd><a href="https://www.google.com/maps?q=${rec.net_latitude},${rec.net_longitude}" target="_blank" rel="noopener">🗺️ Buka di Google Maps</a></dd></div>`
      : "";
  container.innerHTML =
    `<h2>${escapeHtml(rec.net_kode || "(kode net belum diisi)")}</h2><dl class="detail-grid">` +
    LOGNET_FIELDS.filter((f) => rec[f.key] !== undefined && rec[f.key] !== "")
      .map((f) => `<div class="detail-item"><dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(rec[f.key])}</dd></div>`)
      .join("") +
    utmLine +
    gmapsLine +
    `</dl>`;
  setView("lognet-detail");
}

document.getElementById("lognet-detail-back-btn").addEventListener("click", () => setView("lognet"));
document.getElementById("lognet-detail-edit-btn").addEventListener("click", () => openLognetForm(state.lognetDetailId));
document.getElementById("lognet-detail-delete-btn").addEventListener("click", async () => {
  if (!confirm("Hapus log mist net ini secara permanen?")) return;
  await deleteLognet(state.lognetDetailId);
  await reloadLognet();
  showToast("Log dihapus.");
  setView("lognet");
});

document.getElementById("lognet-export-btn").addEventListener("click", async () => {
  const recs = await getAllLognet();
  if (recs.length === 0) return showToast("Belum ada data log banding untuk diekspor.");
  downloadCsv(recs, `log-banding-${new Date().toISOString().slice(0, 10)}.csv`, LOGNET_CSV_COLUMNS);
  showToast(`Mengekspor ${recs.length} log ke CSV.`);
});

document.getElementById("lognet-export-kml-btn").addEventListener("click", async () => {
  const recs = await getAllLognet();
  const n = downloadLognetKml(recs);
  showToast(n > 0 ? `Mengekspor ${n} titik ke KML (Google Earth).` : "Belum ada log dengan koordinat GPS.");
});

document.getElementById("lognet-export-gpx-btn").addEventListener("click", async () => {
  const recs = await getAllLognet();
  const n = downloadLognetGpx(recs);
  showToast(n > 0 ? `Mengekspor ${n} titik ke GPX (UTM Geo Map).` : "Belum ada log dengan koordinat GPS.");
});

document.getElementById("lognet-import-btn").addEventListener("click", async () => {
  const fileInput = document.getElementById("lognet-import-file");
  const status = document.getElementById("lognet-import-status");
  const file = fileInput.files[0];
  if (!file) {
    status.textContent = "Pilih file CSV terlebih dahulu.";
    return;
  }
  const text = await file.text();
  const records = csvToRecords(text);
  const cleaned = records.map((r) => {
    const out = { ...r };
    LOGNET_FIELDS.forEach((f) => {
      if (f.type === "number" && out[f.key] !== "" && out[f.key] !== undefined) {
        out[f.key] = Number(out[f.key]);
      }
    });
    return out;
  });
  await bulkAddLognet(cleaned);
  status.textContent = `${cleaned.length} log berhasil diimpor.`;
  await reloadLognet();
  showToast(`${cleaned.length} log diimpor.`);
});

// ---------- Stats view ----------
function renderStats() {
  const recs = state.records;
  const lognetRecs = state.lognetRecords;
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

  // ---------- Log Mist Net (Log Banding) ----------
  const lognetTotal = lognetRecs.length;
  const byNetKode = {};
  const byNetLokasi = {};
  let lognetRetrap = 0;
  let lognetBurung = 0;
  lognetRecs.forEach((r) => {
    if (r.net_kode) byNetKode[r.net_kode] = (byNetKode[r.net_kode] || 0) + 1;
    if (r.net_lokasi) byNetLokasi[r.net_lokasi] = (byNetLokasi[r.net_lokasi] || 0) + 1;
    if (isRetrap({ retrap: r.net_retrap })) lognetRetrap++;
    if (r.net_nama_burung) lognetBurung++;
  });
  const topNetLokasi = Object.entries(byNetLokasi).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const netKodeChartData = topCounts(lognetRecs, "net_kode", 10).sort((a, b) => a.value - b.value);
  const netSpeciesChartData = topCounts(lognetRecs, "net_nama_burung", 10).sort((a, b) => a.value - b.value);
  const netTrendData = monthlyTrend(lognetRecs, "net_tanggal");

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

    <div class="stat-card wide"><h3 class="stat-section-title">Statistik Log Banding (Mist Net)</h3></div>

    <div class="stat-card"><div class="num">${lognetTotal}</div><div class="label">Total Log Net</div></div>
    <div class="stat-card"><div class="num">${Object.keys(byNetKode).length}</div><div class="label">Jumlah Net (Usaha Tangkap)</div></div>
    <div class="stat-card"><div class="num">${lognetBurung}</div><div class="label">Log dengan Burung Tertangkap</div></div>
    <div class="stat-card"><div class="num">${lognetRetrap}</div><div class="label">Retrap (Log)</div></div>

    <div class="stat-card wide chart-card">
      <div class="label">Grafik: 10 Net Paling Sering Dicek</div>
      ${barChartHorizontal(netKodeChartData)}
      <p class="chart-caption">Jumlah kali cek per kode net (10 tertinggi) -- gambaran usaha tangkap (effort).</p>
    </div>

    <div class="stat-card wide chart-card">
      <div class="label">Grafik: Tren Log Banding per Bulan</div>
      ${lineChartTrend(netTrendData)}
      <p class="chart-caption">Jumlah log mist net per bulan, seluruh periode data.</p>
    </div>

    <div class="stat-card wide chart-card">
      <div class="label">Grafik: 10 Spesies Terbanyak dari Log Banding</div>
      ${barChartHorizontal(netSpeciesChartData)}
      <p class="chart-caption">Nama burung tercatat di Log Banding (10 tertinggi) -- bandingkan dengan grafik spesies tally sheet di atas.</p>
    </div>

    <div class="stat-card wide">
      <div class="label">Tabel: Lokasi Log Banding Terbanyak</div>
      <ul class="stat-list">${topNetLokasi.map(([k, v]) => `<li><span>${escapeHtml(k)}</span><strong>${v}</strong></li>`).join("") || "<li>Belum ada data</li>"}</ul>
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
  if (!confirm("Yakin ingin menghapus SEMUA data (tally sheet dan Log Banding) di perangkat ini? Tindakan ini tidak bisa dibatalkan.")) return;
  const recs = await getAllRecords();
  const synced = recs.filter((r) => r.cloud_id);
  if (synced.length) {
    // Semua catatan yang pernah tersinkron diingat agar tidak diunduh lagi dari cloud saat aplikasi dibuka ulang.
    await addTombs(synced.map((r) => r.cloud_id), false);
    const me = cloud.currentUser()?.email || "";
    const mine = synced.filter((r) => !cloud.isShared() || !r.owner_email || r.owner_email === me);
    if (mine.length && confirm(`Juga hapus ${mine.length} catatan milik akun Anda di cloud?\n\nOK = hapus juga di cloud (tidak bisa dibatalkan).\nBatal = hanya di perangkat ini; data cloud tetap aman dan tidak diunduh lagi ke perangkat ini.${cloud.isShared() ? "\n\nCatatan milik anggota tim lain tidak dihapus." : ""}`)) {
      await addTombs(mine.map((r) => r.cloud_id), true);
      flushCloudDeletes().then((n) => { if (n) showToast(`${n} catatan juga dihapus di cloud.`); });
    }
  }
  await clearAll();
  await clearAllLognet();
  await reload();
  await reloadLognet();
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
let lastViewRestored = false;
function showApp() {
  document.getElementById("auth-gate").hidden = true;
  document.getElementById("app-header").hidden = false;
  document.getElementById("app").hidden = false;
  // Sekali per sesi -- auth state bisa berubah lagi nanti (mis. refresh
  // token), tapi kita tidak mau menimpa halaman yang sedang dibuka user
  // saat itu tiap kali showApp() dipanggil ulang.
  if (!lastViewRestored) {
    lastViewRestored = true;
    restoreLastView();
  }
}

function showGate() {
  clearAuthMarker();
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
  clearAuthMarker();
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

// ---------- Catatan yang sudah dihapus (agar tidak diunduh lagi dari cloud) ----------
// { cloud_id: { pending: true = belum terhapus di cloud (mis. dihapus tanpa sinyal), t: waktu } }
const TOMB_KEY = "cloud_tombstones";
async function getTombs() { try { return (await getSetting(TOMB_KEY)) || {}; } catch (e) { return {}; } }
async function addTombs(ids, pending) {
  const t = await getTombs();
  ids.filter(Boolean).forEach((id) => { t[id] = { pending: !!pending || !!(t[id] && t[id].pending), t: Date.now() }; });
  await saveSetting(TOMB_KEY, t);
}
// Hapus di cloud catatan yang tertunda; yang berhasil ditandai selesai (tetap diingat agar tidak diunduh lagi).
async function flushCloudDeletes() {
  if (!cloud.currentUser() || !navigator.onLine) return 0;
  const t = await getTombs(); let n = 0;
  for (const [id, v] of Object.entries(t)) {
    if (!v.pending) continue;
    try { await cloud.deleteCloudRecord(id); v.pending = false; n++; } catch (e) { /* coba lagi saat sinkron berikutnya */ }
  }
  if (n) await saveSetting(TOMB_KEY, t);
  return n;
}

async function syncAll(silent) {
  if (!cloud.currentUser()) return;
  const syncStatus = document.getElementById("akun-sync-status");
  try {
    if (!silent && syncStatus) syncStatus.textContent = "Menyinkronkan data...";

    await flushCloudDeletes();
    const tombs = await getTombs();
    const unsynced = await getUnsyncedRecords();
    for (const rec of unsynced) {
      const cloudId = await cloud.pushRecord(rec);
      if (cloudId) await updateRecord({ ...rec, cloud_id: cloudId });
    }

    const cloudRecords = await cloud.fetchAllCloudRecords();
    let pulled = 0;
    for (const cr of cloudRecords) {
      if (tombs[cr.cloud_id]) continue;   // sudah dihapus di perangkat ini: jangan diunduh lagi
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
// Lupakan daftar catatan yang dihapus di perangkat ini (kecuali yang menunggu dihapus di cloud), lalu sinkron ulang.
document.getElementById("akun-redownload-btn").addEventListener("click", async () => {
  if (!confirm("Unduh ulang semua catatan dari cloud, termasuk yang sebelumnya dihapus hanya di perangkat ini?")) return;
  const t = await getTombs();
  for (const [id, v] of Object.entries(t)) if (!v.pending) delete t[id];
  await saveSetting(TOMB_KEY, t);
  syncAll(false);
});

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

// ---------- Ingat sesi login di perangkat ini (supaya refresh langsung
// masuk tanpa menunggu SDK Firebase dimuat dari internet) ----------
// Penanda ini hanya mempercepat tampilan awal. Keabsahan sesi tetap dicek
// Firebase di latar belakang: kalau ternyata sudah keluar/ditolak, penanda
// dihapus dan pengguna dikembalikan ke halaman login.
const AUTH_MARKER_KEY = "auth_marker_v1";

function saveAuthMarker(user) {
  try {
    localStorage.setItem(
      AUTH_MARKER_KEY,
      JSON.stringify({ uid: user.uid, email: user.email, admin: cloud.isAdmin() })
    );
  } catch (err) {
    // localStorage nonaktif/penuh -- lewati, tidak fatal.
  }
}

function loadAuthMarker() {
  try {
    const raw = localStorage.getItem(AUTH_MARKER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function clearAuthMarker() {
  try {
    localStorage.removeItem(AUTH_MARKER_KEY);
  } catch (err) {
    // abaikan
  }
}

async function handleAuthedUser(user) {
  await renderAkunUi();
  if (cloud.isApproved()) {
    saveAuthMarker(user);
    showApp();
    syncAll(true);
  } else {
    showPendingApproval(user.email);
  }
}

let authRetryTimer = null;
let authRetryCount = 0;

function initAuthWatch() {
  clearTimeout(authRetryTimer);
  const marker = cloud.isEnabled() ? loadAuthMarker() : null;

  if (marker) {
    // Perangkat ini sudah pernah login & disetujui: langsung tampilkan
    // aplikasi (data lokal sudah ada di IndexedDB), lalu verifikasi ke
    // Firebase di latar belakang.
    document.getElementById("nav-admin").hidden = !marker.admin;
    document.getElementById("header-logout-btn").hidden = false;
    document.getElementById("akun-not-configured").hidden = true;
    document.getElementById("akun-logged-in").hidden = false;
    document.getElementById("akun-email-display").textContent = marker.email;
    showApp();
  } else {
    document.getElementById("gate-checking").hidden = false;
    document.getElementById("gate-error").hidden = true;
    document.getElementById("gate-pending").hidden = true;
    document.getElementById("gate-login-form").hidden = true;
  }

  cloud
    .onAuthChange(async (user) => {
      authRetryCount = 0;
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
      if (!marker) {
        showGateError("Gagal memuat layanan login: " + err.message);
        return;
      }
      // Sudah masuk lewat penanda sesi: jangan blokir. Tetap pakai aplikasi
      // (data tersimpan di perangkat) dan coba sambungkan lagi nanti.
      showToast("Mode offline: layanan login belum termuat. Data tetap tersimpan di perangkat.");
      if (authRetryCount < 3) {
        authRetryCount++;
        authRetryTimer = setTimeout(initAuthWatch, 15000);
      }
    });
}

window.addEventListener("online", () => {
  if (loadAuthMarker() && !cloud.currentUser()) initAuthWatch();
});

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
reloadLognet();
initMapPicker();
