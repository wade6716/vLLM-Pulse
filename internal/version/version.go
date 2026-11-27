package version

import (
	"fmt"
	"strings"
)

// Build-time metadata populated via -ldflags.
var (
	Version   = "dev"
	Commit    = "none"
	BuildDate = "unknown"
)

// Display returns a normalized version string (prefixed with "v" for SemVer values).
func Display() string {
	v := strings.TrimSpace(Version)
	if v == "" || v == "dev" {
		return "dev"
	}
	if !strings.HasPrefix(v, "v") {
		return "v" + v
	}
	return v
}

// String formats full CLI version output.
func String() string {
	return fmt.Sprintf("vLLM-Pulse %s (commit %s, built %s)", Display(), Commit, BuildDate)
}
