import { useMemo } from 'react';
import type * as echarts from 'echarts';
import type { MetricPoint, NodeSummary } from '../types';
import { formatRate } from '../utils/format';
import { EChartBox } from './EChartBox';
import { InfoTip } from './InfoTip';

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
      {/* 卡片 1：生成吞吐 */}
      <div className="flex flex-col justify-between p-3 rounded-xl bg-[#111827]/85 border border-slate-800/80 min-h-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1 text-[11px] font-semibold tracking-wider text-slate-400">
              <span>生成吞吐</span>
              <InfoTip
                title="生成吞吐 (Generation Throughput)"
                formula="vllm:generation_tokens_total · 5s 滑窗速率"
                description="近 5 秒滑动窗口内每秒生成的输出 Token 数，直接反映 Decode 解码阶段的实时吞吐能力与整体服务产出效率。"
              />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-2xl xl:text-3xl font-bold text-emerald-400 mono-nums leading-none">
                {formatRate(latest?.genTokPerSec)}
              </span>
              <span className="text-xs font-medium text-slate-400">tok/s</span>
            </div>
          </div>
          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
            近5s窗口
          </span>
        </div>
        <div className="h-[42%] min-h-[24px] w-full mt-1">
          <EChartBox option={genSpark} />
        </div>
      </div>

      {/* 卡片 2：提示词吞吐 */}
      <div className="flex flex-col justify-between p-3 rounded-xl bg-[#111827]/85 border border-slate-800/80 min-h-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1 text-[11px] font-semibold tracking-wider text-slate-400">
              <span>提示词吞吐</span>
              <InfoTip
                title="提示词吞吐 (Prompt Throughput)"
                formula="vllm:prompt_tokens_total · 5s 滑窗速率"
                description="近 5 秒滑动窗口内每秒处理的输入提示词 Token 数，反映 Prefill 预填充阶段的计算压力；长上下文并发接入时会明显拉高。"
              />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-2xl xl:text-3xl font-bold text-cyan-400 mono-nums leading-none">
                {formatRate(latest?.promptTokPerSec)}
              </span>
              <span className="text-xs font-medium text-slate-400">tok/s</span>
            </div>
          </div>
          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shrink-0">
            近5s窗口
          </span>
        </div>
        <div className="h-[42%] min-h-[24px] w-full mt-1">
          <EChartBox option={promptSpark} />
        </div>
      </div>

      {/* 卡片 3：并发与排队 */}
      <div className={`flex flex-col justify-between p-3 rounded-xl border transition-colors min-h-0 ${queueBorder}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-[11px] font-semibold tracking-wider text-slate-400">
              <span>并发与排队</span>
              <InfoTip
                title="并发请求与排队原因"
                formula="vllm:num_requests_running / waiting(_by_reason)"
                description="当前正在 GPU 推理的请求数与等待调度请求数。「容量不足」代表 KV Cache 空间受限导致阻塞（> 0 即高亮预警）；「延后」代表策略性暂缓调度。"
              />
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
              <span className="text-[11px] text-slate-500 ml-0.5">运行 / 排队</span>
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
              容量不足 {Math.round(capWaiting)}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-slate-800/70 text-slate-400">
              延后 {Math.round(defWaiting)}
            </span>
          </div>
        </div>
        <div className="h-[42%] min-h-[24px] w-full mt-1">
          <EChartBox option={queueSpark} />
        </div>
      </div>

      {/* 卡片 4：Prefix Cache 命中率 */}
      <div className="flex flex-col justify-between p-3 rounded-xl bg-[#111827]/85 border border-slate-800/80 min-h-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1 text-[11px] font-semibold tracking-wider text-slate-400">
              <span>Prefix Cache 命中率</span>
              <InfoTip
                title="Prefix Cache 前缀缓存命中率"
                formula="Δprefix_cache_hits / Δprefix_cache_queries (近30s)"
                description="近 30 秒滑动窗口内 KV 前缀缓存命中比例。命中率越高，重复系统提示词与多轮对话的 Prefill 计算开销越低；当 30 秒内无新查询时显示「空闲」而非误报 0%。"
              />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              {isPrefixIdle ? (
                <span className="text-xl xl:text-2xl font-bold text-slate-500 tracking-wide leading-none">
                  空闲
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
            className={`px-1.5 py-0.5 text-[10px] font-medium rounded border shrink-0 ${
              isPrefixIdle
                ? 'bg-slate-800 text-slate-400 border-slate-700'
                : 'bg-teal-500/10 text-teal-300 border-teal-500/20'
            }`}
          >
            {isPrefixIdle ? '无新查询' : '近30s窗口'}
          </span>
        </div>
        <div className="h-[42%] min-h-[24px] w-full mt-1">
          <EChartBox option={prefixSpark} />
        </div>
      </div>
    </section>
  );
}
