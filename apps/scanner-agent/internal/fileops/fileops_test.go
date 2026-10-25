package fileops

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/creatoros/scanner-agent/internal/protocol"
)

func roots(dir string) []protocol.RootConfig {
	return []protocol.RootConfig{{RootID: "r", DisplayPath: dir, State: "ACTIVE"}}
}

func writeFile(t *testing.T, p, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestRenameMoveDelete(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "Upscale", "clip.mp4")
	writeFile(t, src, "video")
	renamed := filepath.Join(dir, "Upscale", "ayi-ayi.mp4")
	if err := Apply(roots(dir), "RENAME", src, renamed, int64(len("video"))); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(renamed); err != nil {
		t.Fatal(err)
	}
	moved := filepath.Join(dir, "Final", "ayi-ayi.mp4")
	if err := os.MkdirAll(filepath.Dir(moved), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := Apply(roots(dir), "MOVE", renamed, moved, int64(len("video"))); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "Upscale", "ayi-ayi.mp4")); !os.IsNotExist(err) {
		t.Fatal("source should be gone")
	}
	if err := Apply(roots(dir), "DELETE", moved, "", int64(len("video"))); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(moved); !os.IsNotExist(err) {
		t.Fatal("deleted file should be gone")
	}
	if err := Apply(roots(dir), "DELETE", moved, "", 0); err != nil {
		t.Fatal("deleting a file that is already gone should succeed")
	}
}

func TestRefusesEscapeOverwriteAndSize(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "clip.mp4")
	writeFile(t, src, "video")
	outside := filepath.Join(t.TempDir(), "elsewhere.mp4")
	if err := Apply(roots(dir), "MOVE", src, outside, int64(len("video"))); err == nil {
		t.Fatal("move outside the root must fail")
	}
	if _, err := os.Stat(src); err != nil {
		t.Fatal("failed move must leave the file")
	}
	other := filepath.Join(dir, "other.mp4")
	writeFile(t, other, "taken")
	if err := Apply(roots(dir), "RENAME", src, other, int64(len("video"))); err == nil {
		t.Fatal("overwrite must fail")
	}
	if err := Apply(roots(dir), "DELETE", src, "", 999); err == nil {
		t.Fatal("size mismatch must fail")
	}
	if _, err := os.Stat(src); err != nil {
		t.Fatal("refused delete must leave the file")
	}
	if runtime.GOOS != "windows" {
		link := filepath.Join(dir, "link.mp4")
		if err := os.Symlink(src, link); err == nil {
			if err := Apply(roots(dir), "DELETE", link, "", int64(len("video"))); err == nil {
				t.Fatal("symlink must be refused")
			}
			if _, err := os.Stat(src); err != nil {
				t.Fatal("refusing a link must not delete the target")
			}
		}
	}
}
