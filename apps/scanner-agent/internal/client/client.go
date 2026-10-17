// Package client talks to the Creator OS API. Every request after pairing is signed:
//
//	Authorization: Bearer <device token>
//	x-agent-timestamp: <unix seconds>
//	x-agent-signature: hex(HMAC_SHA256(signingKey, "<ts>." + hex(sha256(body))))
//
// The agent is outbound-only: it never needs an inbound port to talk to the server.
package client

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Client struct {
	Server string // e.g. https://creator.tailnet.ts.net  (no trailing slash, no /api/v1)
	Token  string
	Key    string
	HTTP   *http.Client
	Now    func() time.Time
	mu     sync.RWMutex
}

// SetToken swaps the bearer token after a rotation.
func (c *Client) SetToken(t string) {
	c.mu.Lock()
	c.Token = t
	c.mu.Unlock()
}

func New(server, token, key string) *Client {
	return &Client{
		Server: strings.TrimRight(server, "/"),
		Token:  token,
		Key:    key,
		HTTP:   &http.Client{Timeout: 60 * time.Second},
		Now:    time.Now,
	}
}

// StatusError is returned for non-2xx responses so callers can decide between retry and give-up.
type StatusError struct {
	Status  int
	Code    string
	Message string
}

func (e *StatusError) Error() string { return fmt.Sprintf("server returned %d %s: %s", e.Status, e.Code, e.Message) }

// Permanent reports whether retrying the same request can never succeed (bad payload etc.).
func (e *StatusError) Permanent() bool {
	return e.Status >= 400 && e.Status < 500 && e.Status != 401 && e.Status != 408 && e.Status != 425 && e.Status != 429
}

func (e *StatusError) Revoked() bool { return e.Status == 401 }

// Sign returns the timestamp and signature for a body.
func Sign(key string, body []byte, ts int64) (string, string) {
	sum := sha256.Sum256(body)
	m := hmac.New(sha256.New, []byte(key))
	m.Write([]byte(strconv.FormatInt(ts, 10) + "." + hex.EncodeToString(sum[:])))
	return strconv.FormatInt(ts, 10), hex.EncodeToString(m.Sum(nil))
}

// SignFetch signs an API->agent stream request: HMAC(key, "fetch|root|path|exp").
func SignFetch(key, rootID, path string, exp int64) string {
	m := hmac.New(sha256.New, []byte(key))
	m.Write([]byte(fmt.Sprintf("fetch|%s|%s|%d", rootID, path, exp)))
	return hex.EncodeToString(m.Sum(nil))
}

func (c *Client) do(ctx context.Context, method, path string, body []byte, contentType string, signed bool, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, c.Server+"/api/v1"+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	if contentType == "" && len(body) > 0 {
		contentType = "application/json"
	}
	if contentType != "" {
		req.Header.Set("content-type", contentType)
	}
	if signed {
		c.mu.RLock()
		token := c.Token
		c.mu.RUnlock()
		ts, sig := Sign(c.Key, body, c.Now().Unix())
		req.Header.Set("authorization", "Bearer "+token)
		req.Header.Set("x-agent-timestamp", ts)
		req.Header.Set("x-agent-signature", sig)
	}
	req.Header.Set("user-agent", "creatoros-scanner-agent")
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 32<<20))
	var env struct {
		Data  json.RawMessage `json:"data"`
		Error *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.Unmarshal(raw, &env)
	if res.StatusCode < 200 || res.StatusCode > 299 {
		se := &StatusError{Status: res.StatusCode}
		if env.Error != nil {
			se.Code, se.Message = env.Error.Code, env.Error.Message
		} else {
			se.Message = strings.TrimSpace(string(raw))
			if len(se.Message) > 200 {
				se.Message = se.Message[:200]
			}
		}
		return se
	}
	if out != nil && len(env.Data) > 0 {
		if err := json.Unmarshal(env.Data, out); err != nil {
			return fmt.Errorf("decode response: %w", err)
		}
	}
	return nil
}

// Pair redeems a one-time pairing code. Not signed: the code is the credential.
func Pair(ctx context.Context, server string, req PairInput) (*PairOutput, error) {
	c := New(server, "", "")
	b, _ := json.Marshal(req)
	var out PairOutput
	if err := c.do(ctx, http.MethodPost, "/agents/pair", b, "", false, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type PairInput struct {
	Code         string `json:"code"`
	DeviceUUID   string `json:"deviceUuid"`
	Hostname     string `json:"hostname"`
	OS           string `json:"os"`
	AgentVersion string `json:"agentVersion"`
	Label        string `json:"label,omitempty"`
}

type PairOutput struct {
	DeviceID   string `json:"deviceId"`
	Token      string `json:"token"`
	SigningKey string `json:"signingKey"`
	ExpiresAt  string `json:"expiresAt"`
	OrgName    string `json:"orgName"`
}

func (c *Client) PostJSON(ctx context.Context, path string, in, out any) error {
	b, err := json.Marshal(in)
	if err != nil {
		return err
	}
	return c.do(ctx, http.MethodPost, path, b, "application/json", true, out)
}

// PostRaw posts a prepared body (used by the durable spool so the exact bytes are replayed).
func (c *Client) PostRaw(ctx context.Context, path string, body []byte, out any) error {
	return c.do(ctx, http.MethodPost, path, body, "application/json", true, out)
}

func (c *Client) Get(ctx context.Context, path string, out any) error {
	return c.do(ctx, http.MethodGet, path, nil, "", true, out)
}

func (c *Client) PostBytes(ctx context.Context, path, contentType string, body []byte, out any) error {
	return c.do(ctx, http.MethodPost, path, body, contentType, true, out)
}

// IsRevoked tells whether an error means the credentials were revoked or are otherwise no longer accepted.
func IsRevoked(err error) bool {
	var se *StatusError
	return errors.As(err, &se) && se.Revoked()
}
