package collector

import (
	"testing"
	"time"

	"github.com/wade6716/vllm-pulse/internal/metrics"
)

func TestMockRunnerWarmupAndMetrics(t *testing.T) {
	nodes := MockNodes()
	reg := metrics.NewRegistry(nodes, 6)
	_ = NewMockRunner(reg, time.Second, nil)

	summaries := reg.ListSummaries()
	if len(summaries) != 3 {
		t.Fatalf("expected 3 mock nodes, got %d", len(summaries))
	}
	for _, s := range summaries {
		if s.Status != "ONLINE" || s.Latest == nil {
			t.Fatalf("expected mock node %s ONLINE with Latest point, got %+v", s.ID, s)
		}
	}
	if !summaries[0].HasSpecDecode || summaries[0].Latest.SpecDecode == nil {
		t.Fatalf("expected mock node 0 to have spec decode enabled")
	}
	if summaries[1].HasSpecDecode {
		t.Fatalf("expected mock node 1 to have spec decode disabled")
	}

	snap, ok := reg.Snapshot("all", "15m")
	if !ok || len(snap.Points) < 100 {
		t.Fatalf("expected warmed-up cluster snapshot >= 100 points, got ok=%v len=%d", ok, len(snap.Points))
	}
}
