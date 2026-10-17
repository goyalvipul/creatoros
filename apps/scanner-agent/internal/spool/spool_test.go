package spool

import "testing"

func TestSpoolOrderPersistenceAndDead(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range []string{`{"n":1}`, `{"n":2}`, `{"n":3}`} {
		if err := s.Enqueue("rootA", "/agents/ingest", []byte(b)); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Enqueue("rootB", "/agents/ingest", []byte(`{"n":4}`)); err != nil {
		t.Fatal(err)
	}
	if s.Depth() != 4 || s.DepthFor("rootA") != 3 || s.DepthFor("rootB") != 1 {
		t.Fatalf("depths wrong: %d %d %d", s.Depth(), s.DepthFor("rootA"), s.DepthFor("rootB"))
	}

	// "crash": reopen from disk
	s2, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if s2.Depth() != 4 {
		t.Fatalf("spool must survive restart, got %d", s2.Depth())
	}
	it := s2.Next()
	if string(it.Body) != `{"n":1}` {
		t.Fatalf("FIFO violated: %s", it.Body)
	}
	if drained := s2.Done(it); drained {
		t.Error("rootA still has items")
	}
	it = s2.Next()
	s2.Dead(it) // quarantined, not retried forever
	it = s2.Next()
	if string(it.Body) != `{"n":3}` {
		t.Fatalf("dead item should be skipped: %s", it.Body)
	}
	if !s2.Done(it) {
		t.Error("rootA should be drained")
	}
	// new items after reopen keep increasing order
	if err := s2.Enqueue("rootA", "/x", []byte(`{"n":5}`)); err != nil {
		t.Fatal(err)
	}
	it = s2.Next()
	if string(it.Body) != `{"n":4}` {
		t.Fatalf("order after reopen: %s", it.Body)
	}
}
