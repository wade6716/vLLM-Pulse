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

const MAX_15M_POINTS = 900;
const MAX_6H_POINTS = 1440;

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
      // SSE reconnect or retry will recover
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
      // ignore transient error
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
            if (curRange === '15m') {
              if (prev.length > 0 && prev[prev.length - 1].ts === latest.ts) {
                const copy = prev.slice();
                copy[copy.length - 1] = latest;
                return copy;
              }
              const next = [...prev, latest];
              return next.length > MAX_15M_POINTS ? next.slice(next.length - MAX_15M_POINTS) : next;
            }
            // 6h downsampled view: update the current 1-minute bucket or append a new minute bucket.
            const minuteBucket = Math.floor(latest.ts / 60000) * 60000;
            const bucketPoint: MetricPoint = { ...latest, ts: minuteBucket };
            if (prev.length > 0 && prev[prev.length - 1].ts === minuteBucket) {
              const copy = prev.slice();
              copy[copy.length - 1] = bucketPoint;
              return copy;
            }
            const next = [...prev, bucketPoint];
            return next.length > MAX_6H_POINTS ? next.slice(next.length - MAX_6H_POINTS) : next;
          });
        }

        if (frame.newPreemptions && frame.newPreemptions.length > 0) {
          const matching =
            curNode === 'all'
              ? frame.newPreemptions
              : frame.newPreemptions.filter((p) => p.nodeId === curNode);
          if (matching.length > 0) {
            setPreemptions((prev) => {
              const next = [...prev, ...matching];
              return next.length > 500 ? next.slice(next.length - 500) : next;
            });
          }
        }
      } catch {
        // ignore malformed frame
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
        throw new Error(body.error || 'Failed to add node');
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
        throw new Error(body.error || 'Failed to delete node');
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
