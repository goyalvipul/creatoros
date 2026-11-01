// Package tasksched reads and restarts one named Windows Task Scheduler job.
// It does not run a shell, and it refuses any name that is not a task path.
package tasksched

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"time"
)

var nameOK = regexp.MustCompile(`^\\?(?:[A-Za-z0-9][A-Za-z0-9 ._-]{0,64}\\)*[A-Za-z0-9][A-Za-z0-9 ._-]{0,64}$`)

func ValidName(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 200 {
		return false
	}
	if strings.ContainsAny(name, "\"'`|&;<>\n\r$") {
		return false
	}
	return nameOK.MatchString(name)
}

// Query asks Task Scheduler for one task. Status is RUNNING, READY, DISABLED, NOT_FOUND, or UNKNOWN.
func Query(ctx context.Context, name string) (status, detail string) {
	if !ValidName(name) {
		return "UNKNOWN", "That task name is not allowed."
	}
	if runtime.GOOS != "windows" {
		return "UNKNOWN", "Task Scheduler is only on the Windows agent."
	}
	out, err := run(ctx, "schtasks", "/Query", "/TN", name, "/FO", "LIST")
	return parseStatus(out, err)
}

// Restart stops the task if it is running, then starts it again.
func Restart(ctx context.Context, name string) (status, detail string, err error) {
	if !ValidName(name) {
		return "UNKNOWN", "That task name is not allowed.", errors.New("that task name is not allowed")
	}
	if runtime.GOOS != "windows" {
		return "UNKNOWN", "Task Scheduler is only on the Windows agent.", errors.New("task scheduler is only on the Windows agent")
	}
	_, _ = run(ctx, "schtasks", "/End", "/TN", name)
	if _, err = run(ctx, "schtasks", "/Run", "/TN", name); err != nil {
		status, detail = parseStatus("", err)
		if status == "UNKNOWN" {
			detail = "Could not start the task. " + trim(err.Error())
		}
		return status, detail, fmt.Errorf("could not start the task")
	}
	status, detail = Query(ctx, name)
	return status, detail, nil
}

func run(ctx context.Context, file string, args ...string) (string, error) {
	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cctx, file, args...)
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	err := cmd.Run()
	return buf.String(), err
}

func parseStatus(output string, err error) (string, string) {
	text := output
	if err != nil {
		text = output + "\n" + err.Error()
	}
	low := strings.ToLower(text)
	if strings.Contains(low, "cannot find") || strings.Contains(low, "does not exist") {
		return "NOT_FOUND", "Task Scheduler does not have a task with that name."
	}
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if len(line) < 8 || !strings.HasPrefix(strings.ToLower(line), "status:") {
			continue
		}
		value := strings.TrimSpace(line[strings.Index(line, ":")+1:])
		switch strings.ToLower(value) {
		case "running":
			return "RUNNING", "Running"
		case "ready":
			return "READY", "Ready"
		case "disabled":
			return "DISABLED", "Disabled"
		default:
			if value == "" {
				return "UNKNOWN", "Task Scheduler did not say."
			}
			return "UNKNOWN", value
		}
	}
	if err != nil {
		return "UNKNOWN", trim(text)
	}
	return "UNKNOWN", "Task Scheduler did not say."
}

func trim(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > 300 {
		return s[:300]
	}
	return s
}
