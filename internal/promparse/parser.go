package promparse

import (
	"bufio"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
)

// Sample represents a single parsed Prometheus exposition sample line.
type Sample struct {
	Name         string
	Labels       map[string]string
	Value        float64
	HasTimestamp bool
	TimestampMs  int64
}

// Parse reads Prometheus text exposition lines from r and returns valid numeric samples.
// Comment lines (# HELP, # TYPE) and empty lines are skipped. Malformed lines are skipped
// cleanly so a single unexpected line does not discard an entire scrape.
func Parse(r io.Reader) ([]Sample, error) {
	scanner := bufio.NewScanner(r)
	// Allow long lines with many labels (up to 1 MiB).
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)

	samples := make([]Sample, 0, 128)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || line[0] == '#' {
			continue
		}
		sample, ok := parseLine(line)
		if !ok {
			continue
		}
		samples = append(samples, sample)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scan metrics stream: %w", err)
	}
	return samples, nil
}

func parseLine(line string) (Sample, bool) {
	var sample Sample

	// Find metric name end: '{' or whitespace.
	idx := 0
	n := len(line)
	for idx < n && line[idx] != '{' && line[idx] != ' ' && line[idx] != '\t' {
		idx++
	}
	if idx == 0 {
		return sample, false
	}
	sample.Name = line[:idx]

	rest := strings.TrimSpace(line[idx:])
	if rest == "" {
		return sample, false
	}

	if rest[0] == '{' {
		labels, afterBrace, ok := parseLabels(rest)
		if !ok {
			return sample, false
		}
		sample.Labels = labels
		rest = strings.TrimSpace(afterBrace)
	}

	if rest == "" {
		return sample, false
	}

	// Remaining tokens: <value> [timestamp]
	fields := strings.Fields(rest)
	if len(fields) == 0 {
		return sample, false
	}

	val, err := parsePromFloat(fields[0])
	if err != nil {
		return sample, false
	}
	sample.Value = val

	if len(fields) >= 2 {
		if ts, err := strconv.ParseInt(fields[1], 10, 64); err == nil {
			sample.HasTimestamp = true
			sample.TimestampMs = ts
		}
	}
	return sample, true
}

func parseLabels(s string) (map[string]string, string, bool) {
	// s starts with '{'.
	i := 1
	n := len(s)
	labels := make(map[string]string, 4)

	for i < n {
		// Skip whitespace and commas between labels.
		for i < n && (s[i] == ' ' || s[i] == '\t' || s[i] == ',') {
			i++
		}
		if i >= n {
			return nil, "", false
		}
		if s[i] == '}' {
			return labels, s[i+1:], true
		}

		// Read label key up to '='.
		keyStart := i
		for i < n && s[i] != '=' && s[i] != '}' {
			i++
		}
		if i >= n || s[i] != '=' {
			return nil, "", false
		}
		key := strings.TrimSpace(s[keyStart:i])
		i++ // skip '='

		// Skip whitespace before opening quote.
		for i < n && (s[i] == ' ' || s[i] == '\t') {
			i++
		}
		if i >= n || s[i] != '"' {
			return nil, "", false
		}
		i++ // skip opening '"'

		var valBuf strings.Builder
		closed := false
		for i < n {
			ch := s[i]
			if ch == '\\' && i+1 < n {
				next := s[i+1]
				switch next {
				case 'n':
					valBuf.WriteByte('\n')
				case '\\':
					valBuf.WriteByte('\\')
				case '"':
					valBuf.WriteByte('"')
				default:
					valBuf.WriteByte(next)
				}
				i += 2
				continue
			}
			if ch == '"' {
				i++
				closed = true
				break
			}
			valBuf.WriteByte(ch)
			i++
		}
		if !closed {
			return nil, "", false
		}
		if key != "" {
			labels[key] = valBuf.String()
		}
	}

	return nil, "", false
}

func parsePromFloat(tok string) (float64, error) {
	switch strings.ToLower(tok) {
	case "+inf", "inf":
		return math.Inf(1), nil
	case "-inf":
		return math.Inf(-1), nil
	case "nan":
		return math.NaN(), nil
	default:
		return strconv.ParseFloat(tok, 64)
	}
}
