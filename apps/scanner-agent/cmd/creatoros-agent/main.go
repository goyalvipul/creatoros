// Command creatoros-agent is the Creator OS scanner agent.
//
//	creatoros-agent pair --server https://host --code ABC123   pair this machine (one-time code from Storage & Devices)
//	creatoros-agent run                                         run in the foreground
//	creatoros-agent install | uninstall | start | stop | status Windows service management (Administrator)
//	creatoros-agent reset-state                                 forget cached scan state (forces re-hash / re-probe)
//	creatoros-agent version
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/creatoros/scanner-agent/internal/agent"
	"github.com/creatoros/scanner-agent/internal/client"
	"github.com/creatoros/scanner-agent/internal/config"
	"github.com/creatoros/scanner-agent/internal/logx"
	"github.com/creatoros/scanner-agent/internal/service"
)

var version = "0.1.0"

func usage() {
	fmt.Fprint(os.Stderr, `Creator OS scanner agent `+version+`

Usage:
  creatoros-agent pair --server <url> --code <code> [--label name] [--listen 0.0.0.0:7755] [--advertise url,url]
  creatoros-agent run
  creatoros-agent install [--account DOMAIN\user --password ...] [--no-firewall]
  creatoros-agent uninstall | start | stop | status
  creatoros-agent reset-state
  creatoros-agent systemd-unit
  creatoros-agent version

Common flag: --dir <data directory> (default `+config.DefaultDir()+`)
`)
}

func main() {
	if len(os.Args) < 2 {
		if service.IsService() {
			os.Args = append(os.Args, "run")
		} else {
			usage()
			os.Exit(2)
		}
	}
	cmd, args := os.Args[1], os.Args[2:]
	var err error
	switch cmd {
	case "pair":
		err = cmdPair(args)
	case "run":
		err = cmdRun(args)
	case "install":
		err = cmdInstall(args)
	case "uninstall":
		err = service.Uninstall()
	case "start":
		err = service.Start()
	case "stop":
		err = service.Stop()
	case "status":
		err = cmdStatus(args)
	case "reset-state":
		err = cmdReset(args)
	case "systemd-unit":
		exe, _ := os.Executable()
		fmt.Print(service.SystemdUnit(exe, config.DefaultDir()))
	case "version", "--version", "-v":
		fmt.Println(version)
	case "help", "--help", "-h":
		usage()
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func dirFlag(fs *flag.FlagSet) *string {
	return fs.String("dir", config.DefaultDir(), "data directory")
}

func cmdPair(args []string) error {
	fs := flag.NewFlagSet("pair", flag.ExitOnError)
	dir := dirFlag(fs)
	server := fs.String("server", "", "Creator OS base URL, e.g. https://creator.tailnet.ts.net")
	code := fs.String("code", "", "one-time pairing code")
	label := fs.String("label", "", "device label")
	listen := fs.String("listen", "", "stream listen address (default 0.0.0.0:7755)")
	adv := fs.String("advertise", "", "comma-separated URLs to report instead of auto-detected ones")
	_ = fs.Parse(args)
	if *server == "" || *code == "" {
		return fmt.Errorf("--server and --code are required")
	}
	cfg, err := config.LoadOrInit(*dir)
	if err != nil {
		return err
	}
	host, _ := os.Hostname()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	out, err := client.Pair(ctx, *server, client.PairInput{
		Code: strings.TrimSpace(*code), DeviceUUID: cfg.DeviceUUID, Hostname: host,
		OS: osName(), AgentVersion: version, Label: *label,
	})
	if err != nil {
		return fmt.Errorf("pairing failed: %w", err)
	}
	cfg.Server = strings.TrimRight(*server, "/")
	cfg.DeviceID, cfg.Token, cfg.SigningKey, cfg.ExpiresAt = out.DeviceID, out.Token, out.SigningKey, out.ExpiresAt
	if *listen != "" {
		cfg.Listen = *listen
	}
	if *adv != "" {
		cfg.Advertise = nil
		for _, u := range strings.Split(*adv, ",") {
			if u = strings.TrimSpace(u); u != "" {
				cfg.Advertise = append(cfg.Advertise, u)
			}
		}
	}
	if err := config.Save(*dir, cfg); err != nil {
		return err
	}
	if err := service.HardenDir(*dir, ""); err != nil {
		fmt.Fprintln(os.Stderr, "warning: could not restrict folder permissions:", err)
	}
	fmt.Printf("Paired with %q as device %s.\nCredentials saved in %s\nNext: `creatoros-agent install` (Windows service) or `creatoros-agent run`.\n", out.OrgName, out.DeviceID, *dir)
	return nil
}

func cmdRun(args []string) error {
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	dir := dirFlag(fs)
	verbose := fs.Bool("verbose", false, "debug logging")
	_ = fs.Parse(args)
	cfg, err := config.Load(*dir)
	if err != nil {
		return fmt.Errorf("cannot read %s (pair first): %w", filepath.Join(*dir, "agent.json"), err)
	}
	level := slog.LevelInfo
	if *verbose {
		level = slog.LevelDebug
	}
	isSvc := service.IsService()
	log, closer := logx.Setup(*dir, !isSvc, level)
	defer closer.Close()
	a := agent.New(*dir, cfg, log, version)
	if isSvc {
		return service.Run(a.Run)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return a.Run(ctx)
}

func cmdInstall(args []string) error {
	fs := flag.NewFlagSet("install", flag.ExitOnError)
	dir := dirFlag(fs)
	account := fs.String("account", "", `run as this account (needed for network shares), e.g. .\creator`)
	password := fs.String("password", "", "password for --account")
	noFW := fs.Bool("no-firewall", false, "do not add a firewall rule")
	_ = fs.Parse(args)
	cfg, err := config.Load(*dir)
	if err != nil || !cfg.Paired() {
		return fmt.Errorf("pair this machine first (creatoros-agent pair ...)")
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if err := service.HardenDir(*dir, *account); err != nil {
		fmt.Fprintln(os.Stderr, "warning:", err)
	}
	if err := service.Install(service.InstallOptions{Exe: exe, Args: []string{"run", "--dir", *dir}, Account: *account, Password: *password}); err != nil {
		return err
	}
	fmt.Println("Service installed (starts automatically, restarts on failure).")
	if !*noFW {
		port := "7755"
		if i := strings.LastIndex(cfg.Listen, ":"); i >= 0 {
			port = cfg.Listen[i+1:]
		}
		if err := service.OpenFirewall(port); err != nil {
			fmt.Fprintln(os.Stderr, "warning: firewall rule not added:", err)
		} else {
			fmt.Printf("Firewall: TCP %s allowed from the local subnet and Tailscale only.\n", port)
		}
	}
	if err := service.Start(); err != nil {
		return fmt.Errorf("installed, but could not start: %w", err)
	}
	fmt.Println("Service started.")
	return nil
}

func cmdStatus(args []string) error {
	fs := flag.NewFlagSet("status", flag.ExitOnError)
	dir := dirFlag(fs)
	_ = fs.Parse(args)
	st, err := service.Status()
	if err != nil {
		return err
	}
	fmt.Println("service:", st)
	if cfg, err := config.Load(*dir); err == nil {
		fmt.Printf("paired: %v  server: %s  device: %s\n", cfg.Paired(), cfg.Server, cfg.DeviceID)
	} else {
		fmt.Println("paired: false")
	}
	return nil
}

func cmdReset(args []string) error {
	fs := flag.NewFlagSet("reset-state", flag.ExitOnError)
	dir := dirFlag(fs)
	_ = fs.Parse(args)
	p := filepath.Join(*dir, "state")
	ents, err := os.ReadDir(p)
	if err != nil {
		return err
	}
	n := 0
	for _, e := range ents {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			if err := os.Remove(filepath.Join(p, e.Name())); err == nil {
				n++
			}
		}
	}
	fmt.Printf("Removed %d cached state file(s). Stop the service before running this; the next scan re-hashes and re-probes everything.\n", n)
	return nil
}
