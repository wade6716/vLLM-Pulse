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
        smooth: 0.38,
        connectNulls: false,
        lineStyle: {
          width: 2,
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
                  { offset: 0, color: `${color}38` },
                  { offset: 1, color: `${color}00` },
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
    () => buildSparkOption(tail.map((p) => p.genTokPerSec), '#30D158'),
    [tail],
  );
  const promptSpark = useMemo(
    () => buildSparkOption(tail.map((p) => p.promptTokPerSec), '#0A84FF'),
    [tail],
  );

  const capWaiting = latest?.waitingCapacity ?? 0;
  const defWaiting = latest?.waitingDeferred ?? 0;

  const queueColor =
    capWaiting >= 5 ? '#FF453A' : capWaiting > 0 ? '#FF9F0A' : '#64D2FF';
  const queueSpark = useMemo(
    () => buildSparkOption(tail.map((p) => p.running + p.waiting), queueColor),
    [tail, queueColor],
  );

  const isPrefixIdle = latest?.prefixCacheIdle ?? true;
  const prefixSpark = useMemo(
    () =>
      buildSparkOption(
        tail.map((p) => (p.prefixCacheIdle ? null : p.prefixCacheHitRate)),
        isPrefixIdle ? 'rgba(255,255,255,0.22)' : '#5AC8FA',
        isPrefixIdle,
      ),
    [tail, isPrefixIdle],
  );

  const queueCardTone =
    capWaiting >= 5 ? 'apple-card-crit' : capWaiting > 0 ? 'apple-card-warn' : '';

  return (
    <section className="h-[18.5%] min-h-0 grid grid-cols-4 gap-3">
      {/* 卡片 1：生成吞吐 */}
      <div className="apple-card flex flex-col justify-between px-4 py-3.5 min-h-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1 text-xs font-medium text-white/60">
              <span className="w-1.5 h-1.5 rounded-full bg-[#30D158] mr-0.5" />
              <span>生成吞吐</span>
              <InfoTip
                title="生成吞吐 (Generation Throughput)"
                formula="vllm:generation_tokens_total · 5s 滑窗速率"
                description="近 5 秒滑动窗口内每秒生成的输出 Token 数，直接反映 Decode 解码阶段的实时吞吐能力与整体服务产出效率。"
              />
            </div>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="text-3xl xl:text-[34px] font-semibold tracking-tight text-[#F5F5F7] tabular-nums leading-none">
                {formatRate(latest?.genTokPerSec)}
              </span>
              <span className="text-xs font-medium text-white/40">tok/s</span>
            </div>
          </div>
          <span className="text-[11px] font-medium text-white/35 shrink-0">近 5s</span>
        </div>
        <div className="h-[40%] min-h-[24px] w-full mt-1">
          <EChartBox option={genSpark} />
        </div>
      </div>

      {/* 卡片 2：提示词吞吐 */}
      <div className="apple-card flex flex-col justify-between px-4 py-3.5 min-h-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1 text-xs font-medium text-white/60">
              <span className="w-1.5 h-1.5 rounded-full bg-[#0A84FF] mr-0.5" />
              <span>提示词吞吐</span>
              <InfoTip
                title="提示词吞吐 (Prompt Throughput)"
                formula="vllm:prompt_tokens_total · 5s 滑窗速率"
                description="近 5 秒滑动窗口内每秒处理的输入提示词 Token 数，反映 Prefill 预填充阶段的计算压力；长上下文并发接入时会明显拉高。"
              />
            </div>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="text-3xl xl:text-[34px] font-semibold tracking-tight text-[#F5F5F7] tabular-nums leading-none">
                {formatRate(latest?.promptTokPerSec)}
              </span>
              <span className="text-xs font-medium text-white/40">tok/s</span>
            </div>
          </div>
          <span className="text-[11px] font-medium text-white/35 shrink-0">近 5s</span>
        </div>
        <div className="h-[40%] min-h-[24px] w-full mt-1">
          <EChartBox option={promptSpark} />
        </div>
      </div>

      {/* 卡片 3：并发与排队 */}
      <div className={`apple-card flex flex-col justify-between px-4 py-3.5 transition-all duration-300 min-h-0 ${queueCardTone}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-xs font-medium text-white/60">
              <span
                className="w-1.5 h-1.5 rounded-full mr-0.5"
                style={{ backgroundColor: queueColor }}
              />
              <span>并发与排队</span>
              <InfoTip
                title="并发请求与排队原因"
                formula="vllm:num_requests_running / waiting(_by_reason)"
                description="当前正在 GPU 推理的请求数与等待调度请求数。「容量不足」代表 KV Cache 空间受限导致阻塞（> 0 即高亮预警）；「延后」代表策略性暂缓调度。"
              />
            </div>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="text-3xl xl:text-[34px] font-semibold tracking-tight text-[#F5F5F7] tabular-nums leading-none">
                {latest ? Math.round(latest.running) : '--'}
              </span>
              <span className="text-white/25 text-xl font-medium">/</span>
              <span
                className={`text-2xl xl:text-[26px] font-semibold tabular-nums leading-none ${
                  capWaiting >= 5
                    ? 'text-[#FF453A]'
                    : capWaiting > 0
                      ? 'text-[#FF9F0A]'
                      : 'text-white/65'
                }`}
              >
                {latest ? Math.round(latest.waiting) : '--'}
              </span>
              <span className="text-[11px] text-white/35 ml-0.5">运行 / 排队</span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 text-[11px] tabular-nums shrink-0">
            <span
              className={`px-2 py-0.5 rounded-full font-medium ${
                capWaiting >= 5
                  ? 'bg-[#FF453A]/20 text-[#FF6961]'
                  : capWaiting > 0
                    ? 'bg-[#FF9F0A]/20 text-[#FFB340]'
                    : 'text-white/45'
              }`}
            >
              容量不足 {Math.round(capWaiting)}
            </span>
            <span className="px-2 py-0.5 text-white/40">延后 {Math.round(defWaiting)}</span>
          </div>
        </div>
        <div className="h-[40%] min-h-[24px] w-full mt-1">
          <EChartBox option={queueSpark} />
        </div>
      </div>

      {/* 卡片 4：Prefix Cache 命中率 */}
      <div className="apple-card flex flex-col justify-between px-4 py-3.5 min-h-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1 text-xs font-medium text-white/60">
              <span
                className={`w-1.5 h-1.5 rounded-full mr-0.5 ${
                  isPrefixIdle ? 'bg-white/30' : 'bg-[#5AC8FA]'
                }`}
              />
              <span>Prefix Cache 命中率</span>
              <InfoTip
                title="Prefix Cache 前缀缓存命中率"
                formula="Δprefix_cache_hits / Δprefix_cache_queries (近30s)"
                description="近 30 秒滑动窗口内 KV 前缀缓存命中比例。命中率越高，重复系统提示词与多轮对话的 Prefill 计算开销越低；当 30 秒内无新查询时显示「空闲」而非误报 0%。"
              />
            </div>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              {isPrefixIdle ? (
                <span className="text-2xl xl:text-[28px] font-semibold text-white/35 tracking-tight leading-none">
                  空闲
                </span>
              ) : (
                <>
                  <span className="text-3xl xl:text-[34px] font-semibold tracking-tight text-[#F5F5F7] tabular-nums leading-none">
                    {latest?.prefixCacheHitRate !== null && latest?.prefixCacheHitRate !== undefined
                      ? latest.prefixCacheHitRate.toFixed(1)
                      : '--'}
                  </span>
                  <span className="text-xs font-medium text-white/40">%</span>
                </>
              )}
            </div>
          </div>
          <span className="text-[11px] font-medium text-white/35 shrink-0">
            {isPrefixIdle ? '无查询' : '近 30s'}
          </span>
        </div>
        <div className="h-[40%] min-h-[24px] w-full mt-1">
          <EChartBox option={prefixSpark} />
        </div>
      </div>
    </section>
  );
}
