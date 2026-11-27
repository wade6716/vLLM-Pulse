package metrics

// SpecDecodePosRate represents acceptance rate (0..100%) for a single draft token position.
type SpecDecodePosRate struct {
	Position       int     `json:"position"`
	AcceptanceRate float64 `json:"acceptanceRate"`
}

// SpecDecodeSnapshot holds speculative decoding diagnostics for a node.
type SpecDecodeSnapshot struct {
	Enabled              bool                `json:"enabled"`
	MeanAcceptanceLength float64             `json:"meanAcceptanceLength"`
	AcceptanceRate       float64             `json:"acceptanceRate"`
	DraftTokensPerSec    float64             `json:"draftTokensPerSec"`
	AcceptedTokensPerSec float64             `json:"acceptedTokensPerSec"`
	PerPosition          []SpecDecodePosRate `json:"perPosition"`
}

// MetricPoint is a single time-series point delivered to the frontend.
type MetricPoint struct {
	TimestampMs        int64               `json:"ts"`
	GenTokPerSec       float64             `json:"genTokPerSec"`
	PromptTokPerSec    float64             `json:"promptTokPerSec"`
	Running            float64             `json:"running"`
	Waiting            float64             `json:"waiting"`
	WaitingCapacity    float64             `json:"waitingCapacity"`
	WaitingDeferred    float64             `json:"waitingDeferred"`
	HasWaitingByReason bool                `json:"hasWaitingByReason"`
	KvCachePct         float64             `json:"kvCachePct"`
	MaxKvCachePct      float64             `json:"maxKvCachePct"`
	DeltaPreemptions   float64             `json:"deltaPreemptions"`
	TotalPreemptions   float64             `json:"totalPreemptions"`
	PrefixCacheHitRate *float64            `json:"prefixCacheHitRate"`
	PrefixCacheIdle    bool                `json:"prefixCacheIdle"`
	TtftP50Ms          *float64            `json:"ttftP50Ms"`
	TtftP95Ms          *float64            `json:"ttftP95Ms"`
	ItlP50Ms           *float64            `json:"itlP50Ms"`
	ItlP95Ms           *float64            `json:"itlP95Ms"`
	SpecDecode         *SpecDecodeSnapshot `json:"specDecode,omitempty"`
}

// PreemptionEvent captures an exact timestamp where deltaPreemptions > 0 occurred.
type PreemptionEvent struct {
	TimestampMs int64   `json:"ts"`
	NodeID      string  `json:"nodeId"`
	NodeName    string  `json:"nodeName"`
	Delta       float64 `json:"delta"`
	Total       float64 `json:"total"`
	KvCachePct  float64 `json:"kvCachePct"`
}

// NodeSummary describes current health, metadata, alert status, and latest metrics for a node or cluster.
type NodeSummary struct {
	ID                string       `json:"id"`
	Name              string       `json:"name"`
	URL               string       `json:"url"`
	ModelName         string       `json:"modelName"`
	Status            string       `json:"status"` // ONLINE | OFFLINE
	ScrapeDurationMs  int64        `json:"scrapeDurationMs"`
	UptimeSec         int64        `json:"uptimeSec"`
	LastError         string       `json:"lastError,omitempty"`
	HasSpecDecode     bool         `json:"hasSpecDecode"`
	Dynamic           bool         `json:"dynamic"`
	AlertLevel        string       `json:"alertLevel"` // normal | warn | critical
	AlertReasons      []string     `json:"alertReasons,omitempty"`
	LastPreemptionTs  int64        `json:"lastPreemptionTs,omitempty"`
	TotalGenTokens    float64      `json:"totalGenTokens"`
	TotalPromptTokens float64      `json:"totalPromptTokens"`
	Latest            *MetricPoint `json:"latest"`
}

// SnapshotResponse is returned by GET /api/snapshot.
type SnapshotResponse struct {
	NodeID      string            `json:"nodeId"`
	Range       string            `json:"range"`
	Summary     NodeSummary       `json:"summary"`
	Points      []MetricPoint     `json:"points"`
	Preemptions []PreemptionEvent `json:"preemptions"`
	Nodes       []NodeSummary     `json:"nodes"`
}

// StreamFrame is broadcast once per second over GET /api/stream.
type StreamFrame struct {
	TimestampMs    int64             `json:"ts"`
	Nodes          []NodeSummary     `json:"nodes"`
	Cluster        NodeSummary       `json:"cluster"`
	NewPreemptions []PreemptionEvent `json:"newPreemptions,omitempty"`
}
