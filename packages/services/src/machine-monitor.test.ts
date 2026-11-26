import { describe, expect, it } from 'vitest';
import { memoryReading, queueCounts, matchMachine } from './machine-monitor';
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
