//go:build !windows

package service

import (
	"context"
	"errors"
)

const Name = "creatoros-agent"

func IsService() bool { return false }

func Run(fn func(ctx context.Context) error) error { return errors.New("not a windows service") }

type InstallOptions struct {
	Exe      string
	Args     []string
	Account  string
	Password string
}

var errWindows = errors.New("service management is Windows-only; on Linux use the systemd unit printed by `creatoros-agent systemd-unit`")

func Install(InstallOptions) error  { return errWindows }
func Uninstall() error              { return errWindows }
func Start() error                  { return errWindows }
func Stop() error                   { return errWindows }
func Status() (string, error)       { return "", errWindows }
func HardenDir(string, string) error { return nil }
func OpenFirewall(string) error     { return nil }

