package scan

import (
	"regexp"
	"strings"
	"sync"
)

var globCache sync.Map // pattern -> *regexp.Regexp

// compileGlob converts a glob into a regexp. Supported: * (no slash), ** (any depth), ? (one char), [abc].
// A pattern without a slash matches the base name at any depth ("*.tmp" matches "a/b/c.tmp").
// Matching is case-insensitive because the agent mostly runs on Windows.
func compileGlob(p string) *regexp.Regexp {
	if v, ok := globCache.Load(p); ok {
		return v.(*regexp.Regexp)
	}
	pat := strings.ReplaceAll(strings.TrimSpace(p), `\`, "/")
	pat = strings.TrimSuffix(strings.TrimPrefix(pat, "./"), "/")
	anyDepth := !strings.Contains(pat, "/")
	var sb strings.Builder
	sb.WriteString("(?i)^")
	if anyDepth {
		sb.WriteString("(?:.*/)?")
	}
	for i := 0; i < len(pat); i++ {
		c := pat[i]
		switch c {
		case '*':
			if i+1 < len(pat) && pat[i+1] == '*' {
				i++
				if i+1 < len(pat) && pat[i+1] == '/' {
					i++
					sb.WriteString("(?:.*/)?")
				} else {
					sb.WriteString(".*")
				}
			} else {
				sb.WriteString("[^/]*")
			}
		case '?':
			sb.WriteString("[^/]")
		case '[':
			end := strings.IndexByte(pat[i:], ']')
			if end < 0 {
				sb.WriteString(`\[`)
			} else {
				sb.WriteString(pat[i : i+end+1])
				i += end
			}
		default:
			sb.WriteString(regexp.QuoteMeta(string(c)))
		}
	}
	// a directory pattern like "cache/" or "node_modules" should also cover everything under it
	sb.WriteString("(?:/.*)?$")
	re, err := regexp.Compile(sb.String())
	if err != nil {
		re = regexp.MustCompile(`^\b$`) // matches nothing
	}
	globCache.Store(p, re)
	return re
}

// MatchAny reports whether rel (forward-slash relative path) matches any of the globs.
func MatchAny(globs []string, rel string) bool {
	for _, g := range globs {
		if g == "" {
			continue
		}
		if compileGlob(g).MatchString(rel) {
			return true
		}
	}
	return false
}
