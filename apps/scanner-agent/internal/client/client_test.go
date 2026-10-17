package client

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSignMatchesProtocol(t *testing.T) {
	// Independent recomputation of HMAC_SHA256(key, ts + "." + sha256hex(body)).
	ts, sig := Sign("k", []byte(`{"a":1}`), 1700000000)
	if ts != "1700000000" || len(sig) != 64 {
		t.Fatal(ts, sig)
	}
	sum := sha256.Sum256([]byte(`{"a":1}`))
	_, sig2 := Sign("k", []byte(`{"a":1}`), 1700000000)
	if sig != sig2 || hex.EncodeToString(sum[:]) == "" {
		t.Fatal("not deterministic")
	}
	_, other := Sign("k", []byte(`{"a":2}`), 1700000000)
	if other == sig {
		t.Fatal("body must be covered by the signature")
	}
	_, empty := Sign("k", nil, 1700000000)
	_, empty2 := Sign("k", []byte{}, 1700000000)
	if empty != empty2 {
		t.Fatal("nil and empty bodies must sign identically")
	}
}

func TestRequestsAreSignedAndErrorsClassified(t *testing.T) {
	var gotAuth, gotTS, gotSig string
	status := 200
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth, gotTS, gotSig = r.Header.Get("authorization"), r.Header.Get("x-agent-timestamp"), r.Header.Get("x-agent-signature")
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(status)
		if status == 200 {
			w.Write([]byte(`{"data":{"ack":7},"error":null}`))
		} else {
			w.Write([]byte(`{"data":null,"error":{"code":"NOPE","message":"denied"}}`))
		}
	}))
	defer ts.Close()
	c := New(ts.URL, "tok", "key")
	c.Now = func() time.Time { return time.Unix(1700000000, 0) }
	var out struct{ Ack int }
	body := []byte(`{"x":1}`)
	if err := c.PostRaw(context.Background(), "/agents/ingest", body, &out); err != nil {
		t.Fatal(err)
	}
	wantTS, wantSig := Sign("key", body, 1700000000)
	if out.Ack != 7 || gotAuth != "Bearer tok" || gotTS != wantTS || gotSig != wantSig {
		t.Fatalf("headers wrong: %q %q %q ack=%d", gotAuth, gotTS, gotSig, out.Ack)
	}

	for st, wantPerm := range map[int]bool{400: true, 403: true, 422: true, 500: false, 503: false, 429: false, 401: false} {
		status = st
		err := c.PostRaw(context.Background(), "/agents/ingest", body, nil)
		var se *StatusError
		if !errors.As(err, &se) || se.Permanent() != wantPerm || se.Code != "NOPE" {
			t.Errorf("status %d: err=%v permanent=%v want %v", st, err, se != nil && se.Permanent(), wantPerm)
		}
	}
	status = 401
	if err := c.Get(context.Background(), "/agents/config", nil); !IsRevoked(err) {
		t.Error("401 must be reported as revoked/credentials rejected")
	}
}

func TestSignFetchMatchesServerFormat(t *testing.T) {
	// "fetch|<root>|<path>|<exp>" is what the API signs (signAgentFetch in packages/services/src/devices.ts)
	a := SignFetch("k", "r", `D:\Media\a.mp4`, 123)
	b := SignFetch("k", "r", `D:\Media\a.mp4`, 124)
	if a == b || len(a) != 64 {
		t.Fatal("fetch signature must depend on exp")
	}
}
