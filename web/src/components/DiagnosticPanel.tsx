import { useMemo } from 'react';
import { Cpu, Flame, Layers, Sparkles } from 'lucide-react';
import type * as echarts from 'echarts';
import type { NodeSummary, PreemptionEvent } from '../types';
import { formatCompact, formatRate, formatTimeClock, kvThresholdColor, kvThresholdTextClass } from '../utils/format';
import { EChartBox } from './EChartBox';

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
        data: positions.map((p) => `Pos ${p.position}`),
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
          name: 'Acceptance',
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

  // Mode C: Cluster Multi-Node Leaderboard
  if (isCluster) {
    const sorted = [...nodes].sort((a, b) => (b.latest?.kvCachePct ?? 0) - (a.latest?.kvCachePct ?? 0));

    return (
      <div className="flex flex-col p-3.5 rounded-xl bg-[#111827]/85 border border-slate-800/80 min-h-0">
        <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Cluster Load Leaderboard
            </span>
          </div>
          <span className="text-[11px] text-slate-500">Click node to inspect</span>
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
                      <span className="px-1.5 py-0.5 text-[9px] font-semibold uppercase rounded bg-teal-500/15 text-teal-300 border border-teal-500/25 shrink-0">
                        SPEC
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
                    <div className="text-[10px] text-slate-500">tok/s</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-200">
                      {pt ? `${Math.round(pt.running)}/${Math.round(pt.waiting)}` : '--'}
                    </div>
                    <div className="text-[10px] text-slate-500">run/wait</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Mode A: Speculative Decoding Diagnostic Panel
  if (showSpecDecode && spec) {
    return (
      <div className="flex flex-col p-3.5 rounded-xl bg-[#111827]/85 border border-slate-800/80 min-h-0">
        <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-teal-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Speculative Decoding Diagnostics
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs mono-nums">
            <span className="px-2 py-0.5 rounded bg-teal-500/15 text-teal-300 border border-teal-500/30 font-semibold">
              Mean Len {spec.meanAcceptanceLength.toFixed(2)}
            </span>
            <span className="px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-semibold">
              Accept {spec.acceptanceRate.toFixed(1)}%
            </span>
          </div>
        </div>

        <div className="flex-1 min-h-0 w-full">
          {spec.perPosition && spec.perPosition.length > 0 ? (
            <EChartBox option={specBarOption} />
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-slate-500">
              Speculative decoding active — awaiting per-position token samples
            </div>
          )}
        </div>
      </div>
    );
  }

  // Mode B: Single Node Preemption Event Feed + Node Health Details
  const recentEvents = [...preemptions].reverse().slice(0, 20);
  const latest = summary?.latest;

  return (
    <div className="flex flex-col p-3.5 rounded-xl bg-[#111827]/85 border border-slate-800/80 min-h-0">
      <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
        <div className="flex items-center gap-2">
          <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Node Health & Preemption Feed
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] mono-nums text-slate-400">
          <span>Gen {formatCompact(summary?.totalGenTokens)}</span>
          <span className="text-slate-600">•</span>
          <span>Prompt {formatCompact(summary?.totalPromptTokens)}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-2 shrink-0 text-xs">
        <div className="px-2.5 py-1.5 rounded-lg bg-[#0B0F19]/80 border border-slate-800/90">
          <div className="text-[10px] uppercase text-slate-500">Queue (Capacity)</div>
          <div className="font-semibold mono-nums text-slate-200">
            {latest ? Math.round(latest.waitingCapacity) : 0}
          </div>
        </div>
        <div className="px-2.5 py-1.5 rounded-lg bg-[#0B0F19]/80 border border-slate-800/90">
          <div className="text-[10px] uppercase text-slate-500">Queue (Deferred)</div>
          <div className="font-semibold mono-nums text-slate-200">
            {latest ? Math.round(latest.waitingDeferred) : 0}
          </div>
        </div>
        <div className="px-2.5 py-1.5 rounded-lg bg-[#0B0F19]/80 border border-slate-800/90">
          <div className="text-[10px] uppercase text-slate-500">Scrape Latency</div>
          <div className="font-semibold mono-nums text-emerald-400">
            {summary?.scrapeDurationMs ?? 0} ms
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto noc-inner-scroll space-y-1 pr-1">
        {recentEvents.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500">
            No preemption events recorded in active window
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
                  +{Math.round(ev.delta)} preempt
                </span>
              </div>
              <div className="mono-nums text-slate-400 text-[11px] shrink-0">
                KV {ev.kvCachePct.toFixed(1)}% · Total {Math.round(ev.total)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
