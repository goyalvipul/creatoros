//go:build !windows

package scan

import (
	"fmt"
	"io/fs"
	"os"
	"syscall"
)

func LongPath(p string) string { return p }

func platformInfo(path string, info fs.FileInfo) (string, float64) {
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return "", 0
	}
	return fmt.Sprintf("%x-%x", uint64(st.Dev), uint64(st.Ino)), ctimeMs(st)
}

func isSharingViolation(err error) bool { return false }

func openProbeExclusive(path string) error { return nil }

func openFile(path string) (*os.File, error) { return os.Open(path) }
