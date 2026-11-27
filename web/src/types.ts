export interface SpecDecodePosRate {
  position: number;
  acceptanceRate: number;
}

export interface SpecDecodeSnapshot {
  enabled: boolean;
  meanAcceptanceLength: number;
  acceptanceRate: number;
  draftTokensPerSec: number;
  acceptedTokensPerSec: number;
  perPosition?: SpecDecodePosRate[];
}

export interface MetricPoint {
  ts: number;
  genTokPerSec: number;
  promptTokPerSec: number;
  running: number;
  waiting: number;
  waitingCapacity: number;
  waitingDeferred: number;
  hasWaitingByReason: boolean;
  kvCachePct: number;
  maxKvCachePct: number;
  deltaPreemptions: number;
  totalPreemptions: number;
  prefixCacheHitRate: number | null;
  prefixCacheIdle: boolean;
  ttftP50Ms: number | null;
  ttftP95Ms: number | null;
  itlP50Ms: number | null;
  itlP95Ms: number | null;
  specDecode?: SpecDecodeSnapshot;
}

export interface PreemptionEvent {
  ts: number;
  nodeId: string;
  nodeName: string;
  delta: number;
  total: number;
  kvCachePct: number;
}

export type AlertLevel = 'normal' | 'warn' | 'critical';

export interface NodeSummary {
  id: string;
  name: string;
  url: string;
  modelName: string;
  status: 'ONLINE' | 'OFFLINE';
  scrapeDurationMs: number;
  uptimeSec: number;
  lastError?: string;
  hasSpecDecode: boolean;
  dynamic: boolean;
  alertLevel: AlertLevel;
  alertReasons?: string[];
  lastPreemptionTs?: number;
  totalGenTokens: number;
  totalPromptTokens: number;
  latest: MetricPoint | null;
}

export type TimeRange = '1m' | '5m' | '15m' | '1h' | '6h' | '24h';

export interface SnapshotResponse {
  nodeId: string;
  range: TimeRange;
  summary: NodeSummary;
  points: MetricPoint[];
  preemptions: PreemptionEvent[];
  nodes: NodeSummary[];
}

export interface StreamFrame {
  ts: number;
  nodes: NodeSummary[];
  cluster: NodeSummary;
  newPreemptions?: PreemptionEvent[];
}
