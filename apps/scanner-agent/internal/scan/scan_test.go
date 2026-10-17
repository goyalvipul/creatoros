package scan

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/creatoros/scanner-agent/internal/protocol"
)

func TestGlob(t *testing.T) {
	cases := []struct {
		glob, path string
		want       bool
	}{
		{"*.tmp", "a/b/c.tmp", true},
		{"*.tmp", "a/b/c.mp4", false},
		{"cache", "x/cache/file.mp4", true},
		{"cache/", "cache/file.mp4", true},
		{"**/proxy/**", "a/b/proxy/clip.mov", true},
		{"**/proxy/**", "a/b/clip.mov", false},
		{"Raw/*.mp4", "raw/a.mp4", true},
		{"Raw/*.mp4", "raw/sub/a.mp4", false},
		{"clip?.mp4", "clip1.mp4", true},
	}
	for _, c := range cases {
		if got := MatchAny([]string{c.glob}, c.path); got != c.want {
			t.Errorf("glob %q vs %q = %v, want %v", c.glob, c.path, got, c.want)
		}
	}
}

func write(t *testing.T, p string, content string, age time.Duration) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	old := simNow().Add(-age)
	if err := os.Chtimes(p, old, old); err != nil {
		t.Fatal(err)
	}
}

// simNow runs the scanner one hour in the future so files created by the test (whose creation time is real "now")
// look settled, while files written with age 0 still look brand new.
func simNow() time.Time { return time.Now().Add(time.Hour) }

type collector struct{ batches []protocol.IngestBatch }

func (c *collector) emit(b protocol.IngestBatch) error { c.batches = append(c.batches, b); return nil }
func (c *collector) files() map[string]protocol.Observation {
	m := map[string]protocol.Observation{}
	for _, b := range c.batches {
		for _, o := range b.Observations {
			if o.Kind == protocol.KindFile {
				m[filepath.Base(o.Path)] = o
			}
		}
	}
	return m
}

func rootCfg(dir string) protocol.RootConfig {
	return protocol.RootConfig{RootID: "11111111-1111-4111-8111-111111111111", DisplayPath: dir, Recursive: true, SettleSeconds: 30, HashMode: "all", State: "ACTIVE", Extensions: []string{"mp4", "mov", "jpg"}}
}

func run(t *testing.T, rc protocol.RootConfig, st *State, jobType string) (*collector, Result, error) {
	t.Helper()
	c := &collector{}
	res, err := Run(context.Background(), Options{Root: rc, State: st, JobType: jobType, Emit: c.emit, BatchSize: 2, Now: simNow})
	return c, res, err
}

func TestScanBasics(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "a.mp4"), "aaaa", time.Hour)
	write(t, filepath.Join(dir, "sub", "b.mov"), "bbbbbb", time.Hour)
	write(t, filepath.Join(dir, "sub", "notes.txt"), "ignored by extension", time.Hour)
	write(t, filepath.Join(dir, "sub", "c.tmp"), "partial", time.Hour)
	write(t, filepath.Join(dir, "cache", "d.mp4"), "excluded", time.Hour)
	write(t, filepath.Join(dir, "fresh.mp4"), "just written", 0)
	write(t, filepath.Join(dir, "$RECYCLE.BIN", "x.mp4"), "trash", time.Hour)
	rc := rootCfg(dir)
	rc.ExcludeGlobs = []string{"cache"}
	st, _ := LoadState(t.TempDir(), rc.RootID)

	c, res, err := run(t, rc, st, "SCAN")
	if err != nil {
		t.Fatal(err)
	}
	if !res.Complete {
		t.Fatalf("scan should be complete: %+v", res)
	}
	files := c.files()
	if len(files) != 3 {
		t.Fatalf("expected a.mp4, b.mov, fresh.mp4; got %v", keys(files))
	}
	if files["a.mp4"].State != protocol.StateStable || files["a.mp4"].QuickSignature == "" || files["a.mp4"].StableObservations != 1 {
		t.Errorf("a.mp4 should be stable with a signature: %+v", files["a.mp4"])
	}
	if files["fresh.mp4"].State != protocol.StateStillWriting || files["fresh.mp4"].QuickSignature != "" {
		t.Errorf("fresh.mp4 must be STILL_WRITING without hashing: %+v", files["fresh.mp4"])
	}
	first, last := c.batches[0], c.batches[len(c.batches)-1]
	if first.Phase != "START" || last.Phase != "END" || last.Complete == nil || !*last.Complete {
		t.Errorf("phases wrong: first=%s last=%s complete=%v", first.Phase, last.Phase, last.Complete)
	}
	seen := map[string]bool{}
	for _, b := range c.batches {
		if b.RunID != first.RunID {
			t.Error("run id must be constant within a run")
		}
		for _, o := range b.Observations {
			if seen[o.EventID] || !strings.HasPrefix(o.EventID, first.RunID+":") {
				t.Errorf("bad/duplicate event id %q", o.EventID)
			}
			seen[o.EventID] = true
		}
	}

	// second scan: stable count grows, signature reused, deleted file vanishes from the report
	_ = os.Remove(filepath.Join(dir, "sub", "b.mov"))
	c2, res2, err := run(t, rc, st, "SCAN")
	if err != nil || !res2.Complete {
		t.Fatalf("second scan: %v %+v", err, res2)
	}
	f2 := c2.files()
	if _, ok := f2["b.mov"]; ok {
		t.Error("deleted file must not be reported")
	}
	if f2["a.mp4"].StableObservations != 2 {
		t.Errorf("stable observations should grow: %d", f2["a.mp4"].StableObservations)
	}
	if f2["a.mp4"].QuickSignature != files["a.mp4"].QuickSignature {
		t.Error("signature should be stable")
	}
	if _, ok := st.Get(filepath.Join(dir, "sub", "b.mov")); ok {
		t.Error("state of a deleted file must be pruned after a complete scan")
	}
}

func keys[V any](m map[string]V) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}

func TestScanChangeResetsStability(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "a.mp4")
	write(t, p, "v1", time.Hour)
	rc := rootCfg(dir)
	st, _ := LoadState(t.TempDir(), rc.RootID)
	c1, _, _ := run(t, rc, st, "SCAN")
	st.Update(p, func(e *Entry) { e.Hashed, e.Probed = true, true })
	write(t, p, "version two, longer", 2*time.Hour)
	c2, _, _ := run(t, rc, st, "SCAN")
	a, b := c1.files()["a.mp4"], c2.files()["a.mp4"]
	if b.StableObservations != 1 || b.QuickSignature == a.QuickSignature {
		t.Errorf("changed file should restart stability and re-sign: %+v vs %+v", a, b)
	}
	if e, _ := st.Get(p); e.Hashed || e.Probed {
		t.Error("enrichment flags must reset when the file changes")
	}
}

func TestScanUnreachableNeverEmits(t *testing.T) {
	rc := rootCfg(filepath.Join(t.TempDir(), "does-not-exist"))
	st, _ := LoadState(t.TempDir(), rc.RootID)
	c, _, err := run(t, rc, st, "SCAN")
	if !errors.Is(err, ErrUnreachable) {
		t.Fatalf("want ErrUnreachable, got %v", err)
	}
	if len(c.batches) != 0 {
		t.Error("an unreachable root must produce no batches (so nothing can be marked missing)")
	}
}

func TestScanCancelledIsNotComplete(t *testing.T) {
	dir := t.TempDir()
	for i := 0; i < 5; i++ {
		write(t, filepath.Join(dir, string(rune('a'+i))+".mp4"), "x", time.Hour)
	}
	rc := rootCfg(dir)
	st, _ := LoadState(t.TempDir(), rc.RootID)
	ctx, cancel := context.WithCancel(context.Background())
	c := &collector{}
	n := 0
	_, err := Run(ctx, Options{Root: rc, State: st, BatchSize: 1, Now: simNow, Emit: func(b protocol.IngestBatch) error {
		n++
		if n == 2 {
			cancel()
		}
		return c.emit(b)
	}})
	if err == nil {
		t.Fatal("expected cancellation error")
	}
	for _, b := range c.batches {
		if b.Phase == "END" {
			t.Error("a cancelled scan must never send END (no false completeness)")
		}
	}
}

func TestHashes(t *testing.T) {
	dir := t.TempDir()
	big := strings.Repeat("0123456789abcdef", 100_000) // 1.6MB: exercises start/middle/end sampling
	p := filepath.Join(dir, "big.bin")
	write(t, p, big, time.Hour)
	sig1, err := QuickSignature(p, int64(len(big)))
	if err != nil {
		t.Fatal(err)
	}
	sig2, _ := QuickSignature(p, int64(len(big)))
	if sig1 != sig2 {
		t.Error("quick signature must be deterministic")
	}
	// change a byte in the middle: must change the signature
	b := []byte(big)
	b[len(b)/2] = 'X'
	if err := os.WriteFile(p, b, 0o644); err != nil {
		t.Fatal(err)
	}
	sig3, _ := QuickSignature(p, int64(len(b)))
	if sig3 == sig1 {
		t.Error("middle change should alter quick signature")
	}
	got, n, err := FullHash(context.Background(), p)
	if err != nil || n != int64(len(b)) {
		t.Fatal(err, n)
	}
	want := sha256.Sum256(b)
	if got != hex.EncodeToString(want[:]) {
		t.Error("full hash mismatch")
	}
	// tiny and empty files
	empty := filepath.Join(dir, "empty")
	write(t, empty, "", time.Hour)
	if _, err := QuickSignature(empty, 0); err != nil {
		t.Errorf("empty file: %v", err)
	}
}
