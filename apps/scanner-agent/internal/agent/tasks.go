package agent

import (
	"context"
	"time"

	"github.com/creatoros/scanner-agent/internal/protocol"
	"github.com/creatoros/scanner-agent/internal/tasksched"
)

// pollWindowsTasks asks Task Scheduler about the names the owner saved, and restarts one when they ask.
func (a *Agent) pollWindowsTasks(ctx context.Context) {
	if a.authBad.Load() {
		return
	}
	pctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	var page protocol.WindowsTasksPage
	if err := a.cl.Get(pctx, "/agents/windows-tasks", &page); err != nil {
		a.noteErr(err)
		return
	}
	for _, task := range page.Tasks {
		if ctx.Err() != nil {
			return
		}
		status, detail := tasksched.Query(pctx, task.TaskName)
		if err := a.cl.PostJSON(pctx, "/agents/windows-tasks/report", protocol.WindowsTaskReport{
			ID: task.ID, Status: status, Detail: detail,
		}, nil); err != nil {
			a.Log.Warn("could not report scheduled task", "task", task.TaskName, "err", err)
		}
	}
	for _, job := range page.Restarts {
		if ctx.Err() != nil {
			return
		}
		status, detail, err := tasksched.Restart(pctx, job.TaskName)
		result := protocol.WindowsTaskResult{ID: job.ID, OK: err == nil, Status: status, Detail: detail}
		if err != nil {
			result.Error = err.Error()
			a.Log.Warn("scheduled task restart failed", "task", job.TaskName, "err", err)
		} else {
			a.Log.Info("scheduled task restarted", "task", job.TaskName, "status", status)
		}
		if postErr := a.cl.PostJSON(pctx, "/agents/windows-tasks/result", result, nil); postErr != nil {
			a.Log.Warn("could not report scheduled task restart", "err", postErr)
		}
	}
}
