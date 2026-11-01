package tasksched

import "testing"

func TestValidName(t *testing.T) {
	ok := []string{`ComfyUI`, `\ComfyUI`, `\Mehak\Telegram bot`}
	bad := []string{``, `ComfyUI & calc`, `..\Windows`, `"ComfyUI"`, `schtasks /Run`}
	for _, name := range ok {
		if !ValidName(name) {
			t.Fatalf("expected %q to be allowed", name)
		}
	}
	for _, name := range bad {
		if ValidName(name) {
			t.Fatalf("expected %q to be refused", name)
		}
	}
}

func TestParseStatus(t *testing.T) {
	status, detail := parseStatus("TaskName: \\ComfyUI\nStatus: Running\n", nil)
	if status != "RUNNING" || detail != "Running" {
		t.Fatalf("got %s %s", status, detail)
	}
	status, _ = parseStatus("", errString("ERROR: The system cannot find the file specified."))
	if status != "NOT_FOUND" {
		t.Fatalf("got %s", status)
	}
}

type errString string

func (e errString) Error() string { return string(e) }
