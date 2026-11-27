import { Activity, Clock, Maximize2, Minimize2, Plus, Radio, ShieldAlert, Tv } from 'lucide-react';
import type { NodeSummary, TimeRange } from '../types';
import { formatUptime } from '../utils/format';

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
      {/* Left: Brand + Node Selector + TV Auto-Rotate */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center text-emerald-400">
            <Activity className="w-4 h-4" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-bold tracking-tight text-slate-100">vLLM-Pulse</span>
            {mockMode && (
              <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                MOCK
              </span>
            )}
          </div>
        </div>

        <div className="h-4 w-px bg-slate-800 shrink-0" />

        <div className="flex items-center gap-1.5 min-w-0">
          <select
            aria-label="Select monitored node"
            value={activeNodeId}
            onChange={(e) => onSelectNode(e.target.value)}
            className="bg-[#0B0F19] text-slate-200 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-700/80 focus:outline-none focus:border-cyan-500/70 max-w-[230px] truncate cursor-pointer"
          >
            <option value="all">All Cluster ({nodes.length} Nodes)</option>
            {nodes.map((n) => {
              const kv = n.latest ? `${n.latest.kvCachePct.toFixed(0)}%` : '--';
              const tag = n.status === 'OFFLINE' ? 'OFFLINE' : `KV ${kv}`;
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
              title="Add temporary vLLM target"
              className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-slate-700/70 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {nodes.length > 1 && (
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
            title="Auto-rotate nodes every 30s and lock on alert"
          >
            {lockedByAlert ? (
              <>
                <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                <span>ALERT LOCK</span>
              </>
            ) : (
              <>
                <Tv className="w-3.5 h-3.5" />
                <span className="tabular-nums">
                  {tvRotate ? `TV ${secondsRemaining}s` : 'TV Rotate'}
                </span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Center: Model Name + Engine Uptime */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#0B0F19]/90 border border-slate-800 min-w-0">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold shrink-0">
            MODEL
          </span>
          <span className="text-xs font-semibold text-cyan-300 truncate max-w-[260px]">
            {summary?.modelName || 'Waiting...'}
          </span>
        </div>

        <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#0B0F19]/90 border border-slate-800 shrink-0">
          <Clock className="w-3 h-3 text-slate-400" />
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            UPTIME
          </span>
          <span className="text-xs font-medium text-slate-200 mono-nums">
            {formatUptime(summary?.uptimeSec ?? 0)}
          </span>
        </div>
      </div>

      {/* Right: Online Breathing Light + Scrape Latency + Range + Fullscreen */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[#0B0F19]/80 border border-slate-800">
          <span
            className={`w-2 h-2 rounded-full ${
              isOnline ? 'bg-emerald-400 animate-live-breathe' : 'bg-red-500'
            }`}
          />
          <span className={`text-xs font-semibold ${isOnline ? 'text-emerald-400' : 'text-red-400'}`}>
            {isOnline ? 'ONLINE' : sseConnected ? 'OFFLINE' : 'SYNCING'}
          </span>
          <span className="text-slate-600">|</span>
          <span className="flex items-center gap-1 text-xs text-slate-400 mono-nums" title="Scrape latency">
            <Radio className="w-3 h-3 text-slate-500" />
            {scrapeMs}ms
          </span>
        </div>

        <div className="flex items-center p-0.5 rounded-lg bg-[#0B0F19] border border-slate-800">
          {(['15m', '6h'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onSelectRange(r)}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                range === r
                  ? 'bg-slate-700/80 text-slate-100 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onToggleFullscreen}
          title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          className="p-1.5 rounded-lg bg-[#0B0F19] hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors cursor-pointer"
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
}
