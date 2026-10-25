package agent

import (
	"context"
	"time"

	"github.com/creatoros/scanner-agent/internal/fileops"
	"github.com/creatoros/scanner-agent/internal/protocol"
	"github.com/creatoros/scanner-agent/internal/server"
)

// pollFileOps runs owner-confirmed rename, move, and delete requests.
// Indexing itself still never writes.
func (a *Agent) pollFileOps(ctx context.Context) {
	if a.authBad.Load() {
		return
	}
	pctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var ops []protocol.FileOp
	if err := a.cl.Get(pctx, "/agents/file-operations", &ops); err != nil {
		a.noteErr(err)
		return
	}
	for _, op := range ops {
		if ctx.Err() != nil {
			return
		}
		a.runFileOp(pctx, op)
	}
}

func (a *Agent) runFileOp(ctx context.Context, op protocol.FileOp) {
	err := fileops.Apply(a.Roots(), op.Kind, op.FromPath, op.ToPath, op.Size)
	result := protocol.FileOpResult{ID: op.ID, OK: err == nil, ToPath: op.ToPath}
	if err != nil {
		result.Error = err.Error()
		if len(result.Error) > 500 {
			result.Error = result.Error[:500]
		}
		a.Log.Warn("file change failed", "op", op.Kind, "path", op.FromPath, "err", err)
	} else {
		a.rememberFileOp(op)
		a.Log.Info("file change applied", "op", op.Kind, "from", op.FromPath, "to", op.ToPath)
	}
	if postErr := a.cl.PostJSON(ctx, "/agents/file-operations/result", result, nil); postErr != nil {
		a.Log.Warn("could not report file change", "err", postErr)
	}
}

func (a *Agent) rememberFileOp(op protocol.FileOp) {
	a.mu.RLock()
	var fromRT, toRT *rootRT
	var fromLen, toLen int
	for _, rt := range a.rts {
		cfg := rt.getCfg()
		if server.InsideRoot(cfg.DisplayPath, op.FromPath) && len(cfg.DisplayPath) > fromLen {
			fromRT = rt
			fromLen = len(cfg.DisplayPath)
		}
		if op.ToPath != "" && server.InsideRoot(cfg.DisplayPath, op.ToPath) && len(cfg.DisplayPath) > toLen {
			toRT = rt
			toLen = len(cfg.DisplayPath)
		}
	}
	a.mu.RUnlock()
	if fromRT == nil || fromRT.state == nil {
		return
	}
	if op.Kind == "DELETE" || op.ToPath == "" {
		fromRT.state.Forget(op.FromPath)
		_ = fromRT.state.Save()
		return
	}
	entry, ok := fromRT.state.Get(op.FromPath)
	if toRT != nil && toRT != fromRT && toRT.state != nil && ok {
		cp := *entry
		fromRT.state.Forget(op.FromPath)
		toRT.state.Put(op.ToPath, &cp)
		_ = fromRT.state.Save()
		_ = toRT.state.Save()
		return
	}
	fromRT.state.Relocate(op.FromPath, op.ToPath)
	_ = fromRT.state.Save()
}
