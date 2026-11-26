import { describe, expect, it } from 'vitest';
import { memoryReading, queueCounts, matchMachine, hardwareReading, resolveComfyRestartTask } from './machine-monitor';
const device=(id:string,hostname:string,tailscale:string)=>({id,name:id,hostname,tailscale,os:'windows',state:'ONLINE',seenAt:new Date(),urls:[],cpu:null,scanning:false});
describe('machine monitor',()=>{
  it('does not turn missing or malformed readings into zero usage',()=>{
    expect(memoryReading(24,4)).toEqual({usedBytes:20,totalBytes:24});
    expect(memoryReading(24,undefined)).toBeNull();
    expect(memoryReading(24,30)).toBeNull();
    expect(memoryReading(0,0)).toBeNull();
    expect(queueCounts({queue_running:[],queue_pending:[]})).toEqual({running:0,pending:0});
    expect(queueCounts({queue_running:[]})).toBeNull();
  });
  it('requires a unique exact machine host rather than matching capacity or label',()=>{
    const a=device('a','PC24','100.64.1.2'),b=device('b','PC12','100.64.1.3');
    expect(matchMachine('http://100.64.1.2:8188',[a,b])?.id).toBe('a');
    expect(matchMachine('http://pc24:8188',[a,b])?.id).toBe('a');
    expect(matchMachine('http://pc24-other:8188',[a,b])).toBeNull();
    expect(matchMachine('http://localhost:8188',[a,b])).toBeNull();
    expect(matchMachine('http://100.64.1.2:8188',[a,device('c','other','100.64.1.2')])).toBeNull();
  });
});

describe('hardware telemetry',()=>{
  it('preserves zero, validates GPU identity and rejects stale readings',()=>{
    const now=new Date('2026-11-25T12:00:00Z');
    const h={sampledAt:now.toISOString(),cpuPct:0,ramTotalBytes:32,ramUsedBytes:17,gpus:[{name:'NVIDIA GeForce RTX 3090',utilPct:0,tempC:42,memoryTotalBytes:24,memoryUsedBytes:15}]};
    expect(hardwareReading(h,'RTX 3090',null,now)).toMatchObject({cpuPct:0,gpuPct:0,gpuTempC:42,ram:{usedBytes:17,totalBytes:32},vram:{usedBytes:15,totalBytes:24}});
    expect(hardwareReading(h,'RTX 3060',null,now)?.gpuPct).toBeNull();
    expect(hardwareReading({...h,gpus:[...h.gpus,...h.gpus]},'RTX 3090',null,now)?.gpuPct).toBeNull();
    expect(hardwareReading(h,'RTX 3090',null,new Date(now.getTime()+91_000))).toBeNull();
    expect(hardwareReading({...h,cpuPct:101},'RTX 3090',null,now)?.cpuPct).toBeNull();
  });
});

describe('dashboard Windows task recovery',()=>{
  const pc=device('a','PC24','100.64.1.2');
  const task={id:'task',deviceId:'a',deviceName:'PC24',deviceState:'ONLINE',label:'ComfyUI',taskName:'ComfyUI',status:'READY',detail:null,checkedAt:null,restartStatus:null,restartError:null};
  it('resolves the same configured task even with a stopped service or in-flight restart',()=>{
    const url='http://100.64.1.2:8188';
    expect(resolveComfyRestartTask(url,[pc],[task])?.id).toBe('task');
    expect(resolveComfyRestartTask(url,[pc],[{...task,status:'UNKNOWN',restartStatus:'PENDING'}])?.id).toBe('task');
    expect(resolveComfyRestartTask(url,[{...pc,state:'OFFLINE'}],[{...task,deviceState:'OFFLINE',restartStatus:'RUNNING'}])?.id).toBe('task');
  });
  it('never falls back to another machine or an ambiguous task',()=>{
    const url='http://100.64.1.2:8188';
    expect(resolveComfyRestartTask(url,[pc],[{...task,deviceId:'b'}])).toBeNull();
    expect(resolveComfyRestartTask(url,[pc],[task,{...task,id:'other'}])).toBeNull();
    expect(resolveComfyRestartTask(url,[pc],[{...task,label:'Telegram',taskName:'Telegram'}])).toBeNull();
  });
});
