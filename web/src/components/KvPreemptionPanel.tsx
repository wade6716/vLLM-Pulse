import { useEffect, useMemo, useRef, useState } from 'react';
import { Flame, ShieldCheck, Zap } from 'lucide-react';
import type * as echarts from 'echarts';
import type { NodeSummary } from '../types';
import { formatAgo, kvStatusLabel, kvThresholdColor, kvThresholdTextClass } from '../utils/format';
import { EChartBox } from './EChartBox';
import { InfoTip } from './InfoTip';

interface KvPreemptionPanelProps {
  summary: NodeSummary | null;
  nowMs: number;
}

export function KvPreemptionPanel({ summary, nowMs }: KvPreemptionPanelProps) {
  const latest = summary?.latest;
  const kvPct = latest?.kvCachePct ?? 0;
  const maxKvPct = latest?.maxKvCachePct ?? kvPct;
  const deltaPreempt = latest?.deltaPreemptions ?? 0;
  const totalPreempt = latest?.totalPreemptions ?? 0;
  const lastPreemptTs = summary?.lastPreemptionTs ?? 0;

  const [pulseActive, setPulseActive] = useState(false);
  const [pulseDelta, setPulseDelta] = useState(0);
  const pulseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (deltaPreempt > 0) {
      setPulseActive(true);
      setPulseDelta(deltaPreempt);
      if (pulseTimerRef.current !== null) {
        window.clearTimeout(pulseTimerRef.current);
      }
      pulseTimerRef.current = window.setTimeout(() => {
        setPulseActive(false);
      }, 3200);
    }
  }, [deltaPreempt, latest?.ts]);

  useEffect(() => {
    return () => {
      if (pulseTimerRef.current !== null) {
        window.clearTimeout(pulseTimerRef.current);
      }
    };
  }, []);

  const ringOption = useMemo<echarts.EChartsOption>(() => {
    const color = kvThresholdColor(kvPct);
    const statusText = kvStatusLabel(kvPct);
    const detailColor = kvPct >= 70 ? color : '#F5F5F7';

    return {
      animation: true,
      animationDurationUpdate: 450,
      series: [
        {
          type: 'gauge',
          startAngle: 215,
          endAngle: -35,
          min: 0,
          max: 100,
          radius: '92%',
          center: ['50%', '54%'],
          pointer: { show: false },
          anchor: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          axisLine: {
            roundCap: true,
            lineStyle: {
              width: 16,
              color: [[1, 'rgba(255, 255, 255, 0.08)']],
            },
          },
          progress: {
            show: true,
            width: 16,
            roundCap: true,
            itemStyle: {
              color,
              shadowBlur: 18,
              shadowColor: `${color}66`,
            },
          },
          title: {
            show: true,
            offsetCenter: [0, '26%'],
            fontSize: 12,
            fontWeight: 500,
            color: kvPct >= 70 ? color : 'rgba(235, 235, 245, 0.55)',
          },
          detail: {
            valueAnimation: true,
            offsetCenter: [0, '-4%'],
            fontSize: 38,
            fontWeight: 600,
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", sans-serif',
            color: detailColor,
            formatter: (v: number) => `${v.toFixed(1)}%`,
          },
          data: [{ value: Number(kvPct.toFixed(1)), name: statusText }],
        },
      ],
    };
  }, [kvPct]);

  const cardTone =
    pulseActive || kvPct >= 85
      ? 'apple-card-crit'
      : kvPct >= 70
        ? 'apple-card-warn'
        : '';

  return (
    <div className={`apple-card flex flex-col justify-between p-4 transition-all duration-300 min-h-0 ${cardTone}`}>
      {/* 标题栏 */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold text-[#F5F5F7] tracking-tight">
            KV Cache 显存压力
          </span>
          <InfoTip
            title="KV Cache 显存块占用率"
            formula="vllm:kv_cache_usage_perc / gpu_cache_usage_perc"
            description="vLLM 显存中 KV Cache 块的使用比例。70%～85% 进入琥珀预警区，≥ 85% 进入红色高危区，极易触发容量排队与请求抢占重算。"
          />
          {summary?.id === 'all' && maxKvPct > kvPct + 1 && (
            <span className={`text-[11px] tabular-nums px-2 py-0.5 rounded-full bg-white/[0.06] ${kvThresholdTextClass(maxKvPct)}`}>
              峰值 {maxKvPct.toFixed(1)}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-white/40 shrink-0 tabular-nums">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#FF9F0A]" />70% 预警
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#FF453A]" />85% 告警
          </span>
        </div>
      </div>

      {/* Apple Watch 活动圆环仪表 */}
      <div className="flex-1 min-h-0 w-full">
        <EChartBox option={ringOption} />
      </div>

      {/* 抢占事件脉冲胶囊 */}
      <div
        className={`shrink-0 flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border transition-all duration-300 ${
          pulseActive
            ? 'bg-[#FF453A]/[0.14] border-[#FF453A]/45'
            : 'apple-subcard'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative flex items-center justify-center w-8 h-8 shrink-0">
            {pulseActive && (
              <span className="absolute inset-0 rounded-full bg-[#FF453A]/45 animate-preemption-ripple" />
            )}
            <div
              className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center ${
                pulseActive
                  ? 'bg-[#FF453A]/25 text-[#FF6961]'
                  : 'bg-white/[0.06] text-[#30D158]'
              }`}
            >
              {pulseActive ? <Flame className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-white/75">抢占事件</span>
              <InfoTip
                title="请求抢占事件 (Preemptions)"
                formula="vllm:num_preemptions_total (周期增量 Δ + 累计)"
                description="当 KV Cache 空间耗尽时，vLLM 会被迫中断运行中请求并回收其显存块，稍后重新计算或换出，导致尾部延迟剧增。首次采集仅作基线不误报，容器重启自动重置。"
              />
              {pulseActive && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-[#FF453A] text-white tabular-nums">
                  <Zap className="w-2.5 h-2.5" />+{Math.round(pulseDelta)} 次
                </span>
              )}
            </div>
            <div className="text-[11px] text-white/45 truncate tabular-nums">
              最近发生：<span className="text-white/75">{formatAgo(lastPreemptTs, nowMs)}</span>
            </div>
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="text-lg font-semibold text-[#F5F5F7] tabular-nums leading-tight">
            {Math.round(totalPreempt).toLocaleString('en-US')}
          </div>
          <div className="text-[10px] text-white/40">累计次数</div>
        </div>
      </div>
    </div>
  );
}
