package service

import "fmt"

// SystemdUnit returns a unit file for Linux hosts.
func SystemdUnit(exe, dir string) string {
	return fmt.Sprintf(`[Unit]
Description=Creator OS Scanner Agent
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=%s run
Environment=CREATOROS_AGENT_DIR=%s
Restart=always
RestartSec=10
# read-only access to media is enforced by the agent itself; these add defence in depth
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=%s

[Install]
WantedBy=multi-user.target
`, exe, dir, dir)
}
