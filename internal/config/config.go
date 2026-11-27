package config

import (
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// ServerConfig configures the HTTP server listen address.
type ServerConfig struct {
	Host string `yaml:"host"`
	Port int    `yaml:"port"`
}

// ScrapeConfig configures polling interval and per-request HTTP timeout.
type ScrapeConfig struct {
	Interval time.Duration `yaml:"interval"`
	Timeout  time.Duration `yaml:"timeout"`
}

// NodeConfig represents a single remote vLLM /metrics target.
type NodeConfig struct {
	ID      string            `yaml:"id"`
	Name    string            `yaml:"name"`
	URL     string            `yaml:"url"`
	Headers map[string]string `yaml:"headers"`
}

// Config is the top-level runtime configuration for vLLM-Pulse.
type Config struct {
	Server         ServerConfig `yaml:"server"`
	Scrape         ScrapeConfig `yaml:"scrape"`
	RetentionHours int          `yaml:"retention_hours"`
	Mock           bool         `yaml:"mock"`
	Nodes          []NodeConfig `yaml:"nodes"`
}

// DefaultConfig returns a Config initialized with sensible defaults.
func DefaultConfig() Config {
	return Config{
		Server: ServerConfig{
			Host: "0.0.0.0",
			Port: 8080,
		},
		Scrape: ScrapeConfig{
			Interval: time.Second,
			Timeout:  2 * time.Second,
		},
		RetentionHours: 6,
		Mock:           false,
	}
}

// LoadFile reads a YAML configuration file and expands environment variables inside headers.
func LoadFile(path string) (Config, error) {
	cfg := DefaultConfig()
	data, err := os.ReadFile(path)
	if err != nil {
		return cfg, fmt.Errorf("read config file %q: %w", path, err)
	}
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return cfg, fmt.Errorf("parse config yaml %q: %w", path, err)
	}
	if cfg.Server.Host == "" {
		cfg.Server.Host = "0.0.0.0"
	}
	if cfg.Server.Port == 0 {
		cfg.Server.Port = 8080
	}
	if cfg.Scrape.Interval <= 0 {
		cfg.Scrape.Interval = time.Second
	}
	if cfg.Scrape.Timeout <= 0 {
		cfg.Scrape.Timeout = 2 * time.Second
	}
	if cfg.RetentionHours == 0 {
		cfg.RetentionHours = 6
	}
	return cfg, nil
}

// NormalizeAndValidate expands header env vars, generates missing node IDs/names,
// clamps retention hours to [6, 24], and validates URLs and unique IDs.
func (c *Config) NormalizeAndValidate() error {
	if c.Server.Port < 1 || c.Server.Port > 65535 {
		return fmt.Errorf("invalid server port %d: must be in 1..65535", c.Server.Port)
	}
	if c.Scrape.Interval < 200*time.Millisecond {
		return fmt.Errorf("invalid scrape interval %s: must be >= 200ms", c.Scrape.Interval)
	}
	if c.Scrape.Timeout < 100*time.Millisecond {
		return fmt.Errorf("invalid scrape timeout %s: must be >= 100ms", c.Scrape.Timeout)
	}
	if c.RetentionHours < 6 {
		c.RetentionHours = 6
	} else if c.RetentionHours > 24 {
		c.RetentionHours = 24
	}

	seenIDs := make(map[string]struct{}, len(c.Nodes))
	for i := range c.Nodes {
		node := &c.Nodes[i]
		normalizedURL, parsed, err := ValidateNodeURL(node.URL)
		if err != nil {
			return fmt.Errorf("node[%d]: %w", i, err)
		}
		node.URL = normalizedURL

		if strings.TrimSpace(node.Name) == "" {
			node.Name = DefaultNodeName(parsed)
		}
		if strings.TrimSpace(node.ID) == "" {
			node.ID = SlugifyID(node.Name, parsed.Host)
		} else {
			node.ID = SlugifyID(node.ID, parsed.Host)
		}

		baseID := node.ID
		suffix := 2
		for {
			if _, exists := seenIDs[node.ID]; !exists {
				break
			}
			node.ID = fmt.Sprintf("%s-%d", baseID, suffix)
			suffix++
		}
		seenIDs[node.ID] = struct{}{}

		if len(node.Headers) > 0 {
			expanded := make(map[string]string, len(node.Headers))
			for k, v := range node.Headers {
				expanded[k] = os.ExpandEnv(v)
			}
			node.Headers = expanded
		}
	}

	if !c.Mock && len(c.Nodes) == 0 {
		return fmt.Errorf("no target nodes configured: pass --target, --config, or --mock")
	}
	return nil
}

// AddTarget appends a CLI --target URL to the node list.
func (c *Config) AddTarget(rawURL string) {
	c.Nodes = append(c.Nodes, NodeConfig{URL: strings.TrimSpace(rawURL)})
}

// ValidateNodeURL checks that rawURL is a valid http or https URL and normalizes missing path to /metrics if empty.
func ValidateNodeURL(rawURL string) (string, *url.URL, error) {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return "", nil, fmt.Errorf("node url is empty")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", nil, fmt.Errorf("invalid url %q: %w", trimmed, err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", nil, fmt.Errorf("unsupported url scheme %q in %q: must be http or https", parsed.Scheme, trimmed)
	}
	if parsed.Host == "" {
		return "", nil, fmt.Errorf("missing host in url %q", trimmed)
	}
	if parsed.Path == "" {
		parsed.Path = "/metrics"
	}
	return parsed.String(), parsed, nil
}

// DefaultNodeName derives a readable default node name from URL host:port.
func DefaultNodeName(u *url.URL) string {
	if u == nil {
		return "vllm-node"
	}
	return u.Host
}

var nonSlugRe = regexp.MustCompile(`[^a-z0-9-]+`)

// SlugifyID produces a lowercase URL-safe identifier.
func SlugifyID(preferred, fallback string) string {
	src := strings.TrimSpace(preferred)
	if src == "" {
		src = strings.TrimSpace(fallback)
	}
	s := strings.ToLower(src)
	s = strings.ReplaceAll(s, ":", "-")
	s = strings.ReplaceAll(s, ".", "-")
	s = strings.ReplaceAll(s, "_", "-")
	s = nonSlugRe.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" || s == "all" {
		return "node"
	}
	return s
}
