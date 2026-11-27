package metrics

import (
	"math"
	"strings"
	"testing"

	"github.com/wade6716/vllm-pulse/internal/config"
	"github.com/wade6716/vllm-pulse/internal/promparse"
)

func parseSampleText(t *testing.T, text string) []promparse.Sample {
	t.Helper()
	samples, err := promparse.Parse(strings.NewReader(text))
	if err != nil {
		t.Fatalf("parseSampleText failed: %v", err)
	}
	return samples
}

func TestFirstScrapeBaselineZeroing(t *testing.T) {
	eng := NewNodeEngine(config.NodeConfig{ID: "n1", Name: "n1", URL: "http://n1/metrics"}, 6, false)

	s1 := parseSampleText(t, `
vllm:num_requests_running{engine="0",model_name="Qwen3-27B"} 2.0
vllm:kv_cache_usage_perc{engine="0",model_name="Qwen3-27B"} 0.25
vllm:num_preemptions_total{engine="0",model_name="Qwen3-27B"} 7231.0
vllm:num_preemptions_created{engine="0",model_name="Qwen3-27B"} 1794913047.0
vllm:generation_tokens_total{engine="0",model_name="Qwen3-27B"} 500000.0
`)
	pt1, ev1 := eng.Ingest(1794913100000, s1, 10)
	if pt1.DeltaPreemptions != 0 || ev1 != nil {
		t.Fatalf("first scrape must yield deltaPreemptions=0 and nil event, got delta=%v, ev=%v", pt1.DeltaPreemptions, ev1)
	}
	if pt1.TotalPreemptions != 7231.0 {
		t.Fatalf("expected totalPreemptions=7231.0, got %v", pt1.TotalPreemptions)
	}
	if pt1.GenTokPerSec != 0 {
		t.Fatalf("first scrape throughput must be 0, got %v", pt1.GenTokPerSec)
	}

	s2 := parseSampleText(t, `
vllm:num_requests_running{engine="0",model_name="Qwen3-27B"} 3.0
vllm:kv_cache_usage_perc{engine="0",model_name="Qwen3-27B"} 0.30
vllm:num_preemptions_total{engine="0",model_name="Qwen3-27B"} 7233.0
vllm:num_preemptions_created{engine="0",model_name="Qwen3-27B"} 1794913047.0
vllm:generation_tokens_total{engine="0",model_name="Qwen3-27B"} 500200.0
`)
	pt2, ev2 := eng.Ingest(1794913101000, s2, 12)
	if pt2.DeltaPreemptions != 2 || ev2 == nil || ev2.Delta != 2 {
		t.Fatalf("second scrape expected deltaPreemptions=2, got delta=%v, ev=%+v", pt2.DeltaPreemptions, ev2)
	}
	if math.Abs(pt2.GenTokPerSec-100.0) > 0.5 {
		t.Fatalf("expected 200 tokens over 2 ticks (~100 tok/s), got %v", pt2.GenTokPerSec)
	}
}

func TestContainerRestartResetProtection(t *testing.T) {
	eng := NewNodeEngine(config.NodeConfig{ID: "n1", Name: "n1", URL: "http://n1/metrics"}, 6, false)

	// Scrape 1: baseline
	eng.Ingest(1700000000000, parseSampleText(t, `
vllm:num_preemptions_total{engine="0"} 100.0
vllm:num_preemptions_created{engine="0"} 1700000000.0
vllm:generation_tokens_total{engine="0"} 10000.0
`), 5)

	// Scrape 2: normal increment
	pt2, _ := eng.Ingest(1700000001000, parseSampleText(t, `
vllm:num_preemptions_total{engine="0"} 101.0
vllm:num_preemptions_created{engine="0"} 1700000000.0
vllm:generation_tokens_total{engine="0"} 10100.0
`), 5)
	if pt2.DeltaPreemptions != 1 {
		t.Fatalf("expected delta=1 before restart, got %v", pt2.DeltaPreemptions)
	}

	// Case A: Restart detected by curr < prev
	pt3, ev3 := eng.Ingest(1700000002000, parseSampleText(t, `
vllm:num_preemptions_total{engine="0"} 2.0
vllm:num_preemptions_created{engine="0"} 1700000000.0
vllm:generation_tokens_total{engine="0"} 50.0
`), 5)
	if pt3.DeltaPreemptions != 0 || ev3 != nil {
		t.Fatalf("restart (curr < prev) must reset delta to 0, got %v", pt3.DeltaPreemptions)
	}

	// Scrape 4: normal increment after restart
	pt4, ev4 := eng.Ingest(1700000003000, parseSampleText(t, `
vllm:num_preemptions_total{engine="0"} 5.0
vllm:num_preemptions_created{engine="0"} 1700000000.0
vllm:generation_tokens_total{engine="0"} 150.0
`), 5)
	if pt4.DeltaPreemptions != 3 || ev4 == nil || ev4.Delta != 3 {
		t.Fatalf("expected delta=3 after restart recovery, got %v", pt4.DeltaPreemptions)
	}

	// Case B: Restart detected purely by *_created timestamp change even when curr >= prev!
	pt5, ev5 := eng.Ingest(1700000004000, parseSampleText(t, `
vllm:num_preemptions_total{engine="0"} 10.0
vllm:num_preemptions_created{engine="0"} 1700000004.0
vllm:generation_tokens_total{engine="0"} 200.0
`), 5)
	if pt5.DeltaPreemptions != 0 || ev5 != nil {
		t.Fatalf("restart (*_created change) must reset delta to 0, got %v", pt5.DeltaPreemptions)
	}
}

func TestPrefixCacheIdleAndWindowHitRate(t *testing.T) {
	eng := NewNodeEngine(config.NodeConfig{ID: "n1", Name: "n1", URL: "http://n1/metrics"}, 6, false)

	// Scrape 1: baseline -> delta queries == 0 -> idle
	pt1, _ := eng.Ingest(1700000000000, parseSampleText(t, `
vllm:prefix_cache_hits_total{engine="0"} 500
vllm:prefix_cache_queries_total{engine="0"} 1000
`), 5)
	if !pt1.PrefixCacheIdle || pt1.PrefixCacheHitRate != nil {
		t.Fatalf("expected idle prefix cache when Δqueries=0, got idle=%v rate=%v", pt1.PrefixCacheIdle, pt1.PrefixCacheHitRate)
	}

	// Scrape 2: +75 hits / +100 queries -> 75%
	pt2, _ := eng.Ingest(1700000001000, parseSampleText(t, `
vllm:prefix_cache_hits_total{engine="0"} 575
vllm:prefix_cache_queries_total{engine="0"} 1100
`), 5)
	if pt2.PrefixCacheIdle || pt2.PrefixCacheHitRate == nil || math.Abs(*pt2.PrefixCacheHitRate-75.0) > 0.01 {
		t.Fatalf("expected 75%% prefix cache hit rate, got idle=%v rate=%v", pt2.PrefixCacheIdle, pt2.PrefixCacheHitRate)
	}

	// Advance 35s with zero new queries so the 30s window becomes completely idle again.
	pt3, _ := eng.Ingest(1700000036000, parseSampleText(t, `
vllm:prefix_cache_hits_total{engine="0"} 575
vllm:prefix_cache_queries_total{engine="0"} 1100
`), 5)
	if !pt3.PrefixCacheIdle || pt3.PrefixCacheHitRate != nil {
		t.Fatalf("expected idle prefix cache after 30s window expires, got idle=%v rate=%v", pt3.PrefixCacheIdle, pt3.PrefixCacheHitRate)
	}
}

func TestV0FallbacksMultiEngineAndSpecDecode(t *testing.T) {
	eng := NewNodeEngine(config.NodeConfig{ID: "n1", Name: "n1", URL: "http://n1/metrics"}, 6, false)

	base := `
vllm:num_requests_running{engine="0",model_name="V0-Model"} 2
vllm:num_requests_running{engine="1",model_name="V0-Model"} 3
vllm:gpu_cache_usage_perc{engine="0",model_name="V0-Model"} 0.40
vllm:gpu_cache_usage_perc{engine="1",model_name="V0-Model"} 0.60
vllm:gpu_prefix_cache_hits_total{engine="0"} 100
vllm:gpu_prefix_cache_queries_total{engine="0"} 200
vllm:time_per_output_token_seconds_bucket{engine="0",le="0.02"} 10
vllm:time_per_output_token_seconds_bucket{engine="0",le="0.04"} 20
vllm:time_per_output_token_seconds_bucket{engine="0",le="+Inf"} 20
vllm:spec_decode_num_drafts_total{engine="0"} 100
vllm:spec_decode_num_draft_tokens_total{engine="0"} 300
vllm:spec_decode_num_accepted_tokens_total{engine="0"} 200
vllm:spec_decode_num_accepted_tokens_per_pos_total{engine="0",position="0"} 100
vllm:spec_decode_num_accepted_tokens_per_pos_total{engine="0",position="1"} 80
`
	eng.Ingest(1700000000000, parseSampleText(t, base), 8)

	next := `
vllm:num_requests_running{engine="0",model_name="V0-Model"} 2
vllm:num_requests_running{engine="1",model_name="V0-Model"} 3
vllm:gpu_cache_usage_perc{engine="0",model_name="V0-Model"} 0.40
vllm:gpu_cache_usage_perc{engine="1",model_name="V0-Model"} 0.60
vllm:gpu_prefix_cache_hits_total{engine="0"} 140
vllm:gpu_prefix_cache_queries_total{engine="0"} 250
vllm:time_per_output_token_seconds_bucket{engine="0",le="0.02"} 60
vllm:time_per_output_token_seconds_bucket{engine="0",le="0.04"} 120
vllm:time_per_output_token_seconds_bucket{engine="0",le="+Inf"} 120
vllm:spec_decode_num_drafts_total{engine="0"} 200
vllm:spec_decode_num_draft_tokens_total{engine="0"} 600
vllm:spec_decode_num_accepted_tokens_total{engine="0"} 350
vllm:spec_decode_num_accepted_tokens_per_pos_total{engine="0",position="0"} 190
vllm:spec_decode_num_accepted_tokens_per_pos_total{engine="0",position="1"} 140
`
	pt, _ := eng.Ingest(1700000001000, parseSampleText(t, next), 8)

	if pt.Running != 5 {
		t.Fatalf("expected multi-engine running=5, got %v", pt.Running)
	}
	if math.Abs(pt.KvCachePct-50.0) > 0.01 || math.Abs(pt.MaxKvCachePct-60.0) > 0.01 {
		t.Fatalf("expected mean KV=50%% and max KV=60%%, got mean=%v max=%v", pt.KvCachePct, pt.MaxKvCachePct)
	}
	if pt.PrefixCacheHitRate == nil || math.Abs(*pt.PrefixCacheHitRate-80.0) > 0.01 {
		t.Fatalf("expected V0 gpu_prefix_cache hit rate=80%%, got %v", pt.PrefixCacheHitRate)
	}
	// ITL delta buckets: le=0.02 -> 50, le=0.04 -> 100, +Inf -> 100 => P50 = 20ms, P95 = 38ms
	if pt.ItlP50Ms == nil || math.Abs(*pt.ItlP50Ms-20.0) > 0.1 {
		t.Fatalf("expected ITL P50=20ms, got %v", pt.ItlP50Ms)
	}
	if pt.ItlP95Ms == nil || math.Abs(*pt.ItlP95Ms-38.0) > 0.1 {
		t.Fatalf("expected ITL P95=38ms, got %v", pt.ItlP95Ms)
	}
	if pt.SpecDecode == nil || !pt.SpecDecode.Enabled {
		t.Fatalf("expected spec decode enabled")
	}
	// Δdrafts=100, ΔdraftTokens=300, Δaccepted=150 => acceptanceRate=50%, meanLen=1+150/100=2.5
	if math.Abs(pt.SpecDecode.AcceptanceRate-50.0) > 0.01 {
		t.Fatalf("expected spec decode acceptance rate 50%%, got %v", pt.SpecDecode.AcceptanceRate)
	}
	if math.Abs(pt.SpecDecode.MeanAcceptanceLength-2.5) > 0.01 {
		t.Fatalf("expected mean acceptance length 2.5, got %v", pt.SpecDecode.MeanAcceptanceLength)
	}
	if len(pt.SpecDecode.PerPosition) != 2 || math.Abs(pt.SpecDecode.PerPosition[0].AcceptanceRate-90.0) > 0.01 || math.Abs(pt.SpecDecode.PerPosition[1].AcceptanceRate-60.0) > 0.01 {
		t.Fatalf("unexpected per-position rates: %+v", pt.SpecDecode.PerPosition)
	}
}

func TestSnapshotTimeRangeSlicing(t *testing.T) {
	reg := NewRegistry([]config.NodeConfig{{ID: "n1", Name: "n1", URL: "http://n1/metrics"}}, 24)
	eng, ok := reg.Get("n1")
	if !ok {
		t.Fatal("missing n1 engine")
	}

	baseTs := int64(1700000000000)
	// Push 10 minutes (600 seconds) of samples
	for i := 0; i < 600; i++ {
		ts := baseTs + int64(i)*1000
		pre := 0.0
		if i == 100 || i == 580 {
			pre = float64(i)
		}
		eng.Ingest(ts, []promparse.Sample{
			{Name: "vllm:num_requests_running", Labels: map[string]string{"engine": "0"}, Value: 4},
			{Name: "vllm:kv_cache_usage_perc", Labels: map[string]string{"engine": "0"}, Value: 0.4},
			{Name: "vllm:num_preemptions_total", Labels: map[string]string{"engine": "0"}, Value: 10 + pre},
		}, 5)
	}

	snap1m, ok := reg.Snapshot("n1", "1m")
	if !ok || snap1m.Range != "1m" || len(snap1m.Points) != 61 {
		t.Fatalf("expected 1m range with 61 points (0..60s inclusive), got ok=%v range=%s len=%d", ok, snap1m.Range, len(snap1m.Points))
	}
	if len(snap1m.Preemptions) != 1 {
		t.Fatalf("expected only recent preemption event inside 1m window, got %d", len(snap1m.Preemptions))
	}

	snap5m, _ := reg.Snapshot("n1", "5m")
	if snap5m.Range != "5m" || len(snap5m.Points) != 301 {
		t.Fatalf("expected 5m range with 301 points, got range=%s len=%d", snap5m.Range, len(snap5m.Points))
	}

	snap15m, _ := reg.Snapshot("all", "15m")
	if snap15m.Range != "15m" || len(snap15m.Points) != 600 {
		t.Fatalf("expected cluster 15m range with 600 points, got range=%s len=%d", snap15m.Range, len(snap15m.Points))
	}

	snap24h, _ := reg.Snapshot("n1", "24h")
	if snap24h.Range != "24h" || len(snap24h.Points) < 10 {
		t.Fatalf("expected 24h low-freq range >= 10 minute buckets, got range=%s len=%d", snap24h.Range, len(snap24h.Points))
	}
}
