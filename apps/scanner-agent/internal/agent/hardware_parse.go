package agent

import (
	"encoding/csv"
	"math"
	"strconv"
	"strings"

	"github.com/creatoros/scanner-agent/internal/protocol"
)

func readingNumber(s string,min,max float64)*float64{
	v,err:=strconv.ParseFloat(strings.TrimSpace(s),64)
	if err!=nil||math.IsNaN(v)||math.IsInf(v,0)||v<min||v>max{return nil}
	return &v
}
func readingBytes(s string)*uint64{
	v:=readingNumber(s,0,1048576)
	if v==nil{return nil}
	b:=uint64(*v*1048576)
	return &b
}
func parseNvidiaReadings(raw string)[]protocol.GPUReading{
	out:=[]protocol.GPUReading{}
	r:=csv.NewReader(strings.NewReader(raw))
	r.TrimLeadingSpace=true
	r.FieldsPerRecord=5
	for len(out)<16{
		row,err:=r.Read()
		if err!=nil{break}
		name:=strings.TrimSpace(row[0])
		if name==""||len(name)>160{continue}
		total,used:=readingBytes(row[3]),readingBytes(row[4])
		if total==nil||used==nil||*total==0||*used>*total{total,used=nil,nil}
		out=append(out,protocol.GPUReading{Name:name,UtilPct:readingNumber(row[1],0,100),TempC:readingNumber(row[2],0,150),MemoryTotalBytes:total,MemoryUsedBytes:used})
	}
	return out
}
