import { Activity, Clock, Maximize2, Minimize2, Plus, Radio, ShieldAlert, Tv } from 'lucide-react';
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
    <header className="h-[7.5%] min-h-[46px] max-h-[60px] shrink-0 flex items-center justify-between gap-3 px-4 rounded-xl bg-[#111827]/90 border border-slate-800/80 shadow-lg">
      {/* 左侧：品牌标识 + 节点选择 + TV 大屏轮播 */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center text-emerald-400">
            <Activity className="w-4 h-4" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-bold tracking-tight text-slate-100">vLLM-Pulse</span>
            {mockMode && (
              <span className="px-1.5 py-0.5 text-[10px] font-semibold tracking-wider rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                模拟模式
              </span>
            )}
          </div>
        </div>

        <div className="h-4 w-px bg-slate-800 shrink-0" />

        <div className="flex items-center gap-1.5 min-w-0">
          <select
            aria-label="选择监控节点"
            value={activeNodeId}
            onChange={(e) => onSelectNode(e.target.value)}
            className="bg-[#0B0F19] text-slate-200 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-700/80 focus:outline-none focus:border-cyan-500/70 max-w-[240px] truncate cursor-pointer"
          >
            <option value="all">集群汇总 ({nodes.length} 节点)</option>
            {nodes.map((n) => {
              const kv = n.latest ? `${n.latest.kvCachePct.toFixed(0)}%` : '--';
              const tag = n.status === 'OFFLINE' ? '离线' : `KV ${kv}`;
              return (
                <option key={n.id} value={n.id}>
                  {n.name} [{tag}]
                </option>
              );
            })}
          </select>

          {!mockMode && (
            <button
              type="button"
              onClick={onOpenAddNode}
              title="添加临时 vLLM 监控节点"
              className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-slate-700/70 transition-colors cursor-pointer"
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
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer shrink-0 ${
                lockedByAlert
                  ? 'bg-red-500/20 text-red-300 border-red-500/50 animate-pulse'
                  : tvRotate
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                    : 'bg-slate-800/70 text-slate-400 border-slate-700/70 hover:text-slate-200'
              }`}
            >
              {lockedByAlert ? (
                <>
                  <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
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

      {/* 中间：当前模型 + 引擎运行时长 */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#0B0F19]/90 border border-slate-800 min-w-0">
          <span className="text-[10px] tracking-wider text-slate-500 font-semibold shrink-0">
            当前模型
          </span>
          <span className="text-xs font-semibold text-cyan-300 truncate max-w-[250px]">
            {formatModelDisplay(summary?.modelName)}
          </span>
        </div>

        <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#0B0F19]/90 border border-slate-800 shrink-0">
          <Clock className="w-3 h-3 text-slate-400" />
          <span className="text-[10px] tracking-wider text-slate-500 font-semibold">运行时长</span>
          <span className="text-xs font-medium text-slate-200 mono-nums">
            {formatUptime(summary?.uptimeSec ?? 0)}
          </span>
          <InfoTip
            title="引擎已运行时长"
            formula="vllm:num_preemptions_created / process_start_time_seconds"
            description="基于指标 *_created 暴露的引擎启动时间戳推算连续运行时长；若期间发生容器重启，Counter 基线会自动重置归零。"
          />
        </div>
      </div>

      {/* 右侧：在线呼吸灯 + 采集延迟 + 时间窗切换 + 全屏 */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[#0B0F19]/80 border border-slate-800">
          <span
            className={`w-2 h-2 rounded-full ${
              isOnline ? 'bg-emerald-400 animate-live-breathe' : 'bg-red-500'
            }`}
          />
          <span className={`text-xs font-semibold ${isOnline ? 'text-emerald-400' : 'text-red-400'}`}>
            {isOnline ? '在线' : sseConnected ? '离线' : '同步中'}
          </span>
          <span className="text-slate-600">|</span>
          <span className="flex items-center gap-1 text-xs text-slate-400 mono-nums">
            <Radio className="w-3 h-3 text-slate-500" />
            {scrapeMs}ms
          </span>
          <InfoTip
            title="采集延迟 (Scrape Latency)"
            formula="单次 GET /metrics 往返耗时"
            description="后端并发拉取目标节点 Prometheus 指标的 HTTP 耗时（毫秒）。若某节点超时或离线，仅该节点标记离线，不阻塞其他节点采集。"
          />
        </div>

        <div className="flex items-center p-0.5 rounded-lg bg-[#0B0F19] border border-slate-800">
          {([
            { id: '15m', label: '15分钟' },
            { id: '6h', label: '6小时' },
          ] as const).map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelectRange(r.id)}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                range === r.id
                  ? 'bg-slate-700/80 text-slate-100 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
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
          className="p-1.5 rounded-lg bg-[#0B0F19] hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors cursor-pointer"
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
}
