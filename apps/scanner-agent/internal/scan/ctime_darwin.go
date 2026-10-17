//go:build darwin

package scan

import "syscall"

func ctimeMs(st *syscall.Stat_t) float64 {
	return float64(st.Ctimespec.Sec)*1000 + float64(st.Ctimespec.Nsec)/1e6
}
