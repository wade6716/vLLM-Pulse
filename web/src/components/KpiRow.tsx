import { useMemo } from 'react';
import type * as echarts from 'echarts';
import type { MetricPoint, NodeSummary } from '../types';
import { formatRate } from '../utils/format';
import { EChartBox } from './EChartBox';

interface KpiRowProps {
  summary: NodeSummary | null;
  points: MetricPoint[];
}

function buildSparkOption(values: (number | null)[], color: string, isDashed = false): echarts.EChartsOption {
  return {
    animation: false,
    grid: { left: 2, right: 2, top: 4, bottom: 2 },
    xAxis: {
      type: 'category',
      show: false,
      boundaryGap: false,
      data: values.map((_, i) => i),
    },
    yAxis: {
      type: 'value',
      show: false,
      min: (v) => (v.min === v.max ? Math.max(0, v.min - 1) : v.min),
    },
    series: [
      {
        type: 'line',
        data: values,
        showSymbol: false,
        smooth: 0.25,
        connectNulls: false,
        lineStyle: {
          width: 1.75,
          color,
          type: isDashed ? 'dashed' : 'solid',
        },
        areaStyle: isDashed
          ? undefined
          : {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: `${color}40` },
                  { offset: 1, color: `${color}02` },
                ],
              },
            },
      },
    ],
  };
}

export function KpiRow({ summary, points }: KpiRowProps) {
  const latest = summary?.latest ?? (points.length > 0 ? points[points.length - 1] : null);
  const tail = useMemo(() => points.slice(-60), [points]);

  const genSpark = useMemo(
    () => buildSparkOption(tail.map((p) => p.genTokPerSec), '#10B981'),
    [tail],
  );
  const promptSpark = useMemo(
    () => buildSparkOption(tail.map((p) => p.promptTokPerSec), '#06B6D4'),
    [tail],
  );
  const queueColor =
    (latest?.waitingCapacity ?? 0) >= 5
      ? '#EF4444'
      : (latest?.waitingCapacity ?? 0) > 0
        ? '#F59E0B'
        : '#38BDF8';
  const queueSpark = useMemo(
    () => buildSparkOption(tail.map((p) => p.running + p.waiting), queueColor),
    [tail, queueColor],
  );

  const isPrefixIdle = latest?.prefixCacheIdle ?? true;
  const prefixSpark = useMemo(
    () =>
      buildSparkOption(
        tail.map((p) => (p.prefixCacheIdle ? null : p.prefixCacheHitRate)),
        isPrefixIdle ? '#475569' : '#2DD4BF',
        isPrefixIdle,
      ),
    [tail, isPrefixIdle],
  );

  const capWaiting = latest?.waitingCapacity ?? 0;
  const defWaiting = latest?.waitingDeferred ?? 0;
  const queueBorder =
    capWaiting >= 5
      ? 'border-red-500/60 bg-red-950/20'
      : capWaiting > 0
        ? 'border-amber-500/55 bg-amber-950/15'
        : 'border-slate-800/80 bg-[#111827]/85';

  return (
    <section className="h-[18%] min-h-0 grid grid-cols-4 gap-2.5">
      {/* Card 1: Generation Throughput */}
      <div className="flex flex-col justify-between p-3 rounded-xl bg-[#111827]/85 border border-slate-800/80 min-h-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Generation Throughput
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-2xl xl:text-3xl font-bold text-emerald-400 mono-nums leading-none">
                {formatRate(latest?.genTokPerSec)}
              </span>
              <span className="text-xs font-medium text-slate-400">tok/s</span>
            </div>
          </div>
          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            5s win
          </span>
        </div>
        <div className="h-[42%] min-h-[24px] w-full mt-1">
          <EChartBox option={genSpark} />
        </div>
      </div>

      {/* Card 2: Prompt Throughput */}
      <div className="flex flex-col justify-between p-3 rounded-xl bg-[#111827]/85 border border-slate-800/80 min-h-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Prompt Throughput
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-2xl xl:text-3xl font-bold text-cyan-400 mono-nums leading-none">
                {formatRate(latest?.promptTokPerSec)}
              </span>
              <span className="text-xs font-medium text-slate-400">tok/s</span>
            </div>
          </div>
          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            5s win
          </span>
        </div>
        <div className="h-[42%] min-h-[24px] w-full mt-1">
          <EChartBox option={promptSpark} />
        </div>
      </div>

      {/* Card 3: Concurrency & Queue */}
      <div className={`flex flex-col justify-between p-3 rounded-xl border transition-colors min-h-0 ${queueBorder}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Concurrency & Queue
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-2xl xl:text-3xl font-bold text-slate-100 mono-nums leading-none">
                {latest ? Math.round(latest.running) : '--'}
              </span>
              <span className="text-slate-500 font-semibold">/</span>
              <span
                className={`text-xl xl:text-2xl font-bold mono-nums leading-none ${
                  capWaiting >= 5
                    ? 'text-red-400'
                    : capWaiting > 0
                      ? 'text-amber-400'
                      : 'text-slate-300'
                }`}
              >
                {latest ? Math.round(latest.waiting) : '--'}
              </span>
              <span className="text-[11px] text-slate-500 ml-0.5">run / wait</span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-0.5 text-[10px] mono-nums shrink-0">
            <span
              className={`px-1.5 py-0.5 rounded font-semibold ${
                capWaiting > 0
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              cap {Math.round(capWaiting)}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-slate-800/70 text-slate-400">
              def {Math.round(defWaiting)}
            </span>
          </div>
        </div>
        <div className="h-[42%] min-h-[24px] w-full mt-1">
          <EChartBox option={queueSpark} />
        </div>
      </div>

      {/* Card 4: Prefix Cache Hit Rate */}
      <div className="flex flex-col justify-between p-3 rounded-xl bg-[#111827]/85 border border-slate-800/80 min-h-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Prefix Cache Hit Rate
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              {isPrefixIdle ? (
                <span className="text-xl xl:text-2xl font-bold text-slate-500 tracking-wide leading-none">
                  IDLE
                </span>
              ) : (
                <>
                  <span className="text-2xl xl:text-3xl font-bold text-teal-400 mono-nums leading-none">
                    {latest?.prefixCacheHitRate !== null && latest?.prefixCacheHitRate !== undefined
                      ? latest.prefixCacheHitRate.toFixed(1)
                      : '--'}
                  </span>
                  <span className="text-xs font-medium text-slate-400">%</span>
                </>
              )}
            </div>
          </div>
          <span
            className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${
              isPrefixIdle
                ? 'bg-slate-800 text-slate-400 border-slate-700'
                : 'bg-teal-500/10 text-teal-300 border-teal-500/20'
            }`}
          >
            {isPrefixIdle ? 'Δqueries = 0' : '30s win'}
          </span>
        </div>
        <div className="h-[42%] min-h-[24px] w-full mt-1">
          <EChartBox option={prefixSpark} />
        </div>
      </div>
    </section>
  );
}
