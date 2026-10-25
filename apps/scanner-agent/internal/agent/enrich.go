package agent

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"time"

	"github.com/creatoros/scanner-agent/internal/config"
	"github.com/creatoros/scanner-agent/internal/probe"
	"github.com/creatoros/scanner-agent/internal/protocol"
	"github.com/creatoros/scanner-agent/internal/scan"
	"github.com/creatoros/scanner-agent/internal/server"
)

// enrichRun batches hash/probe observations into one HEARTBEAT-type run (enrichment only: it never touches
// completeness bookkeeping on the server).
type enrichRun struct {
	a       *Agent
	rootID  string
	runID   string
	seq     int
	pending []protocol.Observation
	started bool
	count   int
}

func (e *enrichRun) add(ob protocol.Observation) error {
	e.seq++
	ob.Seq = e.seq
	ob.EventID = e.runID + ":" + strconv.Itoa(e.seq)
	e.pending = append(e.pending, ob)
	e.count++
	if len(e.pending) >= 50 {
		return e.flush(false)
	}
	return nil
}

func (e *enrichRun) flush(end bool) error {
	if len(e.pending) == 0 && (!end || !e.started) {
		return nil
	}
	phase := "PROGRESS"
	switch {
	case end:
		phase = "END"
	case !e.started:
		phase = "START"
	}
	e.started = true
	b := protocol.IngestBatch{RootID: e.rootID, RunID: e.runID, JobType: "HEARTBEAT", Phase: phase, Observations: e.pending}
	if b.Observations == nil {
		b.Observations = []protocol.Observation{}
	}
	if end {
		f := false
		b.Complete = &f
		b.Counts = &protocol.Counts{}
	}
	e.pending = nil
	body, err := json.Marshal(b)
	if err != nil {
		return err
	}
	return e.a.spool.Enqueue(e.rootID, "/agents/ingest", body)
}
func (a *Agent) enrichLoop(ctx context.Context) {
	var lastPoll time.Time
	for {
		if !a.authBad.Load() {
			a.pollFileOps(ctx)
		}
		busy := false
		if !a.authBad.Load() && a.spool.Depth() < 2000 {
			if a.Now().Sub(lastPoll) > 60*time.Second {
				lastPoll = a.Now()
				a.pollRequests(ctx)
			}
			busy = a.enrichOnce(ctx)
			a.processPreviews(ctx)
		}
		d := 10 * time.Second
		if busy {
			d = time.Second
		}
		if !sleepCtx(ctx, d) {
			return
		}
	}
}

func (a *Agent) pollRequests(ctx context.Context) {
	a.mu.RLock()
	needHash := false
	for _, rt := range a.rts {
		if rt.getCfg().HashMode == "candidates" {
			needHash = true
		}
	}
	a.mu.RUnlock()
	pctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var resp protocol.IngestResponse
	if needHash {
		var hr []protocol.WantHash
		if err := a.cl.Get(pctx, "/agents/hash-requests", &hr); err == nil {
			resp.WantHash = hr
		} else {
			a.noteErr(err)
		}
	}
	var pr []protocol.WantPreview
	if err := a.cl.Get(pctx, "/agents/preview-requests", &pr); err == nil {
		resp.WantPreview = pr
	} else {
		a.noteErr(err)
	}
	a.absorbWants(resp)
}

func (a *Agent) takeWantHash(rc protocol.RootConfig) map[string]bool {
	out := map[string]bool{}
	a.mu.Lock()
	defer a.mu.Unlock()
	for p := range a.wantH {
		if server.InsideRoot(rc.DisplayPath, p) {
			out[p] = true
			delete(a.wantH, p)
		}
	}
	return out
}

// enrichOnce hashes/probes pending files for each idle root, bounded in time. Returns true if it did work.
func (a *Agent) enrichOnce(ctx context.Context) bool {
	a.mu.RLock()
	rts := make([]*rootRT, 0, len(a.rts))
	for _, rt := range a.rts {
		rts = append(rts, rt)
	}
	revoked := a.pcfg.Revoked
	a.mu.RUnlock()
	if revoked {
		return false
	}
	worked := false
	deadline := a.Now().Add(90 * time.Second)
	for _, rt := range rts {
		rc := rt.getCfg()
		if rc.State != "" && rc.State != "ACTIVE" {
			continue
		}
		if rt.scanning.Load() || !rt.enriching.CompareAndSwap(false, true) {
			continue
		}
		func() {
			defer rt.enriching.Store(false)
			wanted := a.takeWantHash(rc)
			er := &enrichRun{a: a, rootID: rc.RootID, runID: config.NewUUID()}
			snap := rt.state.Snapshot()
			for path, e := range snap {
				if ctx.Err() != nil || a.Now().After(deadline) || rt.scanning.Load() {
					break
				}
				if e.Stable < 1 {
					continue
				}
				forceHash := wanted[path]
				needHash := forceHash || (rc.HashMode == "all" && !e.Hashed)
				needProbe := !e.Probed && probe.IsMedia(path) && (a.tools.FFprobe != "" || probe.IsImage(path))
				if rc.HashMode == "off" {
					needHash = false
				}
				if !needHash && !needProbe {
					continue
				}
				if t, ok := a.enrichFail.Load(path); ok && a.Now().Sub(t.(time.Time)) < 10*time.Minute {
					continue
				}
				if err := a.enrichFile(ctx, rt, er, path, e, needProbe, needHash); err != nil {
					if errors.Is(err, context.Canceled) {
						break
					}
					a.enrichFail.Store(path, a.Now())
					a.Log.Warn("enrichment skipped", "path", path, "err", err)
				} else {
					worked = true
				}
				delete(wanted, path)
			}
			// requested paths that are not (yet) in local state are re-queued for a later pass
			a.mu.Lock()
			for p := range wanted {
				a.wantH[p] = struct{}{}
			}
			a.mu.Unlock()
			if err := er.flush(true); err != nil {
				a.Log.Error("cannot spool enrichment results", "err", err)
			}
		}()
	}
	return worked
}

func (a *Agent) enrichFile(ctx context.Context, rt *rootRT, er *enrichRun, path string, e scan.Entry, needProbe, needHash bool) error {
	st, err := os.Stat(scan.LongPath(path))
	if err != nil {
		return err
	}
	if st.Size() != e.Size || float64(st.ModTime().UnixNano())/1e6 != e.Mtime {
		return errors.New("file changed since scan") // the next scan reports the change; enrichment follows
	}
	if needProbe {
		p, perr := a.tools.Probe(ctx, path)
		ob := protocol.Observation{Kind: protocol.KindProbe, Path: path, Size: e.Size, MtimeMs: e.Mtime, State: protocol.StateStable, StableObservations: e.Stable}
		if perr != nil {
			a.Log.Warn("probe failed", "path", path, "err", perr)
			ob.ProbeState = "PROBE_FAILED"
			ob.Error = truncate(perr.Error(), 900)
		} else {
			ob.Probe, ob.ProbeState = p, "INDEXED"
		}
		if err := er.add(ob); err != nil {
			return err
		}
		rt.state.Update(path, func(x *scan.Entry) { x.Probed = true })
	}
	if needHash {
		sum, n, herr := scan.FullHash(ctx, path)
		if herr != nil {
			return herr
		}
		st2, err := os.Stat(scan.LongPath(path))
		if err != nil || st2.Size() != e.Size || n != e.Size || float64(st2.ModTime().UnixNano())/1e6 != e.Mtime {
			return errors.New("file changed while hashing; hash discarded")
		}
		ob := protocol.Observation{Kind: protocol.KindHash, Path: path, Size: e.Size, MtimeMs: e.Mtime, State: protocol.StateStable, StableObservations: e.Stable, FullHash: sum, HashAlg: "sha256", QuickSignature: e.Sig}
		if err := er.add(ob); err != nil {
			return err
		}
		rt.state.Update(path, func(x *scan.Entry) { x.Hashed = true })
	}
	return nil
}

func (a *Agent) processPreviews(ctx context.Context) {
	a.mu.Lock()
	var batch []protocol.WantPreview
	for id, p := range a.wantP {
		delete(a.wantP, id)
		if t, ok := a.failP[id]; ok && a.Now().Sub(t) < 10*time.Minute {
			continue
		}
		batch = append(batch, p)
		if len(batch) >= 10 {
			break
		}
	}
	a.mu.Unlock()
	if len(batch) == 0 || a.tools.FFmpeg == "" {
		if len(batch) > 0 {
			a.warnOnce("noffmpeg", "ffmpeg missing: thumbnails are not generated")
		}
		return
	}
	roots := a.Roots()
	for _, p := range batch {
		if ctx.Err() != nil {
			return
		}
		var rc *protocol.RootConfig
		for i := range roots {
			if server.InsideRoot(roots[i].DisplayPath, p.Path) && roots[i].State != "RETIRED" {
				rc = &roots[i]
				break
			}
		}
		if rc == nil {
			continue // the server named a path outside every granted root: ignore
		}
		jpg, err := a.tools.Thumbnail(ctx, p.Path, 10000)
		if err == nil && len(jpg) > 5*1024*1024 {
			err = errors.New("thumbnail too large")
		}
		if err == nil {
			uctx, cancel := context.WithTimeout(ctx, 60*time.Second)
			err = a.cl.PostBytes(uctx, "/agents/previews/"+p.InstanceID, "image/jpeg", jpg, nil)
			cancel()
		}
		if err != nil {
			a.mu.Lock()
			a.failP[p.InstanceID] = a.Now()
			a.mu.Unlock()
			a.Log.Warn("preview failed", "path", p.Path, "err", err)
		}
	}
}
