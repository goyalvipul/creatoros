package probe

import "testing"

const sample = `{
 "streams": [
  {"codec_type":"video","codec_name":"h264","width":1080,"height":1920,"r_frame_rate":"30000/1001","avg_frame_rate":"30000/1001","duration":"12.5","side_data_list":[{"rotation":-90}]},
  {"codec_type":"audio","codec_name":"aac"}
 ],
 "format": {"format_name":"mov,mp4,m4a,3gp,3g2,mj2","duration":"12.480000","bit_rate":"8000000","tags":{"creation_time":"2026-01-02T03:04:05.000000Z","encoder":"Lavf60","comment":"{\"workflow\":1}"}}
}`

func TestParseFFprobe(t *testing.T) {
	p, err := ParseFFprobe([]byte(sample), `D:\clips\a.mp4`)
	if err != nil {
		t.Fatal(err)
	}
	if p.Width != 1080 || p.Height != 1920 || p.Codec != "h264" || p.AudioCodec != "aac" || p.HasAudio == nil || !*p.HasAudio {
		t.Errorf("streams: %+v", p)
	}
	if int(p.DurationMs) != 12480 || int(p.Bitrate) != 8000000 || p.Rotation != -90 {
		t.Errorf("format: %+v", p)
	}
	if p.Fps < 29.9 || p.Fps > 30 {
		t.Errorf("fps: %v", p.Fps)
	}
	if p.Mime != "video/mp4" || p.CreationTime == "" || p.Workflow["encoder"] != "Lavf60" {
		t.Errorf("misc: %+v", p)
	}
}

func TestParseFFprobeSilentAndInvalid(t *testing.T) {
	p, err := ParseFFprobe([]byte(`{"streams":[{"codec_type":"video","codec_name":"vp9","width":10,"height":10,"r_frame_rate":"25/1"}],"format":{}}`), "x.webm")
	if err != nil || p.HasAudio == nil || *p.HasAudio {
		t.Fatalf("silent video must report hasAudio=false: %+v %v", p, err)
	}
	if _, err := ParseFFprobe([]byte("not json"), "x.mp4"); err == nil {
		t.Error("garbage should error")
	}
}

func TestKinds(t *testing.T) {
	if !IsVideo("a.MOV") || !IsImage("b.jpg") || IsMedia("c.txt") || !IsMedia("d.wav") {
		t.Error("kind detection")
	}
}
