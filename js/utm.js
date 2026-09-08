// Konversi koordinat Latitude/Longitude (WGS84) ke UTM.
// Dipakai supaya data GPS bisa langsung dicocokkan dengan aplikasi UTM Geo Map
// atau alat GPS lapangan lain yang membaca koordinat UTM.

const A = 6378137.0; // sumbu mayor WGS84
const E = 0.0818191908426; // eksentrisitas WGS84
const K0 = 0.9996;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

export function latLonToUtm(lat, lon) {
  if (lat === "" || lon === "" || lat === undefined || lon === undefined || lat === null || lon === null) return null;
  lat = Number(lat);
  lon = Number(lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;

  const zone = Math.floor((lon + 180) / 6) + 1;
  const lonOrigin = (zone - 1) * 6 - 180 + 3;
  const lonOriginRad = toRad(lonOrigin);

  const latRad = toRad(lat);
  const lonRad = toRad(lon);

  const eSq = E * E;
  const ePrimeSq = eSq / (1 - eSq);

  const N = A / Math.sqrt(1 - eSq * Math.sin(latRad) * Math.sin(latRad));
  const T = Math.tan(latRad) * Math.tan(latRad);
  const C = ePrimeSq * Math.cos(latRad) * Math.cos(latRad);
  const Adist = Math.cos(latRad) * (lonRad - lonOriginRad);

  const M =
    A *
    ((1 - eSq / 4 - (3 * eSq * eSq) / 64 - (5 * eSq * eSq * eSq) / 256) * latRad -
      ((3 * eSq) / 8 + (3 * eSq * eSq) / 32 + (45 * eSq * eSq * eSq) / 1024) * Math.sin(2 * latRad) +
      ((15 * eSq * eSq) / 256 + (45 * eSq * eSq * eSq) / 1024) * Math.sin(4 * latRad) -
      ((35 * eSq * eSq * eSq) / 3072) * Math.sin(6 * latRad));

  let easting =
    K0 *
      N *
      (Adist +
        ((1 - T + C) * Adist ** 3) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * ePrimeSq) * Adist ** 5) / 120) +
    500000.0;

  let northing =
    K0 *
    (M +
      N *
        Math.tan(latRad) *
        ((Adist ** 2) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * Adist ** 4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * ePrimeSq) * Adist ** 6) / 720));

  const hemisphere = lat < 0 ? "S" : "N";
  if (lat < 0) northing += 10000000.0;

  return {
    zone,
    hemisphere,
    easting: Math.round(easting * 100) / 100,
    northing: Math.round(northing * 100) / 100,
  };
}

export function formatUtm(utm) {
  if (!utm) return "-";
  return `${utm.zone}${utm.hemisphere} ${Math.round(utm.easting)}mE ${Math.round(utm.northing)}mN`;
}
