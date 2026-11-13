import type { Reading, TdsUnit } from '../domain/types';
import { displayTds } from '../services/measurements';

interface Props { readings: Reading[]; unit: TdsUnit; }

export default function Sparkline({ readings, unit }: Props) {
  const points = readings;
  if (!points.length) return null;
  const values = points.map((point) => displayTds(point.tdsPpm, unit));
  const min = Math.min(...values), max = Math.max(...values);
  const padding = Math.max((max - min) * 0.16, Math.abs(max) * 0.04, 0.05);
  const low = min - padding, high = max + padding;
  const coords = values.map((value, index) => ({ x: points.length === 1 ? 400 : 4 + (index / (points.length - 1)) * 792, y: 220 - ((value - low) / (high - low)) * 210 }));
  const path = coords.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const last = coords[coords.length - 1];
  const labels = [0, 0.33, 0.67, 1].map((position) => (high - (high - low) * position).toPrecision(3));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((part) => Math.round((points.length - 1) * part));

  return (
    <div className="chart-area">
      <div className="chart-y-labels">{labels.map((label, index) => <span key={index}>{label}</span>)}</div>
      <div className="chart-plot">
        <div className="chart-grid"><i /><i /><i /><i /></div>
        <svg className="chart-svg" viewBox="0 0 800 230" preserveAspectRatio="none" role="img" aria-label="TDS readings chart">
          <defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#54ac8d" stopOpacity=".21" /><stop offset="1" stopColor="#54ac8d" stopOpacity="0" /></linearGradient></defs>
          <path className="chart-area-path" d={`${path} L${last.x.toFixed(1)},230 L${coords[0].x.toFixed(1)},230 Z`} />
          <path className="chart-line" d={path} />
          <circle className="chart-last-dot" r="4" cx={last.x} cy={last.y} />
        </svg>
        <div className="chart-x-labels">{ticks.map((index, key) => <span key={key}>{new Date(points[index].time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>)}</div>
      </div>
    </div>
  );
}
