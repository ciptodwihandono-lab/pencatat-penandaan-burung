// Isian otomatis untuk form catatan penandaan & Log Mist Net:
// - Pencarian jenis burung Indonesia (nama Indonesia / ilmiah / Inggris / famili), bekerja tanpa sinyal.
// - Saran dari isian yang pernah dipakai (datalist) untuk kolom teks.
// - Nomor cincin berikutnya, deteksi retrap, nomor spesies dari catatan lama, berat burung otomatis.
import { BURUNG_INDONESIA } from "./burung-indonesia.js";

const IUCN_TERANCAM = new Set(["CR", "EN", "VU", "NT"]);
const ROWS = BURUNG_INDONESIA.map(([sci, ind, eng, fam, iucn, p, pop]) => ({
  sci, ind, eng, fam, iucn, p: !!p, pop,
  q: `${ind} ${sci} ${eng} ${fam}`.toLowerCase(),
}));
const BY_SCI = new Map(ROWS.map((r) => [r.sci.toLowerCase(), r]));

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Cari jenis: semua kata harus cocok; awal nama cocok didahulukan, lalu jenis yang paling sering tercatat di Indonesia. */
export function searchBurung(q, limit = 12) {
  const words = String(q || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || words.join("").length < 2) return [];
  const w0 = words[0];
  const hits = ROWS.filter((r) => words.every((w) => r.q.includes(w)));
  const score = (r) => (r.ind.toLowerCase().startsWith(w0) || r.sci.toLowerCase().startsWith(w0) || r.eng.toLowerCase().startsWith(w0) ? 1 : 0);
  hits.sort((a, b) => score(b) - score(a) || b.pop - a.pop);
  return hits.slice(0, limit);
}
export function findBurung(name) {
  if (!name) return null;
  const n = String(name).trim().toLowerCase();
  return BY_SCI.get(n) || ROWS.find((r) => r.ind.toLowerCase() === n || r.eng.toLowerCase() === n) || null;
}
export const JUMLAH_JENIS = ROWS.length;

/** Kotak saran di bawah input nama burung. onPick(row) dipanggil saat jenis dipilih. */
export function attachSpeciesPicker(input, onPick) {
  if (!input || input.dataset.picker) return;
  input.dataset.picker = "1";
  input.setAttribute("autocomplete", "off");
  input.removeAttribute("list");
  input.placeholder = input.placeholder || "Ketik nama Indonesia, ilmiah, atau Inggris";
  const box = document.createElement("div");
  box.className = "sp-suggest";
  box.hidden = true;
  input.insertAdjacentElement("afterend", box);
  const info = document.createElement("div");
  info.className = "field-hint sp-info";
  box.insertAdjacentElement("afterend", info);

  const showInfo = () => {
    const r = findBurung(input.value);
    info.innerHTML = r
      ? `${r.ind ? esc(r.ind) + " · " : ""}<i>${esc(r.sci)}</i>${r.fam ? " · " + esc(r.fam) : ""}${r.iucn ? ` · IUCN ${esc(r.iucn)}` : ""}${r.p ? " · <b>Dilindungi</b>" : ""}`
      : input.value.trim() ? "Tidak ada di daftar burung Indonesia — boleh diketik bebas." : "";
    info.classList.toggle("warn", !!(r && (r.p || IUCN_TERANCAM.has(r.iucn))));
  };
  const render = () => {
    const res = searchBurung(input.value);
    if (!res.length || document.activeElement !== input) { box.hidden = true; return; }
    box.innerHTML = res.map((r, i) => `<button type="button" data-i="${i}"><b>${r.ind ? esc(r.ind) : `<i>${esc(r.sci)}</i>`}</b>${r.ind ? ` <i>${esc(r.sci)}</i>` : ""}<span>${esc([r.eng, r.fam].filter(Boolean).join(" · "))}${r.iucn && IUCN_TERANCAM.has(r.iucn) ? ` · <em class="iucn">${esc(r.iucn)}</em>` : ""}${r.p ? ' · <em class="iucn">Dilindungi</em>' : ""}</span></button>`).join("");
    box._res = res;
    box.hidden = false;
  };
  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  input.addEventListener("blur", () => setTimeout(() => { box.hidden = true; showInfo(); }, 200));
  // pointerdown agar pilihan terpilih sebelum input kehilangan fokus (penting di HP)
  box.addEventListener("pointerdown", (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    e.preventDefault();
    const r = box._res[Number(b.dataset.i)];
    input.value = r.sci;
    box.hidden = true;
    showInfo();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    box.hidden = true;
    if (onPick) onPick(r);
  });
  input._spShowInfo = showInfo;
  showInfo();
}

/** Datalist berisi nilai yang pernah dipakai (terbaru dahulu), digabung dengan saran bawaan. */
export function attachHistory(input, records, key, base = []) {
  if (!input) return;
  const seen = new Set(), vals = [];
  const add = (v) => { v = String(v ?? "").trim(); if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); vals.push(v); } };
  base.forEach(add);
  records.forEach((r) => add(r[key]));
  if (!vals.length) return;
  let dl = document.getElementById(`hist_${input.id}`);
  if (!dl) { dl = document.createElement("datalist"); dl.id = `hist_${input.id}`; input.insertAdjacentElement("afterend", dl); }
  dl.innerHTML = vals.slice(0, 40).map((v) => `<option value="${esc(v)}">`).join("");
  input.setAttribute("list", dl.id);
  input.setAttribute("autocomplete", "off");
}

/** Nomor cincin berikutnya: angka di akhir nomor terakhir ditambah 1, panjang angka dipertahankan (A0123 -> A0124). */
export function nextBandNumber(records) {
  const last = records.filter((r) => r.nomor_cincin).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "") || (b.id || 0) - (a.id || 0))[0];
  const m = last && /^(.*?)(\d+)(\D*)$/.exec(String(last.nomor_cincin).trim());
  if (!m) return "";
  const n = String(Number(m[2]) + 1).padStart(m[2].length, "0");
  return m[1] + n + m[3];
}
