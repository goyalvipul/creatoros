package scan

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"io"
)

const sampleSize = 64 * 1024

// QuickSignature is a cheap content fingerprint: sha256(size | first 64KB | middle 64KB | last 64KB).
// Two files with different quick signatures are certainly different; equal ones are only *candidates* for
// duplicates and get a full SHA-256 before the server treats them as identical.
func QuickSignature(path string, size int64) (string, error) {
	f, err := openFile(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	var sz [8]byte
	binary.LittleEndian.PutUint64(sz[:], uint64(size))
	h.Write(sz[:])
	buf := make([]byte, sampleSize)
	offsets := []int64{0}
	if size > 3*sampleSize {
		offsets = append(offsets, size/2-sampleSize/2, size-sampleSize)
	} else if size > sampleSize {
		offsets = append(offsets, size-sampleSize)
	}
	for _, off := range offsets {
		n, err := f.ReadAt(buf, off)
		if err != nil && err != io.EOF {
			return "", err
		}
		h.Write(buf[:n])
	}
	return "qs1:" + hex.EncodeToString(h.Sum(nil))[:32], nil
}

// FullHash streams the whole file through SHA-256. It honours ctx so shutdown is prompt.
func FullHash(ctx context.Context, path string) (string, int64, error) {
	f, err := openFile(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	buf := make([]byte, 1<<20)
	var total int64
	for {
		if err := ctx.Err(); err != nil {
			return "", total, err
		}
		n, err := f.Read(buf)
		if n > 0 {
			h.Write(buf[:n])
			total += int64(n)
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", total, err
		}
	}
	return hex.EncodeToString(h.Sum(nil)), total, nil
}
