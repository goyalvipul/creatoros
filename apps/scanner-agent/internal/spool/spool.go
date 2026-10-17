// Package spool is the agent's durable outbound queue. Every batch is written to disk (atomic rename) before the
// scanner moves on, and is only deleted after the server acknowledged it. A crash, reboot or a week without network
// therefore never loses observations; batches are replayed in order and the server de-duplicates by event id.
package spool

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

const MaxItems = 50000

var ErrFull = errors.New("spool is full")

type Item struct {
	Name   string          `json:"-"`
	RootID string          `json:"rootId"`
	Path   string          `json:"path"` // API path, e.g. /agents/ingest
	Body   json.RawMessage `json:"body"`
}

type Spool struct {
	dir     string
	mu      sync.Mutex
	names   []string
	roots   map[string]string // name -> rootId
	counter int64
	notify  chan struct{}
}

func Open(dir string) (*Spool, error) {
	if err := os.MkdirAll(filepath.Join(dir, "dead"), 0o700); err != nil {
		return nil, err
	}
	s := &Spool{dir: dir, roots: map[string]string{}, notify: make(chan struct{}, 1)}
	ents, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	for _, e := range ents {
		n := e.Name()
		if e.IsDir() || !strings.HasSuffix(n, ".json") {
			continue
		}
		s.names = append(s.names, n)
		if it, err := s.read(n); err == nil {
			s.roots[n] = it.RootID
		}
		var c int64
		if _, err := fmt.Sscanf(n, "%d.json", &c); err == nil && c > s.counter {
			s.counter = c
		}
	}
	sort.Strings(s.names)
	return s, nil
}

func (s *Spool) read(name string) (*Item, error) {
	b, err := os.ReadFile(filepath.Join(s.dir, name))
	if err != nil {
		return nil, err
	}
	var it Item
	if err := json.Unmarshal(b, &it); err != nil {
		return nil, err
	}
	it.Name = name
	return &it, nil
}

// Enqueue durably stores a request.
func (s *Spool) Enqueue(rootID, path string, body []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.names) >= MaxItems {
		return ErrFull
	}
	s.counter++
	name := fmt.Sprintf("%016d.json", s.counter)
	b, err := json.Marshal(Item{RootID: rootID, Path: path, Body: body})
	if err != nil {
		return err
	}
	tmp := filepath.Join(s.dir, name+".tmp")
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, filepath.Join(s.dir, name)); err != nil {
		return err
	}
	s.names = append(s.names, name)
	s.roots[name] = rootID
	select {
	case s.notify <- struct{}{}:
	default:
	}
	return nil
}

// Next returns the oldest item or nil when empty. A corrupt file is moved to dead/ and skipped.
func (s *Spool) Next() *Item {
	for {
		s.mu.Lock()
		if len(s.names) == 0 {
			s.mu.Unlock()
			return nil
		}
		name := s.names[0]
		s.mu.Unlock()
		it, err := s.read(name)
		if err != nil {
			s.Dead(&Item{Name: name})
			continue
		}
		return it
	}
}

// Wait returns a channel signalled when something was enqueued.
func (s *Spool) Wait() <-chan struct{} { return s.notify }

func (s *Spool) remove(name string) {
	s.mu.Lock()
	for i, n := range s.names {
		if n == name {
			s.names = append(s.names[:i], s.names[i+1:]...)
			break
		}
	}
	delete(s.roots, name)
	s.mu.Unlock()
}

// Done deletes an acknowledged item and reports whether its root has nothing left queued.
func (s *Spool) Done(it *Item) (rootDrained bool) {
	_ = os.Remove(filepath.Join(s.dir, it.Name))
	s.remove(it.Name)
	return s.DepthFor(it.RootID) == 0
}

// Dead quarantines an item the server will never accept, so it cannot block the queue.
func (s *Spool) Dead(it *Item) {
	_ = os.Rename(filepath.Join(s.dir, it.Name), filepath.Join(s.dir, "dead", it.Name))
	s.remove(it.Name)
}

func (s *Spool) Depth() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.names)
}

func (s *Spool) DepthFor(rootID string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, r := range s.roots {
		if r == rootID {
			n++
		}
	}
	return n
}
