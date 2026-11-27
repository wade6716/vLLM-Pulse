package version

import (
	"strings"
	"testing"
)

func TestDisplayAndString(t *testing.T) {
	origV, origC, origB := Version, Commit, BuildDate
	t.Cleanup(func() {
		Version, Commit, BuildDate = origV, origC, origB
	})

	Version = "dev"
	if got := Display(); got != "dev" {
		t.Fatalf("expected dev, got %q", got)
	}

	Version = "0.1.0"
	Commit = "abc1234"
	BuildDate = "2026-11-27T10:00:00Z"
	if got := Display(); got != "v0.1.0" {
		t.Fatalf("expected v0.1.0, got %q", got)
	}
	if s := String(); !strings.Contains(s, "v0.1.0") || !strings.Contains(s, "abc1234") {
		t.Fatalf("unexpected String() output: %q", s)
	}
}
