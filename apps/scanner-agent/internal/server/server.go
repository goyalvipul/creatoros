// Package server is the agent's small inbound HTTP surface. The API streams original files to the owner's
// browser, and receives one owner-chosen upload into a folder this agent already indexes. Both require a
// short-lived HMAC signature. Scanning never writes. Upload creates one new file and does not overwrite.
package server

import (
	"crypto/hmac"
	"encoding/json"
	"errors"
	"io"
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

// An owner upload is one new file. It is not an edit of a file already on disk.
const maxUploadBytes = 4 << 30

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
	mux.HandleFunc("/v1/upload", s.upload)
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

// signedPath checks the HMAC and that the path stays inside the granted root. The file itself may not exist yet.
func (s *Server) signedPath(r *http.Request) (*protocol.RootConfig, string, int, string) {
	q := r.URL.Query()
	rootID, path, expS, sig := q.Get("root"), q.Get("path"), q.Get("exp"), q.Get("sig")
	exp, err := strconv.ParseInt(expS, 10, 64)
	if err != nil || rootID == "" || path == "" || sig == "" || strings.ContainsRune(path, 0) {
		return nil, "", http.StatusBadRequest, "bad request"
	}
	now := s.now().Unix()
	if exp < now {
		return nil, "", http.StatusForbidden, "link expired"
	}
	if exp > now+3600 {
		return nil, "", http.StatusForbidden, "link validity too long"
	}
	key := s.P.SigningKey()
	if key == "" {
		return nil, "", http.StatusServiceUnavailable, "agent not paired"
	}
	want := client.SignFetch(key, rootID, path, exp)
	if !hmac.Equal([]byte(want), []byte(strings.ToLower(sig))) {
		return nil, "", http.StatusForbidden, "bad signature"
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
		return nil, "", http.StatusForbidden, "root not granted"
	}
	clean := filepath.Clean(path)
	if !filepath.IsAbs(clean) || !InsideRoot(root.DisplayPath, clean) || clean == filepath.Clean(root.DisplayPath) {
		return nil, "", http.StatusForbidden, "path outside root"
	}
	return root, clean, 0, ""
}

func (s *Server) stream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		fail(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	root, clean, code, msg := s.signedPath(r)
	if code != 0 {
		fail(w, code, msg)
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

// upload writes one new file inside a granted root. A partial write stays as name.ext.part, which scans ignore.
func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		fail(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	root, clean, code, msg := s.signedPath(r)
	if code != 0 {
		fail(w, code, msg)
		return
	}
	length := r.ContentLength
	if length < 0 {
		fail(w, http.StatusLengthRequired, "say how large the file is")
		return
	}
	if length == 0 || length > maxUploadBytes {
		fail(w, http.StatusRequestEntityTooLarge, "file is empty or larger than 4 GB")
		return
	}
	parent := filepath.Dir(clean)
	realRoot, err1 := filepath.EvalSymlinks(scan.LongPath(root.DisplayPath))
	realParent, err2 := filepath.EvalSymlinks(scan.LongPath(parent))
	if err1 != nil || err2 != nil {
		fail(w, http.StatusBadRequest, "folder is not on this PC")
		return
	}
	if !InsideRoot(strings.TrimPrefix(realRoot, `\\?\`), strings.TrimPrefix(realParent, `\\?\`)) {
		fail(w, http.StatusForbidden, "path outside root")
		return
	}
	if st, err := os.Lstat(scan.LongPath(clean)); err == nil && st.Mode()&os.ModeSymlink != 0 {
		fail(w, http.StatusForbidden, "refusing to follow a link")
		return
	} else if err == nil {
		fail(w, http.StatusConflict, "a file with this name is already in that folder")
		return
	} else if !errors.Is(err, fs.ErrNotExist) {
		fail(w, http.StatusInternalServerError, "cannot check the destination")
		return
	}
	part := clean + ".part"
	f, err := os.OpenFile(scan.LongPath(part), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		if errors.Is(err, fs.ErrExist) {
			fail(w, http.StatusConflict, "a previous upload of this name did not finish")
			return
		}
		fail(w, http.StatusInternalServerError, "cannot create the file")
		return
	}
	ok := false
	defer func() {
		f.Close()
		if !ok {
			os.Remove(scan.LongPath(part))
		}
	}()
	n, err := io.Copy(f, io.LimitReader(r.Body, length))
	if err != nil || n != length {
		fail(w, http.StatusBadRequest, "upload stopped before the whole file arrived")
		return
	}
	if err := f.Close(); err != nil {
		fail(w, http.StatusInternalServerError, "cannot finish the file")
		return
	}
	if err := os.Rename(scan.LongPath(part), scan.LongPath(clean)); err != nil {
		fail(w, http.StatusConflict, "could not place the file; the name may already exist")
		return
	}
	ok = true
	w.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "size": n, "path": clean})
}
