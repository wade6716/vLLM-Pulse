import { useMemo } from 'react';
import type * as echarts from 'echarts';
import type { MetricPoint, NodeSummary, TimeRange } from '../types';
import { formatMs, formatTimeClock } from '../utils/format';
import { EChartBox } from './EChartBox';

interface LatencyChartProps {
  summary: NodeSummary | null;
  points: MetricPoint[];
  range: TimeRange;
}

export function LatencyChart({ summary, points, range }: LatencyChartProps) {
  const withSec = range === '15m';
  const latest = summary?.latest ?? (points.length > 0 ? points[points.length - 1] : null);

  const option = useMemo<echarts.EChartsOption>(() => {
    const ttft50 = points.map((p) => [p.ts, p.ttftP50Ms]);
    const ttft95 = points.map((p) => [p.ts, p.ttftP95Ms]);
    const itl50 = points.map((p) => [p.ts, p.itlP50Ms]);
    const itl95 = points.map((p) => [p.ts, p.itlP95Ms]);

    return {
      animation: false,
      grid: { left: 46, right: 16, top: 20, bottom: 22 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        borderColor: '#334155',
        textStyle: { color: '#E2E8F0', fontSize: 12 },
        valueFormatter: (v: unknown) => (typeof v === 'number' ? `${v.toFixed(1)} ms` : '--'),
      },
      xAxis: {
        type: 'time',
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#1E293B' } },
        axisTick: { show: false },
        axisLabel: {
          color: '#64748B',
          fontSize: 10,
          formatter: (val: number) => formatTimeClock(val, withSec),
        },
      },
      yAxis: {
        type: 'value',
        name: 'ms',
        nameTextStyle: { color: '#64748B', fontSize: 10, align: 'right' },
        axisLabel: { color: '#94A3B8', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(51, 65, 85, 0.35)', type: 'dashed' } },
        min: 0,
      },
      series: [
        {
          name: 'TTFT P50',
          type: 'line',
          data: ttft50,
          showSymbol: false,
          connectNulls: false,
          smooth: 0.2,
          lineStyle: { width: 2, color: '#06B6D4' },
        },
        {
          name: 'TTFT P95',
          type: 'line',
          data: ttft95,
          showSymbol: false,
          connectNulls: false,
          smooth: 0.2,
          lineStyle: { width: 1.75, color: '#38BDF8', type: 'dashed' },
        },
        {
          name: 'ITL P50',
          type: 'line',
          data: itl50,
          showSymbol: false,
          connectNulls: false,
          smooth: 0.2,
          lineStyle: { width: 2, color: '#10B981' },
        },
        {
          name: 'ITL P95',
          type: 'line',
          data: itl95,
          showSymbol: false,
          connectNulls: false,
          smooth: 0.2,
          lineStyle: { width: 1.75, color: '#F59E0B', type: 'dashed' },
        },
      ],
    };
  }, [points, withSec]);

  return (
    <div className="flex flex-col p-3.5 rounded-xl bg-[#111827]/85 border border-slate-800/80 min-h-0">
      <div className="flex items-center justify-between gap-2 mb-1 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Latency Quantiles (30s Window)
          </span>
        </div>

        <div className="flex items-center gap-2.5 text-[11px] mono-nums">
          <span className="text-cyan-300">
            TTFT {formatMs(latest?.ttftP50Ms)} / <span className="text-sky-300">{formatMs(latest?.ttftP95Ms)}</span>
          </span>
          <span className="text-slate-600">|</span>
          <span className="text-emerald-300">
            ITL {formatMs(latest?.itlP50Ms)} / <span className="text-amber-300">{formatMs(latest?.itlP95Ms)}</span>
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 w-full">
        <EChartBox option={option} />
      </div>
    </div>
  );
}
