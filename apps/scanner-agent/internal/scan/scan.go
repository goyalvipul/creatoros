// Package scan walks a storage root and turns what it finds into protocol observations.
//
// Safety rules baked in here:
//   - read-only: files are only stat'ed, opened for reading and sampled; nothing is ever written, moved or deleted
//   - a scan is "complete" only if every directory could be listed; otherwise the server will not infer missing files
//   - an unreachable or empty-looking root yields an error before any END is sent
package scan

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/creatoros/scanner-agent/internal/config"
	"github.com/creatoros/scanner-agent/internal/protocol"
)

var ErrUnreachable = errors.New("storage root is not reachable")

// Names that are never user content. They are skipped silently and do not make a scan incomplete.
var systemNames = map[string]bool{
	"$recycle.bin": true, "system volume information": true, ".trashes": true, ".spotlight-v100": true,
	".fseventsd": true, "lost+found": true, ".ds_store": true, "thumbs.db": true, "desktop.ini": true,
	".temporaryitems": true,
}

type Options struct {
	Root      protocol.RootConfig
	State     *State
	JobType   string // SCAN or RECONCILE
	Now       func() time.Time
	BatchSize int
	Emit      func(protocol.IngestBatch) error
	Log       *slog.Logger
}

type Result struct {
	RunID    string
	Scanned  int
	Errors   int
	Complete bool
	Files    int
	Writing  int
}

type walker struct {
	ctx      context.Context
	o        Options
	runID    string
	seq      int
	pending  []protocol.Observation
	started  bool
	res      Result
	failures []protocol.PathError
	seen     map[string]struct{}
	exts     map[string]bool
	settleMs float64
	visited  map[string]bool
	complete bool
}

func NormalizeExts(in []string) map[string]bool {
	m := map[string]bool{}
	for _, e := range in {
		e = strings.ToLower(strings.TrimPrefix(strings.TrimSpace(e), "."))
		if e != "" {
			m[e] = true
		}
	}
	return m
}

// Run performs one scan of a root.
func Run(ctx context.Context, o Options) (Result, error) {
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.BatchSize <= 0 {
		o.BatchSize = 500
	}
	if o.Log == nil {
		o.Log = slog.Default()
	}
	if o.JobType == "" {
		o.JobType = "SCAN"
	}
	rootPath := o.Root.DisplayPath
	st, err := os.Stat(LongPath(rootPath))
	if err != nil || !st.IsDir() {
		if err == nil {
			err = errors.New("not a directory")
		}
		return Result{}, fmt.Errorf("%w: %v", ErrUnreachable, err)
	}
	if _, err := os.ReadDir(LongPath(rootPath)); err != nil {
		return Result{}, fmt.Errorf("%w: %v", ErrUnreachable, err)
	}
	w := &walker{
		ctx: ctx, o: o, runID: config.NewUUID(), seen: map[string]struct{}{},
		exts: NormalizeExts(o.Root.Extensions), settleMs: float64(o.Root.SettleSeconds) * 1000,
		visited: map[string]bool{}, complete: true,
	}
	w.res.RunID = w.runID
	if err := w.send("START", nil, nil); err != nil {
		return w.res, err
	}
	w.walk(rootPath, rootPath, 0)
	if err := ctx.Err(); err != nil {
		return w.res, err
	}
	failures := w.failures
	if len(failures) > 200 {
		failures = failures[:200]
	}
	done := w.complete
	if err := w.send("END", &done, failures); err != nil {
		return w.res, err
	}
	w.res.Complete = done
	if done {
		o.State.Prune(w.seen)
		o.State.mu.Lock()
		o.State.LastScan = o.Now()
		if o.JobType == "RECONCILE" {
			o.State.LastFull = o.Now()
		}
		o.State.mu.Unlock()
	}
	return w.res, nil
}

func (w *walker) send(phase string, complete *bool, failures []protocol.PathError) error {
	if phase == "START" {
		w.started = true
	}
	b := protocol.IngestBatch{
		RootID: w.o.Root.RootID, RunID: w.runID, JobType: w.o.JobType, Phase: phase,
		Observations: w.pending,
	}
	if b.Observations == nil {
		b.Observations = []protocol.Observation{}
	}
	if phase == "END" {
		b.Complete = complete
		b.Counts = &protocol.Counts{Scanned: w.res.Scanned, Errors: w.res.Errors}
		b.Errors = failures
	}
	w.pending = nil
	return w.o.Emit(b)
}

func (w *walker) add(ob protocol.Observation) error {
	w.seq++
	ob.Seq = w.seq
	ob.EventID = fmt.Sprintf("%s:%d", w.runID, w.seq)
	w.pending = append(w.pending, ob)
	if len(w.pending) >= w.o.BatchSize {
		return w.send("PROGRESS", nil, nil)
	}
	return nil
}

func (w *walker) fail(path string, err error) {
	w.complete = false
	w.res.Errors++
	if len(w.failures) < 200 {
		w.failures = append(w.failures, protocol.PathError{Path: path, Error: truncate(err.Error(), 500)})
	}
	w.o.Log.Warn("scan error", "root", w.o.Root.RootID, "path", path, "err", err)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func (w *walker) rel(root, full string) string {
	r, err := filepath.Rel(root, full)
	if err != nil {
		return filepath.ToSlash(full)
	}
	return filepath.ToSlash(r)
}

func (w *walker) walk(root, dir string, depth int) {
	if w.ctx.Err() != nil {
		return
	}
	entries, err := os.ReadDir(LongPath(dir))
	if err != nil {
		w.fail(dir, err)
		return
	}
	for _, e := range entries {
		if w.ctx.Err() != nil {
			return
		}
		name := e.Name()
		if systemNames[strings.ToLower(name)] {
			continue
		}
		full := filepath.Join(dir, name)
		rel := w.rel(root, full)
		mode := e.Type()
		isLink := mode&fs.ModeSymlink != 0 || mode&fs.ModeIrregular != 0
		if isLink {
			if !w.o.Root.FollowLinks {
				continue
			}
			real, err := filepath.EvalSymlinks(LongPath(full))
			if err != nil {
				w.fail(full, err)
				continue
			}
			ti, err := os.Stat(LongPath(real))
			if err != nil {
				w.fail(full, err)
				continue
			}
			if ti.IsDir() {
				if w.visited[real] || !w.o.Root.Recursive || MatchAny(w.o.Root.ExcludeGlobs, rel) {
					continue
				}
				w.visited[real] = true
				w.walk(root, full, depth+1)
				continue
			}
			w.file(full, rel, ti)
			continue
		}
		if e.IsDir() {
			if !w.o.Root.Recursive || MatchAny(w.o.Root.ExcludeGlobs, rel) {
				continue
			}
			w.walk(root, full, depth+1)
			continue
		}
		if !mode.IsRegular() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				continue // vanished while scanning
			}
			w.fail(full, err)
			continue
		}
		w.file(full, rel, info)
	}
}

func (w *walker) wanted(full, rel string) bool {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(full), "."))
	if len(w.exts) > 0 && !w.exts[ext] {
		return false
	}
	switch strings.ToLower(ext) {
	case "tmp", "part", "crdownload", "partial", "!ut", "download":
		return false
	}
	if strings.HasPrefix(filepath.Base(full), "~$") {
		return false
	}
	if MatchAny(w.o.Root.ExcludeGlobs, rel) {
		return false
	}
	if len(w.o.Root.IncludeGlobs) > 0 && !MatchAny(w.o.Root.IncludeGlobs, rel) {
		return false
	}
	return true
}

func (w *walker) file(full, rel string, info fs.FileInfo) {
	if !w.wanted(full, rel) {
		return
	}
	now := w.o.Now()
	nowMs := float64(now.UnixNano()) / 1e6
	mtimeMs := float64(info.ModTime().UnixNano()) / 1e6
	size := info.Size()
	fileID, ctimeMs := platformInfo(full, info)

	prev, hadPrev := w.o.State.Get(full)
	unchanged := hadPrev && prev.Size == size && prev.Mtime == mtimeMs && (fileID == "" || prev.FileID == "" || prev.FileID == fileID)

	newest := mtimeMs
	if mtimeMs > nowMs+60_000 { // future-dated file: do not trust its mtime
		newest = 0
	}
	if ctimeMs > newest && ctimeMs <= nowMs+60_000 {
		newest = ctimeMs
	}
	state := protocol.StateStable
	if nowMs-newest < w.settleMs {
		state = protocol.StateStillWriting
	}
	if state == protocol.StateStable && (!unchanged || prev.Stable < 1) {
		if err := openProbeExclusive(full); err != nil {
			switch {
			case isSharingViolation(err):
				state = protocol.StateStillWriting
			case errors.Is(err, fs.ErrPermission):
				state = protocol.StatePermissionDenied
			}
		}
	}

	entry := &Entry{Size: size, Mtime: mtimeMs, FileID: fileID}
	if unchanged {
		entry.Sig, entry.Hashed, entry.Probed, entry.Thumb = prev.Sig, prev.Hashed, prev.Probed, prev.Thumb
	}
	sig := entry.Sig
	if state == protocol.StateStable && sig == "" {
		s, err := QuickSignature(full, size)
		switch {
		case err == nil:
			sig = s
		case isSharingViolation(err):
			state = protocol.StateStillWriting
		case errors.Is(err, fs.ErrPermission):
			state = protocol.StatePermissionDenied
		case errors.Is(err, fs.ErrNotExist):
			return
		default:
			w.res.Errors++
			if e := w.add(protocol.Observation{Kind: protocol.KindError, Path: full, Error: truncate(err.Error(), 900), State: protocol.StateIncomplete}); e != nil {
				w.complete = false
			}
		}
	}
	stable := 0
	if state == protocol.StateStable {
		stable = 1
		if unchanged {
			stable = prev.Stable + 1
		}
	}
	entry.Stable = stable
	entry.Sig = sig
	if state != protocol.StateStable {
		entry.Sig, entry.Hashed, entry.Probed, entry.Thumb = "", false, false, false
		w.res.Writing++
	}
	w.o.State.Put(full, entry)
	w.seen[full] = struct{}{}
	w.res.Scanned++
	w.res.Files++

	ob := protocol.Observation{
		Kind: protocol.KindFile, Path: full, FileID: fileID, Size: size, MtimeMs: mtimeMs, CtimeMs: ctimeMs,
		MtimePrecisionMs: 1, State: state, StableObservations: stable, QuickSignature: entry.Sig,
		Ext: strings.ToLower(strings.TrimPrefix(filepath.Ext(full), ".")),
	}
	if err := w.add(ob); err != nil {
		// The durable spool could not accept the batch (disk full?). Never claim completeness after that.
		w.complete = false
		w.fail(full, fmt.Errorf("spool write failed: %w", err))
	}
}
