//go:build !windows

package agent

import "github.com/creatoros/scanner-agent/internal/protocol"

// Older and non-Windows agents still send heartbeats; unsupported hardware is unknown.
func collectHardware() *protocol.HardwareReading { return nil }
