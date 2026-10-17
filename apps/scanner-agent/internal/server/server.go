// Package server is the agent's small inbound HTTP surface used by the Creator OS API to stream original files
// (with Range support) to the owner's browser. It is read-only and only serves files that are inside a granted
// storage root, and only for requests carrying a short-lived HMAC signature issued by the API.
package server

import (
	"crypto/hmac"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/creatoros/scanner-agent/internal/client"
	"github.com/creatoros/scanner-agent/internal/protocol"
	"github.com/creatoros/scanner-agent/internal/scan"
)

type Provider interface {
	Roots() []protocol.RootConfig
	SigningKey() string
}

type Server struct {
	P       Provider
	Log     *slog.Logger
	Version string
	Now     func() time.Time
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "version": s.Version, "protocol": protocol.Version})
	})
	mux.HandleFunc("/v1/stream", s.stream)
	return mux
}

func (s *Server) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func fail(w http.ResponseWriter, code int, msg string) {
	http.Error(w, msg, code)
}

// InsideRoot reports whether p is root or below it (case-insensitive on Windows).
func InsideRoot(root, p string) bool {
	root, p = filepath.Clean(root), filepath.Clean(p)
	if runtime.GOOS == "windows" {
		root, p = strings.ToLower(root), strings.ToLower(p)
	}
	if p == root {
		return true
	}
	sep := string(filepath.Separator)
	if !strings.HasSuffix(root, sep) {
		root += sep
	}
	return strings.HasPrefix(p, root)
}

func (s *Server) stream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		fail(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	q := r.URL.Query()
	rootID, path, expS, sig := q.Get("root"), q.Get("path"), q.Get("exp"), q.Get("sig")
	exp, err := strconv.ParseInt(expS, 10, 64)
	if err != nil || rootID == "" || path == "" || sig == "" || strings.ContainsRune(path, 0) {
		fail(w, http.StatusBadRequest, "bad request")
		return
	}
	now := s.now().Unix()
	if exp < now {
		fail(w, http.StatusForbidden, "link expired")
		return
	}
	if exp > now+3600 {
		fail(w, http.StatusForbidden, "link validity too long")
		return
	}
	key := s.P.SigningKey()
	if key == "" {
		fail(w, http.StatusServiceUnavailable, "agent not paired")
		return
	}
	want := client.SignFetch(key, rootID, path, exp)
	if !hmac.Equal([]byte(want), []byte(strings.ToLower(sig))) {
		fail(w, http.StatusForbidden, "bad signature")
		return
	}
	var root *protocol.RootConfig
	for _, rc := range s.P.Roots() {
		if rc.RootID == rootID {
			c := rc
			root = &c
			break
		}
	}
	if root == nil || root.State == "RETIRED" {
		fail(w, http.StatusForbidden, "root not granted")
		return
	}
	clean := filepath.Clean(path)
	if !filepath.IsAbs(clean) || !InsideRoot(root.DisplayPath, clean) {
		fail(w, http.StatusForbidden, "path outside root")
		return
	}
	// Resolve symlinks/junctions and make sure we did not escape the root (unless the root explicitly follows links).
	if !root.FollowLinks {
		realRoot, err1 := filepath.EvalSymlinks(scan.LongPath(root.DisplayPath))
		realFile, err2 := filepath.EvalSymlinks(scan.LongPath(clean))
		if err1 != nil || err2 != nil {
			fail(w, http.StatusNotFound, "not found")
			return
		}
		if !InsideRoot(strings.TrimPrefix(realRoot, `\\?\`), strings.TrimPrefix(realFile, `\\?\`)) {
			fail(w, http.StatusForbidden, "path outside root")
			return
		}
	}
	f, err := os.Open(scan.LongPath(clean))
	if err != nil {
		switch {
		case errors.Is(err, fs.ErrNotExist):
			fail(w, http.StatusNotFound, "not found")
		case errors.Is(err, fs.ErrPermission):
			fail(w, http.StatusForbidden, "permission denied")
		default:
			fail(w, http.StatusInternalServerError, "cannot open file")
		}
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		fail(w, http.StatusNotFound, "not a file")
		return
	}
	ct := mime.TypeByExtension(strings.ToLower(filepath.Ext(clean)))
	if ct == "" {
		ct = "application/octet-stream"
	}
	w.Header().Set("content-type", ct)
	w.Header().Set("cache-control", "private, no-store")
	w.Header().Set("x-content-type-options", "nosniff")
	http.ServeContent(w, r, filepath.Base(clean), st.ModTime(), f)
}
