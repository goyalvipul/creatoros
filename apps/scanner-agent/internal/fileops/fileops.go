// Package fileops is the only place the agent changes an original file.
// It renames, moves, or deletes one regular file after the owner confirmed that exact path.
// The path has to stay inside a folder this agent is already allowed to index.
// It does not run a shell, follow a link out of that folder, or replace a file that is already there.
package fileops

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"

	"github.com/creatoros/scanner-agent/internal/protocol"
	"github.com/creatoros/scanner-agent/internal/server"
)

// Apply performs one confirmed change. A delete of a file that is already gone,
// or a rename whose destination is already in place, is treated as done.
func Apply(roots []protocol.RootConfig, kind, from, to string, size int64) error {
	kind = strings.ToUpper(strings.TrimSpace(kind))
	from = filepath.Clean(from)
	if !filepath.IsAbs(from) || rootFor(roots, from) == nil {
		return errors.New("that file is outside the folders this PC is indexing")
	}
	if kind != "DELETE" && kind != "RENAME" && kind != "MOVE" {
		return errors.New("unknown file change")
	}

	info, err := os.Lstat(from)
	if errors.Is(err, os.ErrNotExist) {
		if kind == "DELETE" {
			return nil
		}
		return alreadyMoved(roots, to)
	}
	if err != nil {
		return friendly(err)
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return errors.New("Creator OS will not change a shortcut or link")
	}
	if !info.Mode().IsRegular() {
		return errors.New("only a file can be renamed, moved, or deleted")
	}
	resolved, err := filepath.EvalSymlinks(from)
	if err != nil || rootFor(roots, resolved) == nil {
		return errors.New("that path points outside an indexed folder")
	}
	if size >= 0 && info.Size() != size {
		return errors.New("the file changed size, so it was left untouched")
	}
	if kind == "DELETE" {
		if err := os.Remove(resolved); err != nil {
			return friendly(err)
		}
		return nil
	}

	to = filepath.Clean(to)
	if !filepath.IsAbs(to) || rootFor(roots, to) == nil {
		return errors.New("that folder is outside the folders this PC is indexing")
	}
	if samePath(from, to) {
		return errors.New("that is already the file path")
	}
	parent, err := resolvedDir(filepath.Dir(to))
	if err != nil {
		return err
	}
	dest := filepath.Join(parent, filepath.Base(to))
	if rootFor(roots, dest) == nil {
		return errors.New("that folder is outside the folders this PC is indexing")
	}
	if _, err := os.Lstat(dest); err == nil {
		return errors.New("a file is already at that path")
	} else if !errors.Is(err, os.ErrNotExist) {
		return friendly(err)
	}
	if err := os.Rename(resolved, dest); err != nil {
		if errors.Is(err, syscall.EXDEV) {
			return errors.New("that folder is on a different drive. Move the file on the same drive")
		}
		return friendly(err)
	}
	return nil
}

func alreadyMoved(roots []protocol.RootConfig, to string) error {
	to = filepath.Clean(to)
	if to == "" || to == "." || !filepath.IsAbs(to) || rootFor(roots, to) == nil {
		return errors.New("the file is not there")
	}
	info, err := os.Lstat(to)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("the file is not there")
	}
	return nil
}

func resolvedDir(dir string) (string, error) {
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("that folder does not exist on this PC")
	}
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return "", errors.New("that folder does not exist on this PC")
	}
	st, err := os.Stat(resolved)
	if err != nil || !st.IsDir() {
		return "", errors.New("that folder does not exist on this PC")
	}
	return resolved, nil
}

func rootFor(roots []protocol.RootConfig, p string) *protocol.RootConfig {
	var best *protocol.RootConfig
	bestLen := -1
	for i := range roots {
		rc := roots[i]
		if rc.State != "" && rc.State != "ACTIVE" {
			continue
		}
		if server.InsideRoot(rc.DisplayPath, p) && len(filepath.Clean(rc.DisplayPath)) > bestLen {
			c := rc
			best = &c
			bestLen = len(filepath.Clean(rc.DisplayPath))
		}
	}
	return best
}

func samePath(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if a == b {
		return true
	}
	return runtime.GOOS == "windows" && strings.EqualFold(a, b)
}

func friendly(err error) error {
	if errors.Is(err, syscall.EACCES) || errors.Is(err, syscall.EPERM) || isDeny(err) {
		return errors.New("this PC refused to change the file. The agent needs permission to change that folder")
	}
	var pathErr *fs.PathError
	if errors.As(err, &pathErr) && pathErr.Err != nil {
		return fmt.Errorf("this PC could not change the file: %s", pathErr.Err.Error())
	}
	return fmt.Errorf("this PC could not change the file: %s", err.Error())
}

func isDeny(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "access is denied") || strings.Contains(msg, "permission denied")
}
