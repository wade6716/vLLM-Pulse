package server

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/wade6716/vllm-pulse/internal/collector"
	"github.com/wade6716/vllm-pulse/internal/config"
	"github.com/wade6716/vllm-pulse/internal/hub"
	"github.com/wade6716/vllm-pulse/internal/metrics"
	"github.com/wade6716/vllm-pulse/internal/version"
)

// Server exposes the REST API, SSE stream, and embedded frontend SPA.
type Server struct {
	registry  *metrics.Registry
	collector *collector.Collector
	sseHub    *hub.SSEHub
	mockMode  bool
	mux       *http.ServeMux
}

// New constructs an HTTP handler mux for vLLM-Pulse.
func New(registry *metrics.Registry, col *collector.Collector, sseHub *hub.SSEHub, mockMode bool) *Server {
	s := &Server{
		registry:  registry,
		collector: col,
		sseHub:    sseHub,
		mockMode:  mockMode,
		mux:       http.NewServeMux(),
	}
	s.routes()
	return s
}

// Handler returns the root http.Handler.
func (s *Server) Handler() http.Handler {
	return s.mux
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	s.mux.HandleFunc("GET /api/nodes", s.handleListNodes)
	s.mux.HandleFunc("POST /api/nodes", s.handleAddNode)
	s.mux.HandleFunc("DELETE /api/nodes/{id}", s.handleDeleteNode)
	s.mux.HandleFunc("GET /api/snapshot", s.handleSnapshot)
	s.mux.Handle("GET /api/stream", s.sseHub)
	s.mux.Handle("/", s.handleSPA())
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "ok",
		"mock":      s.mockMode,
		"version":   version.Display(),
		"commit":    version.Commit,
		"buildDate": version.BuildDate,
	})
}

func (s *Server) handleListNodes(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"nodes":   s.registry.ListSummaries(),
		"cluster": s.registry.ClusterSummary(),
		"mock":    s.mockMode,
		"version": version.Display(),
		"commit":  version.Commit,
	})
}

type addNodeRequest struct {
	Name    string            `json:"name"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
}

func (s *Server) handleAddNode(w http.ResponseWriter, r *http.Request) {
	if s.collector == nil {
		writeError(w, http.StatusBadRequest, "dynamic nodes are disabled in --mock mode")
		return
	}

	var req addNodeRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON payload")
		return
	}

	normalizedURL, parsed, err := config.ValidateNodeURL(req.URL)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = config.DefaultNodeName(parsed)
	}
	id := config.SlugifyID(name, parsed.Host)
	if _, exists := s.registry.Get(id); exists {
		for suffix := 2; ; suffix++ {
			candidate := id + "-" + string(rune('0'+suffix))
			if suffix >= 10 {
				candidate = id + "-" + parsed.Port()
			}
			if _, taken := s.registry.Get(candidate); !taken {
				id = candidate
				break
			}
		}
	}

	nodeCfg := config.NodeConfig{
		ID:      id,
		Name:    name,
		URL:     normalizedURL,
		Headers: req.Headers,
	}

	summary, err := s.collector.AddAndStart(nodeCfg, true)
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, summary)
}

func (s *Server) handleDeleteNode(w http.ResponseWriter, r *http.Request) {
	if s.collector == nil {
		writeError(w, http.StatusBadRequest, "dynamic nodes are disabled in --mock mode")
		return
	}
	id := r.PathValue("id")
	if id == "" || id == "all" {
		writeError(w, http.StatusBadRequest, "invalid node id")
		return
	}
	if !s.collector.StopAndRemove(id) {
		writeError(w, http.StatusNotFound, "node not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"deleted": id})
}

func (s *Server) handleSnapshot(w http.ResponseWriter, r *http.Request) {
	nodeID := r.URL.Query().Get("node")
	if nodeID == "" {
		nodeID = "all"
	}
	rangeStr := r.URL.Query().Get("range")
	if rangeStr == "" {
		rangeStr = "15m"
	}

	snap, ok := s.registry.Snapshot(nodeID, rangeStr)
	if !ok {
		writeError(w, http.StatusNotFound, "node not found")
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

func (s *Server) handleSPA() http.Handler {
	sub, err := fs.Sub(DistFS, "dist")
	if err != nil {
		return http.NotFoundHandler()
	}
	fileServer := http.FileServer(http.FS(sub))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			writeError(w, http.StatusNotFound, "endpoint not found")
			return
		}

		cleanPath := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if cleanPath == "" || cleanPath == "." {
			cleanPath = "index.html"
		}

		if info, statErr := fs.Stat(sub, cleanPath); statErr == nil && !info.IsDir() {
			if strings.HasPrefix(cleanPath, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			fileServer.ServeHTTP(w, r)
			return
		}

		// Fallback to index.html for SPA routes.
		indexBytes, err := fs.ReadFile(sub, "index.html")
		if err != nil {
			http.Error(w, "frontend assets not built", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(indexBytes)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
