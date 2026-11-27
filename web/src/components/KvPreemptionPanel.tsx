import { useEffect, useMemo, useRef, useState } from 'react';
import { Flame, ShieldCheck, Zap } from 'lucide-react';
import type * as echarts from 'echarts';
import type { NodeSummary } from '../types';
import { formatAgo, kvThresholdColor, kvThresholdTextClass } from '../utils/format';
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

  const gaugeOption = useMemo<echarts.EChartsOption>(() => {
    const color = kvThresholdColor(kvPct);
    return {
      animation: true,
      animationDurationUpdate: 400,
      series: [
        {
          type: 'gauge',
          startAngle: 205,
          endAngle: -25,
          min: 0,
          max: 100,
          radius: '98%',
          center: ['50%', '64%'],
          splitNumber: 10,
          axisLine: {
            lineStyle: {
              width: 14,
              color: [
                [0.7, '#10B981'],
                [0.85, '#F59E0B'],
                [1, '#EF4444'],
              ],
            },
          },
          pointer: {
            show: true,
            length: '62%',
            width: 4,
            itemStyle: {
              color: '#F8FAFC',
            },
          },
          anchor: {
            show: true,
            showAbove: true,
            size: 10,
            itemStyle: {
              borderWidth: 2,
              borderColor: color,
              color: '#0B0F19',
            },
          },
          axisTick: {
            distance: -14,
            length: 5,
            lineStyle: { color: '#0B0F19', width: 1.5 },
          },
          splitLine: {
            distance: -14,
            length: 14,
            lineStyle: { color: '#0B0F19', width: 2 },
          },
          axisLabel: {
            distance: 18,
            fontSize: 10,
            color: '#94A3B8',
            formatter: (v: number) => {
              if (v === 0 || v === 70 || v === 85 || v === 100) return `${v}%`;
              return '';
            },
          },
          detail: {
            valueAnimation: true,
            offsetCenter: [0, '32%'],
            fontSize: 28,
            fontWeight: 700,
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            color,
            formatter: (v: number) => `${v.toFixed(1)}%`,
          },
          data: [{ value: Number(kvPct.toFixed(1)) }],
        },
      ],
    };
  }, [kvPct]);

  const cardTone =
    pulseActive || kvPct >= 85
      ? 'border-red-500/60 bg-red-950/15'
      : kvPct >= 70
        ? 'border-amber-500/50 bg-amber-950/10'
        : 'border-slate-800/80 bg-[#111827]/85';

  return (
    <div className={`flex flex-col justify-between p-3.5 rounded-xl border transition-colors min-h-0 ${cardTone}`}>
      {/* 标题栏 */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold tracking-wider text-slate-300">
            KV Cache 显存压力
          </span>
          <InfoTip
            title="KV Cache 显存块占用率"
            formula="vllm:kv_cache_usage_perc / gpu_cache_usage_perc"
            description="vLLM 显存中 KV Cache 块的使用比例。70%～85% 进入琥珀预警区，≥ 85% 进入红色高危区，极易触发容量排队与请求抢占重算。"
          />
          {summary?.id === 'all' && maxKvPct > kvPct + 1 && (
            <span className={`text-[11px] mono-nums px-1.5 py-0.5 rounded bg-slate-800 ${kvThresholdTextClass(maxKvPct)}`}>
              峰值 {maxKvPct.toFixed(1)}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 shrink-0">
          <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/25">
            预警 70%
          </span>
          <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-300 border border-red-500/25">
            告警 85%
          </span>
        </div>
      </div>

      {/* 半圆压力仪表盘 */}
      <div className="flex-1 min-h-0 w-full">
        <EChartBox option={gaugeOption} />
      </div>

      {/* 抢占事件脉冲区 */}
      <div
        className={`shrink-0 flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
          pulseActive
            ? 'bg-red-500/15 border-red-500/55'
            : 'bg-[#0B0F19]/80 border-slate-800/90'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative flex items-center justify-center w-8 h-8 shrink-0">
            {pulseActive && (
              <span className="absolute inset-0 rounded-full bg-red-500/45 animate-preemption-ripple" />
            )}
            <div
              className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center border ${
                pulseActive
                  ? 'bg-red-500/25 border-red-400 text-red-300'
                  : 'bg-slate-800/80 border-slate-700 text-emerald-400'
              }`}
            >
              {pulseActive ? <Flame className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold tracking-wider text-slate-400">
                抢占事件
              </span>
              <InfoTip
                title="请求抢占事件 (Preemptions)"
                formula="vllm:num_preemptions_total (周期增量 Δ + 累计)"
                description="当 KV Cache 空间耗尽时，vLLM 会被迫中断运行中请求并回收其显存块，稍后重新计算或换出，导致尾部延迟剧增。首次采集仅作基线不误报，容器重启自动重置。"
              />
              {pulseActive && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded bg-red-500 text-white mono-nums">
                  <Zap className="w-2.5 h-2.5" />+{Math.round(pulseDelta)} 次
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400 truncate mono-nums">
              最近发生：<span className="text-slate-200">{formatAgo(lastPreemptTs, nowMs)}</span>
            </div>
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-slate-100 mono-nums leading-tight">
            {Math.round(totalPreempt).toLocaleString('en-US')}
          </div>
          <div className="text-[10px] tracking-wider text-slate-500">累计次数</div>
        </div>
      </div>
    </div>
  );
}
