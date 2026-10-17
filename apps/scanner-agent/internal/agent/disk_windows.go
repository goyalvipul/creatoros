//go:build windows

package agent

import "golang.org/x/sys/windows"

func diskSpace(path string) (free, total float64) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, 0
	}
	var f, t, tf uint64
	if err := windows.GetDiskFreeSpaceEx(p, &f, &t, &tf); err != nil {
		return 0, 0
	}
	return float64(f), float64(t)
}
