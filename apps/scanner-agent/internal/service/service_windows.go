//go:build windows

// Package service installs and runs the agent as a Windows service that starts at boot and restarts on failure.
package service

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"time"

	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

const Name = "CreatorOSAgent"

func IsService() bool {
	ok, err := svc.IsWindowsService()
	return err == nil && ok
}

type handler struct {
	run func(ctx context.Context) error
}

func (h *handler) Execute(args []string, r <-chan svc.ChangeRequest, s chan<- svc.Status) (bool, uint32) {
	const accepted = svc.AcceptStop | svc.AcceptShutdown
	s <- svc.Status{State: svc.StartPending}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- h.run(ctx) }()
	s <- svc.Status{State: svc.Running, Accepts: accepted}
	for {
		select {
		case err := <-done:
			if err != nil {
				return true, 1
			}
			return false, 0
		case c := <-r:
			switch c.Cmd {
			case svc.Interrogate:
				s <- c.CurrentStatus
			case svc.Stop, svc.Shutdown:
				s <- svc.Status{State: svc.StopPending, WaitHint: 30000}
				cancel()
				select {
				case <-done:
				case <-time.After(25 * time.Second):
				}
				return false, 0
			}
		}
	}
}

// Run executes fn under the service control manager.
func Run(fn func(ctx context.Context) error) error {
	return svc.Run(Name, &handler{run: fn})
}

type InstallOptions struct {
	Exe      string
	Args     []string
	Account  string // empty = LocalSystem
	Password string
}

func Install(o InstallOptions) error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("cannot connect to the service manager (run from an elevated/Administrator prompt): %w", err)
	}
	defer m.Disconnect()
	if s, err := m.OpenService(Name); err == nil {
		s.Close()
		return errors.New("service already installed; run `uninstall` first")
	}
	s, err := m.CreateService(Name, o.Exe, mgr.Config{
		DisplayName:      "Creator OS Scanner Agent",
		Description:      "Indexes creator media folders (read-only) and serves signed streams to Creator OS.",
		StartType:        mgr.StartAutomatic,
		DelayedAutoStart: true,
		ServiceStartName: o.Account,
		Password:         o.Password,
	}, o.Args...)
	if err != nil {
		return err
	}
	defer s.Close()
	_ = s.SetRecoveryActions([]mgr.RecoveryAction{
		{Type: mgr.ServiceRestart, Delay: 5 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 30 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 60 * time.Second},
	}, 86400)
	return nil
}

func Uninstall() error {
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	s, err := m.OpenService(Name)
	if err != nil {
		return errors.New("service is not installed")
	}
	defer s.Close()
	_, _ = s.Control(svc.Stop)
	return s.Delete()
}

func Start() error {
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	s, err := m.OpenService(Name)
	if err != nil {
		return errors.New("service is not installed")
	}
	defer s.Close()
	return s.Start()
}

func Stop() error {
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	s, err := m.OpenService(Name)
	if err != nil {
		return errors.New("service is not installed")
	}
	defer s.Close()
	_, err = s.Control(svc.Stop)
	return err
}

func Status() (string, error) {
	m, err := mgr.Connect()
	if err != nil {
		return "", err
	}
	defer m.Disconnect()
	s, err := m.OpenService(Name)
	if err != nil {
		return "not installed", nil
	}
	defer s.Close()
	st, err := s.Query()
	if err != nil {
		return "", err
	}
	names := map[svc.State]string{svc.Stopped: "stopped", svc.StartPending: "starting", svc.StopPending: "stopping", svc.Running: "running", svc.Paused: "paused"}
	if n, ok := names[st.State]; ok {
		return n, nil
	}
	return fmt.Sprintf("state %d", st.State), nil
}

// HardenDir restricts the data directory (it holds the device signing key) to SYSTEM, Administrators and the service account.
func HardenDir(dir, account string) error {
	args := []string{dir, "/inheritance:r", "/grant:r", "SYSTEM:(OI)(CI)F", "Administrators:(OI)(CI)F"}
	if account != "" {
		args = append(args, account+":(OI)(CI)F")
	}
	out, err := exec.Command("icacls", args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("icacls: %v: %s", err, out)
	}
	return nil
}

// OpenFirewall allows the stream port from the local subnet and Tailscale only.
func OpenFirewall(port string) error {
	_ = exec.Command("netsh", "advfirewall", "firewall", "delete", "rule", "name=Creator OS Agent").Run()
	out, err := exec.Command("netsh", "advfirewall", "firewall", "add", "rule", "name=Creator OS Agent", "dir=in", "action=allow", "protocol=TCP",
		"localport="+port, "remoteip=LocalSubnet,100.64.0.0/10", "profile=any").CombinedOutput()
	if err != nil {
		return fmt.Errorf("netsh: %v: %s", err, out)
	}
	return nil
}
