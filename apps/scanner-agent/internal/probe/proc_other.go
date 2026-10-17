//go:build !windows

package probe

import "os/exec"

func hide(cmd *exec.Cmd) {}
