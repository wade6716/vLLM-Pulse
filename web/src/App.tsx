import { useCallback, useEffect, useState } from 'react';
import { AddNodeModal } from './components/AddNodeModal';
import { DiagnosticPanel } from './components/DiagnosticPanel';
import { KpiRow } from './components/KpiRow';
import { KvPreemptionPanel } from './components/KvPreemptionPanel';
import { LatencyChart } from './components/LatencyChart';
import { MainPulseChart } from './components/MainPulseChart';
import { TopBar } from './components/TopBar';
import { useMetricsStream } from './hooks/useMetricsStream';
import { useTvRotation } from './hooks/useTvRotation';
import type { TimeRange } from './types';

export function App() {
  const [activeNodeId, setActiveNodeId] = useState<string>('all');
  const [range, setRange] = useState<TimeRange>('15m');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);

  const {
    nodes,
    clusterSummary,
    activeSummary,
    points,
    preemptions,
    mockMode,
    sseConnected,
    nowMs,
    addNode,
    deleteNode,
  } = useMetricsStream(activeNodeId, range);

  // 单节点配置时默认直接展示该节点
  useEffect(() => {
    if (nodes.length === 1 && activeNodeId === 'all') {
      setActiveNodeId(nodes[0].id);
    }
  }, [nodes, activeNodeId]);

  const { tvRotate, setTvRotate, lockedByAlert, secondsRemaining } = useTvRotation(
    nodes,
    activeNodeId,
    setActiveNodeId,
  );

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    } else {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, []);

  const handleSelectNode = useCallback(
    (id: string) => {
      setActiveNodeId(id);
      if (id === 'all' && tvRotate) {
        setTvRotate(false);
      }
    },
    [tvRotate, setTvRotate],
  );

  const displaySummary = activeNodeId === 'all' ? (clusterSummary ?? activeSummary) : activeSummary;
  const isCritical = displaySummary?.alertLevel === 'critical';

  return (
    <main
      className={`h-screen w-screen overflow-hidden flex flex-col p-3.5 gap-3 transition-all duration-700 ${
        isCritical ? 'apple-canvas-alert' : 'apple-canvas'
      }`}
    >
      {/* 第一区：悬浮磨砂顶栏 (~7%) */}
      <TopBar
        nodes={nodes}
        activeNodeId={activeNodeId}
        onSelectNode={handleSelectNode}
        summary={displaySummary}
        range={range}
        onSelectRange={setRange}
        tvRotate={tvRotate}
        onToggleTvRotate={() => setTvRotate(!tvRotate)}
        lockedByAlert={lockedByAlert}
        secondsRemaining={secondsRemaining}
        mockMode={mockMode}
        sseConnected={sseConnected}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        onOpenAddNode={() => setAddModalOpen(true)}
      />

      {/* 第二区：4 张核心 KPI 脉冲卡 (~18.5%) */}
      <KpiRow summary={displaySummary} points={points} />

      {/* 第三区：视觉主轴 — KV 圆环压力表 (34%) & 主脉搏波形 (66%) (~44.5%) */}
      <section className="h-[44.5%] min-h-0 grid grid-cols-[34fr_66fr] gap-3">
        <KvPreemptionPanel summary={displaySummary} nowMs={nowMs} />
        <MainPulseChart points={points} preemptions={preemptions} range={range} />
      </section>

      {/* 第四区：双轴延迟趋势 (50%) & 自适应专项诊断 (50%) (~30%) */}
      <section className="h-[30%] min-h-0 grid grid-cols-2 gap-3">
        <LatencyChart summary={displaySummary} points={points} range={range} />
        <DiagnosticPanel
          activeNodeId={activeNodeId}
          summary={displaySummary}
          nodes={nodes}
          preemptions={preemptions}
          onSelectNode={handleSelectNode}
        />
      </section>

      <AddNodeModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        nodes={nodes}
        onAdd={addNode}
        onDelete={deleteNode}
      />
    </main>
  );
}

export default App;
