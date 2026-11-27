import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openAgentFile } from './agent-file';
import { badRequest, type Ctx } from './types';

const exec=promisify(execFile);
export type QualityExpectation={duration:number;aspect:string;requireAudio:boolean};
export type QualityReport={verdict:'PASS'|'FAIL'|'REVIEW';duration:number|null;width:number|null;height:number|null;hasAudio:boolean;blackSeconds:number;freezeSeconds:number;defects:string[];unverified:string[];checkedAt:string};
type Probe={streams?:{codec_type?:string;width?:number;height?:number;duration?:string}[];format?:{duration?:string}};
function measuredSeconds(log:string,kind:'black'|'freeze',duration:number){
  const pattern=kind==='black'?/black_duration:([0-9.]+)/g:/freeze_duration:\s*([0-9.]+)/g;
  const values=Array.from(log.matchAll(pattern),m=>Number(m[1])).filter(n=>Number.isFinite(n)&&n>=0);
  // FFmpeg may leave an interval open at EOF. Only count observed starts not paired with an end.
  const starts=Array.from(log.matchAll(kind==='black'?/black_start:([0-9.]+)/g:/freeze_start:\s*([0-9.]+)/g),m=>Number(m[1]));
  if(starts.length>values.length){const last=starts.at(-1);if(last!==undefined&&Number.isFinite(last))values.push(Math.max(0,duration-last));}
  return Math.min(duration,values.reduce((a,b)=>a+b,0));
}
export function assessTechnicalVideo(probe:Probe,log:string,expected:QualityExpectation,checkedAt=new Date().toISOString()):QualityReport{
  const video=probe.streams?.find(s=>s.codec_type==='video'),hasAudio=Boolean(probe.streams?.some(s=>s.codec_type==='audio'));
  const duration=Number(probe.format?.duration??video?.duration),width=video?.width??null,height=video?.height??null;
  const validDuration=Number.isFinite(duration)&&duration>0;
  const defects:string[]=[];
  if(!video||!width||!height)defects.push('NO_VALID_VIDEO');
  if(!validDuration)defects.push('INVALID_DURATION');
  if(validDuration&&expected.duration>0&&Math.abs(duration-expected.duration)>Math.max(1,expected.duration*0.12))defects.push('DURATION_MISMATCH');
  const ratio=/^(\d+):(\d+)/.exec(expected.aspect);
  if(ratio&&width&&height&&Math.abs((width/height)/(Number(ratio[1])/Number(ratio[2]))-1)>0.06)defects.push('ASPECT_MISMATCH');
  if(expected.requireAudio&&!hasAudio)defects.push('MISSING_AUDIO');
  const blackSeconds=validDuration?measuredSeconds(log,'black',duration):0,freezeSeconds=validDuration?measuredSeconds(log,'freeze',duration):0;
  if(validDuration&&blackSeconds>=Math.max(1.5,duration*0.2))defects.push('EXCESSIVE_BLACK_FRAMES');
  // Static shots can be intentional. Treat a freeze as a human-review flag, not automatic regeneration.
  const review=validDuration&&freezeSeconds>=Math.max(2,duration*0.3);
  if(review)defects.push('POSSIBLE_FROZEN_MOTION');
  return {verdict:defects.some(d=>d!=='POSSIBLE_FROZEN_MOTION')?'FAIL':review?'REVIEW':'PASS',duration:validDuration?duration:null,width,height,hasAudio,blackSeconds,freezeSeconds,defects,unverified:['Identity consistency','Exercise accuracy','Speech and lip synchronization','Reference-motion similarity','Semantic continuity'],checkedAt};
}
export async function inspectProductionVideo(ctx:Ctx,fileId:string,expected:QualityExpectation){
  const max=200*1024*1024;
  const media=await openAgentFile(ctx.db,ctx.env,ctx.orgId,fileId,(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(120000)}));
  if(media.size>max)throw badRequest('Video exceeds the 200 MiB quality-check limit.');
  const dir=await mkdtemp(join(tmpdir(),'kk-quality-')),file=join(dir,'video');
  try{
    const handle=await open(file,'wx',0o600),reader=media.body.getReader();let total=0;
    try{for(;;){const v=await reader.read();if(v.done)break;total+=v.value.byteLength;if(total>max)throw badRequest('Video exceeds quality-check byte limit.');await handle.writeFile(v.value);}}finally{await reader.cancel().catch(()=>undefined);await handle.close();}
    if(!total)throw badRequest('No video bytes received.');
    const probe=await exec('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,avi,mpegts,mpeg,flv','-show_streams','-show_format','-of','json',file],{timeout:20000,maxBuffer:262144});
    const parsed=JSON.parse(probe.stdout) as Probe;
    let log='';
    if(parsed.streams?.some(s=>s.codec_type==='video')){
      const decoded=await exec('ffmpeg',['-nostdin','-v','info','-xerror','-threads','1','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,avi,mpegts,mpeg,flv','-i',file,'-map','0:v:0','-an','-vf','blackdetect=d=0.5:pix_th=0.1,freezedetect=n=-60dB:d=1.5','-f','null','-'],{timeout:120000,maxBuffer:2*1024*1024});
      log=decoded.stderr;
    }
    return assessTechnicalVideo(parsed,log,expected,ctx.now().toISOString());
  }finally{await rm(dir,{recursive:true,force:true});}
}
