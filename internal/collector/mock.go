package collector

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/wade6716/vllm-pulse/internal/config"
	"github.com/wade6716/vllm-pulse/internal/metrics"
	"github.com/wade6716/vllm-pulse/internal/promparse"
)

type mockNodeState struct {
	cfg               config.NodeConfig
	modelName         string
	hasSpecDecode     bool
	createdSec        float64
	preemptions       float64
	genTokens         float64
	promptTokens      float64
	prefixHits        float64
	prefixQueries     float64
	ttftBuckets       []float64
	itlBuckets        []float64
	specDrafts        float64
	specDraftTokens   float64
	specAcceptedTotal float64
	specAcceptedPos   [5]float64
}

var (
	ttftBounds = []float64{0.02, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0}
	itlBounds  = []float64{0.005, 0.01, 0.02, 0.035, 0.05, 0.08, 0.12, 0.25}
)

// MockNodes returns the 3 built-in mock node definitions.
func MockNodes() []config.NodeConfig {
	return []config.NodeConfig{
		{
			ID:   "mock-qwen3-a100",
			Name: "gpu-a100-01 (Qwen3-27B)",
			URL:  "mock://gpu-a100-01:11435/metrics",
		},
		{
			ID:   "mock-llama3-h100",
			Name: "gpu-h100-02 (Llama-3.3-70B)",
			URL:  "mock://gpu-h100-02:11435/metrics",
		},
		{
			ID:   "mock-deepseek-l40",
			Name: "gpu-l40s-03 (DeepSeek-R1-32B)",
			URL:  "mock://gpu-l40s-03:11435/metrics",
		},
	}
}

// MockRunner emits realistic Prometheus exposition metrics for 3 simulated vLLM nodes
// and feeds them through the exact same promparse -> MetricEngine -> RingBuffer pipeline.
type MockRunner struct {
	registry  *metrics.Registry
	interval  time.Duration
	onPreempt PreemptionSink
	states    []*mockNodeState
}

// NewMockRunner creates a MockRunner and pre-warms 120 seconds of realistic history.
func NewMockRunner(registry *metrics.Registry, interval time.Duration, onPreempt PreemptionSink) *MockRunner {
	nowSec := float64(time.Now().Unix())
	states := []*mockNodeState{
		{
			cfg:           MockNodes()[0],
			modelName:     "Qwen3-27B-FP8",
			hasSpecDecode: true,
			createdSec:    nowSec - 142310,
			preemptions:   7231.0, // Exercises first-scrape baseline protection
			genTokens:     1842000,
			promptTokens:  9210000,
			prefixHits:    320000,
			prefixQueries: 480000,
			ttftBuckets:   make([]float64, len(ttftBounds)+1),
			itlBuckets:    make([]float64, len(itlBounds)+1),
			specDrafts:    120000,
			specDraftTokens: 600000,
			specAcceptedTotal: 396000,
		},
		{
			cfg:           MockNodes()[1],
			modelName:     "Llama-3.3-70B-FP8",
			hasSpecDecode: false,
			createdSec:    nowSec - 498120,
			preemptions:   412.0,
			genTokens:     4210000,
			promptTokens:  15800000,
			prefixHits:    610000,
			prefixQueries: 820000,
			ttftBuckets:   make([]float64, len(ttftBounds)+1),
			itlBuckets:    make([]float64, len(itlBounds)+1),
		},
		{
			cfg:           MockNodes()[2],
			modelName:     "DeepSeek-R1-Distill-32B",
			hasSpecDecode: false,
			createdSec:    nowSec - 84210,
			preemptions:   19.0,
			genTokens:     910000,
			promptTokens:  3400000,
			prefixHits:    120000,
			prefixQueries: 195000,
			ttftBuckets:   make([]float64, len(ttftBounds)+1),
			itlBuckets:    make([]float64, len(itlBounds)+1),
		},
	}

	mr := &MockRunner{
		registry:  registry,
		interval:  interval,
		onPreempt: onPreempt,
		states:    states,
	}
	mr.warmup(120)
	return mr
}

func (m *MockRunner) warmup(seconds int) {
	now := time.Now().Truncate(time.Second)
	for i := seconds; i >= 1; i-- {
		ts := now.Add(-time.Duration(i) * time.Second)
		m.stepAt(ts, false)
	}
}

// Start runs the mock 1s ticker until ctx is cancelled.
func (m *MockRunner) Start(ctx context.Context) {
	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			m.stepAt(now, true)
		}
	}
}

func (m *MockRunner) stepAt(ts time.Time, emitEvents bool) {
	sec := ts.Unix()
	tsMs := ts.UnixMilli()

	for idx, st := range m.states {
		promText := m.advanceAndFormat(idx, st, sec)
		samples, err := promparse.Parse(strings.NewReader(promText))
		if err != nil {
			continue
		}
		eng, ok := m.registry.Get(st.cfg.ID)
		if !ok {
			continue
		}
		// Realistic sub-15ms mock scrape time.
		scrapeMs := int64(5 + (sec+int64(idx*3))%7)
		_, preemptEv := eng.Ingest(tsMs, samples, scrapeMs)
		if emitEvents && preemptEv != nil && m.onPreempt != nil {
			m.onPreempt(*preemptEv)
		}
	}
}

func (m *MockRunner) advanceAndFormat(idx int, st *mockNodeState, sec int64) string {
	var (
		running      float64
		waitingCap   float64
		waitingDef   float64
		kvFrac       float64
		genDelta     float64
		promptDelta  float64
		queryDelta   float64
		hitDelta     float64
		preemptDelta float64
		ttftScale    float64 = 1.0
		itlScale     float64 = 1.0
	)

	switch idx {
	case 0:
		// Node 1 (Qwen3-27B + Spec Decode): 60s cycle showing Normal -> Amber (75-84%) -> Red KV > 85% + Preemption spike -> Recovery
		phase := sec % 60
		wave := math.Sin(float64(sec) * 0.22)
		switch {
		case phase < 28:
			// Normal calm operation
			kvFrac = 0.44 + 0.08*wave
			running = 12 + math.Round(3*wave)
			genDelta = 340 + 45*wave
			promptDelta = 820 + 140*math.Cos(float64(sec)*0.18)
			queryDelta = 120
			hitDelta = 88
		case phase < 40:
			// Amber ramp (72% .. 84%)
			prog := float64(phase-28) / 12.0
			kvFrac = 0.72 + prog*0.12
			running = 24 + math.Round(prog*6)
			waitingCap = math.Round(1 + prog*2)
			waitingDef = 1
			genDelta = 460 + 40*wave
			promptDelta = 1450 + 180*wave
			queryDelta = 180
			hitDelta = 112
			ttftScale = 1.6
			itlScale = 1.35
		case phase < 48:
			// Critical KV >= 88%..95% + Preemption spikes!
			prog := float64(phase-40) / 8.0
			kvFrac = 0.89 + 0.05*math.Sin(prog*math.Pi)
			running = 30
			waitingCap = 5 + float64(phase%3)
			waitingDef = 2
			genDelta = 380 + 30*wave
			promptDelta = 1800 + 200*wave
			queryDelta = 210
			hitDelta = 96
			ttftScale = 2.8
			itlScale = 1.9
			if phase == 41 || phase == 44 || phase == 46 {
				preemptDelta = float64(2 + (phase % 2))
			}
		default:
			// Cooling recovery
			prog := float64(phase-48) / 12.0
			kvFrac = 0.78 - prog*0.32
			running = 18 - math.Round(prog*6)
			waitingDef = 1
			genDelta = 350 + 25*wave
			promptDelta = 900 + 90*wave
			queryDelta = 140
			hitDelta = 104
			ttftScale = 1.25
		}

		// Advance spec decode counters
		drafts := 95 + 15*wave
		st.specDrafts += drafts
		st.specDraftTokens += drafts * 5.0
		posRates := [5]float64{0.91, 0.78, 0.61, 0.44, 0.27}
		for p, r := range posRates {
			acc := drafts * (r + 0.03*math.Sin(float64(sec)+float64(p)))
			if acc < 0 {
				acc = 0
			}
			st.specAcceptedPos[p] += acc
			st.specAcceptedTotal += acc
		}

	case 1:
		// Node 2 (Llama-3.3-70B, no spec decode): steady high throughput + periodic single preemption
		wave := math.Sin(float64(sec) * 0.14)
		kvFrac = 0.54 + 0.09*wave
		running = 18 + math.Round(4*wave)
		if sec%90 == 22 {
			preemptDelta = 1
			kvFrac = 0.76
			waitingCap = 1
		}
		genDelta = 520 + 65*wave
		promptDelta = 1120 + 190*math.Cos(float64(sec)*0.11)
		queryDelta = 160
		hitDelta = 132 // ~82.5% hit rate
		ttftScale = 1.15
		itlScale = 1.05

	default:
		// Node 3 (DeepSeek-R1-32B): 35s active burst / 35s idle (Δqueries == 0 -> Prefix Cache IDLE)
		cycle := sec % 70
		if cycle < 35 {
			wave := math.Sin(float64(sec) * 0.25)
			kvFrac = 0.36 + 0.12*wave
			running = 8 + math.Round(3*wave)
			waitingDef = float64(cycle % 2)
			genDelta = 260 + 50*wave
			promptDelta = 640 + 120*wave
			queryDelta = 90
			hitDelta = 54
			ttftScale = 0.9
			itlScale = 0.85
		} else {
			// True idle period: 0 queries, 0 tokens, KV near idle baseline
			kvFrac = 0.06
			running = 0
			genDelta = 0
			promptDelta = 0
			queryDelta = 0
			hitDelta = 0
		}
	}

	st.preemptions += preemptDelta
	st.genTokens += genDelta
	st.promptTokens += promptDelta
	st.prefixQueries += queryDelta
	st.prefixHits += hitDelta

	// Populate TTFT & ITL cumulative histogram buckets when requests occurred.
	if promptDelta > 0 {
		addHistogramSample(st.ttftBuckets, ttftBounds, 0.085*ttftScale, 12)
	}
	if genDelta > 0 {
		addHistogramSample(st.itlBuckets, itlBounds, 0.018*itlScale, 30)
	}

	var sb strings.Builder
	lbl := fmt.Sprintf(`engine="0",model_name="%s"`, st.modelName)
	sb.WriteString(fmt.Sprintf("vllm:num_requests_running{%s} %.1f\n", lbl, running))
	sb.WriteString(fmt.Sprintf("vllm:num_requests_waiting{%s} %.1f\n", lbl, waitingCap+waitingDef))
	sb.WriteString(fmt.Sprintf("vllm:num_requests_waiting_by_reason{%s,reason=\"capacity\"} %.1f\n", lbl, waitingCap))
	sb.WriteString(fmt.Sprintf("vllm:num_requests_waiting_by_reason{%s,reason=\"deferred\"} %.1f\n", lbl, waitingDef))
	sb.WriteString(fmt.Sprintf("vllm:kv_cache_usage_perc{%s} %.6f\n", lbl, kvFrac))
	sb.WriteString(fmt.Sprintf("vllm:num_preemptions_total{%s} %.1f\n", lbl, st.preemptions))
	sb.WriteString(fmt.Sprintf("vllm:num_preemptions_created{%s} %.6e\n", lbl, st.createdSec))
	sb.WriteString(fmt.Sprintf("vllm:generation_tokens_total{%s} %.1f\n", lbl, st.genTokens))
	sb.WriteString(fmt.Sprintf("vllm:prompt_tokens_total{%s} %.1f\n", lbl, st.promptTokens))
	sb.WriteString(fmt.Sprintf("vllm:prefix_cache_hits_total{%s} %.1f\n", lbl, st.prefixHits))
	sb.WriteString(fmt.Sprintf("vllm:prefix_cache_queries_total{%s} %.1f\n", lbl, st.prefixQueries))

	for i, b := range ttftBounds {
		sb.WriteString(fmt.Sprintf("vllm:time_to_first_token_seconds_bucket{%s,le=\"%g\"} %.0f\n", lbl, b, st.ttftBuckets[i]))
	}
	sb.WriteString(fmt.Sprintf("vllm:time_to_first_token_seconds_bucket{%s,le=\"+Inf\"} %.0f\n", lbl, st.ttftBuckets[len(ttftBounds)]))

	for i, b := range itlBounds {
		sb.WriteString(fmt.Sprintf("vllm:inter_token_latency_seconds_bucket{%s,le=\"%g\"} %.0f\n", lbl, b, st.itlBuckets[i]))
	}
	sb.WriteString(fmt.Sprintf("vllm:inter_token_latency_seconds_bucket{%s,le=\"+Inf\"} %.0f\n", lbl, st.itlBuckets[len(itlBounds)]))

	if st.hasSpecDecode {
		sb.WriteString(fmt.Sprintf("vllm:spec_decode_num_drafts_total{%s} %.1f\n", lbl, st.specDrafts))
		sb.WriteString(fmt.Sprintf("vllm:spec_decode_num_draft_tokens_total{%s} %.1f\n", lbl, st.specDraftTokens))
		sb.WriteString(fmt.Sprintf("vllm:spec_decode_num_accepted_tokens_total{%s} %.1f\n", lbl, st.specAcceptedTotal))
		for pos := 0; pos < len(st.specAcceptedPos); pos++ {
			sb.WriteString(fmt.Sprintf("vllm:spec_decode_num_accepted_tokens_per_pos_total{%s,position=\"%d\"} %.1f\n", lbl, pos, st.specAcceptedPos[pos]))
		}
	}

	return sb.String()
}

func addHistogramSample(buckets []float64, bounds []float64, medianSec float64, weight float64) {
	// Distribute weight around medianSec into cumulative buckets.
	for i, b := range bounds {
		ratio := b / (b + medianSec)
		buckets[i] += math.Round(weight * ratio)
	}
	buckets[len(bounds)] += weight
}
