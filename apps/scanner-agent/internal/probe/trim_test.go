package probe

import "testing"

func TestAccurateTrimSeeksAfterInput(t *testing.T) {
	args, err := TrimArgs("ACCURATE", 1500, 3200, 90)
	if err != nil {
		t.Fatal(err)
	}
	ss, in := indexOf(args, "-ss"), indexOf(args, "-i")
	if ss < 0 || in < 0 || ss < in {
		t.Fatalf("accurate cut must seek after -i: %v", args)
	}
	if indexOf(args, "libx264") < 0 || indexOf(args, "0:a?") < 0 {
		t.Fatalf("missing encode args: %v", args)
	}
	if indexOf(args, "rotate=90") < 0 {
		t.Fatalf("rotation not kept: %v", args)
	}
}

func TestFastTrimSeeksBeforeInput(t *testing.T) {
	args, err := TrimArgs("FAST", 1500, 3200, 0)
	if err != nil {
		t.Fatal(err)
	}
	if indexOf(args, "-ss") > indexOf(args, "-i") {
		t.Fatalf("fast cut must seek before -i: %v", args)
	}
	if indexOf(args, "copy") < 0 {
		t.Fatalf("fast cut must copy: %v", args)
	}
}

func TestTrimRejectsEmptyRange(t *testing.T) {
	if _, err := TrimArgs("ACCURATE", 5, 5, 0); err == nil {
		t.Fatal("expected a range error")
	}
}

func indexOf(args []string, want string) int {
	for i, arg := range args {
		if arg == want {
			return i
		}
	}
	return -1
}
