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

  // Default to the first node if only 1 node is configured
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

  return (
    <main className="h-screen w-screen overflow-hidden flex flex-col bg-[#0B0F19] p-3 gap-2.5 select-none">
      {/* Row 1: Top Status Bar (~8%) */}
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

      {/* Row 2: 4 Core KPI Pulse Cards (~18%) */}
      <KpiRow summary={displaySummary} points={points} />

      {/* Row 3: Visual Core — KV Gauge + Preemption Pulse (35%) & Main Pulse Waveform (65%) (~44%) */}
      <section className="h-[44.5%] min-h-0 grid grid-cols-[35fr_65fr] gap-2.5">
        <KvPreemptionPanel summary={displaySummary} nowMs={nowMs} />
        <MainPulseChart points={points} preemptions={preemptions} range={range} />
      </section>

      {/* Row 4: Latency Trends (50%) & Adaptive Diagnostics (50%) (~30%) */}
      <section className="h-[30%] min-h-0 grid grid-cols-2 gap-2.5">
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
