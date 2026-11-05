package probe

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/creatoros/scanner-agent/internal/protocol"
	"github.com/creatoros/scanner-agent/internal/scan"
	"github.com/creatoros/scanner-agent/internal/server"
)

// TrimRequest is one owner-saved cut. The source is only read. Output is a new file.
type TrimRequest struct {
	Mode    string
	From    string
	To      string
	StartMs int
	EndMs   int
	Rotate  float64
	Roots   []protocol.RootConfig
}

func allowed(roots []protocol.RootConfig, p string) bool {
	clean := filepath.Clean(p)
	if !filepath.IsAbs(clean) {
		return false
	}
	for _, root := range roots {
		if root.State != "" && root.State != "ACTIVE" {
			continue
		}
		if server.InsideRoot(root.DisplayPath, clean) {
			return true
		}
	}
	return false
}

// TrimArgs is the ffmpeg argument list without the binary. INPUT and OUTPUT are placeholders in tests.
func TrimArgs(mode string, startMs, endMs int, rotate float64) ([]string, error) {
	if startMs < 0 || endMs <= startMs {
		return nil, fmt.Errorf("the end has to be after the start")
	}
	start := fmt.Sprintf("%.3f", float64(startMs)/1000)
	end := fmt.Sprintf("%.3f", float64(endMs)/1000)
	span := fmt.Sprintf("%.3f", float64(endMs-startMs)/1000)
	if strings.EqualFold(mode, "FAST") {
		return []string{
			"-y", "-hide_banner", "-nostdin",
			"-ss", start, "-i", "INPUT", "-t", span,
			"-map", "0:v:0", "-map", "0:a?",
			"-c", "copy",
			"-avoid_negative_ts", "make_zero", "-movflags", "+faststart",
			"-progress", "pipe:1", "-nostats",
			"OUTPUT",
		}, nil
	}
	args := []string{
		"-y", "-hide_banner", "-nostdin", "-noautorotate",
		"-i", "INPUT", "-ss", start, "-to", end,
		"-map", "0:v:0", "-map", "0:a?",
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
		"-c:a", "aac", "-b:a", "192k",
		"-movflags", "+faststart", "-avoid_negative_ts", "make_zero",
		"-progress", "pipe:1", "-nostats",
	}
	if rotate != 0 {
		args = append(args, "-metadata:s:v:0", fmt.Sprintf("rotate=%g", rotate))
	}
	args = append(args, "OUTPUT")
	return args, nil
}

// Trim writes a new clip. It refuses to replace the source or any file that is already there.
func (t Tools) Trim(ctx context.Context, req TrimRequest, onProgress func(pct int)) (*protocol.Probe, int64, error) {
	if t.FFmpeg == "" || t.FFprobe == "" {
		return nil, 0, fmt.Errorf("ffmpeg is not installed next to the scanner")
	}
	from := filepath.Clean(req.From)
	to := filepath.Clean(req.To)
	if from == to || strings.EqualFold(from, to) {
		return nil, 0, fmt.Errorf("the new clip would replace the original")
	}
	if !allowed(req.Roots, from) || !allowed(req.Roots, to) {
		return nil, 0, fmt.Errorf("that path is outside the folders this PC is indexing")
	}
	info, err := os.Lstat(scan.LongPath(from))
	if err != nil {
		return nil, 0, fmt.Errorf("the source video is not on this PC")
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return nil, 0, fmt.Errorf("only a regular video file can be trimmed")
	}
	if _, err := os.Lstat(scan.LongPath(to)); err == nil {
		return nil, 0, fmt.Errorf("a file is already at the new clip path")
	}
	part := to + ".part.mp4"
	if !allowed(req.Roots, part) {
		return nil, 0, fmt.Errorf("that path is outside the folders this PC is indexing")
	}
	_ = os.Remove(scan.LongPath(part))
	args, err := TrimArgs(req.Mode, req.StartMs, req.EndMs, req.Rotate)
	if err != nil {
		return nil, 0, err
	}
	for i, arg := range args {
		if arg == "INPUT" {
			args[i] = scan.LongPath(from)
		}
		if arg == "OUTPUT" {
			args[i] = scan.LongPath(part)
		}
	}
	cmd := exec.CommandContext(ctx, t.FFmpeg, args...)
	hide(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, 0, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, 0, err
	}
	if err := cmd.Start(); err != nil {
		return nil, 0, fmt.Errorf("ffmpeg: %s", err.Error())
	}
	errCh := make(chan string, 1)
	go func() {
		b, _ := io.ReadAll(stderr)
		text := strings.TrimSpace(string(b))
		if len(text) > 400 {
			text = text[len(text)-400:]
		}
		errCh <- text
	}()
	span := float64(req.EndMs-req.StartMs) / 1000
	readProgress(stdout, span, onProgress)
	waitErr := cmd.Wait()
	detail := <-errCh
	if waitErr != nil {
		_ = os.Remove(scan.LongPath(part))
		if detail == "" {
			detail = waitErr.Error()
		}
		return nil, 0, fmt.Errorf("ffmpeg: %s", detail)
	}
	if err := os.Rename(scan.LongPath(part), scan.LongPath(to)); err != nil {
		_ = os.Remove(scan.LongPath(part))
		return nil, 0, fmt.Errorf("the new clip could not be saved")
	}
	out, err := os.Stat(scan.LongPath(to))
	if err != nil || out.Size() < 1000 {
		_ = os.Remove(scan.LongPath(to))
		return nil, 0, fmt.Errorf("the new clip was empty")
	}
	probed, err := t.Probe(ctx, to)
	if err != nil {
		_ = os.Remove(scan.LongPath(to))
		return nil, 0, fmt.Errorf("the new clip could not be checked: %s", err.Error())
	}
	want := float64(req.EndMs - req.StartMs)
	frame := 40.0
	if probed.Fps > 1 && probed.Fps < 240 {
		frame = 1000 / probed.Fps
	}
	ok := false
	if strings.EqualFold(req.Mode, "FAST") {
		ok = probed.DurationMs > 50 && probed.DurationMs <= want+10000
	} else {
		slack := 150.0
		if frame*2 > slack {
			slack = frame * 2
		}
		diff := probed.DurationMs - want
		if diff < 0 {
			diff = -diff
		}
		ok = diff <= slack
	}
	if !ok {
		_ = os.Remove(scan.LongPath(to))
		return nil, 0, fmt.Errorf("the new clip did not match the selected length")
	}
	return probed, out.Size(), nil
}

func readProgress(r io.Reader, span float64, onProgress func(pct int)) {
	if onProgress == nil || span <= 0 {
		_, _ = io.Copy(io.Discard, r)
		return
	}
	last := -1
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "out_time_ms=") {
			continue
		}
		raw := strings.TrimPrefix(line, "out_time_ms=")
		v, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			continue
		}
		// ffmpeg writes microseconds in the field named out_time_ms.
		sec := v / 1_000_000
		pct := int(sec / span * 100)
		if pct < 0 {
			pct = 0
		}
		if pct > 99 {
			pct = 99
		}
		if pct != last {
			last = pct
			onProgress(pct)
		}
	}
}

// TrimTimeout is how long one encode may run before it is stopped.
const TrimTimeout = 3 * time.Hour
