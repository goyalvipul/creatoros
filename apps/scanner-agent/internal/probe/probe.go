// Package probe extracts technical metadata (ffprobe) and thumbnails (ffmpeg). Both are optional: without them the
// agent still indexes and hashes files, and the server shows previews as "pending".
package probe

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"mime"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/creatoros/scanner-agent/internal/protocol"
	"github.com/creatoros/scanner-agent/internal/scan"
)

type Tools struct {
	FFmpeg  string
	FFprobe string
}

var (
	videoExt = set("mp4 mov mkv avi webm m4v mpg mpeg wmv flv mts m2ts 3gp mxf")
	audioExt = set("mp3 wav m4a aac flac ogg opus wma aif aiff")
	imageExt = set("jpg jpeg png gif webp heic heif bmp tif tiff avif")
)

func set(s string) map[string]bool {
	m := map[string]bool{}
	for _, v := range strings.Fields(s) {
		m[v] = true
	}
	return m
}

func ext(path string) string { return strings.ToLower(strings.TrimPrefix(filepath.Ext(path), ".")) }

func IsVideo(path string) bool { return videoExt[ext(path)] }
func IsImage(path string) bool { return imageExt[ext(path)] }
func IsMedia(path string) bool { e := ext(path); return videoExt[e] || audioExt[e] || imageExt[e] }

// Locate finds ffmpeg/ffprobe: explicit config, next to the agent executable, then PATH.
func Locate(cfgFFmpeg, cfgFFprobe string) Tools {
	return Tools{FFmpeg: find("ffmpeg", cfgFFmpeg), FFprobe: find("ffprobe", cfgFFprobe)}
}

func find(name, explicit string) string {
	if explicit != "" {
		if _, err := os.Stat(explicit); err == nil {
			return explicit
		}
	}
	if exe, err := os.Executable(); err == nil {
		for _, n := range []string{name + ".exe", name} {
			p := filepath.Join(filepath.Dir(exe), n)
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				return p
			}
		}
	}
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	return ""
}

type ffprobeOut struct {
	Streams []struct {
		CodecType    string `json:"codec_type"`
		CodecName    string `json:"codec_name"`
		Width        int    `json:"width"`
		Height       int    `json:"height"`
		RFrameRate   string `json:"r_frame_rate"`
		AvgFrameRate string `json:"avg_frame_rate"`
		Duration     string `json:"duration"`
		BitRate      string `json:"bit_rate"`
		Tags         map[string]string
		SideDataList []struct {
			Rotation float64 `json:"rotation"`
		} `json:"side_data_list"`
		Disposition struct {
			AttachedPic int `json:"attached_pic"`
		} `json:"disposition"`
	} `json:"streams"`
	Format struct {
		FormatName string            `json:"format_name"`
		Duration   string            `json:"duration"`
		BitRate    string            `json:"bit_rate"`
		Tags       map[string]string `json:"tags"`
	} `json:"format"`
}

func fraction(s string) float64 {
	a, b, ok := strings.Cut(s, "/")
	if !ok {
		f, _ := strconv.ParseFloat(s, 64)
		return f
	}
	n, _ := strconv.ParseFloat(a, 64)
	d, _ := strconv.ParseFloat(b, 64)
	if d == 0 {
		return 0
	}
	return n / d
}

// ParseFFprobe converts ffprobe JSON into the wire probe. Exposed for tests.
func ParseFFprobe(raw []byte, path string) (*protocol.Probe, error) {
	var o ffprobeOut
	if err := json.Unmarshal(raw, &o); err != nil {
		return nil, err
	}
	p := &protocol.Probe{FormatName: o.Format.FormatName}
	if d, err := strconv.ParseFloat(o.Format.Duration, 64); err == nil {
		p.DurationMs = d * 1000
	}
	if b, err := strconv.ParseFloat(o.Format.BitRate, 64); err == nil {
		p.Bitrate = b
	}
	hasAudio := false
	for _, s := range o.Streams {
		switch s.CodecType {
		case "video":
			if s.Disposition.AttachedPic == 1 || p.Codec != "" {
				continue // cover art or second video stream
			}
			p.Codec, p.Width, p.Height = s.CodecName, s.Width, s.Height
			fps := fraction(s.AvgFrameRate)
			if fps == 0 {
				fps = fraction(s.RFrameRate)
			}
			p.Fps = fps
			for _, sd := range s.SideDataList {
				if sd.Rotation != 0 {
					p.Rotation = sd.Rotation
				}
			}
			if r, err := strconv.ParseFloat(s.Tags["rotate"], 64); err == nil && p.Rotation == 0 {
				p.Rotation = r
			}
			if p.DurationMs == 0 {
				if d, err := strconv.ParseFloat(s.Duration, 64); err == nil {
					p.DurationMs = d * 1000
				}
			}
		case "audio":
			hasAudio = true
			if p.AudioCodec == "" {
				p.AudioCodec = s.CodecName
			}
		}
	}
	p.HasAudio = &hasAudio
	if ct := o.Format.Tags["creation_time"]; ct != "" {
		p.CreationTime = ct
	}
	if m := mime.TypeByExtension("." + ext(path)); m != "" {
		p.Mime = strings.SplitN(m, ";", 2)[0]
	}
	// Keep container tags that identify generator workflows (ComfyUI and friends); the server decides what they mean.
	wf := map[string]interface{}{}
	for k, v := range o.Format.Tags {
		lk := strings.ToLower(k)
		if lk == "encoder" || lk == "comment" || lk == "title" || strings.Contains(lk, "workflow") || strings.Contains(lk, "prompt") {
			if len(v) > 4000 {
				v = v[:4000]
			}
			wf[k] = v
		}
	}
	if len(wf) > 0 {
		p.Workflow = wf
	}
	return p, nil
}

// Probe returns technical metadata. For images it falls back to the Go standard library when ffprobe is absent.
func (t Tools) Probe(ctx context.Context, path string) (*protocol.Probe, error) {
	if t.FFprobe == "" {
		if IsImage(path) {
			return imageProbe(path)
		}
		return nil, errors.New("ffprobe not installed")
	}
	cctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cctx, t.FFprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", "--", scan.LongPath(path))
	hide(cmd)
	var out, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &stderr
	if err := cmd.Run(); err != nil {
		if IsImage(path) {
			if p, ierr := imageProbe(path); ierr == nil {
				return p, nil
			}
		}
		return nil, fmt.Errorf("ffprobe: %v: %s", err, strings.TrimSpace(firstLine(stderr.String())))
	}
	return ParseFFprobe(out.Bytes(), path)
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

func imageProbe(path string) (*protocol.Probe, error) {
	f, err := os.Open(scan.LongPath(path))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	cfg, format, err := image.DecodeConfig(f)
	if err != nil {
		return nil, err
	}
	p := &protocol.Probe{Width: cfg.Width, Height: cfg.Height, Codec: format, FormatName: format}
	if m := mime.TypeByExtension("." + ext(path)); m != "" {
		p.Mime = strings.SplitN(m, ";", 2)[0]
	}
	return p, nil
}

// Thumbnail renders a JPEG preview (max 480px wide). Source files are only read.
func (t Tools) Thumbnail(ctx context.Context, path string, durationMs float64) ([]byte, error) {
	if t.FFmpeg == "" {
		return nil, errors.New("ffmpeg not installed")
	}
	attempts := []string{}
	if IsVideo(path) {
		at := durationMs / 1000 * 0.1
		if at > 10 {
			at = 10
		}
		if at < 0.5 {
			at = 0
		}
		attempts = append(attempts, strconv.FormatFloat(at, 'f', 2, 64), "0")
	} else {
		attempts = append(attempts, "")
	}
	var lastErr error
	for _, ss := range attempts {
		cctx, cancel := context.WithTimeout(ctx, 90*time.Second)
		args := []string{"-v", "error", "-nostdin"}
		if ss != "" {
			args = append(args, "-ss", ss)
		}
		args = append(args, "-i", scan.LongPath(path), "-frames:v", "1", "-vf", "scale='min(480,iw)':-2", "-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "-")
		cmd := exec.CommandContext(cctx, t.FFmpeg, args...)
		hide(cmd)
		var out, stderr bytes.Buffer
		cmd.Stdout, cmd.Stderr = &out, &stderr
		err := cmd.Run()
		cancel()
		if err == nil && out.Len() > 0 {
			return out.Bytes(), nil
		}
		if err != nil {
			lastErr = fmt.Errorf("ffmpeg: %v: %s", err, strings.TrimSpace(firstLine(stderr.String())))
		} else {
			lastErr = errors.New("ffmpeg produced no frame")
		}
	}
	return nil, lastErr
}
