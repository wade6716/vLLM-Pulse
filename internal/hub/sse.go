package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/wade6716/vllm-pulse/internal/metrics"
)

// SSEHub fans out 1 Hz StreamFrame payloads to connected SSE clients without blocking
// on slow subscribers.
type SSEHub struct {
	registry *metrics.Registry
	interval time.Duration

	mu           sync.Mutex
	clients      map[chan []byte]struct{}
	pendingPre   []metrics.PreemptionEvent
}

// NewSSEHub creates a new SSE broadcaster.
func NewSSEHub(registry *metrics.Registry, interval time.Duration) *SSEHub {
	if interval <= 0 {
		interval = time.Second
	}
	return &SSEHub{
		registry: registry,
		interval: interval,
		clients:  make(map[chan []byte]struct{}),
	}
}

// RecordPreemption queues a preemption event to be emitted in the next 1 Hz frame.
func (h *SSEHub) RecordPreemption(ev metrics.PreemptionEvent) {
	h.mu.Lock()
	h.pendingPre = append(h.pendingPre, ev)
	h.mu.Unlock()
}

// Start runs the 1 Hz broadcast loop until ctx is cancelled.
func (h *SSEHub) Start(ctx context.Context) {
	ticker := time.NewTicker(h.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			h.broadcastFrame(now.UnixMilli())
		}
	}
}

func (h *SSEHub) broadcastFrame(tsMs int64) {
	h.mu.Lock()
	if len(h.clients) == 0 {
		h.pendingPre = h.pendingPre[:0]
		h.mu.Unlock()
		return
	}
	preemptions := h.pendingPre
	h.pendingPre = nil
	h.mu.Unlock()

	frame := metrics.StreamFrame{
		TimestampMs:    tsMs,
		Nodes:          h.registry.ListSummaries(),
		Cluster:        h.registry.ClusterSummary(),
		NewPreemptions: preemptions,
	}
	payload, err := json.Marshal(frame)
	if err != nil {
		return
	}

	h.mu.Lock()
	for ch := range h.clients {
		select {
		case ch <- payload:
		default:
			// Slow client: drop frame to protect broadcaster & other clients.
		}
	}
	h.mu.Unlock()
}

// ServeHTTP handles GET /api/stream SSE connections.
func (h *SSEHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	ch := make(chan []byte, 16)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()

	defer func() {
		h.mu.Lock()
		delete(h.clients, ch)
		h.mu.Unlock()
	}()

	// Emit an initial frame immediately upon connect.
	initFrame := metrics.StreamFrame{
		TimestampMs: time.Now().UnixMilli(),
		Nodes:       h.registry.ListSummaries(),
		Cluster:     h.registry.ClusterSummary(),
	}
	if initBytes, err := json.Marshal(initFrame); err == nil {
		fmt.Fprintf(w, "event: tick\ndata: %s\n\n", initBytes)
		flusher.Flush()
	}

	keepalive := time.NewTicker(15 * time.Second)
	defer keepalive.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case data := <-ch:
			fmt.Fprintf(w, "event: tick\ndata: %s\n\n", data)
			flusher.Flush()
		case <-keepalive.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}
