import { useMemo } from 'react';
import { Cpu, Flame, Layers, Sparkles } from 'lucide-react';
import type * as echarts from 'echarts';
import type { NodeSummary, PreemptionEvent } from '../types';
import { formatCompact, formatRate, formatTimeClock, kvThresholdColor, kvThresholdTextClass } from '../utils/format';
import { EChartBox } from './EChartBox';
import { InfoTip } from './InfoTip';

interface DiagnosticPanelProps {
  activeNodeId: string;
  summary: NodeSummary | null;
  nodes: NodeSummary[];
  preemptions: PreemptionEvent[];
  onSelectNode: (id: string) => void;
}

export function DiagnosticPanel({
  activeNodeId,
  summary,
  nodes,
  preemptions,
  onSelectNode,
}: DiagnosticPanelProps) {
  const spec = summary?.latest?.specDecode;
  const isCluster = activeNodeId === 'all';
  const showSpecDecode = !isCluster && Boolean(summary?.hasSpecDecode && spec?.enabled);

  const specBarOption = useMemo<echarts.EChartsOption>(() => {
    const positions = spec?.perPosition ?? [];
    return {
      animation: false,
      grid: { left: 36, right: 12, top: 18, bottom: 22 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        borderColor: '#334155',
        textStyle: { color: '#E2E8F0', fontSize: 12 },
        valueFormatter: (v: unknown) => (typeof v === 'number' ? `${v.toFixed(1)}%` : '--'),
      },
      xAxis: {
        type: 'category',
        data: positions.map((p) => `位置 ${p.position}`),
        axisLine: { lineStyle: { color: '#1E293B' } },
        axisTick: { show: false },
        axisLabel: { color: '#94A3B8', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        interval: 25,
        axisLabel: { color: '#64748B', fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: 'rgba(51, 65, 85, 0.35)', type: 'dashed' } },
      },
      series: [
        {
          name: '位置接受率',
          type: 'bar',
          barWidth: '48%',
          data: positions.map((p) => p.acceptanceRate),
          itemStyle: {
            borderRadius: [4, 4, 0, 0],
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: '#2DD4BF' },
                { offset: 1, color: '#0F766E' },
              ],
            },
          },
          label: {
            show: true,
            position: 'top',
            color: '#99F6E4',
            fontSize: 10,
            fontFamily: 'monospace',
            formatter: (p: { value: unknown }) => `${Number(p.value).toFixed(0)}%`,
          },
        },
      ],
    };
  }, [spec]);

  // 模式 C：集群多节点负载排行
  if (isCluster) {
    const sorted = [...nodes].sort((a, b) => (b.latest?.kvCachePct ?? 0) - (a.latest?.kvCachePct ?? 0));

    return (
      <div className="flex flex-col p-3.5 rounded-xl bg-[#111827]/85 border border-slate-800/80 min-h-0">
        <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs font-semibold tracking-wider text-slate-300">
              集群节点负载排行
            </span>
            <InfoTip
              title="多节点负载对比排行"
              description="按 KV Cache 使用率从高到低排列所有纳管节点，直观对比各节点显存水位、总吞吐与并发排队情况；点击任意节点行可一键下钻查看单节点详情。"
            />
          </div>
          <span className="text-[11px] text-slate-500">点击节点查看详情</span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto noc-inner-scroll space-y-1.5 pr-1">
          {sorted.map((n) => {
            const pt = n.latest;
            const kv = pt?.kvCachePct ?? 0;
            const totalTok = (pt?.genTokPerSec ?? 0) + (pt?.promptTokPerSec ?? 0);
            const barColor = kvThresholdColor(kv);
            const isCrit = n.status === 'OFFLINE' || kv >= 85 || (pt?.deltaPreemptions ?? 0) > 0;

            return (
              <button
                key={n.id}
                type="button"
                onClick={() => onSelectNode(n.id)}
                className={`w-full text-left px-3 py-2 rounded-lg border transition-colors cursor-pointer flex items-center justify-between gap-3 ${
                  isCrit
                    ? 'bg-red-950/20 border-red-500/45 hover:bg-red-950/35'
                    : 'bg-[#0B0F19]/75 border-slate-800/90 hover:border-slate-700'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        n.status === 'ONLINE' ? 'bg-emerald-400' : 'bg-red-500'
                      }`}
                    />
                    <span className="text-xs font-semibold text-slate-100 truncate">{n.name}</span>
                    {n.hasSpecDecode && (
                      <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-teal-500/15 text-teal-300 border border-teal-500/25 shrink-0">
                        投机解码
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(100, kv)}%`, backgroundColor: barColor }}
                      />
                    </div>
                    <span className={`text-[11px] mono-nums w-11 text-right ${kvThresholdTextClass(kv)}`}>
                      {kv.toFixed(0)}%
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0 text-right mono-nums">
                  <div>
                    <div className="text-xs font-semibold text-slate-200">{formatRate(totalTok)}</div>
                    <div className="text-[10px] text-slate-500">总 tok/s</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-200">
                      {pt ? `${Math.round(pt.running)}/${Math.round(pt.waiting)}` : '--'}
                    </div>
                    <div className="text-[10px] text-slate-500">运行/排队</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // 模式 A：单节点且探测到投机解码指标
  if (showSpecDecode && spec) {
    return (
      <div className="flex flex-col p-3.5 rounded-xl bg-[#111827]/85 border border-slate-800/80 min-h-0">
        <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-teal-400" />
            <span className="text-xs font-semibold tracking-wider text-slate-300">
              投机解码专项诊断
            </span>
            <InfoTip
              title="投机解码 (Speculative Decoding)"
              formula="vllm:spec_decode_* (近30s 滑窗)"
              description="自动探测到 spec_decode 指标时点亮。平均接受长度 = 1 + 接受草稿Token / Draft轮次（越高解码加速比越高）；柱状图展示各 Draft 位置（0～N）的逐位接受率衰减。"
            />
          </div>

          <div className="flex items-center gap-2.5 text-xs mono-nums shrink-0">
            <span className="px-2 py-0.5 rounded bg-teal-500/15 text-teal-300 border border-teal-500/30 font-semibold">
              平均长度 {spec.meanAcceptanceLength.toFixed(2)}
            </span>
            <span className="px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-semibold">
              接受率 {spec.acceptanceRate.toFixed(1)}%
            </span>
          </div>
        </div>

        <div className="flex-1 min-h-0 w-full">
          {spec.perPosition && spec.perPosition.length > 0 ? (
            <EChartBox option={specBarOption} />
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-slate-500">
              投机解码已启用，等待逐位置接受率样本
            </div>
          )}
        </div>
      </div>
    );
  }

  // 模式 B：单节点无投机解码 — 节点健康详情与抢占事件流
  const recentEvents = [...preemptions].reverse().slice(0, 20);
  const latest = summary?.latest;

  return (
    <div className="flex flex-col p-3.5 rounded-xl bg-[#111827]/85 border border-slate-800/80 min-h-0">
      <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-xs font-semibold tracking-wider text-slate-300">
            节点健康与抢占事件流
          </span>
          <InfoTip
            title="节点健康详情与抢占事件流"
            formula="waiting_by_reason + generation/prompt_tokens_total + 抢占日志"
            description="展示当前单节点的排队原因拆解（容量不足 vs 策略延后）、启动以来的累计 Token 生成量、采集耗时及当前时间窗内的抢占事件流水。"
          />
        </div>
        <div className="flex items-center gap-2 text-[11px] mono-nums text-slate-400 shrink-0">
          <span>累计生成 {formatCompact(summary?.totalGenTokens)}</span>
          <span className="text-slate-600">•</span>
          <span>累计提示词 {formatCompact(summary?.totalPromptTokens)}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-2 shrink-0 text-xs">
        <div className="px-2.5 py-1.5 rounded-lg bg-[#0B0F19]/80 border border-slate-800/90">
          <div className="text-[10px] text-slate-500">容量不足排队</div>
          <div className="font-semibold mono-nums text-slate-200">
            {latest ? Math.round(latest.waitingCapacity) : 0}
          </div>
        </div>
        <div className="px-2.5 py-1.5 rounded-lg bg-[#0B0F19]/80 border border-slate-800/90">
          <div className="text-[10px] text-slate-500">延后调度排队</div>
          <div className="font-semibold mono-nums text-slate-200">
            {latest ? Math.round(latest.waitingDeferred) : 0}
          </div>
        </div>
        <div className="px-2.5 py-1.5 rounded-lg bg-[#0B0F19]/80 border border-slate-800/90">
          <div className="text-[10px] text-slate-500">采集耗时</div>
          <div className="font-semibold mono-nums text-emerald-400">
            {summary?.scrapeDurationMs ?? 0} ms
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto noc-inner-scroll space-y-1 pr-1">
        {recentEvents.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500">
            当前时间窗内无抢占事件
          </div>
        ) : (
          recentEvents.map((ev, idx) => (
            <div
              key={`${ev.ts}-${idx}`}
              className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-red-950/20 border border-red-500/25 text-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Flame className="w-3.5 h-3.5 text-red-400 shrink-0" />
                <span className="mono-nums text-slate-300">{formatTimeClock(ev.ts, true)}</span>
                <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 font-semibold mono-nums text-[10px]">
                  +{Math.round(ev.delta)} 次抢占
                </span>
              </div>
              <div className="mono-nums text-slate-400 text-[11px] shrink-0">
                KV {ev.kvCachePct.toFixed(1)}% · 累计 {Math.round(ev.total)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
