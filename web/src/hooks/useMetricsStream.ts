import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  MetricPoint,
  NodeSummary,
  PreemptionEvent,
  SnapshotResponse,
  StreamFrame,
  TimeRange,
} from '../types';

interface UseMetricsStreamResult {
  nodes: NodeSummary[];
  clusterSummary: NodeSummary | null;
  activeSummary: NodeSummary | null;
  points: MetricPoint[];
  preemptions: PreemptionEvent[];
  mockMode: boolean;
  sseConnected: boolean;
  nowMs: number;
  refreshNodes: () => Promise<void>;
  addNode: (payload: { name: string; url: string; headers?: Record<string, string> }) => Promise<NodeSummary>;
  deleteNode: (id: string) => Promise<void>;
}

const RANGE_CONFIG: Record<TimeRange, { lowFreq: boolean; windowMs: number; maxPoints: number }> = {
  '1m': { lowFreq: false, windowMs: 60_000, maxPoints: 65 },
  '5m': { lowFreq: false, windowMs: 300_000, maxPoints: 305 },
  '15m': { lowFreq: false, windowMs: 900_000, maxPoints: 905 },
  '1h': { lowFreq: true, windowMs: 3_600_000, maxPoints: 65 },
  '6h': { lowFreq: true, windowMs: 21_600_000, maxPoints: 365 },
  '24h': { lowFreq: true, windowMs: 86_400_000, maxPoints: 1445 },
};

function prunePoints(pts: MetricPoint[], cutoffTs: number, maxPoints: number): MetricPoint[] {
  let start = 0;
  while (start < pts.length && pts[start].ts < cutoffTs) {
    start++;
  }
  const sliced = start > 0 ? pts.slice(start) : pts;
  return sliced.length > maxPoints ? sliced.slice(sliced.length - maxPoints) : sliced;
}

export function useMetricsStream(activeNodeId: string, range: TimeRange): UseMetricsStreamResult {
  const [nodes, setNodes] = useState<NodeSummary[]>([]);
  const [clusterSummary, setClusterSummary] = useState<NodeSummary | null>(null);
  const [activeSummary, setActiveSummary] = useState<NodeSummary | null>(null);
  const [points, setPoints] = useState<MetricPoint[]>([]);
  const [preemptions, setPreemptions] = useState<PreemptionEvent[]>([]);
  const [mockMode, setMockMode] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const activeNodeRef = useRef(activeNodeId);
  const rangeRef = useRef(range);
  activeNodeRef.current = activeNodeId;
  rangeRef.current = range;

  const fetchSnapshot = useCallback(async (nodeId: string, timeRange: TimeRange) => {
    try {
      const res = await fetch(`/api/snapshot?node=${encodeURIComponent(nodeId)}&range=${timeRange}`);
      if (!res.ok) return;
      const data: SnapshotResponse = await res.json();
      if (activeNodeRef.current !== nodeId || rangeRef.current !== timeRange) return;

      setNodes(data.nodes ?? []);
      setActiveSummary(data.summary ?? null);
      setPoints(data.points ?? []);
      setPreemptions(data.preemptions ?? []);
    } catch {
      // SSE 重连时会自动恢复
    }
  }, []);

  const refreshNodes = useCallback(async () => {
    try {
      const res = await fetch('/api/nodes');
      if (!res.ok) return;
      const data: { nodes: NodeSummary[]; cluster: NodeSummary; mock: boolean } = await res.json();
      setNodes(data.nodes ?? []);
      setClusterSummary(data.cluster ?? null);
      setMockMode(Boolean(data.mock));
    } catch {
      // 忽略瞬时异常
    }
  }, []);

  useEffect(() => {
    void refreshNodes();
  }, [refreshNodes]);

  useEffect(() => {
    void fetchSnapshot(activeNodeId, range);
  }, [activeNodeId, range, fetchSnapshot]);

  useEffect(() => {
    let closed = false;
    const es = new EventSource('/api/stream');

    es.onopen = () => {
      if (!closed) {
        setSseConnected(true);
      }
    };

    es.onerror = () => {
      if (!closed) {
        setSseConnected(false);
      }
    };

    es.addEventListener('tick', (event) => {
      if (closed) return;
      try {
        const frame: StreamFrame = JSON.parse((event as MessageEvent).data);
        setSseConnected(true);
        setNowMs(frame.ts || Date.now());
        setNodes(frame.nodes ?? []);
        setClusterSummary(frame.cluster ?? null);

        const curNode = activeNodeRef.current;
        const curRange = rangeRef.current;
        const cfg = RANGE_CONFIG[curRange] ?? RANGE_CONFIG['15m'];

        const targetSummary =
          curNode === 'all'
            ? frame.cluster
            : (frame.nodes ?? []).find((n) => n.id === curNode) ?? null;

        if (targetSummary) {
          setActiveSummary(targetSummary);
        }

        const latest = targetSummary?.latest;
        if (latest) {
          setPoints((prev) => {
            if (!cfg.lowFreq) {
              let next: MetricPoint[];
              if (prev.length > 0 && prev[prev.length - 1].ts === latest.ts) {
                next = prev.slice();
                next[next.length - 1] = latest;
              } else {
                next = [...prev, latest];
              }
              return prunePoints(next, latest.ts - cfg.windowMs, cfg.maxPoints);
            }
            const minuteBucket = Math.floor(latest.ts / 60000) * 60000;
            const bucketPoint: MetricPoint = { ...latest, ts: minuteBucket };
            let next: MetricPoint[];
            if (prev.length > 0 && prev[prev.length - 1].ts === minuteBucket) {
              next = prev.slice();
              next[next.length - 1] = bucketPoint;
            } else {
              next = [...prev, bucketPoint];
            }
            return prunePoints(next, minuteBucket - cfg.windowMs, cfg.maxPoints);
          });
        }

        if (frame.newPreemptions && frame.newPreemptions.length > 0) {
          const matching =
            curNode === 'all'
              ? frame.newPreemptions
              : frame.newPreemptions.filter((p) => p.nodeId === curNode);
          if (matching.length > 0) {
            const cutoff = (latest?.ts ?? frame.ts ?? Date.now()) - cfg.windowMs;
            setPreemptions((prev) => {
              const merged = [...prev, ...matching].filter((e) => e.ts >= cutoff);
              return merged.length > 500 ? merged.slice(merged.length - 500) : merged;
            });
          }
        }
      } catch {
        // 忽略异常帧
      }
    });

    return () => {
      closed = true;
      es.close();
    };
  }, []);

  const addNode = useCallback(
    async (payload: { name: string; url: string; headers?: Record<string, string> }) => {
      const res = await fetch('/api/nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || '添加节点失败');
      }
      await refreshNodes();
      return body as NodeSummary;
    },
    [refreshNodes],
  );

  const deleteNode = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || '移除节点失败');
      }
      await refreshNodes();
    },
    [refreshNodes],
  );

  return {
    nodes,
    clusterSummary,
    activeSummary,
    points,
    preemptions,
    mockMode,
    sseConnected,
    nowMs,
    refreshNodes,
    addNode,
    deleteNode,
  };
}
