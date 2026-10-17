//go:build !windows && !linux && !darwin

package scan

import "syscall"

func ctimeMs(st *syscall.Stat_t) float64 { return 0 }
