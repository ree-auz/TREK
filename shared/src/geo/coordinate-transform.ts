/** Coordinate conversions at an Amap boundary. TREK uses WGS84 internally; Amap uses GCJ-02. */
export interface Coordinate {
  lat: number;
  lng: number;
}

const PI = Math.PI;
const A = 6378245;
const EE = 0.006693421622965943;

/**
 * Mathematical GCJ-02 coverage guard, not a provider-selection policy.
 * Provider choice is explicit per Trip and must never depend on this function.
 */
export function isMainlandChina({ lat, lng }: Coordinate): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lng >= 73.5 && lng <= 135.1 && lat >= 18.1 && lat <= 53.6;
}

function transformLat(x: number, y: number): number {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  r += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3;
  return r + ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3;
}

function transformLng(x: number, y: number): number {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  r += ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3;
  return r + ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3;
}

export function wgs84ToGcj02(point: Coordinate): Coordinate {
  if (!isMainlandChina(point)) return { ...point };
  const dLat0 = transformLat(point.lng - 105, point.lat - 35);
  const dLng0 = transformLng(point.lng - 105, point.lat - 35);
  const radLat = (point.lat / 180) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const dLat = (dLat0 * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  const dLng = (dLng0 * 180) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return { lat: point.lat + dLat, lng: point.lng + dLng };
}

/** Local iterative inverse used only when GCJ-02 data crosses into TREK's WGS84 model. */
export function gcj02ToWgs84(point: Coordinate): Coordinate {
  if (!isMainlandChina(point)) return { ...point };
  let guess = { ...point };
  for (let i = 0; i < 8; i++) {
    const projected = wgs84ToGcj02(guess);
    guess = { lat: guess.lat - (projected.lat - point.lat), lng: guess.lng - (projected.lng - point.lng) };
  }
  return guess;
}

export function parseAmapCoordinate(value: unknown): Coordinate | null {
  if (typeof value !== 'string') return null;
  const parts = value.split(',');
  if (parts.length !== 2) return null;
  const lng = Number(parts[0]);
  const lat = Number(parts[1]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}
