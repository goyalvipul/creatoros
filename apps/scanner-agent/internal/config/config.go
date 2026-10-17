// Package config stores the agent's local identity and settings.
package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

type Config struct {
	Server     string `json:"server"`
	DeviceUUID string `json:"deviceUuid"`
	DeviceID   string `json:"deviceId,omitempty"`
	Token      string `json:"token,omitempty"`
	SigningKey string `json:"signingKey,omitempty"`
	ExpiresAt  string `json:"tokenExpiresAt,omitempty"`
	Listen     string `json:"listen"`
	// Advertise lets you override the URLs reported to the server (e.g. a fixed LAN name).
	Advertise []string `json:"advertise,omitempty"`
	// Binaries (optional): full paths if ffmpeg/ffprobe are not on PATH.
	FFmpeg  string `json:"ffmpeg,omitempty"`
	FFprobe string `json:"ffprobe,omitempty"`
}

func (c *Config) Paired() bool { return c.Token != "" && c.SigningKey != "" }

// DefaultDir returns the per-machine data directory.
func DefaultDir() string {
	if v := os.Getenv("CREATOROS_AGENT_DIR"); v != "" {
		return v
	}
	if runtime.GOOS == "windows" {
		pd := os.Getenv("ProgramData")
		if pd == "" {
			pd = `C:\ProgramData`
		}
		return filepath.Join(pd, "CreatorOS", "agent")
	}
	if os.Geteuid() == 0 {
		return "/var/lib/creatoros-agent"
	}
	home, _ := os.UserConfigDir()
	return filepath.Join(home, "creatoros-agent")
}

func path(dir string) string { return filepath.Join(dir, "agent.json") }

func Load(dir string) (*Config, error) {
	b, err := os.ReadFile(path(dir))
	if err != nil {
		return nil, err
	}
	var c Config
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, fmt.Errorf("agent.json is corrupted: %w", err)
	}
	if c.Listen == "" {
		c.Listen = "0.0.0.0:7755"
	}
	return &c, nil
}

// LoadOrInit returns the existing config or a new unpaired one with a fresh device UUID.
func LoadOrInit(dir string) (*Config, error) {
	c, err := Load(dir)
	if err == nil {
		return c, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	id, err := newUUID()
	if err != nil {
		return nil, err
	}
	return &Config{DeviceUUID: id, Listen: "0.0.0.0:7755"}, nil
}

// Save writes atomically with owner-only permissions (the file holds the device signing key).
func Save(dir string, c *Config) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	tmp := path(dir) + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path(dir))
}

func newUUID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	h := hex.EncodeToString(b[:])
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:], nil
}

// NewUUID is exported for run ids.
func NewUUID() string {
	id, err := newUUID()
	if err != nil {
		panic(err)
	}
	return id
}
