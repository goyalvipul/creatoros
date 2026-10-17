package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/creatoros/scanner-agent/internal/client"
	"github.com/creatoros/scanner-agent/internal/protocol"
)

type prov struct {
	roots []protocol.RootConfig
	key   string
}

func (p prov) Roots() []protocol.RootConfig { return p.roots }
func (p prov) SigningKey() string           { return p.key }

const rid = "22222222-2222-4222-8222-222222222222"

func setup(t *testing.T) (*httptest.Server, string, time.Time) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "clip.mp4"), []byte("0123456789"), 0o644); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(filepath.Dir(root), "secret-"+filepath.Base(root)+".txt")
	if err := os.WriteFile(outside, []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Remove(outside) })
	now := time.Now()
	s := &Server{P: prov{roots: []protocol.RootConfig{{RootID: rid, DisplayPath: root, State: "ACTIVE"}}, key: "device-key"}, Now: func() time.Time { return now }}
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return ts, root, now
}

func get(t *testing.T, ts *httptest.Server, path, key string, exp int64, rng string) *http.Response {
	t.Helper()
	q := url.Values{"root": {rid}, "path": {path}, "exp": {strconv.FormatInt(exp, 10)}, "sig": {client.SignFetch(key, rid, path, exp)}}
	req, _ := http.NewRequest("GET", ts.URL+"/v1/stream?"+q.Encode(), nil)
	if rng != "" {
		req.Header.Set("Range", rng)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res
}

func TestStreamRangeAndAuth(t *testing.T) {
	ts, root, now := setup(t)
	p := filepath.Join(root, "clip.mp4")
	exp := now.Add(2 * time.Minute).Unix()

	res := get(t, ts, p, "device-key", exp, "")
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != 200 || string(body) != "0123456789" || res.Header.Get("Accept-Ranges") != "bytes" {
		t.Fatalf("full read failed: %d %q", res.StatusCode, body)
	}
	res = get(t, ts, p, "device-key", exp, "bytes=2-5")
	body, _ = io.ReadAll(res.Body)
	if res.StatusCode != 206 || string(body) != "2345" || res.Header.Get("Content-Range") != "bytes 2-5/10" {
		t.Fatalf("range failed: %d %q %q", res.StatusCode, body, res.Header.Get("Content-Range"))
	}
	if res := get(t, ts, p, "wrong-key", exp, ""); res.StatusCode != 403 {
		t.Errorf("bad signature must be 403, got %d", res.StatusCode)
	}
	if res := get(t, ts, p, "device-key", now.Add(-time.Second).Unix(), ""); res.StatusCode != 403 {
		t.Errorf("expired link must be 403, got %d", res.StatusCode)
	}
	if res := get(t, ts, p, "device-key", now.Add(5*time.Hour).Unix(), ""); res.StatusCode != 403 {
		t.Errorf("over-long validity must be 403, got %d", res.StatusCode)
	}
	if res := get(t, ts, filepath.Join(root, "missing.mp4"), "device-key", exp, ""); res.StatusCode != 404 {
		t.Errorf("missing file must be 404, got %d", res.StatusCode)
	}
}

func TestStreamPathEscapes(t *testing.T) {
	ts, root, now := setup(t)
	exp := now.Add(time.Minute).Unix()
	outside := filepath.Join(filepath.Dir(root), "secret-"+filepath.Base(root)+".txt")
	for _, p := range []string{
		outside,
		filepath.Join(root, "..", filepath.Base(outside)),
		root + "-sibling" + string(filepath.Separator) + "clip.mp4", // prefix trick
		"clip.mp4", // relative
	} {
		if res := get(t, ts, p, "device-key", exp, ""); res.StatusCode != 403 {
			t.Errorf("path %q must be refused (403), got %d", p, res.StatusCode)
		}
	}
	// unknown root
	q := url.Values{"root": {"33333333-3333-4333-8333-333333333333"}, "path": {filepath.Join(root, "clip.mp4")}, "exp": {strconv.FormatInt(exp, 10)}}
	q.Set("sig", client.SignFetch("device-key", "33333333-3333-4333-8333-333333333333", filepath.Join(root, "clip.mp4"), exp))
	res, _ := http.Get(ts.URL + "/v1/stream?" + q.Encode())
	if res.StatusCode != 403 {
		t.Errorf("ungranted root must be 403, got %d", res.StatusCode)
	}
}

func TestStreamSymlinkEscape(t *testing.T) {
	ts, root, now := setup(t)
	outside := filepath.Join(filepath.Dir(root), "secret-"+filepath.Base(root)+".txt")
	link := filepath.Join(root, "link.mp4")
	if err := os.Symlink(outside, link); err != nil {
		t.Skip("symlinks not permitted on this machine:", err)
	}
	if res := get(t, ts, link, "device-key", now.Add(time.Minute).Unix(), ""); res.StatusCode != 403 {
		t.Errorf("symlink escaping the root must be refused, got %d", res.StatusCode)
	}
}

func TestInsideRoot(t *testing.T) {
	root := filepath.Join(os.TempDir(), "media")
	if !InsideRoot(root, filepath.Join(root, "a", "b.mp4")) || !InsideRoot(root, root) {
		t.Error("children should be inside")
	}
	if InsideRoot(root, root+"2") || InsideRoot(root, filepath.Dir(root)) {
		t.Error("siblings/parents must be outside")
	}
}

func TestHealth(t *testing.T) {
	ts, _, _ := setup(t)
	res, err := http.Get(ts.URL + "/v1/health")
	if err != nil || res.StatusCode != 200 {
		t.Fatal(err, res)
	}
}
