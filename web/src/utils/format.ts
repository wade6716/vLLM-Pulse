export function formatRate(val: number | undefined | null): string {
  if (val === undefined || val === null || Number.isNaN(val)) return '--';
  if (val >= 1000) return val.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (val >= 100) return val.toFixed(0);
  return val.toFixed(1);
}

export function formatCompact(val: number | undefined | null): string {
  if (val === undefined || val === null || Number.isNaN(val)) return '0';
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(2)}B`;
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return Math.round(val).toString();
}

export function formatMs(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '--';
  if (val >= 1000) return `${(val / 1000).toFixed(2)}s`;
  if (val >= 100) return `${val.toFixed(0)}ms`;
  return `${val.toFixed(1)}ms`;
}

export function formatUptime(sec: number): string {
  if (!sec || sec <= 0) return '00h 00m 00s';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m`;
  return `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
}

export function formatAgo(tsMs: number | undefined, nowMs: number): string {
  if (!tsMs || tsMs <= 0) return 'Never';
  const diffSec = Math.max(0, Math.floor((nowMs - tsMs) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  const sec = diffSec % 60;
  if (min < 60) return `${min}m ${sec}s ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m ago`;
}

export function formatTimeClock(tsMs: number, withSeconds = true): string {
  const d = new Date(tsMs);
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (!withSeconds) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function kvThresholdColor(pct: number): string {
  if (pct >= 85) return '#EF4444'; // Critical Red
  if (pct >= 70) return '#F59E0B'; // Warning Amber
  return '#10B981'; // Calm Emerald
}

export function kvThresholdTextClass(pct: number): string {
  if (pct >= 85) return 'text-red-400';
  if (pct >= 70) return 'text-amber-400';
  return 'text-emerald-400';
}
