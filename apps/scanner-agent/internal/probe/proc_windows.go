//go:build windows

package probe

import (
	"os/exec"
	"syscall"
)

// hide stops child processes from flashing console windows.
func hide(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}
