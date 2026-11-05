package agent

import (
	"context"
	"sync/atomic"
	"time"

	"github.com/creatoros/scanner-agent/internal/probe"
	"github.com/creatoros/scanner-agent/internal/protocol"
)

// pollTrims claims at most one saved trim for this PC and encodes it beside the source.
func (a *Agent) pollTrims(ctx context.Context) {
	if a.authBad.Load() || !a.trimBusy.CompareAndSwap(false, true) {
		return
	}
	pctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	var jobs []protocol.VideoEdit
	if err := a.cl.Get(pctx, "/agents/video-edits", &jobs); err != nil {
		a.trimBusy.Store(false)
		a.noteErr(err)
		return
	}
	if len(jobs) == 0 {
		a.trimBusy.Store(false)
		return
	}
	go func() {
		defer a.trimBusy.Store(false)
		for _, job := range jobs {
			if ctx.Err() != nil {
				return
			}
			a.runTrim(ctx, job)
		}
	}()
}

func (a *Agent) runTrim(ctx context.Context, job protocol.VideoEdit) {
	tctx, cancel := context.WithTimeout(ctx, probe.TrimTimeout)
	defer cancel()
	var last atomic.Int32
	last.Store(-1)
	probeOut, size, err := a.tools.Trim(tctx, probe.TrimRequest{
		Mode:    job.Mode,
		From:    job.FromPath,
		To:      job.ToPath,
		StartMs: job.StartMs,
		EndMs:   job.EndMs,
		Rotate:  job.Rotate,
		Roots:   a.Roots(),
	}, func(pct int) {
		if int32(pct) == last.Load() {
			return
		}
		last.Store(int32(pct))
		pctx, stop := context.WithTimeout(context.Background(), 15*time.Second)
		defer stop()
		_ = a.cl.PostJSON(pctx, "/agents/video-edits/progress", protocol.VideoEditProgress{ID: job.ID, ProgressPct: pct}, nil)
	})
	result := protocol.VideoEditResult{ID: job.ID, OK: err == nil, ToPath: job.ToPath, Size: size}
	if probeOut != nil {
		result.Probe = probeOut
	}
	if err != nil {
		result.Error = err.Error()
		if len(result.Error) > 500 {
			result.Error = result.Error[:500]
		}
		a.Log.Warn("trim failed", "path", job.FromPath, "err", err)
	} else {
		a.Log.Info("trim saved", "from", job.FromPath, "to", job.ToPath, "bytes", size)
	}
	rctx, stop := context.WithTimeout(context.Background(), 30*time.Second)
	defer stop()
	if postErr := a.cl.PostJSON(rctx, "/agents/video-edits/result", result, nil); postErr != nil {
		a.Log.Warn("could not report trim", "err", postErr)
	}
}
