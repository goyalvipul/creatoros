// Package agent wires the scanner, spool, uploader, hasher and stream server into one long-running process.
//
// The agent is outbound-first: it pulls its configuration, pushes observations and heartbeats, and only exposes a
// small signed, read-only streaming endpoint. If the server is down it keeps scanning into the durable spool and
// replays when the server returns; if it is revoked it goes idle and never touches the disk again.
package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/creatoros/scanner-agent/internal/client"
	"github.com/creatoros/scanner-agent/internal/config"
	"github.com/creatoros/scanner-agent/internal/probe"
	"github.com/creatoros/scanner-agent/internal/protocol"
	"github.com/creatoros/scanner-agent/internal/scan"
	"github.com/creatoros/scanner-agent/internal/server"
	"github.com/creatoros/scanner-agent/internal/spool"
)

type rootRT struct {
	mu          sync.Mutex
	cfg         protocol.RootConfig
	state       *scan.State
	scanning    atomic.Bool
	enriching   atomic.Bool
	nextAttempt time.Time
	drainedAt   time.Time
	reachable   bool
	lastErr     string
}

func (r *rootRT) getCfg() protocol.RootConfig {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.cfg
}

func (r *rootRT) setCfg(c protocol.RootConfig) {
	r.mu.Lock()
	r.cfg = c
	r.mu.Unlock()
}

func (r *rootRT) getDrained() time.Time {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.drainedAt
}

func (r *rootRT) setDrained(t time.Time) {
	r.mu.Lock()
	r.drainedAt = t
	r.mu.Unlock()
}

type Agent struct {
	Dir     string
	Cfg     *config.Config
	Log     *slog.Logger
	Version string
	Now     func() time.Time

	cl    *client.Client
	spool *spool.Spool
	tools probe.Tools

	mu     sync.RWMutex
	pcfg   protocol.Config
	cfgAt  time.Time
	rts    map[string]*rootRT
	wantH  map[string]struct{}
	wantP  map[string]protocol.WantPreview
	failP  map[string]time.Time
	listen []string

	authBad    atomic.Bool
	warned     sync.Map
	enrichFail sync.Map
}

func New(dir string, cfg *config.Config, log *slog.Logger, version string) *Agent {
	return &Agent{
		Dir: dir, Cfg: cfg, Log: log, Version: version, Now: time.Now,
		rts: map[string]*rootRT{}, wantH: map[string]struct{}{}, wantP: map[string]protocol.WantPreview{}, failP: map[string]time.Time{},
	}
}

func (a *Agent) warnOnce(key, msg string) {
	if _, loaded := a.warned.LoadOrStore(key, true); !loaded {
		a.Log.Warn(msg)
	}
}

// ----- server.Provider -----

func (a *Agent) Roots() []protocol.RootConfig {
	a.mu.RLock()
	defer a.mu.RUnlock()
	out := make([]protocol.RootConfig, 0, len(a.rts))
	for _, rt := range a.rts {
		out = append(out, rt.getCfg())
	}
	return out
}

func (a *Agent) SigningKey() string { return a.Cfg.SigningKey }

// ----- lifecycle -----

// Run blocks until ctx is cancelled.
func (a *Agent) Run(ctx context.Context) error {
	if !a.Cfg.Paired() {
		return errors.New("this agent is not paired yet: run `creatoros-agent pair --server <url> --code <code>` first")
	}
	var err error
	if a.spool, err = spool.Open(filepath.Join(a.Dir, "spool")); err != nil {
		return fmt.Errorf("open spool: %w", err)
	}
	a.cl = client.New(a.Cfg.Server, a.Cfg.Token, a.Cfg.SigningKey)
	a.tools = probe.Locate(a.Cfg.FFmpeg, a.Cfg.FFprobe)
	a.Log.Info("agent starting", "version", a.Version, "device", a.Cfg.DeviceID, "server", a.Cfg.Server, "ffmpeg", a.tools.FFmpeg != "", "ffprobe", a.tools.FFprobe != "", "spool", a.spool.Depth())
	if a.tools.FFprobe == "" {
		a.Log.Warn("ffprobe not found: video metadata and thumbnails are disabled (install ffmpeg or place ffmpeg.exe/ffprobe.exe next to the agent)")
	}

	a.loadConfigCache()

	lis, lerr := net.Listen("tcp", a.Cfg.Listen)
	var srv *http.Server
	if lerr != nil {
		a.Log.Error("cannot listen for stream requests; scanning continues but browser playback of originals is unavailable", "addr", a.Cfg.Listen, "err", lerr)
	} else {
		a.listen = a.listenURLs(lis.Addr().(*net.TCPAddr).Port)
		s := &server.Server{P: a, Log: a.Log, Version: a.Version, Now: a.Now}
		srv = &http.Server{Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 2 * time.Minute}
		go func() {
			if err := srv.Serve(lis); err != nil && !errors.Is(err, http.ErrServerClosed) {
				a.Log.Error("stream server stopped", "err", err)
			}
		}()
		a.Log.Info("stream server listening", "urls", a.listen)
	}

	var wg sync.WaitGroup
	run := func(name string, fn func(context.Context)) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					a.Log.Error("loop panicked; restarting agent process is recommended", "loop", name, "panic", fmt.Sprint(r))
				}
			}()
			fn(ctx)
		}()
	}
	run("heartbeat", a.heartbeatLoop)
	run("scheduler", a.schedulerLoop)
	run("sender", a.senderLoop)
	run("enrich", a.enrichLoop)
	<-ctx.Done()
	if srv != nil {
		sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = srv.Shutdown(sctx)
		cancel()
	}
	wg.Wait()
	a.Log.Info("agent stopped")
	return nil
}

func sleepCtx(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

// ----- configuration -----

func (a *Agent) cachePath() string { return filepath.Join(a.Dir, "config-cache.json") }

func (a *Agent) loadConfigCache() {
	b, err := os.ReadFile(a.cachePath())
	if err != nil {
		return
	}
	var c protocol.Config
	if json.Unmarshal(b, &c) == nil {
		a.applyConfig(c, false)
		a.Log.Info("loaded cached configuration", "roots", len(c.Roots))
	}
}

func (a *Agent) fetchConfig(ctx context.Context) error {
	var c protocol.Config
	cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err := a.cl.Get(cctx, "/agents/config", &c); err != nil {
		a.noteErr(err)
		return err
	}
	a.authBad.Store(false)
	a.applyConfig(c, true)
	if b, err := json.Marshal(c); err == nil {
		_ = os.WriteFile(a.cachePath()+".tmp", b, 0o600)
		_ = os.Rename(a.cachePath()+".tmp", a.cachePath())
	}
	return nil
}

func (a *Agent) noteErr(err error) {
	if client.IsRevoked(err) {
		if !a.authBad.Swap(true) {
			a.Log.Error("server rejected this device's credentials (revoked or expired). The agent is idle; re-pair it from Storage & Devices.", "err", err)
		}
	}
}

func (a *Agent) applyConfig(c protocol.Config, fresh bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.pcfg = c
	if fresh {
		a.cfgAt = a.Now()
	}
	seen := map[string]bool{}
	for _, rc := range c.Roots {
		seen[rc.RootID] = true
		rt, ok := a.rts[rc.RootID]
		if !ok {
			st, err := scan.LoadState(filepath.Join(a.Dir, "state"), rc.RootID)
			if err != nil {
				a.Log.Error("cannot load state; skipping root", "root", rc.RootID, "err", err)
				continue
			}
			rt = &rootRT{state: st, nextAttempt: st.LastScan.Add(time.Duration(intervalMin(rc)) * time.Minute)}
			if st.LastScan.IsZero() {
				rt.nextAttempt = a.Now()
			}
			a.rts[rc.RootID] = rt
			a.Log.Info("root configured", "root", rc.RootID, "path", rc.DisplayPath, "hash", rc.HashMode, "interval_min", intervalMin(rc))
		}
		rt.setCfg(rc)
	}
	for id := range a.rts {
		if !seen[id] {
			delete(a.rts, id)
		}
	}
}

func intervalMin(rc protocol.RootConfig) int {
	if rc.ScanIntervalMinute <= 0 {
		return 360
	}
	return rc.ScanIntervalMinute
}

func (a *Agent) listenURLs(port int) []string {
	if len(a.Cfg.Advertise) > 0 {
		return a.Cfg.Advertise
	}
	host, _, _ := net.SplitHostPort(a.Cfg.Listen)
	if host != "" && host != "0.0.0.0" && host != "::" {
		return []string{fmt.Sprintf("http://%s:%d", host, port)}
	}
	var out []string
	ifs, _ := net.Interfaces()
	for _, ifc := range ifs {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, ad := range addrs {
			ipn, ok := ad.(*net.IPNet)
			if !ok {
				continue
			}
			ip := ipn.IP.To4()
			if ip == nil || ip.IsLinkLocalUnicast() {
				continue
			}
			out = append(out, fmt.Sprintf("http://%s:%d", ip.String(), port))
		}
	}
	if len(out) > 10 {
		out = out[:10]
	}
	return out
}

func tailscaleIP() string {
	_, cgnat, _ := net.ParseCIDR("100.64.0.0/10")
	ifs, _ := net.Interfaces()
	for _, ifc := range ifs {
		addrs, _ := ifc.Addrs()
		for _, ad := range addrs {
			if ipn, ok := ad.(*net.IPNet); ok {
				if ip := ipn.IP.To4(); ip != nil && cgnat.Contains(ip) {
					return ip.String()
				}
			}
		}
	}
	return ""
}

// ----- heartbeat -----

func (a *Agent) reachable(path string) (bool, string) {
	type res struct {
		ok  bool
		err string
	}
	ch := make(chan res, 1)
	go func() {
		st, err := os.Stat(scan.LongPath(path))
		if err != nil {
			ch <- res{false, err.Error()}
			return
		}
		if !st.IsDir() {
			ch <- res{false, "not a directory"}
			return
		}
		if _, err := os.ReadDir(scan.LongPath(path)); err != nil {
			ch <- res{false, err.Error()}
			return
		}
		ch <- res{true, ""}
	}()
	select {
	case r := <-ch:
		return r.ok, r.err
	case <-time.After(10 * time.Second):
		return false, "timed out reading the folder (network share offline?)"
	}
}

func (a *Agent) buildHeartbeat() protocol.Heartbeat {
	host, _ := os.Hostname()
	a.mu.RLock()
	rts := make([]*rootRT, 0, len(a.rts))
	for _, rt := range a.rts {
		rts = append(rts, rt)
	}
	a.mu.RUnlock()
	hb := protocol.Heartbeat{
		AgentVersion: a.Version, Hostname: host, OS: runtime.GOOS,
		ListenURLs: a.listen, TailscaleIP: tailscaleIP(), Roots: []protocol.RootHealth{},
	}
	if hb.ListenURLs == nil {
		hb.ListenURLs = []string{}
	}
	anyScan := false
	for _, rt := range rts {
		rc := rt.getCfg()
		ok, msg := a.reachable(rc.DisplayPath)
		h := protocol.RootHealth{RootID: rc.RootID, Reachable: ok, Error: truncate(msg, 500), QueueDepth: a.spool.DepthFor(rc.RootID), Scanning: rt.scanning.Load()}
		if ok {
			h.FreeBytes, h.TotalBytes = diskSpace(rc.DisplayPath)
		}
		anyScan = anyScan || h.Scanning
		hb.Roots = append(hb.Roots, h)
	}
	hb.Load = &protocol.Load{Scanning: anyScan}
	return hb
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

func (a *Agent) heartbeatLoop(ctx context.Context) {
	// Config is polled every 10s (so "Scan now" feels immediate); heartbeats follow the server-provided interval.
	var lastBeat time.Time
	for {
		if a.authBad.Load() && !lastBeat.IsZero() && a.Now().Sub(lastBeat) < 5*time.Minute {
			if !sleepCtx(ctx, 10*time.Second) {
				return
			}
			continue
		}
		if err := a.fetchConfig(ctx); err != nil {
			a.Log.Warn("config fetch failed (using last known configuration)", "err", err)
		}
		interval := 30 * time.Second
		a.mu.RLock()
		if s := a.pcfg.HeartbeatSeconds; s >= 5 {
			interval = time.Duration(s) * time.Second
		}
		a.mu.RUnlock()
		if lastBeat.IsZero() || a.Now().Sub(lastBeat) >= interval {
			lastBeat = a.Now()
			a.rotateTokenIfNeeded(ctx)
			hb := a.buildHeartbeat()
			hctx, cancel := context.WithTimeout(ctx, 30*time.Second)
			err := a.cl.PostJSON(hctx, "/agents/heartbeat", hb, nil)
			cancel()
			if err != nil {
				a.noteErr(err)
				a.Log.Warn("heartbeat failed", "err", err)
			}
		}
		if !sleepCtx(ctx, 10*time.Second) {
			return
		}
	}
}

func (a *Agent) rotateTokenIfNeeded(ctx context.Context) {
	if a.Cfg.ExpiresAt == "" || a.authBad.Load() {
		return
	}
	exp, err := time.Parse(time.RFC3339, a.Cfg.ExpiresAt)
	if err != nil || exp.Sub(a.Now()) > 14*24*time.Hour {
		return
	}
	var out struct {
		Token     string `json:"token"`
		ExpiresAt string `json:"expiresAt"`
	}
	rctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err := a.cl.PostJSON(rctx, "/agents/token/rotate", map[string]any{}, &out); err != nil {
		a.Log.Warn("token rotation failed", "err", err)
		return
	}
	if out.Token == "" {
		return
	}
	a.Cfg.Token, a.Cfg.ExpiresAt = out.Token, out.ExpiresAt
	if err := config.Save(a.Dir, a.Cfg); err != nil {
		a.Log.Error("rotated token but could not save it; the agent will need re-pairing after restart", "err", err)
	}
	a.cl.SetToken(out.Token)
	a.Log.Info("device token rotated", "expiresAt", out.ExpiresAt)
}

// ----- scheduler -----

func (a *Agent) schedulerLoop(ctx context.Context) {
	for {
		if !sleepCtx(ctx, 5*time.Second) {
			return
		}
		if a.authBad.Load() {
			continue
		}
		a.mu.RLock()
		revoked := a.pcfg.Revoked
		cfgAt := a.cfgAt
		rts := make([]*rootRT, 0, len(a.rts))
		for _, rt := range a.rts {
			rts = append(rts, rt)
		}
		a.mu.RUnlock()
		if revoked {
			continue
		}
		for _, rt := range rts {
			rc := rt.getCfg()
			if rc.State != "" && rc.State != "ACTIVE" && rc.State != "UNREACHABLE" {
				continue // PAUSED / RETIRED / etc.
			}
			if rt.scanning.Load() {
				continue
			}
			now := a.Now()
			jobType := ""
			requested := (rc.ScanRequested || rc.ReconcileRequested) && a.spool.DepthFor(rc.RootID) == 0 && cfgAt.After(rt.getDrained())
			switch {
			case requested && rc.ReconcileRequested:
				jobType = "RECONCILE"
			case requested:
				jobType = "SCAN"
			case !now.Before(rt.nextAttempt):
				jobType = "SCAN"
			}
			if jobType == "" {
				continue
			}
			rt.scanning.Store(true)
			go a.runScan(ctx, rt, jobType)
		}
	}
}

func (a *Agent) runScan(ctx context.Context, rt *rootRT, jobType string) {
	defer rt.scanning.Store(false)
	rc := rt.getCfg()
	if jobType == "RECONCILE" {
		rt.state.ResetEnrichment()
	}
	started := a.Now()
	a.Log.Info("scan starting", "root", rc.RootID, "path", rc.DisplayPath, "type", jobType)
	res, err := scan.Run(ctx, scan.Options{
		Root: rc, State: rt.state, JobType: jobType, Now: a.Now, Log: a.Log,
		Emit: func(b protocol.IngestBatch) error {
			body, err := json.Marshal(b)
			if err != nil {
				return err
			}
			return a.spool.Enqueue(b.RootID, "/agents/ingest", body)
		},
	})
	_ = rt.state.Save()
	iv := time.Duration(intervalMin(rc)) * time.Minute
	switch {
	case errors.Is(err, scan.ErrUnreachable):
		rt.reachable, rt.lastErr = false, err.Error()
		rt.nextAttempt = a.Now().Add(minDur(iv, 5*time.Minute))
		a.Log.Warn("root unreachable; nothing was reported (files are never marked missing because a drive is offline)", "root", rc.RootID, "err", err)
	case err != nil:
		rt.nextAttempt = a.Now().Add(minDur(iv, 2*time.Minute))
		if ctx.Err() == nil {
			a.Log.Error("scan aborted", "root", rc.RootID, "err", err)
		}
	case !res.Complete:
		rt.nextAttempt = a.Now().Add(minDur(iv, 10*time.Minute))
		a.Log.Warn("scan finished incomplete (some folders could not be read); missing-file detection is skipped", "root", rc.RootID, "scanned", res.Scanned, "errors", res.Errors)
	default:
		rt.nextAttempt = a.Now().Add(iv)
		a.Log.Info("scan complete", "root", rc.RootID, "files", res.Files, "stillWriting", res.Writing, "errors", res.Errors, "took", a.Now().Sub(started).Round(time.Millisecond))
	}
}

func minDur(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}

// ----- sender -----

func (a *Agent) senderLoop(ctx context.Context) {
	backoff := time.Second
	for {
		if ctx.Err() != nil {
			return
		}
		if a.authBad.Load() {
			if !sleepCtx(ctx, 30*time.Second) {
				return
			}
			continue
		}
		it := a.spool.Next()
		if it == nil {
			select {
			case <-ctx.Done():
				return
			case <-a.spool.Wait():
			case <-time.After(5 * time.Second):
			}
			continue
		}
		var resp protocol.IngestResponse
		sctx, cancel := context.WithTimeout(ctx, 90*time.Second)
		err := a.cl.PostRaw(sctx, it.Path, it.Body, &resp)
		cancel()
		if err == nil {
			backoff = time.Second
			if resp.Rejected > 0 {
				a.Log.Warn("server rejected observations (paths outside the granted root?)", "rejected", resp.Rejected)
			}
			a.absorbWants(resp)
			if a.spool.Done(it) {
				a.mu.RLock()
				rt := a.rts[it.RootID]
				a.mu.RUnlock()
				if rt != nil {
					rt.setDrained(a.Now())
				}
			}
			continue
		}
		var se *client.StatusError
		switch {
		case errors.As(err, &se) && se.Permanent():
			a.Log.Error("server permanently rejected a batch; quarantined in spool/dead", "status", se.Status, "code", se.Code, "msg", se.Message)
			a.spool.Dead(it)
		case client.IsRevoked(err):
			a.noteErr(err)
		default:
			a.Log.Warn("upload failed; will retry", "err", err, "retryIn", backoff)
			if !sleepCtx(ctx, backoff) {
				return
			}
			if backoff < 60*time.Second {
				backoff *= 2
			}
		}
	}
}

func (a *Agent) absorbWants(r protocol.IngestResponse) {
	if len(r.WantHash) == 0 && len(r.WantPreview) == 0 {
		return
	}
	a.mu.Lock()
	for _, w := range r.WantHash {
		a.wantH[w.Path] = struct{}{}
	}
	for _, p := range r.WantPreview {
		a.wantP[p.InstanceID] = p
	}
	a.mu.Unlock()
}
