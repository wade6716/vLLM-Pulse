package collector

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/wade6716/vllm-pulse/internal/config"
	"github.com/wade6716/vllm-pulse/internal/metrics"
	"github.com/wade6716/vllm-pulse/internal/promparse"
)

// PreemptionSink receives preemption events as soon as a scrape detects deltaPreemptions > 0.
type PreemptionSink func(ev metrics.PreemptionEvent)

// Collector manages independent polling goroutines for every configured vLLM target.
type Collector struct {
	mu       sync.Mutex
	registry *metrics.Registry
	interval time.Duration
	timeout  time.Duration
	onPreempt PreemptionSink

	parentCtx context.Context
	cancels   map[string]context.CancelFunc
}

// New creates a Collector for the given registry, scrape interval, and per-request HTTP timeout.
func New(registry *metrics.Registry, interval, timeout time.Duration, onPreempt PreemptionSink) *Collector {
	return &Collector{
		registry:  registry,
		interval:  interval,
		timeout:   timeout,
		onPreempt: onPreempt,
		cancels:   make(map[string]context.CancelFunc),
	}
}

// Start launches independent polling goroutines for all initial nodes.
func (c *Collector) Start(ctx context.Context, nodes []config.NodeConfig) {
	c.mu.Lock()
	c.parentCtx = ctx
	c.mu.Unlock()

	for _, n := range nodes {
		c.startWorker(n)
	}
}

// AddAndStart dynamically registers a new target node and begins polling it immediately.
func (c *Collector) AddAndStart(cfg config.NodeConfig, dynamic bool) (metrics.NodeSummary, error) {
	if _, err := c.registry.AddNode(cfg, dynamic); err != nil {
		return metrics.NodeSummary{}, err
	}
	c.startWorker(cfg)
	eng, _ := c.registry.Get(cfg.ID)
	return eng.Summary(), nil
}

// StopAndRemove stops the polling goroutine for id and removes it from the registry.
func (c *Collector) StopAndRemove(id string) bool {
	c.mu.Lock()
	cancel, ok := c.cancels[id]
	if ok {
		delete(c.cancels, id)
	}
	c.mu.Unlock()

	if ok && cancel != nil {
		cancel()
	}
	return c.registry.RemoveNode(id)
}

func (c *Collector) startWorker(cfg config.NodeConfig) {
	c.mu.Lock()
	parent := c.parentCtx
	if parent == nil {
		parent = context.Background()
	}
	if oldCancel, exists := c.cancels[cfg.ID]; exists && oldCancel != nil {
		oldCancel()
	}
	workerCtx, cancel := context.WithCancel(parent)
	c.cancels[cfg.ID] = cancel
	c.mu.Unlock()

	client := &http.Client{
		Timeout: c.timeout,
	}

	go func() {
		// Immediate initial scrape so UI gets baseline quickly.
		c.scrapeOnce(workerCtx, client, cfg)

		ticker := time.NewTicker(c.interval)
		defer ticker.Stop()

		for {
			select {
			case <-workerCtx.Done():
				return
			case <-ticker.C:
				c.scrapeOnce(workerCtx, client, cfg)
			}
		}
	}()
}

func (c *Collector) scrapeOnce(ctx context.Context, client *http.Client, cfg config.NodeConfig) {
	eng, ok := c.registry.Get(cfg.ID)
	if !ok {
		return
	}

	start := time.Now()
	reqCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, cfg.URL, nil)
	if err != nil {
		eng.MarkOffline(time.Now().UnixMilli(), time.Since(start).Milliseconds(), err.Error())
		return
	}
	req.Header.Set("Accept", "text/plain; version=0.0.4, */*;q=0.8")
	for k, v := range cfg.Headers {
		req.Header.Set(k, v)
	}

	resp, err := client.Do(req)
	if err != nil {
		eng.MarkOffline(time.Now().UnixMilli(), time.Since(start).Milliseconds(), err.Error())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Drain short body for diagnostics.
		_, _ = io.CopyN(io.Discard, resp.Body, 4096)
		eng.MarkOffline(time.Now().UnixMilli(), time.Since(start).Milliseconds(), fmt.Sprintf("HTTP %d", resp.StatusCode))
		return
	}

	samples, err := promparse.Parse(resp.Body)
	durationMs := time.Since(start).Milliseconds()
	if err != nil {
		eng.MarkOffline(time.Now().UnixMilli(), durationMs, err.Error())
		return
	}

	_, preemptEv := eng.Ingest(time.Now().UnixMilli(), samples, durationMs)
	if preemptEv != nil && c.onPreempt != nil {
		c.onPreempt(*preemptEv)
	}
}
