//go:build linux

package scan

import "syscall"

func ctimeMs(st *syscall.Stat_t) float64 {
	return float64(st.Ctim.Sec)*1000 + float64(st.Ctim.Nsec)/1e6
}
