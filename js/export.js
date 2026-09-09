import { CSV_COLUMNS } from "./fields.js";

function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

function triggerDownload(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- Google Earth (KML) ----------
export function recordsToKml(records) {
  const withGps = records.filter((r) => r.latitude !== "" && r.longitude !== "" && r.latitude !== undefined && r.longitude !== undefined);
  const placemarks = withGps
    .map((r) => {
      const name = r.nama_spesies || r.nomor_cincin || "Data Penandaan";
      const desc = [
        `Nomor Cincin: ${escapeXml(r.nomor_cincin || "-")}`,
        `Spesies: ${escapeXml(r.nama_spesies || "-")}`,
        `Tanggal: ${escapeXml(r.tanggal || "-")} ${escapeXml(r.waktu || "")}`,
        `Kode Lokasi: ${escapeXml(r.kode_lokasi || "-")}`,
        `Pencincin/Pengukur: ${escapeXml(r.pencincin_pengukur || "-")}`,
        `Umur/Kelamin: ${escapeXml(r.umur || "-")} / ${escapeXml(r.kelamin || "-")}`,
        `Catatan: ${escapeXml(r.catatan || "-")}`,
      ].join("<br/>");
      return `<Placemark><name>${escapeXml(name)}</name><description><![CDATA[${desc}]]></description><Point><coordinates>${r.longitude},${r.latitude},0</coordinates></Point></Placemark>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<name>Data Penandaan Burung</name>
${placemarks}
</Document></kml>`;
}

export function downloadKml(records, filename) {
  const withGps = records.filter((r) => r.latitude !== "" && r.longitude !== "" && r.latitude !== undefined && r.longitude !== undefined);
  triggerDownload(recordsToKml(records), filename || `data-ringing-${new Date().toISOString().slice(0, 10)}.kml`, "application/vnd.google-earth.kml+xml");
  return withGps.length;
}

// ---------- GPX (untuk aplikasi GPS/UTM seperti UTM Geo Map) ----------
export function recordsToGpx(records) {
  const withGps = records.filter((r) => r.latitude !== "" && r.longitude !== "" && r.latitude !== undefined && r.longitude !== undefined);
  const wpts = withGps
    .map((r) => {
      let timeTag = "";
      if (r.tanggal) {
        const iso = new Date(`${r.tanggal}T${r.waktu || "00:00"}:00`);
        if (!Number.isNaN(iso.getTime())) timeTag = `<time>${iso.toISOString()}</time>`;
      }
      const cmt = `Spesies: ${r.nama_spesies || "-"} | Lokasi: ${r.kode_lokasi || "-"} | Petugas: ${r.pencincin_pengukur || "-"}`;
      return `<wpt lat="${r.latitude}" lon="${r.longitude}"><name>${escapeXml(r.nomor_cincin || "")}</name><cmt>${escapeXml(cmt)}</cmt><desc>${escapeXml(r.catatan || "")}</desc>${timeTag}</wpt>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Tally Sheet Penandaan Burung" xmlns="http://www.topografix.com/GPX/1/1">
${wpts}
</gpx>`;
}

export function downloadGpx(records, filename) {
  const withGps = records.filter((r) => r.latitude !== "" && r.longitude !== "" && r.latitude !== undefined && r.longitude !== undefined);
  triggerDownload(recordsToGpx(records), filename || `data-ringing-${new Date().toISOString().slice(0, 10)}.gpx`, "application/gpx+xml");
  return withGps.length;
}

// ---------- Log Mist Net (Log Banding) — Google Earth (KML) & GPX ----------
export function lognetRecordsToKml(records) {
  const withGps = records.filter((r) => r.net_latitude !== "" && r.net_longitude !== "" && r.net_latitude !== undefined && r.net_longitude !== undefined);
  const placemarks = withGps
    .map((r) => {
      const name = r.net_kode || r.net_nama_burung || "Log Mist Net";
      const desc = [
        `Kode Net: ${escapeXml(r.net_kode || "-")}`,
        `Lokasi: ${escapeXml(r.net_lokasi || "-")}`,
        `Tanggal: ${escapeXml(r.net_tanggal || "-")} ${escapeXml(r.net_waktu || "")}`,
        `Nama Burung: ${escapeXml(r.net_nama_burung || "-")}`,
        `Catatan: ${escapeXml(r.net_catatan || "-")}`,
      ].join("<br/>");
      return `<Placemark><name>${escapeXml(name)}</name><description><![CDATA[${desc}]]></description><Point><coordinates>${r.net_longitude},${r.net_latitude},0</coordinates></Point></Placemark>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<name>Log Mist Net</name>
${placemarks}
</Document></kml>`;
}

export function downloadLognetKml(records, filename) {
  const withGps = records.filter((r) => r.net_latitude !== "" && r.net_longitude !== "" && r.net_latitude !== undefined && r.net_longitude !== undefined);
  triggerDownload(lognetRecordsToKml(records), filename || `log-banding-${new Date().toISOString().slice(0, 10)}.kml`, "application/vnd.google-earth.kml+xml");
  return withGps.length;
}

export function lognetRecordsToGpx(records) {
  const withGps = records.filter((r) => r.net_latitude !== "" && r.net_longitude !== "" && r.net_latitude !== undefined && r.net_longitude !== undefined);
  const wpts = withGps
    .map((r) => {
      let timeTag = "";
      if (r.net_tanggal) {
        const iso = new Date(`${r.net_tanggal}T${r.net_waktu || "00:00"}:00`);
        if (!Number.isNaN(iso.getTime())) timeTag = `<time>${iso.toISOString()}</time>`;
      }
      const cmt = `Kode Net: ${r.net_kode || "-"} | Lokasi: ${r.net_lokasi || "-"} | Burung: ${r.net_nama_burung || "-"}`;
      return `<wpt lat="${r.net_latitude}" lon="${r.net_longitude}"><name>${escapeXml(r.net_kode || "")}</name><cmt>${escapeXml(cmt)}</cmt><desc>${escapeXml(r.net_catatan || "")}</desc>${timeTag}</wpt>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Tally Sheet Penandaan Burung" xmlns="http://www.topografix.com/GPX/1/1">
${wpts}
</gpx>`;
}

export function downloadLognetGpx(records, filename) {
  const withGps = records.filter((r) => r.net_latitude !== "" && r.net_longitude !== "" && r.net_latitude !== undefined && r.net_longitude !== undefined);
  triggerDownload(lognetRecordsToGpx(records), filename || `log-banding-${new Date().toISOString().slice(0, 10)}.gpx`, "application/gpx+xml");
  return withGps.length;
}

function csvEscape(value) {
  if (value === undefined || value === null) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

export function recordsToCsv(records, columns = CSV_COLUMNS) {
  const header = columns.join(",");
  const rows = records.map((r) => columns.map((c) => csvEscape(r[c])).join(","));
  return [header, ...rows].join("\r\n");
}

export function downloadCsv(records, filename, columns = CSV_COLUMNS) {
  const csv = "﻿" + recordsToCsv(records, columns); // BOM agar Excel baca UTF-8 dengan benar
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `data-ringing-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Parser CSV sederhana yang mendukung tanda kutip dan koma di dalam field.
function parseCsvLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  result.push(cur);
  return result;
}

export function csvToRecords(csvText) {
  const text = csvText.replace(/^﻿/, "").trim();
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const rec = {};
    header.forEach((h, idx) => {
      rec[h] = cols[idx] !== undefined ? cols[idx] : "";
    });
    records.push(rec);
  }
  return records;
}
