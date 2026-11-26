package agent

import "testing"

func TestParseNvidiaReadings(t *testing.T){
	r:=parseNvidiaReadings("NVIDIA GeForce RTX 3090, 0, 42, 24576, 1024\nNVIDIA GeForce RTX 3060, N/A, N/A, 12288, 1000\n")
	if len(r)!=2||r[0].UtilPct==nil||*r[0].UtilPct!=0||r[0].TempC==nil||*r[0].TempC!=42||r[0].MemoryTotalBytes==nil||*r[0].MemoryTotalBytes!=24576*1048576{t.Fatalf("bad readings: %+v",r)}
	if r[1].UtilPct!=nil||r[1].TempC!=nil{t.Fatal("unsupported metrics must stay absent")}
	r=parseNvidiaReadings("NVIDIA GeForce RTX 3090, 200, NaN, 1024, 2048")
	if len(r)!=1||r[0].UtilPct!=nil||r[0].TempC!=nil||r[0].MemoryTotalBytes!=nil{t.Fatal("invalid reading accepted")}
}
