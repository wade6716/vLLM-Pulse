import { useMemo, useState } from 'react';
import type * as echarts from 'echarts';
import type { MetricPoint, NodeSummary, TimeRange } from '../types';
import { formatMs, formatTimeClock } from '../utils/format';
import { EChartBox } from './EChartBox';
import { InfoTip } from './InfoTip';

interface LatencyChartProps {
  summary: NodeSummary | null;
  points: MetricPoint[];
  range: TimeRange;
}

export function LatencyChart({ summary, points, range }: LatencyChartProps) {
  const withSec = range === '1m' || range === '5m' || range === '15m';
  const latest = summary?.latest ?? (points.length > 0 ? points[points.length - 1] : null);
  const [visible, setVisible] = useState({ ttft: true, itl: true });

  const option = useMemo<echarts.EChartsOption>(() => {
    const ttft50 = points.map((p) => [p.ts, p.ttftP50Ms]);
    const ttft95 = points.map((p) => [p.ts, p.ttftP95Ms]);
    const itl50 = points.map((p) => [p.ts, p.itlP50Ms]);
    const itl95 = points.map((p) => [p.ts, p.itlP95Ms]);

    const seriesList: echarts.SeriesOption[] = [];
    if (visible.ttft) {
      seriesList.push(
        {
          name: 'TTFT 首字 P50',
          type: 'line',
          yAxisIndex: 0,
          data: ttft50,
          showSymbol: false,
          connectNulls: false,
          smooth: 0.35,
          lineStyle: { width: 2, color: '#64D2FF' },
        },
        {
          name: 'TTFT 首字 P95',
          type: 'line',
          yAxisIndex: 0,
          data: ttft95,
          showSymbol: false,
          connectNulls: false,
          smooth: 0.35,
          lineStyle: { width: 1.75, color: '#0A84FF', type: 'dashed' },
        },
      );
    }
    if (visible.itl) {
      seriesList.push(
        {
          name: 'ITL 字间 P50',
          type: 'line',
          yAxisIndex: 1,
          data: itl50,
          showSymbol: false,
          connectNulls: false,
          smooth: 0.35,
          lineStyle: { width: 2, color: '#30D158' },
        },
        {
          name: 'ITL 字间 P95',
          type: 'line',
          yAxisIndex: 1,
          data: itl95,
          showSymbol: false,
          connectNulls: false,
          smooth: 0.35,
          lineStyle: { width: 1.75, color: '#FF9F0A', type: 'dashed' },
        },
      );
    }

    return {
      animation: false,
      grid: {
        left: visible.ttft ? 46 : 16,
        right: visible.itl ? 44 : 16,
        top: 22,
        bottom: 22,
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(38, 38, 42, 0.92)',
        borderColor: 'rgba(255, 255, 255, 0.14)',
        borderWidth: 1,
        borderRadius: 12,
        padding: [10, 12],
        textStyle: { color: '#F5F5F7', fontSize: 12 },
        axisPointer: {
          type: 'line',
          lineStyle: { color: 'rgba(255, 255, 255, 0.22)' },
        },
        valueFormatter: (v: unknown) => (typeof v === 'number' ? `${v.toFixed(1)} ms` : '--'),
      },
      xAxis: {
        type: 'time',
        boundaryGap: false,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: 'rgba(235, 235, 245, 0.38)',
          fontSize: 10,
          formatter: (val: number) => formatTimeClock(val, withSec),
        },
      },
      yAxis: [
        {
          type: 'value',
          show: visible.ttft,
          name: 'TTFT',
          nameTextStyle: { color: 'rgba(100, 210, 255, 0.65)', fontSize: 10, align: 'right' },
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: 'rgba(235, 235, 245, 0.45)', fontSize: 10 },
          splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.05)' } },
          min: 0,
        },
        {
          type: 'value',
          show: visible.itl,
          name: 'ITL',
          nameTextStyle: { color: 'rgba(48, 209, 88, 0.65)', fontSize: 10, align: 'left' },
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: 'rgba(235, 235, 245, 0.45)', fontSize: 10 },
          splitLine: { show: visible.ttft ? false : true, lineStyle: { color: 'rgba(255, 255, 255, 0.05)' } },
          min: 0,
        },
      ],
      series: seriesList,
    };
  }, [points, withSec, visible]);

  return (
    <div className="apple-card flex flex-col p-4 min-h-0">
      <div className="flex items-center justify-between gap-2 mb-1 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold text-[#F5F5F7] tracking-tight">
            实时延迟分位数
          </span>
          <InfoTip
            title="首字延迟 TTFT 与字间延迟 ITL（近30s滑窗）"
            formula="左轴 TTFT (ms) · 右轴 ITL (ms) · histogram_quantile"
            description="基于近 30 秒 Histogram 桶差值按 Prometheus 算法线性插值计算。TTFT（左轴）为首 Token 响应耗时；ITL（右轴）为 Token 间生成耗时。点击右侧 TTFT / ITL 标签可独立开关对应曲线。"
          />
          <span className="text-[11px] text-white/35 ml-1">近 30s</span>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] tabular-nums shrink-0">
          <button
            type="button"
            aria-pressed={visible.ttft}
            onClick={() => setVisible((v) => ({ ...v, ttft: !v.ttft }))}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-all cursor-pointer select-none ${
              visible.ttft
                ? 'bg-white/[0.06] border-white/[0.1] text-white/85 hover:bg-white/[0.11]'
                : 'bg-transparent border-white/[0.04] text-white/30 opacity-45 hover:opacity-75'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#64D2FF]" />
            <span className="text-white/55">TTFT</span>
            <span className="font-medium">
              {formatMs(latest?.ttftP50Ms)} / {formatMs(latest?.ttftP95Ms)}
            </span>
          </button>

          <button
            type="button"
            aria-pressed={visible.itl}
            onClick={() => setVisible((v) => ({ ...v, itl: !v.itl }))}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-all cursor-pointer select-none ${
              visible.itl
                ? 'bg-white/[0.06] border-white/[0.1] text-white/85 hover:bg-white/[0.11]'
                : 'bg-transparent border-white/[0.04] text-white/30 opacity-45 hover:opacity-75'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#30D158]" />
            <span className="text-white/55">ITL</span>
            <span className="font-medium">
              {formatMs(latest?.itlP50Ms)} / {formatMs(latest?.itlP95Ms)}
            </span>
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 w-full">
        <EChartBox option={option} />
      </div>
    </div>
  );
}
