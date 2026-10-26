export interface LatLon { lat: number; lon: number }

/** Central Singapore. Positions are converted to metres on a tangent plane here. */
export const SG_REFERENCE: LatLon = { lat: 1.3521, lon: 103.8198 };

const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

/** Equirectangular tangent plane: x east, y north, in metres. Sub-metre error at island scale. */
export function toLocalM(p: LatLon, ref: LatLon = SG_REFERENCE): { xM: number; yM: number } {
  return {
    xM: EARTH_RADIUS_M * Math.cos(ref.lat * RAD) * (p.lon - ref.lon) * RAD,
    yM: EARTH_RADIUS_M * (p.lat - ref.lat) * RAD,
  };
}

export function toLatLon(p: { xM: number; yM: number }, ref: LatLon = SG_REFERENCE): LatLon {
  return {
    lat: ref.lat + p.yM / EARTH_RADIUS_M / RAD,
    lon: ref.lon + p.xM / (EARTH_RADIUS_M * Math.cos(ref.lat * RAD)) / RAD,
  };
}

export const offsetLatLon = (p: LatLon, dxM: number, dyM: number): LatLon => {
  const local = toLocalM(p);
  return toLatLon({ xM: local.xM + dxM, yM: local.yM + dyM });
};
