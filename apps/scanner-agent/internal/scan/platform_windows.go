//go:build windows

package scan

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/sys/windows"
)

// LongPath adds the extended-length prefix so paths > 260 chars work.
func LongPath(p string) string {
	if len(p) < 240 || strings.HasPrefix(p, `\\?\`) {
		return p
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return p
	}
	if strings.HasPrefix(abs, `\\`) {
		return `\\?\UNC\` + abs[2:]
	}
	return `\\?\` + abs
}

// platformInfo returns the NTFS file index (stable across renames on the same volume) and creation time.
func platformInfo(path string, info fs.FileInfo) (string, float64) {
	var ctime float64
	if d, ok := info.Sys().(*syscall.Win32FileAttributeData); ok {
		ctime = float64(d.CreationTime.Nanoseconds()/1e6) // FILETIME ns since unix epoch
	}
	p, err := windows.UTF16PtrFromString(LongPath(path))
	if err != nil {
		return "", ctime
	}
	h, err := windows.CreateFile(p, 0, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		return "", ctime
	}
	defer windows.CloseHandle(h)
	var fi windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(h, &fi); err != nil {
		return "", ctime
	}
	return fmt.Sprintf("%x-%x%08x", fi.VolumeSerialNumber, fi.FileIndexHigh, fi.FileIndexLow), ctime
}

// isSharingViolation: another process holds the file open without allowing readers.
func isSharingViolation(err error) bool {
	return errors.Is(err, syscall.Errno(32)) || errors.Is(err, syscall.Errno(33))
}

// openProbeExclusive tries to open the file denying other writers. If a writer has it open the call fails
// with a sharing violation, which is a strong "still being written" signal (copy in progress, export in progress).
func openProbeExclusive(path string) error {
	p, err := windows.UTF16PtrFromString(LongPath(path))
	if err != nil {
		return err
	}
	h, err := windows.CreateFile(p, windows.GENERIC_READ, windows.FILE_SHARE_READ, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return err
	}
	return windows.CloseHandle(h)
}

func openFile(path string) (*os.File, error) { return os.Open(LongPath(path)) }
