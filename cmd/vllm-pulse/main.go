package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/wade6716/vllm-pulse/internal/collector"
	"github.com/wade6716/vllm-pulse/internal/config"
	"github.com/wade6716/vllm-pulse/internal/hub"
	"github.com/wade6716/vllm-pulse/internal/metrics"
	"github.com/wade6716/vllm-pulse/internal/server"
)

type stringSliceFlag []string

func (s *stringSliceFlag) String() string {
	return strings.Join(*s, ",")
}

func (s *stringSliceFlag) Set(val string) error {
	*s = append(*s, val)
	return nil
}

func main() {
	var (
		configPath     string
		targets        stringSliceFlag
		host           string
		port           int
		interval       time.Duration
		timeout        time.Duration
		retentionHours int
		mockMode       bool
	)

	flag.StringVar(&configPath, "config", "", "Path to YAML config file")
	flag.Var(&targets, "target", "Remote vLLM /metrics URL (repeatable)")
	flag.StringVar(&host, "host", "", "HTTP listen host (default 0.0.0.0)")
	flag.IntVar(&port, "port", 0, "HTTP listen port (default 8080)")
	flag.DurationVar(&interval, "interval", 0, "Scrape interval (default 1s)")
	flag.DurationVar(&timeout, "timeout", 0, "Per-target scrape timeout (default 2s)")
	flag.IntVar(&retentionHours, "retention-hours", 0, "1-minute ring buffer retention hours (6..24, default 24)")
	flag.BoolVar(&mockMode, "mock", false, "Run with built-in 3-node mock vLLM metrics generator")
	flag.Parse()

	cfg := config.DefaultConfig()
	if configPath != "" {
		loaded, err := config.LoadFile(configPath)
		if err != nil {
			log.Fatalf("config error: %v", err)
		}
		cfg = loaded
	}

	for _, t := range targets {
		cfg.AddTarget(t)
	}
	if host != "" {
		cfg.Server.Host = host
	}
	if port != 0 {
		cfg.Server.Port = port
	}
	if interval > 0 {
		cfg.Scrape.Interval = interval
	}
	if timeout > 0 {
		cfg.Scrape.Timeout = timeout
	}
	if retentionHours > 0 {
		cfg.RetentionHours = retentionHours
	}
	if mockMode {
		cfg.Mock = true
	}

	if err := cfg.NormalizeAndValidate(); err != nil {
		log.Fatalf("invalid configuration: %v", err)
	}

	nodes := cfg.Nodes
	if cfg.Mock {
		nodes = collector.MockNodes()
	}

	registry := metrics.NewRegistry(nodes, cfg.RetentionHours)
	sseHub := hub.NewSSEHub(registry, cfg.Scrape.Interval)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go sseHub.Start(ctx)

	var col *collector.Collector
	if cfg.Mock {
		mockRunner := collector.NewMockRunner(registry, cfg.Scrape.Interval, sseHub.RecordPreemption)
		go mockRunner.Start(ctx)
		log.Printf("vLLM-Pulse running in MOCK mode (%d simulated nodes)", len(nodes))
	} else {
		col = collector.New(registry, cfg.Scrape.Interval, cfg.Scrape.Timeout, sseHub.RecordPreemption)
		col.Start(ctx, nodes)
		log.Printf("vLLM-Pulse polling %d vLLM target(s) every %s (timeout %s)", len(nodes), cfg.Scrape.Interval, cfg.Scrape.Timeout)
	}

	srv := server.New(registry, col, sseHub, cfg.Mock)
	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	httpServer := &http.Server{
		Addr:              addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("vLLM-Pulse NOC dashboard listening on http://%s", addr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("http server error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down vLLM-Pulse...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(shutdownCtx)
}
