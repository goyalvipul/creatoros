// Package logx provides a size-rotated log file (agent.log, agent.log.1) so a 24/7 service never fills the disk.
package logx

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
)

const maxBytes = 10 << 20

type rotator struct {
	mu   sync.Mutex
	path string
	f    *os.File
	size int64
}

func (r *rotator) open() error {
	f, err := os.OpenFile(r.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	st, _ := f.Stat()
	r.f = f
	if st != nil {
		r.size = st.Size()
	}
	return nil
}

func (r *rotator) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.f == nil {
		return len(p), nil
	}
	if r.size+int64(len(p)) > maxBytes {
		_ = r.f.Close()
		_ = os.Remove(r.path + ".1")
		_ = os.Rename(r.path, r.path+".1")
		if err := r.open(); err != nil {
			r.f = nil
			return len(p), nil
		}
	}
	n, err := r.f.Write(p)
	r.size += int64(n)
	return n, err
}

func (r *rotator) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.f != nil {
		return r.f.Close()
	}
	return nil
}

// Setup returns a JSON logger writing to dir/agent.log, and to stderr when interactive.
func Setup(dir string, interactive bool, level slog.Level) (*slog.Logger, io.Closer) {
	_ = os.MkdirAll(dir, 0o700)
	r := &rotator{path: filepath.Join(dir, "agent.log")}
	var w io.Writer = r
	if err := r.open(); err != nil {
		r.f = nil
		w = os.Stderr
	} else if interactive {
		w = io.MultiWriter(r, os.Stderr)
	}
	return slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: level})), r
}
