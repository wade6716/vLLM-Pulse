import { Activity, Clock, Maximize2, Minimize2, Plus, ShieldAlert, Tv } from 'lucide-react';
import type { NodeSummary, TimeRange } from '../types';
import { formatModelDisplay, formatUptime } from '../utils/format';
import { InfoTip } from './InfoTip';

interface TopBarProps {
  nodes: NodeSummary[];
  activeNodeId: string;
  onSelectNode: (id: string) => void;
  summary: NodeSummary | null;
  range: TimeRange;
  onSelectRange: (r: TimeRange) => void;
  tvRotate: boolean;
  onToggleTvRotate: () => void;
  lockedByAlert: boolean;
  secondsRemaining: number;
  mockMode: boolean;
  sseConnected: boolean;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onOpenAddNode: () => void;
}

const TIME_RANGES: ReadonlyArray<{ id: TimeRange; label: string }> = [
  { id: '1m', label: '1分' },
  { id: '5m', label: '5分' },
  { id: '15m', label: '15分' },
  { id: '1h', label: '1时' },
  { id: '6h', label: '6时' },
  { id: '24h', label: '24时' },
];

export function TopBar({
  nodes,
  activeNodeId,
  onSelectNode,
  summary,
  range,
  onSelectRange,
  tvRotate,
  onToggleTvRotate,
  lockedByAlert,
  secondsRemaining,
  mockMode,
  sseConnected,
  isFullscreen,
  onToggleFullscreen,
  onOpenAddNode,
}: TopBarProps) {
  const isOnline = summary?.status === 'ONLINE' && sseConnected;
  const scrapeMs = summary?.scrapeDurationMs ?? 0;

  return (
    <header className="h-[7%] min-h-[48px] max-h-[58px] shrink-0 apple-card flex items-center justify-between gap-2.5 px-4">
      {/* 左侧：Apple 风格徽标 + 节点选择胶囊 + 大屏轮播 */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-xl bg-gradient-to-b from-[#30D158]/25 to-[#30D158]/10 border border-[#30D158]/30 flex items-center justify-center text-[#30D158]">
            <Activity className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[15px] font-semibold tracking-tight text-[#F5F5F7]">vLLM-Pulse</span>
            {mockMode && (
              <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-[#0A84FF]/15 text-[#64D2FF] select-none">
                模拟模式
              </span>
            )}
          </div>
        </div>

        <div className="h-4 w-px bg-white/10 shrink-0" />

        <div className="flex items-center gap-1.5 min-w-0">
          <select
            aria-label="选择监控节点"
            value={activeNodeId}
            onChange={(e) => onSelectNode(e.target.value)}
            className="bg-white/[0.06] hover:bg-white/[0.10] text-[#F5F5F7] text-xs font-medium px-2.5 py-1.5 rounded-xl border border-white/[0.08] focus:outline-none focus:border-[#0A84FF]/70 max-w-[220px] truncate cursor-pointer transition-colors"
          >
            <option value="all" className="bg-[#1C1C1E] text-[#F5F5F7]">
              集群汇总 ({nodes.length} 节点)
            </option>
            {nodes.map((n) => {
              const kv = n.latest ? `${n.latest.kvCachePct.toFixed(0)}%` : '--';
              const tag = n.status === 'OFFLINE' ? '离线' : `KV ${kv}`;
              return (
                <option key={n.id} value={n.id} className="bg-[#1C1C1E] text-[#F5F5F7]">
                  {n.name} · {tag}
                </option>
              );
            })}
          </select>

          {!mockMode && (
            <button
              type="button"
              onClick={onOpenAddNode}
              title="添加临时 vLLM 监控节点"
              className="p-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-white/75 border border-white/[0.08] transition-colors cursor-pointer select-none"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {nodes.length > 1 && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onToggleTvRotate}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-all cursor-pointer shrink-0 select-none ${
                lockedByAlert
                  ? 'bg-[#FF453A]/20 text-[#FF6961] border-[#FF453A]/45 animate-pulse'
                  : tvRotate
                    ? 'bg-[#0A84FF]/20 text-[#64D2FF] border-[#0A84FF]/35'
                    : 'bg-white/[0.06] text-white/65 border-white/[0.08] hover:bg-white/[0.10] hover:text-white/90'
              }`}
            >
              {lockedByAlert ? (
                <>
                  <ShieldAlert className="w-3.5 h-3.5 text-[#FF453A]" />
                  <span>异常锁定</span>
                </>
              ) : (
                <>
                  <Tv className="w-3.5 h-3.5" />
                  <span className="tabular-nums">
                    {tvRotate ? `轮播 ${secondsRemaining}s` : '大屏轮播'}
                  </span>
                </>
              )}
            </button>
            <InfoTip
              title="大屏自动轮播与告警锁定"
              description="开启后每 30 秒自动切换巡检下一个节点；一旦任意节点发生抢占、KV ≥ 85% 或出现容量不足排队，大屏将立即跳转并锁定该异常节点，直到恢复平稳后继续轮播。"
            />
          </div>
        )}
      </div>

      {/* 中间：可复制的当前模型名与引擎运行时长 */}
      <div className="flex items-center gap-2.5 min-w-0 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.06]">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] text-white/40 font-medium shrink-0">当前模型</span>
          <span className="text-xs font-semibold text-[#F5F5F7] truncate max-w-[200px]" title={formatModelDisplay(summary?.modelName)}>
            {formatModelDisplay(summary?.modelName)}
          </span>
        </div>

        <div className="hidden xl:block h-3 w-px bg-white/10 shrink-0" />

        <div className="hidden xl:flex items-center gap-1.5 shrink-0">
          <Clock className="w-3 h-3 text-white/40" />
          <span className="text-[11px] text-white/40 font-medium">运行时长</span>
          <span className="text-xs font-medium text-white/85 tabular-nums">
            {formatUptime(summary?.uptimeSec ?? 0)}
          </span>
          <InfoTip
            title="引擎已运行时长"
            formula="vllm:num_preemptions_created / process_start_time_seconds"
            description="基于指标 *_created 暴露的引擎启动时间戳推算连续运行时长；若期间发生容器重启，Counter 基线会自动重置归零。"
          />
        </div>
      </div>

      {/* 右侧：在线呼吸状态 + 6 档 Apple 分段式时间窗控件 + 全屏 */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/[0.04] border border-white/[0.06]">
          <span
            className={`w-2 h-2 rounded-full ${
              isOnline ? 'bg-[#30D158] animate-live-breathe' : 'bg-[#FF453A]'
            }`}
          />
          <span className={`text-xs font-medium ${isOnline ? 'text-[#30D158]' : 'text-[#FF453A]'}`}>
            {isOnline ? '在线' : sseConnected ? '离线' : '同步中'}
          </span>
          <span className="text-white/15">·</span>
          <span className="text-xs text-white/55 tabular-nums">{scrapeMs}ms</span>
          <InfoTip
            title="采集延迟 (Scrape Latency)"
            formula="单次 GET /metrics 往返耗时"
            description="后端并发拉取目标节点 Prometheus 指标的 HTTP 耗时（毫秒）。若某节点超时或离线，仅该节点标记离线，不阻塞其他节点采集。"
          />
        </div>

        <div className="apple-segmented flex items-center select-none" role="group" aria-label="时间区间选择">
          {TIME_RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelectRange(r.id)}
              className={`px-2 py-1 rounded-[8px] text-[11px] font-medium transition-all cursor-pointer tabular-nums ${
                range === r.id
                  ? 'apple-segmented-active text-[#F5F5F7]'
                  : 'text-white/45 hover:text-white/80'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onToggleFullscreen}
          title={isFullscreen ? '退出全屏' : '进入全屏'}
          className="p-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.11] text-white/70 hover:text-[#F5F5F7] border border-white/[0.07] transition-colors cursor-pointer select-none"
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
}
