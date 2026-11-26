//go:build windows

package agent

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"time"
	"unsafe"

	"github.com/creatoros/scanner-agent/internal/protocol"
	"golang.org/x/sys/windows"
)

var hardwareKernel = windows.NewLazySystemDLL("kernel32.dll")
var hardwareTimes = hardwareKernel.NewProc("GetSystemTimes")
var hardwareMemory = hardwareKernel.NewProc("GlobalMemoryStatusEx")

type memoryStatusEx struct {
	length, load uint32
	totalPhys, availPhys, totalPage, availPage, totalVirtual, availVirtual, availExtended uint64
}
func systemTicks() (idle, total uint64, ok bool) {
	var i,k,u windows.Filetime
	r,_,_ := hardwareTimes.Call(uintptr(unsafe.Pointer(&i)),uintptr(unsafe.Pointer(&k)),uintptr(unsafe.Pointer(&u)))
	if r==0 { return 0,0,false }
	ticks:=func(f windows.Filetime)uint64{return uint64(f.HighDateTime)<<32|uint64(f.LowDateTime)}
	return ticks(i),ticks(k)+ticks(u),true
}
func cpuSample() *float64 {
	i,t,ok:=systemTicks()
	if !ok{return nil}
	time.Sleep(200*time.Millisecond)
	i2,t2,ok:=systemTicks()
	if !ok||t2<=t||i2<i||i2-i>t2-t{return nil}
	v:=100*(1-float64(i2-i)/float64(t2-t))
	return &v
}
func physicalMemory() (total,used *uint64) {
	m:=memoryStatusEx{}
	m.length=uint32(unsafe.Sizeof(m))
	r,_,_:=hardwareMemory.Call(uintptr(unsafe.Pointer(&m)))
	if r==0||m.totalPhys==0||m.availPhys>m.totalPhys{return nil,nil}
	u:=m.totalPhys-m.availPhys
	return &m.totalPhys,&u
}
func nvidiaTool() string {
	// Only standard driver install locations; no shell or server-provided executable.
	for _,entry:=range [][2]string{{"SystemRoot","System32/nvidia-smi.exe"},{"ProgramFiles","NVIDIA Corporation/NVSMI/nvidia-smi.exe"}} {
		root:=os.Getenv(entry[0])
		if !filepath.IsAbs(root){continue}
		p:=filepath.Join(root,filepath.FromSlash(entry[1]))
		if st,err:=os.Stat(p);err==nil&&!st.IsDir(){return p}
	}
	return ""
}
func collectHardware() *protocol.HardwareReading {
	h:=&protocol.HardwareReading{GPUs:[]protocol.GPUReading{}}
	h.CPUPct=cpuSample()
	h.RAMTotalBytes,h.RAMUsedBytes=physicalMemory()
	if bin:=nvidiaTool();bin!=""{
		ctx,cancel:=context.WithTimeout(context.Background(),3*time.Second)
		defer cancel()
		cmd:=exec.CommandContext(ctx,bin,"--query-gpu=name,utilization.gpu,temperature.gpu,memory.total,memory.used","--format=csv,noheader,nounits")
		if out,err:=cmd.Output();err==nil&&len(out)<=65536{
			h.GPUs=parseNvidiaReadings(string(out))
		}
	}
	h.SampledAt=time.Now().UTC().Format(time.RFC3339)
	return h
}
