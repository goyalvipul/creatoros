package scan

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Entry is what the agent remembers about one file between scans.
type Entry struct {
	Size   int64   `json:"s"`
	Mtime  float64 `json:"m"`
	Stable int     `json:"b"`
	Sig    string  `json:"q,omitempty"`
	FileID string  `json:"i,omitempty"`
	Hashed bool    `json:"h,omitempty"`
	Probed bool    `json:"p,omitempty"`
	Thumb  bool    `json:"t,omitempty"`
}

type State struct {
	mu       sync.Mutex
	path     string
	Files    map[string]*Entry `json:"files"`
	LastScan time.Time         `json:"lastScan"`
	LastFull time.Time         `json:"lastFull"`
}

// LoadState reads (or creates) the state file for a root.
func LoadState(dir, rootID string) (*State, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &State{path: filepath.Join(dir, rootID+".json"), Files: map[string]*Entry{}}
	b, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, s); err != nil {
		// A corrupt cache is harmless: it only costs a re-scan.
		s.Files = map[string]*Entry{}
		return s, nil
	}
	if s.Files == nil {
		s.Files = map[string]*Entry{}
	}
	return s, nil
}

func (s *State) Save() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *State) Get(p string) (*Entry, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.Files[p]
	return e, ok
}

func (s *State) Put(p string, e *Entry) {
	s.mu.Lock()
	s.Files[p] = e
	s.mu.Unlock()
}

// Update mutates an entry under the lock.
func (s *State) Update(p string, fn func(e *Entry)) {
	s.mu.Lock()
	if e, ok := s.Files[p]; ok {
		fn(e)
	}
	s.mu.Unlock()
}

// Reset forgets hash/probe/thumbnail flags so the next pass re-sends them (used on RECONCILE).
func (s *State) ResetEnrichment() {
	s.mu.Lock()
	for _, e := range s.Files {
		e.Hashed, e.Probed, e.Thumb = false, false, false
	}
	s.mu.Unlock()
}

// Snapshot returns a copy of path->entry for iteration without holding the lock.
func (s *State) Snapshot() map[string]Entry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]Entry, len(s.Files))
	for k, v := range s.Files {
		out[k] = *v
	}
	return out
}

func (s *State) Prune(keep map[string]struct{}) {
	s.mu.Lock()
	for k := range s.Files {
		if _, ok := keep[k]; !ok {
			delete(s.Files, k)
		}
	}
	s.mu.Unlock()
}
