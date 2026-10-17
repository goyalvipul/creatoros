//go:build !windows && !linux && !darwin

package agent

func diskSpace(path string) (free, total float64) { return 0, 0 }
