import { useMemo } from 'react';
import type * as echarts from 'echarts';
import type { MetricPoint, PreemptionEvent, TimeRange } from '../types';
import { formatTimeClock } from '../utils/format';
import { EChartBox } from './EChartBox';

interface MainPulseChartProps {
  points: MetricPoint[];
  preemptions: PreemptionEvent[];
  range: TimeRange;
}

export function MainPulseChart({ points, preemptions, range }: MainPulseChartProps) {
  const withSec = range === '15m';

  const option = useMemo<echarts.EChartsOption>(() => {
    const genSeries = points.map((p) => [p.ts, p.genTokPerSec]);
    const promptSeries = points.map((p) => [p.ts, p.promptTokPerSec]);
    const kvSeries = points.map((p) => [p.ts, p.kvCachePct]);

    const minTs = points.length > 0 ? points[0].ts : 0;
    const maxTs = points.length > 0 ? points[points.length - 1].ts : 0;

    // Group preemptions within visible window so overlapping timestamps stack cleanly
    const visiblePreemptions = preemptions.filter((ev) => ev.ts >= minTs && ev.ts <= maxTs + 1000);
    const preemptMap = new Map<number, PreemptionEvent[]>();
    for (const ev of visiblePreemptions) {
      const arr = preemptMap.get(ev.ts) ?? [];
      arr.push(ev);
      preemptMap.set(ev.ts, arr);
    }

    const markLineData = Array.from(preemptMap.entries()).map(([ts, evs]) => {
      const totalDelta = evs.reduce((acc, e) => acc + e.delta, 0);
      return {
        xAxis: ts,
        name: `Preemption +${totalDelta}`,
        label: {
          show: true,
          formatter: `+${Math.round(totalDelta)}`,
          color: '#FCA5A5',
          fontSize: 10,
          fontWeight: 700,
          backgroundColor: 'rgba(127, 29, 29, 0.85)',
          padding: [2, 4],
          borderRadius: 3,
        },
        lineStyle: {
          color: '#EF4444',
          width: 1.5,
          type: 'dashed' as const,
        },
      };
    });

    return {
      animation: false,
      grid: {
        left: 52,
        right: 48,
        top: 28,
        bottom: 24,
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        borderColor: '#334155',
        textStyle: { color: '#E2E8F0', fontSize: 12 },
        axisPointer: {
          type: 'cross',
          lineStyle: { color: '#475569' },
        },
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params : [];
          if (list.length === 0) return '';
          const first = list[0] as { value?: [number, number] };
          const ts = first?.value?.[0] ?? 0;
          const timeStr = formatTimeClock(ts, true);
          let html = `<div style="font-weight:600;margin-bottom:4px;color:#94A3B8">${timeStr}</div>`;
          for (const item of list as Array<{ seriesName: string; color: string; value: [number, number] }>) {
            const unit = item.seriesName.includes('KV') ? '%' : ' tok/s';
            const val = item.value?.[1] !== undefined ? item.value[1].toFixed(1) : '--';
            html += `<div style="display:flex;justify-content:space-between;gap:14px">
              <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${item.color};margin-right:6px"></span>${item.seriesName}</span>
              <span style="font-family:monospace;font-weight:600">${val}${unit}</span>
            </div>`;
          }
          // Check if any preemption occurred within 1s of hovered timestamp
          const nearEvs = visiblePreemptions.filter((e) => Math.abs(e.ts - ts) <= (withSec ? 1000 : 30000));
          if (nearEvs.length > 0) {
            const sumD = nearEvs.reduce((a, b) => a + b.delta, 0);
            html += `<div style="margin-top:5px;padding-top:4px;border-top:1px solid #334155;color:#F87171;font-weight:700">
              Preemption Spike: +${Math.round(sumD)} (KV ${nearEvs[0].kvCachePct.toFixed(1)}%)
            </div>`;
          }
          return html;
        },
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
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: 'tok/s',
          nameTextStyle: { color: '#64748B', fontSize: 10, align: 'right' },
          axisLabel: { color: '#94A3B8', fontSize: 10 },
          splitLine: { lineStyle: { color: 'rgba(51, 65, 85, 0.35)', type: 'dashed' } },
          min: 0,
        },
        {
          type: 'value',
          name: 'KV %',
          nameTextStyle: { color: '#64748B', fontSize: 10, align: 'left' },
          min: 0,
          max: 100,
          interval: 25,
          axisLabel: { color: '#94A3B8', fontSize: 10, formatter: '{value}%' },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Generation',
          type: 'line',
          yAxisIndex: 0,
          data: genSeries,
          showSymbol: false,
          smooth: 0.2,
          lineStyle: { width: 2, color: '#10B981' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(16, 185, 129, 0.25)' },
                { offset: 1, color: 'rgba(16, 185, 129, 0.01)' },
              ],
            },
          },
          markLine: {
            symbol: ['none', 'none'],
            silent: false,
            data: markLineData,
          },
        },
        {
          name: 'Prompt',
          type: 'line',
          yAxisIndex: 0,
          data: promptSeries,
          showSymbol: false,
          smooth: 0.2,
          lineStyle: { width: 1.75, color: '#06B6D4' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(6, 182, 212, 0.16)' },
                { offset: 1, color: 'rgba(6, 182, 212, 0.01)' },
              ],
            },
          },
        },
        {
          name: 'KV Cache %',
          type: 'line',
          yAxisIndex: 1,
          data: kvSeries,
          showSymbol: false,
          smooth: 0.2,
          lineStyle: { width: 2, color: '#F59E0B', type: 'dashed' },
          markLine: {
            symbol: ['none', 'none'],
            silent: true,
            label: { show: false },
            data: [
              { yAxis: 70, lineStyle: { color: 'rgba(245, 158, 11, 0.3)', type: 'dotted', width: 1 } },
              { yAxis: 85, lineStyle: { color: 'rgba(239, 68, 68, 0.45)', type: 'dotted', width: 1 } },
            ],
          },
        },
      ],
    };
  }, [points, preemptions, withSec]);

  return (
    <div className="flex flex-col p-3.5 rounded-xl bg-[#111827]/85 border border-slate-800/80 min-h-0">
      <div className="flex items-center justify-between gap-2 mb-1 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Throughput & KV Cache Pulse
          </span>
          <span className="text-[11px] text-slate-500">Dual-axis real-time waveform</span>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-slate-300">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-emerald-400 inline-block" /> Generation
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-cyan-400 inline-block" /> Prompt
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 border-t-2 border-dashed border-amber-400 inline-block" /> KV %
          </span>
          <span className="flex items-center gap-1.5 text-red-400">
            <span className="w-0.5 h-3 bg-red-500 inline-block" /> Preemption
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 w-full">
        <EChartBox option={option} />
      </div>
    </div>
  );
}
