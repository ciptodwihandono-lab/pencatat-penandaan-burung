// Grafik statistik gaya publikasi ilmiah, dirender sebagai SVG murni (tanpa
// library eksternal) supaya tetap ringan dan bekerja penuh offline.
// Mengikuti kaidah: sequential (satu hue) untuk magnitude/tren, categorical
// (palet tervalidasi CVD-safe) untuk perbandingan identitas/komposisi.

function escapeXml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

function truncateLabel(label, maxChars) {
  const s = String(label ?? "");
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars - 1).trimEnd() + "…";
}

function niceMax(value) {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const steps = [1, 2, 2.5, 5, 10];
  for (const s of steps) {
    if (value <= s * magnitude) return s * magnitude;
  }
  return 10 * magnitude;
}

function emptyState(width, height, message) {
  return `<svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="${escapeXml(message)}">
    <text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="chart-empty">${escapeXml(message)}</text>
  </svg>`;
}

// ---------- Bar chart horizontal (magnitude, satu hue) ----------
// data: [{label, value}], sudah terurut menurun oleh pemanggil
export function barChartHorizontal(data, opts = {}) {
  const width = opts.width || 640;
  const rowH = 28;
  const gap = 6;
  const marginLeft = opts.marginLeft || 150;
  const marginRight = 48;
  const marginTop = 8;
  const marginBottom = 8;
  if (!data.length) return emptyState(width, 120, "Belum ada data");

  const height = marginTop + marginBottom + data.length * (rowH + gap) - gap;
  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const plotW = width - marginLeft - marginRight;

  const maxLabelChars = Math.max(6, Math.floor((marginLeft - 10) / 6.2));
  const bars = data
    .map((d, i) => {
      const y = marginTop + i * (rowH + gap);
      const barW = Math.max(2, (d.value / max) * plotW);
      const labelText = truncateLabel(d.label, maxLabelChars);
      const titleTag = labelText !== d.label ? `<title>${escapeXml(d.label)}</title>` : "";
      return `
      <text x="${marginLeft - 10}" y="${y + rowH / 2}" dy="0.35em" text-anchor="end" class="chart-cat-label">${escapeXml(labelText)}${titleTag}</text>
      <rect x="${marginLeft}" y="${y}" width="${barW}" height="${rowH - 6}" rx="4" class="chart-bar-fill" />
      <text x="${marginLeft + barW + 8}" y="${y + (rowH - 6) / 2}" dy="0.35em" class="chart-value-label">${d.value}</text>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="Grafik batang: ${escapeXml(data.map((d) => `${d.label} ${d.value}`).join(", "))}">
    <line x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${height - marginBottom}" class="chart-axis" />
    ${bars}
  </svg>`;
}

// ---------- Line chart (tren waktu, satu hue) ----------
// data: [{label, value}] terurut kronologis
export function lineChartTrend(data, opts = {}) {
  const width = opts.width || 640;
  const height = opts.height || 220;
  const marginLeft = 40;
  const marginRight = 16;
  const marginTop = 16;
  const marginBottom = 34;
  if (!data.length) return emptyState(width, height, "Belum ada data");

  const max = niceMax(Math.max(...data.map((d) => d.value), 1));
  const plotW = width - marginLeft - marginRight;
  const plotH = height - marginTop - marginBottom;
  const stepX = data.length > 1 ? plotW / (data.length - 1) : 0;
  const xAt = (i) => marginLeft + i * stepX;
  const yAt = (v) => marginTop + plotH - (v / max) * plotH;

  const gridLines = [0, 0.5, 1].map((f) => {
    const y = marginTop + plotH * (1 - f);
    const val = Math.round(max * f);
    return `<line x1="${marginLeft}" y1="${y}" x2="${width - marginRight}" y2="${y}" class="chart-grid" />
      <text x="${marginLeft - 8}" y="${y}" dy="0.32em" text-anchor="end" class="chart-axis-label">${val}</text>`;
  }).join("");

  const points = data.map((d, i) => `${xAt(i)},${yAt(d.value)}`).join(" ");

  const showEvery = Math.ceil(data.length / 8) || 1;
  const xLabels = data
    .map((d, i) => {
      if (i % showEvery !== 0 && i !== data.length - 1) return "";
      return `<text x="${xAt(i)}" y="${height - marginBottom + 16}" text-anchor="middle" class="chart-axis-label">${escapeXml(d.label)}</text>`;
    })
    .join("");

  const dots = data
    .map((d, i) => {
      const isLast = i === data.length - 1;
      const r = isLast ? 5 : 4;
      const label = isLast ? `<text x="${xAt(i)}" y="${yAt(d.value) - 12}" text-anchor="middle" class="chart-value-label">${d.value}</text>` : "";
      return `<circle cx="${xAt(i)}" cy="${yAt(d.value)}" r="${r}" class="chart-line-dot" />${label}`;
    })
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="Grafik tren: ${escapeXml(data.map((d) => `${d.label} ${d.value}`).join(", "))}">
    ${gridLines}
    <line x1="${marginLeft}" y1="${marginTop + plotH}" x2="${width - marginRight}" y2="${marginTop + plotH}" class="chart-axis" />
    <polyline points="${points}" class="chart-line-stroke" fill="none" />
    ${dots}
    ${xLabels}
  </svg>`;
}

// ---------- Bar chart vertical kategorikal (komposisi, multi-hue tervalidasi) ----------
// data: [{label, value}]
export function barChartCategorical(data, opts = {}) {
  const width = opts.width || 320;
  const height = opts.height || 200;
  const marginLeft = 32;
  const marginRight = 8;
  const marginTop = 12;
  const marginBottom = 34;
  if (!data.length) return emptyState(width, height, "Belum ada data");

  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const plotW = width - marginLeft - marginRight;
  const plotH = height - marginTop - marginBottom;
  const slot = plotW / data.length;
  const barW = Math.min(40, slot * 0.6);

  const maxLabelChars = Math.max(4, Math.floor(slot / 6));
  const bars = data
    .map((d, i) => {
      const cx = marginLeft + slot * i + slot / 2;
      const barH = Math.max(2, (d.value / max) * plotH);
      const x = cx - barW / 2;
      const y = marginTop + plotH - barH;
      const colorClass = `chart-series-${(i % 8) + 1}`;
      const labelText = truncateLabel(d.label, maxLabelChars);
      const titleTag = labelText !== d.label ? `<title>${escapeXml(d.label)}</title>` : "";
      return `
      <rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4" class="chart-cat-bar ${colorClass}" />
      <text x="${cx}" y="${y - 6}" text-anchor="middle" class="chart-value-label">${d.value}</text>
      <text x="${cx}" y="${height - marginBottom + 16}" text-anchor="middle" class="chart-axis-label">${escapeXml(labelText)}${titleTag}</text>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="Grafik komposisi: ${escapeXml(data.map((d) => `${d.label} ${d.value}`).join(", "))}">
    <line x1="${marginLeft}" y1="${marginTop + plotH}" x2="${width - marginRight}" y2="${marginTop + plotH}" class="chart-axis" />
    ${bars}
  </svg>`;
}

// ---------- Agregasi bantu ----------
export function topCounts(records, key, limit = 10) {
  const counts = {};
  records.forEach((r) => {
    const v = (r[key] || "").toString().trim();
    if (!v) return;
    counts[v] = (counts[v] || 0) + 1;
  });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length <= limit) return entries.map(([label, value]) => ({ label, value }));
  const top = entries.slice(0, limit - 1);
  const restTotal = entries.slice(limit - 1).reduce((s, [, v]) => s + v, 0);
  return [...top.map(([label, value]) => ({ label, value })), { label: "Lainnya", value: restTotal }];
}

export function monthlyTrend(records, dateKey = "tanggal") {
  const counts = {};
  records.forEach((r) => {
    const t = (r[dateKey] || "").trim();
    const m = /^(\d{4})-(\d{2})/.exec(t);
    if (!m) return;
    const key = `${m[1]}-${m[2]}`;
    counts[key] = (counts[key] || 0) + 1;
  });
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return Object.keys(counts)
    .sort()
    .map((key) => {
      const [y, mo] = key.split("-");
      return { label: `${monthNames[Number(mo) - 1]} ${y.slice(2)}`, value: counts[key] };
    });
}
