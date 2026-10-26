import { useMemo } from 'react';
import { CategoryScale, Chart as ChartJS, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip } from 'chart.js';
import { Line } from 'react-chartjs-2';
import type { GroundAt } from '../../lib/elevation';
import type { LatLon } from '../../lib/geo';
import { SPEED_OF_LIGHT_MPS } from '../../lib/rf';
import { buildProfile, bullingtonLossDb, earthBulgeM, fresnelRadiusM } from '../../lib/propagation';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

type End = LatLon & { aglM: number };

/** Ground (with Earth bulge), direct ray and the 60 % first Fresnel envelope along the Tx→Rx path. */
export function PathProfileChart({ tx, rx, groundAt, frequencyGhz }: { tx: End; rx: End; groundAt: GroundAt; frequencyGhz: number }) {
  const chart = useMemo(() => {
    const profile = buildProfile(tx, rx, groundAt);
    if (!profile) return null;
    const { distancesM: d, groundM } = profile;
    const length = d[d.length - 1];
    const txElev = groundM[0] + tx.aglM, rxElev = groundM[groundM.length - 1] + rx.aglM;
    const wavelength = SPEED_OF_LIGHT_MPS / (frequencyGhz * 1e9);
    const ray = Array.from(d, (x) => txElev + (rxElev - txElev) * x / length);
    const f1 = Array.from(d, (x) => 0.6 * fresnelRadiusM(x, length - x, wavelength));
    const worst = bullingtonLossDb(profile, txElev, rxElev, frequencyGhz).worstIndex;
    const point = (value: number, i: number) => (i === worst ? value : null);
    return {
      labels: Array.from(d, (x) => (x / 1000).toFixed(2)),
      datasets: [
        { label: 'Ground + Earth bulge', data: Array.from(groundM), borderColor: '#b08968', backgroundColor: 'rgba(176, 137, 104, .28)', fill: 'origin', pointRadius: 0, borderWidth: 1.5 },
        { label: 'Ground', data: Array.from(groundM, (g, i) => g - earthBulgeM(d[i], length - d[i])), borderColor: '#7c6a58', borderDash: [3, 3], fill: false, pointRadius: 0, borderWidth: 1 },
        { label: 'Direct ray', data: ray, borderColor: '#59d499', fill: false, pointRadius: 0, borderWidth: 2 },
        { label: '60% Fresnel zone', data: ray.map((y, i) => y - f1[i]), borderColor: '#5aa9ff', borderDash: [5, 4], fill: false, pointRadius: 0, borderWidth: 1.5 },
        { label: 'Worst obstruction', data: Array.from(groundM, (g, i) => point(g, i)), borderColor: '#ff6161', backgroundColor: '#ff6161', showLine: false, pointRadius: 6, fill: false },
      ],
    };
  }, [tx.lat, tx.lon, tx.aglM, rx.lat, rx.lon, rx.aglM, groundAt, frequencyGhz]);

  if (!chart) return <p className="field-note">Path profile unavailable: ground elevation for this path has not loaded.</p>;
  return (
    <div className="path-profile" role="img" aria-label="Path profile: ground, direct ray and Fresnel zone between transmitter and receiver">
      <Line
        data={chart}
        options={{
          responsive: true, maintainAspectRatio: false, animation: false, spanGaps: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { labels: { color: '#c8cacc', boxWidth: 14, font: { size: 11 } } } },
          scales: {
            x: { title: { display: true, text: 'Distance from Tx (km)', color: '#9c9c9d' }, ticks: { color: '#9c9c9d', maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,.06)' } },
            y: { title: { display: true, text: 'Elevation (m)', color: '#9c9c9d' }, ticks: { color: '#9c9c9d' }, grid: { color: 'rgba(255,255,255,.06)' } },
          },
        }}
      />
    </div>
  );
}
