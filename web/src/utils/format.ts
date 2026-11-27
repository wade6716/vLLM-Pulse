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
  if (!sec || sec <= 0) return '00时 00分 00秒';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (d > 0) return `${d}天 ${pad(h)}时 ${pad(m)}分`;
  return `${pad(h)}时 ${pad(m)}分 ${pad(s)}秒`;
}

export function formatAgo(tsMs: number | undefined, nowMs: number): string {
  if (!tsMs || tsMs <= 0) return '暂无';
  const diffSec = Math.max(0, Math.floor((nowMs - tsMs) / 1000));
  if (diffSec < 60) return `${diffSec}秒前`;
  const min = Math.floor(diffSec / 60);
  const sec = diffSec % 60;
  if (min < 60) return `${min}分${sec}秒前`;
  const hr = Math.floor(min / 60);
  return `${hr}小时${min % 60}分前`;
}

export function formatTimeClock(tsMs: number, withSeconds = true): string {
  const d = new Date(tsMs);
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (!withSeconds) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatModelDisplay(raw?: string): string {
  if (!raw || raw === 'unknown') return '等待采集...';
  if (raw === 'Multi-Node Cluster') return '多节点集群';
  const match = raw.match(/^(\d+)\s+Models Active$/);
  if (match) return `已加载 ${match[1]} 个模型`;
  return raw;
}

export function kvThresholdColor(pct: number): string {
  if (pct >= 85) return '#FF453A'; // Apple System Red
  if (pct >= 70) return '#FF9F0A'; // Apple System Orange
  return '#30D158'; // Apple System Green
}

export function kvThresholdTextClass(pct: number): string {
  if (pct >= 85) return 'text-[#FF453A]';
  if (pct >= 70) return 'text-[#FF9F0A]';
  return 'text-[#30D158]';
}

export function kvStatusLabel(pct: number): string {
  if (pct >= 85) return '显存高危';
  if (pct >= 70) return '水位偏高';
  return '显存平稳';
}
