package promparse

import (
	"math"
	"strings"
	"testing"
)

func TestParseRealVLLMSample(t *testing.T) {
	raw := `
# HELP vllm:num_requests_running Number of requests currently running on GPU.
# TYPE vllm:num_requests_running gauge
vllm:num_requests_running{engine="0",model_name="Qwen3___8-27B-FP8"} 1.0
vllm:num_requests_waiting{engine="0",model_name="Qwen3___8-27B-FP8"} 0.0
vllm:num_requests_waiting_by_reason{engine="0",model_name="Qwen3___8-27B-FP8",reason="capacity"} 0.0
vllm:num_requests_waiting_by_reason{engine="0",model_name="Qwen3___8-27B-FP8",reason="deferred"} 0.0
vllm:kv_cache_usage_perc{engine="0",model_name="Qwen3___8-27B-FP8"} 0.0561797752808989
vllm:num_preemptions_total{engine="0",model_name="Qwen3___8-27B-FP8"} 7231.0
vllm:num_preemptions_created{engine="0",model_name="Qwen3___8-27B-FP8"} 1.7949130470173714e+09
vllm:time_to_first_token_seconds_bucket{engine="0",le="+Inf",model_name="Qwen3___8-27B-FP8"} 42
`
	samples, err := Parse(strings.NewReader(raw))
	if err != nil {
		t.Fatalf("Parse failed: %v", err)
	}
	if len(samples) != 8 {
		t.Fatalf("expected 8 samples, got %d", len(samples))
	}

	if samples[0].Name != "vllm:num_requests_running" || samples[0].Value != 1.0 {
		t.Fatalf("unexpected sample[0]: %+v", samples[0])
	}
	if samples[0].Labels["model_name"] != "Qwen3___8-27B-FP8" || samples[0].Labels["engine"] != "0" {
		t.Fatalf("unexpected labels on sample[0]: %+v", samples[0].Labels)
	}
	if samples[2].Labels["reason"] != "capacity" {
		t.Fatalf("expected reason=capacity, got %+v", samples[2].Labels)
	}
	if math.Abs(samples[4].Value-0.0561797752808989) > 1e-12 {
		t.Fatalf("unexpected kv cache value: %v", samples[4].Value)
	}
	if samples[5].Value != 7231.0 {
		t.Fatalf("expected 7231.0, got %v", samples[5].Value)
	}
	if math.Abs(samples[6].Value-1.7949130470173714e+09) > 1.0 {
		t.Fatalf("unexpected created timestamp: %v", samples[6].Value)
	}
	if samples[7].Labels["le"] != "+Inf" || samples[7].Value != 42 {
		t.Fatalf("unexpected histogram +Inf bucket: %+v", samples[7])
	}
}

func TestParseEdgeCases(t *testing.T) {
	raw := `
metric_no_labels 123.5 1700000000123
metric_escaped{path="a\\b\"c\nd",trailing="ok",} +Inf
metric_nan NaN
broken_line_without_value
`
	samples, err := Parse(strings.NewReader(raw))
	if err != nil {
		t.Fatalf("Parse failed: %v", err)
	}
	if len(samples) != 3 {
		t.Fatalf("expected 3 valid samples, got %d", len(samples))
	}
	if !samples[0].HasTimestamp || samples[0].TimestampMs != 1700000000123 {
		t.Fatalf("expected timestamp 1700000000123, got %+v", samples[0])
	}
	if samples[1].Labels["path"] != "a\\b\"c\nd" || !math.IsInf(samples[1].Value, 1) {
		t.Fatalf("unexpected escaped/+Inf sample: %+v", samples[1])
	}
	if !math.IsNaN(samples[2].Value) {
		t.Fatalf("expected NaN, got %v", samples[2].Value)
	}
}
