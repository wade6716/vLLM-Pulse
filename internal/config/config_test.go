package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadFileAndExpandEnvHeaders(t *testing.T) {
	t.Setenv("VLLM_TEST_TOKEN", "secret-token-123")

	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")
	content := `
server:
  host: 127.0.0.1
  port: 9090
scrape:
  interval: 2s
  timeout: 3s
retention_hours: 12
nodes:
  - name: "A100-Node-1"
    url: "http://10.0.0.1:11435/metrics"
    headers:
      Authorization: "Bearer ${VLLM_TEST_TOKEN}"
  - url: "https://vllm.internal:8000"
`
	if err := os.WriteFile(cfgPath, []byte(content), 0o600); err != nil {
		t.Fatalf("write temp config: %v", err)
	}

	cfg, err := LoadFile(cfgPath)
	if err != nil {
		t.Fatalf("LoadFile failed: %v", err)
	}
	if err := cfg.NormalizeAndValidate(); err != nil {
		t.Fatalf("NormalizeAndValidate failed: %v", err)
	}

	if cfg.Server.Host != "127.0.0.1" || cfg.Server.Port != 9090 {
		t.Fatalf("unexpected server config: %+v", cfg.Server)
	}
	if cfg.Scrape.Interval != 2*time.Second || cfg.Scrape.Timeout != 3*time.Second {
		t.Fatalf("unexpected scrape config: %+v", cfg.Scrape)
	}
	if cfg.RetentionHours != 12 {
		t.Fatalf("expected retention 12, got %d", cfg.RetentionHours)
	}
	if len(cfg.Nodes) != 2 {
		t.Fatalf("expected 2 nodes, got %d", len(cfg.Nodes))
	}
	if cfg.Nodes[0].ID != "a100-node-1" {
		t.Fatalf("unexpected node 0 ID: %q", cfg.Nodes[0].ID)
	}
	if got := cfg.Nodes[0].Headers["Authorization"]; got != "Bearer secret-token-123" {
		t.Fatalf("expected expanded header, got %q", got)
	}
	if cfg.Nodes[1].URL != "https://vllm.internal:8000/metrics" {
		t.Fatalf("expected /metrics path default, got %q", cfg.Nodes[1].URL)
	}
}

func TestNormalizeDeduplicatesIDsAndRequiresTargetUnlessMock(t *testing.T) {
	emptyCfg := DefaultConfig()
	if err := emptyCfg.NormalizeAndValidate(); err == nil {
		t.Fatal("expected error when no nodes and mock=false")
	}

	mockCfg := DefaultConfig()
	mockCfg.Mock = true
	mockCfg.RetentionHours = 99
	if err := mockCfg.NormalizeAndValidate(); err != nil {
		t.Fatalf("mock config should validate: %v", err)
	}
	if mockCfg.RetentionHours != 24 {
		t.Fatalf("expected clamped retention 24, got %d", mockCfg.RetentionHours)
	}

	dupCfg := DefaultConfig()
	dupCfg.AddTarget("http://host1:8000/metrics")
	dupCfg.AddTarget("http://host1:8000/metrics")
	if err := dupCfg.NormalizeAndValidate(); err != nil {
		t.Fatalf("duplicate targets should deduplicate IDs: %v", err)
	}
	if dupCfg.Nodes[0].ID == dupCfg.Nodes[1].ID {
		t.Fatalf("expected unique IDs, got both %q", dupCfg.Nodes[0].ID)
	}
}
