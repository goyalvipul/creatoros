//go:build linux || darwin

package agent

import "syscall"

func diskSpace(path string) (free, total float64) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0
	}
	bs := float64(st.Bsize)
	return float64(st.Bavail) * bs, float64(st.Blocks) * bs
}
