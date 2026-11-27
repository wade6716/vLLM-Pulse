package metrics

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/wade6716/vllm-pulse/internal/config"
	"github.com/wade6716/vllm-pulse/internal/promparse"
)

type counterKey struct {
	metric string
	engine string
	extra  string
}

type counterState struct {
	prev    float64
	created float64
}

// NodeEngine ingests raw Prometheus samples for a single vLLM target,
// handles V0/V1 metric compatibility, baseline/restart safety guards,
// sliding-window math, and stores historical snapshots in a DualRingBuffer.
type NodeEngine struct {
	mu      sync.RWMutex
	cfg     config.NodeConfig
	dynamic bool

	ring *DualRingBuffer

	counters          map[counterKey]counterState
	status            string
	lastError         string
	scrapeDurationMs  int64
	modelName         string
	uptimeSec         int64
	hasSpecDecode     bool
	lastPreemptionTs  int64
	totalGenTokens    float64
	totalPromptTokens float64
	totalPreemptions  float64
	lastIngestMs      int64
	lastAlertLevel    string
	lastAlertReasons  []string
}

// NewNodeEngine initializes a NodeEngine for the given node configuration.
func NewNodeEngine(cfg config.NodeConfig, retentionHours int, dynamic bool) *NodeEngine {
	return &NodeEngine{
		cfg:            cfg,
		dynamic:        dynamic,
		ring:           NewDualRingBuffer(retentionHours),
		counters:       make(map[counterKey]counterState, 64),
		status:         "OFFLINE",
		lastAlertLevel: "normal",
	}
}

// Ingest processes one scrape of Prometheus samples at timestampMs (epoch ms).
// Returns the computed MetricPoint and an optional PreemptionEvent if deltaPreemptions > 0.
func (e *NodeEngine) Ingest(timestampMs int64, samples []promparse.Sample, scrapeDurationMs int64) (MetricPoint, *PreemptionEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.status = "ONLINE"
	e.lastError = ""
	e.scrapeDurationMs = scrapeDurationMs

	intervalSec := 1.0
	if e.lastIngestMs > 0 && timestampMs > e.lastIngestMs {
		diff := float64(timestampMs-e.lastIngestMs) / 1000.0
		if diff >= 0.2 && diff <= 60.0 {
			intervalSec = diff
		}
	}
	e.lastIngestMs = timestampMs

	// 1. Collect *_created timestamps per (metricBase, engine) and process_start_time_seconds.
	createdMap := make(map[string]map[string]float64) // canonicalMetric -> engine -> createdSec
	var processStart float64
	var minPreemptCreated float64

	for _, s := range samples {
		if mName := s.Labels["model_name"]; mName != "" && strings.HasPrefix(s.Name, "vllm:") {
			e.modelName = mName
		}
		if strings.HasPrefix(s.Name, "vllm:spec_decode_") {
			e.hasSpecDecode = true
		}
		if s.Name == "process_start_time_seconds" && !math.IsNaN(s.Value) && s.Value > 0 {
			if processStart == 0 || s.Value < processStart {
				processStart = s.Value
			}
		}
		if strings.HasSuffix(s.Name, "_created") && strings.HasPrefix(s.Name, "vllm:") && !math.IsNaN(s.Value) && s.Value > 0 {
			base := strings.TrimSuffix(s.Name, "_created")
			eng := engineLabel(s.Labels)
			if createdMap[base] == nil {
				createdMap[base] = make(map[string]float64)
			}
			createdMap[base][eng] = s.Value
			if base == "vllm:num_preemptions" {
				if minPreemptCreated == 0 || s.Value < minPreemptCreated {
					minPreemptCreated = s.Value
				}
			}
		}
	}

	nowSec := float64(timestampMs) / 1000.0
	if minPreemptCreated > 0 && nowSec >= minPreemptCreated {
		e.uptimeSec = int64(nowSec - minPreemptCreated)
	} else if processStart > 0 && nowSec >= processStart {
		e.uptimeSec = int64(nowSec - processStart)
	}

	// 2. Aggregate gauges & resolve V0/V1 canonical series.
	var (
		runningSum          float64
		waitingSum          float64
		waitingCapSum       float64
		waitingDefSum       float64
		hasWaitingByReason  bool
		kvPrimary           = make(map[string]float64)
		kvFallback          = make(map[string]float64)
		preemptTotalSum     float64
		preemptDeltaSum     float64
		genTotalSum         float64
		genDeltaSum         float64
		promptTotalSum      float64
		promptDeltaSum      float64
		hasPrimaryPrefixHit bool
		hasPrimaryPrefixQ   bool
		hasPrimaryITL       bool
	)

	// First pass to detect whether primary V1 metrics exist so we don't mix V0 & V1.
	for _, s := range samples {
		switch s.Name {
		case "vllm:prefix_cache_hits_total":
			hasPrimaryPrefixHit = true
		case "vllm:prefix_cache_queries_total":
			hasPrimaryPrefixQ = true
		case "vllm:inter_token_latency_seconds_bucket":
			hasPrimaryITL = true
		}
	}

	prefixHitName := "vllm:gpu_prefix_cache_hits_total"
	if hasPrimaryPrefixHit {
		prefixHitName = "vllm:prefix_cache_hits_total"
	}
	prefixQueryName := "vllm:gpu_prefix_cache_queries_total"
	if hasPrimaryPrefixQ {
		prefixQueryName = "vllm:prefix_cache_queries_total"
	}
	itlBucketName := "vllm:time_per_output_token_seconds_bucket"
	if hasPrimaryITL {
		itlBucketName = "vllm:inter_token_latency_seconds_bucket"
	}

	var (
		deltaPrefixHits   float64
		deltaPrefixQ      float64
		ttftDeltaBuckets  = make(map[float64]float64)
		itlDeltaBuckets   = make(map[float64]float64)
		deltaSpecDrafts   float64
		deltaSpecDraftTok float64
		deltaSpecAccTok   float64
		deltaSpecPerPos   = make(map[int]float64)
		v0SpecAccRate     float64
		hasV0SpecAccRate  bool
		v0SpecEfficiency  float64
		hasV0SpecEff      bool
	)

	for _, s := range samples {
		if math.IsNaN(s.Value) || math.IsInf(s.Value, 0) {
			continue
		}
		eng := engineLabel(s.Labels)

		switch s.Name {
		case "vllm:num_requests_running":
			runningSum += s.Value
		case "vllm:num_requests_waiting":
			waitingSum += s.Value
		case "vllm:num_requests_waiting_by_reason":
			hasWaitingByReason = true
			switch s.Labels["reason"] {
			case "capacity":
				waitingCapSum += s.Value
			case "deferred":
				waitingDefSum += s.Value
			}
		case "vllm:kv_cache_usage_perc":
			kvPrimary[eng] = s.Value
		case "vllm:gpu_cache_usage_perc":
			kvFallback[eng] = s.Value

		case "vllm:num_preemptions_total":
			created := lookupCreated(createdMap, "vllm:num_preemptions", eng)
			delta := e.updateCounter(counterKey{metric: "preemptions", engine: eng}, s.Value, created)
			preemptDeltaSum += delta
			preemptTotalSum += s.Value

		case "vllm:generation_tokens_total":
			created := lookupCreated(createdMap, "vllm:generation_tokens", eng)
			delta := e.updateCounter(counterKey{metric: "gen_tokens", engine: eng}, s.Value, created)
			genDeltaSum += delta
			genTotalSum += s.Value

		case "vllm:prompt_tokens_total":
			created := lookupCreated(createdMap, "vllm:prompt_tokens", eng)
			delta := e.updateCounter(counterKey{metric: "prompt_tokens", engine: eng}, s.Value, created)
			promptDeltaSum += delta
			promptTotalSum += s.Value

		case prefixHitName:
			created := lookupCreated(createdMap, strings.TrimSuffix(prefixHitName, "_total"), eng)
			delta := e.updateCounter(counterKey{metric: "prefix_hits", engine: eng}, s.Value, created)
			deltaPrefixHits += delta

		case prefixQueryName:
			created := lookupCreated(createdMap, strings.TrimSuffix(prefixQueryName, "_total"), eng)
			delta := e.updateCounter(counterKey{metric: "prefix_queries", engine: eng}, s.Value, created)
			deltaPrefixQ += delta

		case "vllm:time_to_first_token_seconds_bucket":
			le, ok := parseLE(s.Labels["le"])
			if ok {
				created := lookupCreated(createdMap, "vllm:time_to_first_token_seconds", eng)
				delta := e.updateCounter(counterKey{metric: "ttft_bucket", engine: eng, extra: s.Labels["le"]}, s.Value, created)
				if delta > 0 {
					ttftDeltaBuckets[le] += delta
				}
			}

		case itlBucketName:
			le, ok := parseLE(s.Labels["le"])
			if ok {
				created := lookupCreated(createdMap, strings.TrimSuffix(itlBucketName, "_bucket"), eng)
				delta := e.updateCounter(counterKey{metric: "itl_bucket", engine: eng, extra: s.Labels["le"]}, s.Value, created)
				if delta > 0 {
					itlDeltaBuckets[le] += delta
				}
			}

		case "vllm:spec_decode_num_drafts_total":
			created := lookupCreated(createdMap, "vllm:spec_decode_num_drafts", eng)
			deltaSpecDrafts += e.updateCounter(counterKey{metric: "spec_drafts", engine: eng}, s.Value, created)

		case "vllm:spec_decode_num_draft_tokens_total":
			created := lookupCreated(createdMap, "vllm:spec_decode_num_draft_tokens", eng)
			deltaSpecDraftTok += e.updateCounter(counterKey{metric: "spec_draft_tokens", engine: eng}, s.Value, created)

		case "vllm:spec_decode_num_accepted_tokens_total":
			created := lookupCreated(createdMap, "vllm:spec_decode_num_accepted_tokens", eng)
			deltaSpecAccTok += e.updateCounter(counterKey{metric: "spec_accepted_tokens", engine: eng}, s.Value, created)

		case "vllm:spec_decode_num_accepted_tokens_per_pos_total":
			posStr := s.Labels["position"]
			if posStr == "" {
				posStr = s.Labels["pos"]
			}
			if pos, err := strconv.Atoi(posStr); err == nil && pos >= 0 {
				created := lookupCreated(createdMap, "vllm:spec_decode_num_accepted_tokens_per_pos", eng)
				delta := e.updateCounter(counterKey{metric: "spec_accepted_pos", engine: eng, extra: posStr}, s.Value, created)
				if delta > 0 {
					deltaSpecPerPos[pos] += delta
				}
			}

		case "vllm:spec_decode_draft_acceptance_rate":
			v0SpecAccRate = s.Value
			hasV0SpecAccRate = true

		case "vllm:spec_decode_efficiency":
			v0SpecEfficiency = s.Value
			hasV0SpecEff = true
		}
	}

	if genTotalSum > 0 || e.totalGenTokens == 0 {
		e.totalGenTokens = genTotalSum
	}
	if promptTotalSum > 0 || e.totalPromptTokens == 0 {
		e.totalPromptTokens = promptTotalSum
	}
	e.totalPreemptions = preemptTotalSum

	kvMean, kvMax := computeKVPct(kvPrimary, kvFallback)

	// 3. Push tick with current deltas first? No, compute sliding windows including current tick!
	curTick := rawTick{
		Point: MetricPoint{
			TimestampMs:        timestampMs,
			Running:            round2(runningSum),
			Waiting:            round2(waitingSum),
			WaitingCapacity:    round2(waitingCapSum),
			WaitingDeferred:    round2(waitingDefSum),
			HasWaitingByReason: hasWaitingByReason,
			KvCachePct:         kvMean,
			MaxKvCachePct:      kvMax,
			DeltaPreemptions:   preemptDeltaSum,
			TotalPreemptions:   preemptTotalSum,
		},
		DurationSec:             intervalSec,
		DeltaGenTokens:          genDeltaSum,
		DeltaPromptTokens:       promptDeltaSum,
		DeltaPrefixHits:         deltaPrefixHits,
		DeltaPrefixQueries:      deltaPrefixQ,
		TtftDeltaBuckets:        ttftDeltaBuckets,
		ItlDeltaBuckets:         itlDeltaBuckets,
		DeltaSpecDrafts:         deltaSpecDrafts,
		DeltaSpecDraftTokens:    deltaSpecDraftTok,
		DeltaSpecAcceptedTokens: deltaSpecAccTok,
		DeltaSpecAcceptedPerPos: deltaSpecPerPos,
	}

	// Compute 5s throughput window (previous ticks in [now-5000ms, now) + current tick).
	win5 := e.ring.aggregateWindowLocked(timestampMs - 5000)
	total5Gen := win5.GenTokens + curTick.DeltaGenTokens
	total5Prompt := win5.PromptTokens + curTick.DeltaPromptTokens
	elapsed5 := win5.ElapsedSec + intervalSec
	if win5.TickCount > 0 {
		// aggregateWindowLocked already accounts for oldest tick span; add just current interval
		elapsed5 = win5.ElapsedSec + intervalSec
	}
	if elapsed5 < 1.0 {
		elapsed5 = 1.0
	}
	curTick.Point.GenTokPerSec = round2(total5Gen / elapsed5)
	curTick.Point.PromptTokPerSec = round2(total5Prompt / elapsed5)

	// Compute 30s sliding window for Prefix Cache, TTFT/ITL quantiles, and Spec Decode.
	win30 := e.ring.aggregateWindowLocked(timestampMs - 30000)
	sumHits := win30.PrefixHits + deltaPrefixHits
	sumQueries := win30.PrefixQueries + deltaPrefixQ
	if sumQueries <= 0 {
		curTick.Point.PrefixCacheIdle = true
		curTick.Point.PrefixCacheHitRate = nil
	} else {
		rate := clampPct(sumHits / sumQueries * 100.0)
		curTick.Point.PrefixCacheIdle = false
		curTick.Point.PrefixCacheHitRate = &rate
	}

	mergeBucketsInto(win30.TtftBuckets, ttftDeltaBuckets)
	mergeBucketsInto(win30.ItlBuckets, itlDeltaBuckets)
	curTick.Point.TtftP50Ms = HistogramQuantileMs(0.50, win30.TtftBuckets)
	curTick.Point.TtftP95Ms = HistogramQuantileMs(0.95, win30.TtftBuckets)
	curTick.Point.ItlP50Ms = HistogramQuantileMs(0.50, win30.ItlBuckets)
	curTick.Point.ItlP95Ms = HistogramQuantileMs(0.95, win30.ItlBuckets)

	if e.hasSpecDecode {
		win30.SpecDrafts += deltaSpecDrafts
		win30.SpecDraftTokens += deltaSpecDraftTok
		win30.SpecAcceptedTokens += deltaSpecAccTok
		for pos, val := range deltaSpecPerPos {
			win30.SpecAcceptedPerPos[pos] += val
		}
		elapsed30 := win30.ElapsedSec + intervalSec
		if elapsed30 < 1.0 {
			elapsed30 = 1.0
		}
		curTick.Point.SpecDecode = buildSpecDecodeSnapshot(win30, elapsed30, hasV0SpecAccRate, v0SpecAccRate, hasV0SpecEff, v0SpecEfficiency)
	}

	var preemptEvent *PreemptionEvent
	if preemptDeltaSum > 0 {
		e.lastPreemptionTs = timestampMs
		preemptEvent = &PreemptionEvent{
			TimestampMs: timestampMs,
			NodeID:      e.cfg.ID,
			NodeName:    e.cfg.Name,
			Delta:       preemptDeltaSum,
			Total:       preemptTotalSum,
			KvCachePct:  kvMean,
		}
	}

	e.lastAlertLevel, e.lastAlertReasons = classifyAlert("ONLINE", curTick.Point)

	// Append directly under e.mu while locking ring.
	e.ring.AppendTick(curTick, preemptEvent)

	return curTick.Point, preemptEvent
}

// MarkOffline records a failed scrape attempt without blocking other nodes.
func (e *NodeEngine) MarkOffline(timestampMs int64, scrapeDurationMs int64, errMsg string) {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.status = "OFFLINE"
	e.scrapeDurationMs = scrapeDurationMs
	e.lastError = errMsg
	e.lastAlertLevel = "critical"
	e.lastAlertReasons = []string{"node offline"}
}

// Summary returns a snapshot of the node's current metadata and latest MetricPoint.
func (e *NodeEngine) Summary() NodeSummary {
	e.mu.RLock()
	defer e.mu.RUnlock()

	var latestPtr *MetricPoint
	if tick, ok := e.ring.LatestTick(); ok {
		pt := tick.Point
		latestPtr = &pt
	}

	reasons := make([]string, len(e.lastAlertReasons))
	copy(reasons, e.lastAlertReasons)

	model := e.modelName
	if model == "" {
		model = "unknown"
	}

	return NodeSummary{
		ID:                e.cfg.ID,
		Name:              e.cfg.Name,
		URL:               e.cfg.URL,
		ModelName:         model,
		Status:            e.status,
		ScrapeDurationMs:  e.scrapeDurationMs,
		UptimeSec:         e.uptimeSec,
		LastError:         e.lastError,
		HasSpecDecode:     e.hasSpecDecode,
		Dynamic:           e.dynamic,
		AlertLevel:        e.lastAlertLevel,
		AlertReasons:      reasons,
		LastPreemptionTs:  e.lastPreemptionTs,
		TotalGenTokens:    e.totalGenTokens,
		TotalPromptTokens: e.totalPromptTokens,
		Latest:            latestPtr,
	}
}

// updateCounter implements the two mandatory safety guards:
// 1. First observation sets baseline and returns delta = 0.
// 2. Restart detection (curr < prev OR *_created timestamp changed) resets baseline and returns delta = 0.
func (e *NodeEngine) updateCounter(key counterKey, curr float64, created float64) float64 {
	st, exists := e.counters[key]
	if !exists {
		e.counters[key] = counterState{prev: curr, created: created}
		return 0
	}
	if curr < st.prev || (created > 0 && st.created > 0 && created != st.created) {
		e.counters[key] = counterState{prev: curr, created: created}
		return 0
	}
	delta := curr - st.prev
	st.prev = curr
	if created > 0 {
		st.created = created
	}
	e.counters[key] = st
	return delta
}

func engineLabel(labels map[string]string) string {
	if eng, ok := labels["engine"]; ok && eng != "" {
		return eng
	}
	return "0"
}

func lookupCreated(createdMap map[string]map[string]float64, base, engine string) float64 {
	if m, ok := createdMap[base]; ok {
		if v, ok := m[engine]; ok {
			return v
		}
	}
	return 0
}

func parseLE(raw string) (float64, bool) {
	if raw == "" {
		return 0, false
	}
	if strings.EqualFold(raw, "+Inf") || strings.EqualFold(raw, "inf") {
		return math.Inf(1), true
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(v) {
		return 0, false
	}
	return v, true
}

func computeKVPct(primary, fallback map[string]float64) (meanPct float64, maxPct float64) {
	src := primary
	if len(src) == 0 {
		src = fallback
	}
	if len(src) == 0 {
		return 0, 0
	}
	sum := 0.0
	maxVal := 0.0
	for _, v := range src {
		pct := clampPct(v * 100.0)
		sum += pct
		if pct > maxVal {
			maxVal = pct
		}
	}
	return round2(sum / float64(len(src))), round2(maxVal)
}

func buildSpecDecodeSnapshot(win WindowStats, elapsedSec float64, hasV0Acc bool, v0Acc float64, hasV0Eff bool, v0Eff float64) *SpecDecodeSnapshot {
	snap := &SpecDecodeSnapshot{
		Enabled:              true,
		MeanAcceptanceLength: 1.0,
		DraftTokensPerSec:    round2(win.SpecDraftTokens / elapsedSec),
		AcceptedTokensPerSec: round2(win.SpecAcceptedTokens / elapsedSec),
	}

	if win.SpecDraftTokens > 0 {
		snap.AcceptanceRate = clampPct(win.SpecAcceptedTokens / win.SpecDraftTokens * 100.0)
	} else if hasV0Acc {
		rate := v0Acc
		if rate <= 1.0 {
			rate *= 100.0
		}
		snap.AcceptanceRate = clampPct(rate)
	}

	if win.SpecDrafts > 0 {
		snap.MeanAcceptanceLength = round2(1.0 + win.SpecAcceptedTokens/win.SpecDrafts)
	} else if hasV0Eff {
		snap.MeanAcceptanceLength = round2(1.0 + v0Eff)
	}

	if len(win.SpecAcceptedPerPos) > 0 && win.SpecDrafts > 0 {
		positions := make([]int, 0, len(win.SpecAcceptedPerPos))
		for pos := range win.SpecAcceptedPerPos {
			positions = append(positions, pos)
		}
		sort.Ints(positions)
		snap.PerPosition = make([]SpecDecodePosRate, 0, len(positions))
		for _, pos := range positions {
			rate := clampPct(win.SpecAcceptedPerPos[pos] / win.SpecDrafts * 100.0)
			snap.PerPosition = append(snap.PerPosition, SpecDecodePosRate{
				Position:       pos,
				AcceptanceRate: rate,
			})
		}
	}

	return snap
}

func classifyAlert(status string, pt MetricPoint) (string, []string) {
	if status == "OFFLINE" {
		return "critical", []string{"node offline"}
	}
	reasons := make([]string, 0, 3)
	level := "normal"

	if pt.DeltaPreemptions > 0 {
		level = "critical"
		reasons = append(reasons, fmt.Sprintf("preemption +%g", pt.DeltaPreemptions))
	}
	if pt.KvCachePct >= 85 || pt.MaxKvCachePct >= 85 {
		level = "critical"
		reasons = append(reasons, fmt.Sprintf("KV %.1f%% >= 85%%", math.Max(pt.KvCachePct, pt.MaxKvCachePct)))
	} else if pt.KvCachePct >= 70 || pt.MaxKvCachePct >= 70 {
		if level != "critical" {
			level = "warn"
		}
		reasons = append(reasons, fmt.Sprintf("KV %.1f%% >= 70%%", math.Max(pt.KvCachePct, pt.MaxKvCachePct)))
	}

	if pt.WaitingCapacity > 0 {
		if level != "critical" {
			level = "warn"
		}
		reasons = append(reasons, fmt.Sprintf("waiting(capacity)=%.0f", pt.WaitingCapacity))
	}
	return level, reasons
}

// Registry coordinates all monitored NodeEngines and provides cluster-wide snapshots.
type Registry struct {
	mu             sync.RWMutex
	retentionHours int
	engines        map[string]*NodeEngine
	order          []string
}

// NewRegistry creates a Registry initialized with the configured nodes.
func NewRegistry(nodes []config.NodeConfig, retentionHours int) *Registry {
	reg := &Registry{
		retentionHours: retentionHours,
		engines:        make(map[string]*NodeEngine, len(nodes)),
		order:          make([]string, 0, len(nodes)),
	}
	for _, n := range nodes {
		reg.engines[n.ID] = NewNodeEngine(n, retentionHours, false)
		reg.order = append(reg.order, n.ID)
	}
	return reg
}

// AddNode registers a new node engine at runtime and returns it.
func (r *Registry) AddNode(cfg config.NodeConfig, dynamic bool) (*NodeEngine, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.engines[cfg.ID]; exists {
		return nil, fmt.Errorf("node %q already exists", cfg.ID)
	}
	eng := NewNodeEngine(cfg, r.retentionHours, dynamic)
	r.engines[cfg.ID] = eng
	r.order = append(r.order, cfg.ID)
	return eng, nil
}

// RemoveNode removes a dynamically added node engine.
func (r *Registry) RemoveNode(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.engines[id]; !exists {
		return false
	}
	delete(r.engines, id)
	next := make([]string, 0, len(r.order)-1)
	for _, oid := range r.order {
		if oid != id {
			next = append(next, oid)
		}
	}
	r.order = next
	return true
}

// Get returns the NodeEngine for id.
func (r *Registry) Get(id string) (*NodeEngine, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	eng, ok := r.engines[id]
	return eng, ok
}

// ListSummaries returns summaries for all nodes in registration order.
func (r *Registry) ListSummaries() []NodeSummary {
	r.mu.RLock()
	engines := make([]*NodeEngine, 0, len(r.order))
	for _, id := range r.order {
		if e, ok := r.engines[id]; ok {
			engines = append(engines, e)
		}
	}
	r.mu.RUnlock()

	out := make([]NodeSummary, 0, len(engines))
	for _, e := range engines {
		out = append(out, e.Summary())
	}
	return out
}

// ClusterSummary computes the aggregated summary across all nodes.
func (r *Registry) ClusterSummary() NodeSummary {
	summaries := r.ListSummaries()

	r.mu.RLock()
	engines := make([]*NodeEngine, 0, len(r.order))
	for _, id := range r.order {
		if e, ok := r.engines[id]; ok {
			engines = append(engines, e)
		}
	}
	r.mu.RUnlock()

	cluster := NodeSummary{
		ID:         "all",
		Name:       "All Cluster",
		ModelName:  "Multi-Node Cluster",
		Status:     "OFFLINE",
		AlertLevel: "normal",
	}

	models := make(map[string]struct{})
	onlineCount := 0
	var (
		sumScrapeMs  int64
		maxUptime    int64
		sumGenTok    float64
		sumPromptTok float64
		lastPreTs    int64
	)

	var (
		aggPoint         MetricPoint
		sumKV            float64
		maxKV            float64
		sumPrefixHits    float64
		sumPrefixQueries float64
		ttftBuckets      = make(map[float64]float64)
		itlBuckets       = make(map[float64]float64)
		newestTs         int64
	)

	for i, s := range summaries {
		if s.ModelName != "" && s.ModelName != "unknown" {
			models[s.ModelName] = struct{}{}
		}
		if s.UptimeSec > maxUptime {
			maxUptime = s.UptimeSec
		}
		sumGenTok += s.TotalGenTokens
		sumPromptTok += s.TotalPromptTokens
		if s.LastPreemptionTs > lastPreTs {
			lastPreTs = s.LastPreemptionTs
		}
		if s.Status == "ONLINE" && s.Latest != nil {
			onlineCount++
			sumScrapeMs += s.ScrapeDurationMs
			pt := *s.Latest
			if pt.TimestampMs > newestTs {
				newestTs = pt.TimestampMs
			}
			aggPoint.GenTokPerSec = round2(aggPoint.GenTokPerSec + pt.GenTokPerSec)
			aggPoint.PromptTokPerSec = round2(aggPoint.PromptTokPerSec + pt.PromptTokPerSec)
			aggPoint.Running = round2(aggPoint.Running + pt.Running)
			aggPoint.Waiting = round2(aggPoint.Waiting + pt.Waiting)
			aggPoint.WaitingCapacity = round2(aggPoint.WaitingCapacity + pt.WaitingCapacity)
			aggPoint.WaitingDeferred = round2(aggPoint.WaitingDeferred + pt.WaitingDeferred)
			if pt.HasWaitingByReason {
				aggPoint.HasWaitingByReason = true
			}
			aggPoint.DeltaPreemptions += pt.DeltaPreemptions
			aggPoint.TotalPreemptions += pt.TotalPreemptions
			sumKV += pt.KvCachePct
			if pt.KvCachePct > maxKV {
				maxKV = pt.KvCachePct
			}

			// Merge exact 30s deltas for true cluster prefix hit rate and quantiles.
			if i < len(engines) {
				win30 := engines[i].ring.AggregateWindow(pt.TimestampMs - 30000)
				sumPrefixHits += win30.PrefixHits
				sumPrefixQueries += win30.PrefixQueries
				mergeBucketsInto(ttftBuckets, win30.TtftBuckets)
				mergeBucketsInto(itlBuckets, win30.ItlBuckets)
			}
		}
	}

	if len(models) == 1 {
		for m := range models {
			cluster.ModelName = m
		}
	} else if len(models) > 1 {
		cluster.ModelName = fmt.Sprintf("%d Models Active", len(models))
	}

	cluster.UptimeSec = maxUptime
	cluster.TotalGenTokens = sumGenTok
	cluster.TotalPromptTokens = sumPromptTok
	cluster.LastPreemptionTs = lastPreTs

	if onlineCount > 0 {
		cluster.Status = "ONLINE"
		cluster.ScrapeDurationMs = sumScrapeMs / int64(onlineCount)
		aggPoint.TimestampMs = newestTs
		aggPoint.KvCachePct = round2(sumKV / float64(onlineCount))
		aggPoint.MaxKvCachePct = round2(maxKV)
		if sumPrefixQueries <= 0 {
			aggPoint.PrefixCacheIdle = true
		} else {
			rate := clampPct(sumPrefixHits / sumPrefixQueries * 100.0)
			aggPoint.PrefixCacheHitRate = &rate
		}
		aggPoint.TtftP50Ms = HistogramQuantileMs(0.50, ttftBuckets)
		aggPoint.TtftP95Ms = HistogramQuantileMs(0.95, ttftBuckets)
		aggPoint.ItlP50Ms = HistogramQuantileMs(0.50, itlBuckets)
		aggPoint.ItlP95Ms = HistogramQuantileMs(0.95, itlBuckets)

		cluster.Latest = &aggPoint
		cluster.AlertLevel, cluster.AlertReasons = classifyAlert("ONLINE", aggPoint)
	} else if len(summaries) > 0 {
		cluster.AlertLevel = "critical"
		cluster.AlertReasons = []string{"all nodes offline"}
	}

	return cluster
}

// Snapshot returns historical points and preemption events for a specific node ID or "all".
func (r *Registry) Snapshot(nodeID, rangeStr string) (SnapshotResponse, bool) {
	if rangeStr != "6h" {
		rangeStr = "15m"
	}
	summaries := r.ListSummaries()

	if nodeID == "" || nodeID == "all" {
		return r.clusterSnapshot(rangeStr, summaries), true
	}

	eng, ok := r.Get(nodeID)
	if !ok {
		return SnapshotResponse{}, false
	}

	var pts []MetricPoint
	if rangeStr == "6h" {
		pts = eng.ring.LowFreqPoints()
	} else {
		pts = eng.ring.HighFreqPoints()
	}

	var minTs int64
	if len(pts) > 0 {
		minTs = pts[0].TimestampMs
	}
	preemptions := eng.ring.PreemptionsSince(minTs)

	return SnapshotResponse{
		NodeID:      nodeID,
		Range:       rangeStr,
		Summary:     eng.Summary(),
		Points:      pts,
		Preemptions: preemptions,
		Nodes:       summaries,
	}, true
}

func (r *Registry) clusterSnapshot(rangeStr string, summaries []NodeSummary) SnapshotResponse {
	r.mu.RLock()
	engines := make([]*NodeEngine, 0, len(r.order))
	for _, id := range r.order {
		if e, ok := r.engines[id]; ok {
			engines = append(engines, e)
		}
	}
	r.mu.RUnlock()

	bucketMs := int64(1000)
	if rangeStr == "6h" {
		bucketMs = 60000
	}

	type bucketAccum struct {
		ts               int64
		count            float64
		gen              float64
		prompt           float64
		running          float64
		waiting          float64
		waitingCap       float64
		waitingDef       float64
		hasReason        bool
		sumKV            float64
		maxKV            float64
		deltaPre         float64
		totalPre         float64
		prefixRateSum    float64
		prefixActiveCnt  float64
		ttftP50Sum       float64
		ttftP50Cnt       float64
		ttftP95Sum       float64
		ttftP95Cnt       float64
		itlP50Sum        float64
		itlP50Cnt        float64
		itlP95Sum        float64
		itlP95Cnt        float64
	}

	buckets := make(map[int64]*bucketAccum)
	var minTs int64

	for _, e := range engines {
		var pts []MetricPoint
		if rangeStr == "6h" {
			pts = e.ring.LowFreqPoints()
		} else {
			pts = e.ring.HighFreqPoints()
		}
		for _, p := range pts {
			bTs := (p.TimestampMs / bucketMs) * bucketMs
			if minTs == 0 || bTs < minTs {
				minTs = bTs
			}
			acc := buckets[bTs]
			if acc == nil {
				acc = &bucketAccum{ts: bTs}
				buckets[bTs] = acc
			}
			acc.count++
			acc.gen += p.GenTokPerSec
			acc.prompt += p.PromptTokPerSec
			acc.running += p.Running
			acc.waiting += p.Waiting
			acc.waitingCap += p.WaitingCapacity
			acc.waitingDef += p.WaitingDeferred
			if p.HasWaitingByReason {
				acc.hasReason = true
			}
			acc.sumKV += p.KvCachePct
			if p.KvCachePct > acc.maxKV {
				acc.maxKV = p.KvCachePct
			}
			acc.deltaPre += p.DeltaPreemptions
			acc.totalPre += p.TotalPreemptions
			if !p.PrefixCacheIdle && p.PrefixCacheHitRate != nil {
				acc.prefixRateSum += *p.PrefixCacheHitRate
				acc.prefixActiveCnt++
			}
			if p.TtftP50Ms != nil {
				acc.ttftP50Sum += *p.TtftP50Ms
				acc.ttftP50Cnt++
			}
			if p.TtftP95Ms != nil {
				acc.ttftP95Sum += *p.TtftP95Ms
				acc.ttftP95Cnt++
			}
			if p.ItlP50Ms != nil {
				acc.itlP50Sum += *p.ItlP50Ms
				acc.itlP50Cnt++
			}
			if p.ItlP95Ms != nil {
				acc.itlP95Sum += *p.ItlP95Ms
				acc.itlP95Cnt++
			}
		}
	}

	keys := make([]int64, 0, len(buckets))
	for ts := range buckets {
		keys = append(keys, ts)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })

	points := make([]MetricPoint, 0, len(keys))
	for _, k := range keys {
		acc := buckets[k]
		pt := MetricPoint{
			TimestampMs:        acc.ts,
			GenTokPerSec:       round2(acc.gen),
			PromptTokPerSec:    round2(acc.prompt),
			Running:            round2(acc.running),
			Waiting:            round2(acc.waiting),
			WaitingCapacity:    round2(acc.waitingCap),
			WaitingDeferred:    round2(acc.waitingDef),
			HasWaitingByReason: acc.hasReason,
			KvCachePct:         round2(acc.sumKV / acc.count),
			MaxKvCachePct:      round2(acc.maxKV),
			DeltaPreemptions:   acc.deltaPre,
			TotalPreemptions:   acc.totalPre,
		}
		if acc.prefixActiveCnt > 0 {
			v := round2(acc.prefixRateSum / acc.prefixActiveCnt)
			pt.PrefixCacheHitRate = &v
		} else {
			pt.PrefixCacheIdle = true
		}
		if acc.ttftP50Cnt > 0 {
			v := round2(acc.ttftP50Sum / acc.ttftP50Cnt)
			pt.TtftP50Ms = &v
		}
		if acc.ttftP95Cnt > 0 {
			v := round2(acc.ttftP95Sum / acc.ttftP95Cnt)
			pt.TtftP95Ms = &v
		}
		if acc.itlP50Cnt > 0 {
			v := round2(acc.itlP50Sum / acc.itlP50Cnt)
			pt.ItlP50Ms = &v
		}
		if acc.itlP95Cnt > 0 {
			v := round2(acc.itlP95Sum / acc.itlP95Cnt)
			pt.ItlP95Ms = &v
		}
		points = append(points, pt)
	}

	var allPreemptions []PreemptionEvent
	for _, e := range engines {
		allPreemptions = append(allPreemptions, e.ring.PreemptionsSince(minTs)...)
	}
	sort.Slice(allPreemptions, func(i, j int) bool {
		return allPreemptions[i].TimestampMs < allPreemptions[j].TimestampMs
	})

	return SnapshotResponse{
		NodeID:      "all",
		Range:       rangeStr,
		Summary:     r.ClusterSummary(),
		Points:      points,
		Preemptions: allPreemptions,
		Nodes:       summaries,
	}
}
