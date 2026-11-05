package probe

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/creatoros/scanner-agent/internal/protocol"
)

func TestTrimSyntheticClips(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not installed")
	}
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe is not installed")
	}
	dir := t.TempDir()
	tools := Tools{FFmpeg: ffmpeg, FFprobe: ffprobe}
	cases := []struct {
		name  string
		lavfi string
		mode  string
		start int
		end   int
	}{
		{"landscape-audio", "testsrc2=size=320x180:rate=24:duration=4[v];sine=frequency=440:duration=4[a]", "ACCURATE", 500, 2100},
		{"portrait-silent", "testsrc2=size=180x320:rate=30:duration=3", "ACCURATE", 200, 900},
		{"fast-keyframe", "testsrc2=size=160x120:rate=25:duration=4", "FAST", 1000, 2500},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			src := filepath.Join(dir, tc.name+"-src.mp4")
			out := filepath.Join(dir, tc.name+"-out.mp4")
			args := []string{"-y", "-f", "lavfi", "-i", tc.lavfi}
			if tc.name == "landscape-audio" {
				args = []string{"-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-shortest"}
			}
			args = append(args, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "12")
			if tc.name == "landscape-audio" {
				args = append(args, "-c:a", "aac")
			}
			args = append(args, src)
			cmd := exec.Command(ffmpeg, args...)
			if outb, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("fixture: %v %s", err, outb)
			}
			before, err := os.ReadFile(src)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			probed, size, err := tools.Trim(ctx, TrimRequest{
				Mode: tc.mode, From: src, To: out, StartMs: tc.start, EndMs: tc.end,
				Roots: []protocol.RootConfig{{RootID: "t", DisplayPath: dir, State: "ACTIVE"}},
			}, nil)
			if err != nil {
				t.Fatal(err)
			}
			after, _ := os.ReadFile(src)
			if string(before) != string(after) {
				t.Fatal("source bytes changed")
			}
			if _, err := os.Stat(src); err != nil {
				t.Fatal("source missing")
			}
			if size < 1000 || probed == nil || probed.DurationMs < 50 {
				t.Fatalf("bad output size=%d probe=%+v", size, probed)
			}
			if tc.mode == "ACCURATE" {
				want := float64(tc.end - tc.start)
				if probed.DurationMs < want-200 || probed.DurationMs > want+200 {
					t.Fatalf("duration %v want %v", probed.DurationMs, want)
				}
			}
			if tc.name == "landscape-audio" && (probed.HasAudio == nil || !*probed.HasAudio) {
				t.Fatal("audio was dropped")
			}
			if tc.name == "portrait-silent" {
				if probed.HasAudio != nil && *probed.HasAudio {
					t.Fatal("a silent clip gained an audio track")
				}
				if probed.Width >= probed.Height {
					t.Fatalf("portrait became %dx%d", probed.Width, probed.Height)
				}
			}
		})
	}
}
