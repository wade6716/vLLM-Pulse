import { useEffect, useRef, useState } from 'react';
import type { NodeSummary } from '../types';

const ROTATE_INTERVAL_SEC = 30;
const ALERT_COOLDOWN_MS = 10_000;

export function isNodeAlerting(node: NodeSummary): boolean {
  if (node.status === 'OFFLINE') return true;
  const pt = node.latest;
  if (!pt) return false;
  return pt.deltaPreemptions > 0 || pt.kvCachePct >= 85 || pt.maxKvCachePct >= 85 || pt.waitingCapacity > 0;
}

function severityScore(node: NodeSummary): number {
  if (node.status === 'OFFLINE') return 1000;
  const pt = node.latest;
  if (!pt) return 0;
  let score = 0;
  if (pt.deltaPreemptions > 0) score += 500 + pt.deltaPreemptions * 10;
  if (pt.kvCachePct >= 85 || pt.maxKvCachePct >= 85) score += 200 + pt.kvCachePct;
  if (pt.waitingCapacity > 0) score += 100 + pt.waitingCapacity * 5;
  return score;
}

interface UseTvRotationResult {
  tvRotate: boolean;
  setTvRotate: (enabled: boolean) => void;
  lockedByAlert: boolean;
  lockedNodeName: string | null;
  secondsRemaining: number;
}

export function useTvRotation(
  nodes: NodeSummary[],
  activeNodeId: string,
  setActiveNodeId: (id: string) => void,
): UseTvRotationResult {
  const [tvRotate, setTvRotate] = useState(false);
  const [lockedByAlert, setLockedByAlert] = useState(false);
  const [lockedNodeName, setLockedNodeName] = useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(ROTATE_INTERVAL_SEC);

  const lastAlertSeenMsRef = useRef<number>(0);
  const activeNodeRef = useRef(activeNodeId);
  activeNodeRef.current = activeNodeId;

  // Immediate alert detection & lock when TV Rotate is enabled
  useEffect(() => {
    if (!tvRotate || nodes.length === 0) {
      if (lockedByAlert) {
        setLockedByAlert(false);
        setLockedNodeName(null);
      }
      return;
    }

    const alertingNodes = nodes.filter(isNodeAlerting).sort((a, b) => severityScore(b) - severityScore(a));
    if (alertingNodes.length > 0) {
      const top = alertingNodes[0];
      lastAlertSeenMsRef.current = Date.now();
      if (!lockedByAlert || activeNodeRef.current !== top.id) {
        setLockedByAlert(true);
        setLockedNodeName(top.name);
        setActiveNodeId(top.id);
      }
      return;
    }

    if (lockedByAlert && Date.now() - lastAlertSeenMsRef.current >= ALERT_COOLDOWN_MS) {
      setLockedByAlert(false);
      setLockedNodeName(null);
      setSecondsRemaining(ROTATE_INTERVAL_SEC);
    }
  }, [tvRotate, nodes, lockedByAlert, setActiveNodeId]);

  // Ensure initial node is a specific node rather than 'all' when enabling TV rotation
  useEffect(() => {
    if (!tvRotate || nodes.length === 0) return;
    if (activeNodeRef.current === 'all') {
      setActiveNodeId(nodes[0].id);
      setSecondsRemaining(ROTATE_INTERVAL_SEC);
    }
  }, [tvRotate, nodes, setActiveNodeId]);

  // 1s countdown & rotation timer
  useEffect(() => {
    if (!tvRotate || nodes.length <= 1) {
      setSecondsRemaining(ROTATE_INTERVAL_SEC);
      return;
    }

    const timer = window.setInterval(() => {
      if (lockedByAlert) return;

      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          const curIdx = nodes.findIndex((n) => n.id === activeNodeRef.current);
          const nextIdx = curIdx >= 0 ? (curIdx + 1) % nodes.length : 0;
          setActiveNodeId(nodes[nextIdx].id);
          return ROTATE_INTERVAL_SEC;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [tvRotate, nodes, lockedByAlert, setActiveNodeId]);

  return {
    tvRotate,
    setTvRotate,
    lockedByAlert,
    lockedNodeName,
    secondsRemaining,
  };
}
