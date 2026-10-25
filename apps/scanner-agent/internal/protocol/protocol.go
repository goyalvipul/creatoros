// Package protocol holds the wire types shared with the Creator OS API (see packages/domain/src/agent.ts).
package protocol

const Version = 1

// Observation kinds.
const (
	KindFile  = "file"
	KindHash  = "hash"
	KindProbe = "probe"
	KindError = "error"
)

// File states.
const (
	StateStable           = "STABLE"
	StateStillWriting     = "STILL_WRITING"
	StatePermissionDenied = "PERMISSION_DENIED"
	StateIncomplete       = "INCOMPLETE"
)

type Probe struct {
	DurationMs   float64                `json:"durationMs,omitempty"`
	Fps          float64                `json:"fps,omitempty"`
	Width        int                    `json:"width,omitempty"`
	Height       int                    `json:"height,omitempty"`
	Codec        string                 `json:"codec,omitempty"`
	AudioCodec   string                 `json:"audioCodec,omitempty"`
	HasAudio     *bool                  `json:"hasAudio,omitempty"`
	Bitrate      float64                `json:"bitrate,omitempty"`
	Rotation     float64                `json:"rotation,omitempty"`
	FormatName   string                 `json:"formatName,omitempty"`
	Mime         string                 `json:"mime,omitempty"`
	CreationTime string                 `json:"creationTime,omitempty"`
	Workflow     map[string]interface{} `json:"workflow,omitempty"`
}

type Observation struct {
	EventID            string  `json:"eventId"`
	Seq                int     `json:"seq"`
	Kind               string  `json:"kind"`
	Path               string  `json:"path"`
	FileID             string  `json:"fileId,omitempty"`
	Size               int64   `json:"size"`
	MtimeMs            float64 `json:"mtimeMs"`
	CtimeMs            float64 `json:"ctimeMs,omitempty"`
	MtimePrecisionMs   float64 `json:"mtimePrecisionMs,omitempty"`
	State              string  `json:"state,omitempty"`
	StableObservations int     `json:"stableObservations"`
	QuickSignature     string  `json:"quickSignature,omitempty"`
	FullHash           string  `json:"fullHash,omitempty"`
	HashAlg            string  `json:"hashAlg,omitempty"`
	Ext                string  `json:"ext,omitempty"`
	ProbeState         string  `json:"probeState,omitempty"`
	Probe              *Probe  `json:"probe,omitempty"`
	Error              string  `json:"error,omitempty"`
}

type Counts struct {
	Scanned int `json:"scanned"`
	Errors  int `json:"errors"`
}

type PathError struct {
	Path  string `json:"path"`
	Error string `json:"error"`
}

type IngestBatch struct {
	RootID       string        `json:"rootId"`
	RunID        string        `json:"runId"`
	JobType      string        `json:"jobType"`
	Phase        string        `json:"phase"`
	Complete     *bool         `json:"complete,omitempty"`
	Counts       *Counts       `json:"counts,omitempty"`
	Errors       []PathError   `json:"errors,omitempty"`
	Observations []Observation `json:"observations"`
}

type WantHash struct {
	Path   string `json:"path"`
	RootID string `json:"rootId"`
}

type WantPreview struct {
	InstanceID string `json:"instanceId"`
	Path       string `json:"path"`
}

type IngestResponse struct {
	Ack         int           `json:"ack"`
	Accepted    int           `json:"accepted"`
	Duplicates  int           `json:"duplicates"`
	Rejected    int           `json:"rejected"`
	WantHash    []WantHash    `json:"wantHash"`
	WantPreview []WantPreview `json:"wantPreview"`
	ServerTime  string        `json:"serverTime"`
}

type RootHealth struct {
	RootID     string  `json:"rootId"`
	Reachable  bool    `json:"reachable"`
	Error      string  `json:"error,omitempty"`
	FreeBytes  float64 `json:"freeBytes,omitempty"`
	TotalBytes float64 `json:"totalBytes,omitempty"`
	QueueDepth int     `json:"queueDepth"`
	Scanning   bool    `json:"scanning"`
}

type Load struct {
	CPUPct   float64 `json:"cpuPct,omitempty"`
	Scanning bool    `json:"scanning"`
}

type Heartbeat struct {
	AgentVersion string       `json:"agentVersion"`
	Hostname     string       `json:"hostname,omitempty"`
	OS           string       `json:"os,omitempty"`
	ListenURLs   []string     `json:"listenUrls"`
	TailscaleIP  string       `json:"tailscaleIp,omitempty"`
	Load         *Load        `json:"load,omitempty"`
	Roots        []RootHealth `json:"roots"`
}

type RootConfig struct {
	RootID             string   `json:"rootId"`
	DisplayPath        string   `json:"displayPath"`
	Recursive          bool     `json:"recursive"`
	IncludeGlobs       []string `json:"includeGlobs"`
	ExcludeGlobs       []string `json:"excludeGlobs"`
	Extensions         []string `json:"extensions"`
	ScanIntervalMinute int      `json:"scanIntervalMinutes"`
	SettleSeconds      int      `json:"settleSeconds"`
	HashMode           string   `json:"hashMode"`
	FollowLinks        bool     `json:"followLinks"`
	State              string   `json:"state"`
	ScanRequested      bool     `json:"scanRequested"`
	ReconcileRequested bool     `json:"reconcileRequested"`
}

type Config struct {
	DeviceID          string       `json:"deviceId"`
	Protocol          int          `json:"protocol"`
	HeartbeatSeconds  int          `json:"heartbeatSeconds"`
	MaxConcurrentHash int          `json:"maxConcurrentHash"`
	Roots             []RootConfig `json:"roots"`
	Revoked           bool         `json:"revoked"`
}

type PreviewRequest struct {
	InstanceID string `json:"instanceId"`
	Path       string `json:"path"`
}

// FileOp is one owner-confirmed rename, move, or delete. Size is the indexed byte size.
type FileOp struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	FromPath string `json:"fromPath"`
	ToPath   string `json:"toPath,omitempty"`
	Size     int64  `json:"size"`
}

type FileOpResult struct {
	ID     string `json:"id"`
	OK     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
	ToPath string `json:"toPath,omitempty"`
}

