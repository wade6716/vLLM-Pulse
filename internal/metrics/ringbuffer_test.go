package metrics

import (
	"math"
	"testing"
)

func TestHistogramQuantileMs(t *testing.T) {
	// Empty / zero count returns nil.
	if got := HistogramQuantileMs(0.50, map[float64]float64{0.1: 0, math.Inf(1): 0}); got != nil {
		t.Fatalf("expected nil for zero-count histogram, got %v", *got)
	}

	// Cumulative buckets:
	// le=0.05 -> 20
	// le=0.10 -> 60
	// le=0.20 -> 90
	// le=+Inf -> 100
	buckets := map[float64]float64{
		0.05:        20,
		0.10:        60,
		0.20:        90,
		math.Inf(1): 100,
	}

	// P50: rank = 50 -> between 0.05 (20) and 0.10 (60): 0.05 + 0.05 * (30/40) = 0.0875s = 87.5ms
	p50 := HistogramQuantileMs(0.50, buckets)
	if p50 == nil || math.Abs(*p50-87.5) > 0.01 {
		t.Fatalf("expected P50=87.5ms, got %v", p50)
	}

	// P95: rank = 95 -> falls in +Inf bucket (>90), returns highest finite bound 0.20s = 200ms
	p95 := HistogramQuantileMs(0.95, buckets)
	if p95 == nil || math.Abs(*p95-200.0) > 0.01 {
		t.Fatalf("expected P95=200ms, got %v", p95)
	}

	// P85: rank = 85 -> between 0.10 (60) and 0.20 (90): 0.10 + 0.10 * (25/30) = 0.183333s = 183.33ms
	p85 := HistogramQuantileMs(0.85, buckets)
	if p85 == nil || math.Abs(*p85-183.33) > 0.05 {
		t.Fatalf("expected P85=183.33ms, got %v", p85)
	}
}

func TestDualRingBufferWrapAndDownsample(t *testing.T) {
	rb := NewDualRingBuffer(6) // 360 minute points, 900 second points
	baseTs := int64(1700000040000)

	// Push 1000 1s ticks (~16.6 minutes) so high ring wraps at 900 and low ring rolls multiple minutes.
	for i := 0; i < 1000; i++ {
		ts := baseTs + int64(i)*1000
		tick := rawTick{
			Point: MetricPoint{
				TimestampMs:     ts,
				GenTokPerSec:    100,
				PromptTokPerSec: 50,
				KvCachePct:      25,
				MaxKvCachePct:   25,
			},
			DurationSec:        1,
			DeltaGenTokens:     100,
			DeltaPromptTokens:  50,
			DeltaPrefixHits:    8,
			DeltaPrefixQueries: 10,
		}
		var ev *PreemptionEvent
		if i == 50 || i == 950 {
			tick.Point.DeltaPreemptions = 2
			ev = &PreemptionEvent{TimestampMs: ts, NodeID: "n1", Delta: 2, Total: float64(i)}
		}
		rb.AppendTick(tick, ev)
	}

	hi := rb.HighFreqPoints()
	if len(hi) != HighFreqCapacity {
		t.Fatalf("expected %d high-freq points after wrap, got %d", HighFreqCapacity, len(hi))
	}
	if hi[0].TimestampMs != baseTs+100*1000 {
		t.Fatalf("expected oldest high-freq ts %d, got %d", baseTs+100*1000, hi[0].TimestampMs)
	}

	lo := rb.LowFreqPoints()
	if len(lo) < 16 {
		t.Fatalf("expected >= 16 downsampled 1m points, got %d", len(lo))
	}
	if lo[0].PrefixCacheHitRate == nil || math.Abs(*lo[0].PrefixCacheHitRate-80.0) > 0.01 {
		t.Fatalf("expected 80%% prefix cache hit rate in 1m aggregate, got %+v", lo[0].PrefixCacheHitRate)
	}

	evs := rb.PreemptionsSince(baseTs)
	if len(evs) != 2 {
		t.Fatalf("expected 2 preemption events, got %d", len(evs))
	}
}
