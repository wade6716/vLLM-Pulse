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
      grid: { left: 36, right: 10, top: 20, bottom: 22 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(38, 38, 42, 0.92)',
        borderColor: 'rgba(255, 255, 255, 0.14)',
        borderWidth: 1,
        borderRadius: 12,
        padding: [8, 12],
        textStyle: { color: '#F5F5F7', fontSize: 12 },
        valueFormatter: (v: unknown) => (typeof v === 'number' ? `${v.toFixed(1)}%` : '--'),
      },
      xAxis: {
        type: 'category',
        data: positions.map((p) => `位置 ${p.position}`),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: 'rgba(235, 235, 245, 0.55)', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        interval: 25,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: 'rgba(235, 235, 245, 0.4)', fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.05)' } },
      },
      series: [
        {
          name: '位置接受率',
          type: 'bar',
          barWidth: '44%',
          data: positions.map((p) => p.acceptanceRate),
          itemStyle: {
            borderRadius: [8, 8, 2, 2],
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: '#64D2FF' },
                { offset: 1, color: '#5E5CE6' },
              ],
            },
          },
          label: {
            show: true,
            position: 'top',
            color: 'rgba(245, 245, 247, 0.85)',
            fontSize: 10,
            fontWeight: 600,
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
      <div className="apple-card flex flex-col p-4 min-h-0">
        <div className="flex items-center justify-between gap-2 mb-2.5 shrink-0">
          <div className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-[#64D2FF]" />
            <span className="text-[13px] font-semibold text-[#F5F5F7] tracking-tight">
              集群节点负载排行
            </span>
            <InfoTip
              title="多节点负载对比排行"
              description="按 KV Cache 使用率从高到低排列所有纳管节点，直观对比各节点显存水位、总吞吐与并发排队情况；点击任意节点行可一键下钻查看单节点详情。"
            />
          </div>
          <span className="text-[11px] text-white/35">点击节点查看详情</span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto noc-inner-scroll space-y-2 pr-1">
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
                className={`w-full text-left px-3.5 py-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-4 ${
                  isCrit
                    ? 'bg-[#FF453A]/[0.09] border-[#FF453A]/35 hover:bg-[#FF453A]/[0.15]'
                    : 'apple-subcard hover:bg-white/[0.08]'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        n.status === 'ONLINE' ? 'bg-[#30D158]' : 'bg-[#FF453A]'
                      }`}
                    />
                    <span className="text-xs font-medium text-[#F5F5F7] truncate">{n.name}</span>
                    {n.hasSpecDecode && (
                      <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-[#5E5CE6]/25 text-[#A5B4FC] shrink-0">
                        投机解码
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2.5">
                    <div className="flex-1 h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(100, kv)}%`, backgroundColor: barColor }}
                      />
                    </div>
                    <span className={`text-[11px] font-medium tabular-nums w-10 text-right ${kvThresholdTextClass(kv)}`}>
                      {kv.toFixed(0)}%
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-5 shrink-0 text-right tabular-nums">
                  <div>
                    <div className="text-xs font-semibold text-[#F5F5F7]">{formatRate(totalTok)}</div>
                    <div className="text-[10px] text-white/35">总 tok/s</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-[#F5F5F7]">
                      {pt ? `${Math.round(pt.running)}/${Math.round(pt.waiting)}` : '--'}
                    </div>
                    <div className="text-[10px] text-white/35">运行/排队</div>
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
      <div className="apple-card flex flex-col p-4 min-h-0">
        <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#64D2FF]" />
            <span className="text-[13px] font-semibold text-[#F5F5F7] tracking-tight">
              投机解码专项诊断
            </span>
            <InfoTip
              title="投机解码 (Speculative Decoding)"
              formula="vllm:spec_decode_* (近30s 滑窗)"
              description="自动探测到 spec_decode 指标时点亮。平均接受长度 = 1 + 接受草稿Token / Draft轮次（越高解码加速比越高）；柱状图展示各 Draft 位置（0～N）的逐位接受率衰减。"
            />
          </div>

          <div className="flex items-center gap-2 text-xs tabular-nums shrink-0">
            <span className="px-2.5 py-0.5 rounded-full bg-white/[0.06] text-white/80 font-medium">
              <span className="text-[#64D2FF] mr-1">平均长度</span>
              {spec.meanAcceptanceLength.toFixed(2)}
            </span>
            <span className="px-2.5 py-0.5 rounded-full bg-white/[0.06] text-white/80 font-medium">
              <span className="text-[#5E5CE6] mr-1">●</span>
              接受率 {spec.acceptanceRate.toFixed(1)}%
            </span>
          </div>
        </div>

        <div className="flex-1 min-h-0 w-full">
          {spec.perPosition && spec.perPosition.length > 0 ? (
            <EChartBox option={specBarOption} />
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-white/40">
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
    <div className="apple-card flex flex-col p-4 min-h-0">
      <div className="flex items-center justify-between gap-2 mb-2.5 shrink-0">
        <div className="flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-[#64D2FF]" />
          <span className="text-[13px] font-semibold text-[#F5F5F7] tracking-tight">
            节点健康与抢占事件流
          </span>
          <InfoTip
            title="节点健康详情与抢占事件流"
            formula="waiting_by_reason + generation/prompt_tokens_total + 抢占日志"
            description="展示当前单节点的排队原因拆解（容量不足 vs 策略延后）、启动以来的累计 Token 生成量、采集耗时及当前时间窗内的抢占事件流水。"
          />
        </div>
        <div className="flex items-center gap-2 text-[11px] tabular-nums text-white/45 shrink-0">
          <span>累计生成 {formatCompact(summary?.totalGenTokens)}</span>
          <span className="text-white/15">·</span>
          <span>累计提示词 {formatCompact(summary?.totalPromptTokens)}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-2.5 shrink-0 text-xs">
        <div className="apple-subcard px-3 py-2">
          <div className="text-[10px] text-white/45">容量不足排队</div>
          <div className="text-sm font-semibold tabular-nums text-[#F5F5F7] mt-0.5">
            {latest ? Math.round(latest.waitingCapacity) : 0}
          </div>
        </div>
        <div className="apple-subcard px-3 py-2">
          <div className="text-[10px] text-white/45">延后调度排队</div>
          <div className="text-sm font-semibold tabular-nums text-[#F5F5F7] mt-0.5">
            {latest ? Math.round(latest.waitingDeferred) : 0}
          </div>
        </div>
        <div className="apple-subcard px-3 py-2">
          <div className="text-[10px] text-white/45">采集耗时</div>
          <div className="text-sm font-semibold tabular-nums text-[#30D158] mt-0.5">
            {summary?.scrapeDurationMs ?? 0} ms
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto noc-inner-scroll space-y-1.5 pr-1">
        {recentEvents.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-white/40">
            当前时间窗内无抢占事件
          </div>
        ) : (
          recentEvents.map((ev, idx) => (
            <div
              key={`${ev.ts}-${idx}`}
              className="flex items-center justify-between px-3 py-2 rounded-xl bg-[#FF453A]/[0.08] border border-[#FF453A]/20 text-xs"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Flame className="w-3.5 h-3.5 text-[#FF453A] shrink-0" />
                <span className="tabular-nums text-white/80">{formatTimeClock(ev.ts, true)}</span>
                <span className="px-2 py-0.5 rounded-full bg-[#FF453A]/20 text-[#FF6961] font-medium tabular-nums text-[10px]">
                  +{Math.round(ev.delta)} 次抢占
                </span>
              </div>
              <div className="tabular-nums text-white/50 text-[11px] shrink-0">
                KV {ev.kvCachePct.toFixed(1)}% · 累计 {Math.round(ev.total)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
