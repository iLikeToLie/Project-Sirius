import {
  CategoryScale, Chart as ChartJS, Filler, Legend, LinearScale, LineElement, PointElement, Title, Tooltip,
  type ChartData,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

export default function SweepChart({ data, xTitle }: { data: ChartData<'line'>; xTitle: string }) {
  return <Line data={data} options={{
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: { title: { display: true, text: xTitle, color: '#8ea0bf' }, grid: { color: 'rgba(39, 52, 74, 0.55)' }, ticks: { color: '#8ea0bf', maxTicksLimit: 12 } },
      y: { title: { display: true, text: 'Received power (dBm)', color: '#8ea0bf' }, grid: { color: 'rgba(39, 52, 74, 0.55)' }, ticks: { color: '#8ea0bf' } },
    },
    plugins: { legend: { labels: { color: '#d7ddee', usePointStyle: true, pointStyle: 'line' } } },
  }} />;
}
