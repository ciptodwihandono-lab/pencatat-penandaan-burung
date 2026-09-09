// Skema field data — disusun mengikuti persis kolom pada tally sheet
// "INDONESIAN BIRD BANDING SCHEME: FIELD DATA SHEET" (sheet Pass & Waders)
// milik pengguna, ditambah bagian GPS/UTM yang tidak ada di kertas.

// Saran nilai (bukan pilihan yang dipaksakan — field tetap teks bebas
// supaya cocok dengan kode/istilah yang biasa dipakai di lapangan).
export const RETRAP_SUGGESTIONS = ["Y", "N"];
export const AGE_SUGGESTIONS = ["PULL", "JUV", "1Y", "AD", "U"];
export const SEX_SUGGESTIONS = ["M", "F", "U"];
export const METHOD_SUGGESTIONS = ["MN", "HT", "CT", "TRAP"];
export const STATUS_SUGGESTIONS = ["N", "R", "C", "DEAD"];

// Setiap field: key (nama properti record), label tampilan, tipe input, dan section form.
// type "suggest" = input teks bebas + datalist saran (tidak memaksa nilai tertentu).
export const FIELDS = [
  // Info Kegiatan — header tally sheet (INDONESIAN BIRD BANDING SCHEME:
  // FIELD DATA SHEET / BANDER / LOCATION / DATE), diisi sekali per sesi
  // pencatatan di kertas, di sini diisi per catatan supaya konsisten.
  { key: "bander", label: "Bander (Penanggung Jawab Kegiatan)", type: "text", section: "info", required: true },
  { key: "lokasi_nama", label: "Location (Nama Lokasi Kegiatan)", type: "text", section: "info", required: true },

  // Pencatatan (baris paling kiri pada tally sheet)
  { key: "catat", label: "Catat (Pencatat)", type: "text", section: "pencatatan" },
  { key: "pencincin_pengukur", label: "Pencincin / Pengukur (Bander/Measurer)", type: "text", section: "pencatatan", required: true },
  { key: "cek_trainer", label: "Cek / Trainer (Checker/Trainer)", type: "text", section: "pencatatan" },

  // Cincin & status tangkap ulang
  { key: "nomor_cincin", label: "Band Number (Nomor Cincin)", type: "text", section: "cincin", required: true },
  { key: "retrap", label: "Retrap (Tangkap Ulang)", type: "suggest", options: RETRAP_SUGGESTIONS, section: "cincin" },

  // Spesies
  { key: "nama_spesies", label: "Scientific or Common Name (Nama Spesies)", type: "text", section: "spesies", required: true },
  { key: "nomor_spesies", label: "Species Number (Nomor Spesies)", type: "text", section: "spesies" },

  // Umur & kelamin
  { key: "umur", label: "Age (Umur)", type: "suggest", options: AGE_SUGGESTIONS, section: "biologi" },
  { key: "cara_umur", label: "How Aged (Cara Penentuan Umur)", type: "text", section: "biologi" },
  { key: "kelamin", label: "Sex (Jenis Kelamin)", type: "suggest", options: SEX_SUGGESTIONS, section: "biologi" },
  { key: "cara_kelamin", label: "How Sexed (Cara Penentuan Kelamin)", type: "text", section: "biologi" },

  { key: "tanggal", label: "Date (Tanggal)", type: "date", section: "info", required: true },

  // Lokasi & waktu (sesuai kolom tally sheet)
  { key: "kode_lokasi", label: "Location Code (Kode Lokasi)", type: "text", section: "waktu", required: true },
  { key: "waktu", label: "Time (Jam)", type: "time", section: "waktu" },

  // Penangkapan
  { key: "metode", label: "Method (Metode)", type: "suggest", options: METHOD_SUGGESTIONS, section: "tangkap" },
  { key: "status", label: "Status", type: "suggest", options: STATUS_SUGGESTIONS, section: "tangkap" },

  // GPS / UTM — tambahan di luar tally sheet kertas, untuk Google Earth & UTM Geo Map
  { key: "latitude", label: "Latitude", type: "number", step: "any", section: "gps" },
  { key: "longitude", label: "Longitude", type: "number", step: "any", section: "gps" },
  { key: "ketinggian_m", label: "Ketinggian GPS (m)", type: "number", section: "gps" },

  // Berat (gram) — 3 kolom sesuai tally sheet: burung+kantong, kantong, burung bersih
  { key: "berat_bird_bag", label: "Weight: Bird & Bag (g)", type: "number", step: "0.1", section: "berat" },
  { key: "berat_bag", label: "Weight: Bag (g)", type: "number", step: "0.1", section: "berat" },
  { key: "berat_bird", label: "Weight: Bird (g)", type: "number", step: "0.1", section: "berat" },

  // Morfometri — HB/WL/TL, masing-masing ada kolom "ukur" dan "cek"
  { key: "hb_ukur", label: "HB (mm) — ukur", type: "number", step: "0.1", section: "morfometri" },
  { key: "hb_cek", label: "HB (mm) — cek", type: "number", step: "0.1", section: "morfometri" },
  { key: "wl_ukur", label: "WL (mm) — ukur", type: "number", step: "0.1", section: "morfometri" },
  { key: "wl_cek", label: "WL (mm) — cek", type: "number", step: "0.1", section: "morfometri" },
  { key: "tl_ukur", label: "TL (mm) — ukur", type: "number", step: "0.1", section: "morfometri" },
  { key: "tl_cek", label: "TL (mm) — cek", type: "number", step: "0.1", section: "morfometri" },
  { key: "td_diameter_tarsus", label: "TD — Diameter Tarsus (mm)", type: "number", step: "0.1", section: "morfometri" },

  // Tambahan
  { key: "brood_patch", label: "Brood Patch (khusus data Passerine)", type: "text", section: "tambahan" },
  { key: "moult_score", label: "Moult Score", type: "text", section: "tambahan" },
  { key: "photo_ref", label: "Photo (nomor/keterangan foto sesuai tally sheet)", type: "text", section: "tambahan" },
  { key: "catatan", label: "Catatan (Notes)", type: "textarea", section: "tambahan" },
];

export const SECTIONS = [
  { key: "info", title: "Info Kegiatan (Header Tally Sheet)" },
  { key: "pencatatan", title: "Pencatatan" },
  { key: "cincin", title: "Cincin & Retrap" },
  { key: "spesies", title: "Spesies" },
  { key: "biologi", title: "Umur & Jenis Kelamin" },
  { key: "waktu", title: "Kode Lokasi & Waktu" },
  { key: "tangkap", title: "Penangkapan" },
  { key: "gps", title: "Koordinat GPS (untuk Google Earth & UTM Geo Map)" },
  { key: "berat", title: "Berat (gram)" },
  { key: "morfometri", title: "Morfometri (mm)" },
  { key: "tambahan", title: "Brood Patch, Moult, Foto & Catatan" },
];

export const CSV_COLUMNS = [
  "id",
  ...FIELDS.map((f) => f.key),
  "utm_zone",
  "utm_hemisphere",
  "utm_easting",
  "utm_northing",
  "foto",
  "created_at",
  "updated_at",
];
