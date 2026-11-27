import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { openAgentFile } from './agent-file';
import { badRequest, type Ctx } from './types';

const exec = promisify(execFile);
export const qualityCriteria = ['identity','motion','equipment','brief','continuity','audio','lipSync','artifacts','physicalAccuracy'] as const;
const check = z.object({criterion:z.enum(qualityCriteria),status:z.enum(['PASS','FAIL','UNCERTAIN','NOT_APPLICABLE']),evidence:z.string().trim().min(1).max(600),seconds:z.number().min(0).max(30).nullable(),correction:z.string().max(600)}).strict();
export const qualityReportSchema = z.object({checks:z.array(check).length(qualityCriteria.length)}).strict().superRefine((report,ctx)=>{
  if(new Set(report.checks.map(c=>c.criterion)).size!==qualityCriteria.length)ctx.addIssue({code:'custom',message:'Every criterion must occur exactly once.'});
  for(const c of report.checks)if(c.status==='FAIL'&&(!c.correction.trim()||c.seconds===null))ctx.addIssue({code:'custom',message:'Failures require observed time and actionable correction.'});
});
export type SemanticQuality = z.infer<typeof qualityReportSchema>;
export type TechnicalQuality = { duration:number; width:number; height:number; audio:boolean; defects:string[] };
export type QualityRequirements = { duration:number; aspectRatio:string; requireAudio:boolean; requireLipSync:boolean; requirePhysicalAccuracy:boolean };
export function qualityDecision(technical:TechnicalQuality,semantic:SemanticQuality|null,requirements:QualityRequirements) {
  const corrections=[...technical.defects];
  if(technical.defects.length)return {verdict:'FAIL' as const,corrections};
  if(!semantic)return {verdict:'REVIEW' as const,corrections:['Semantic review unavailable; do not assume quality.']};
  const required=new Set<string>(['identity','motion','equipment','brief','continuity','artifacts']);
  if(requirements.requireAudio)required.add('audio');
  if(requirements.requireLipSync)required.add('lipSync');
  if(requirements.requirePhysicalAccuracy)required.add('physicalAccuracy');
  const uncertain=semantic.checks.filter(c=>c.status==='UNCERTAIN'||(c.status==='NOT_APPLICABLE'&&required.has(c.criterion)));
  const failures=semantic.checks.filter(c=>c.status==='FAIL');
  // Do not auto-correct when the model cannot determine critical facts.
  if(uncertain.length)return {verdict:'REVIEW' as const,corrections:uncertain.map(c=>c.criterion+': '+c.evidence)};
  if(failures.length)return {verdict:'FAIL' as const,corrections:failures.map(c=>c.criterion+' at '+c.seconds+'s: '+c.correction)};
  return {verdict:'PASS' as const,corrections:[]};
}
export async function inspectTechnicalVideo(ctx:Ctx,fileId:string,requirements:QualityRequirements):Promise<TechnicalQuality> {
  const source=await openAgentFile(ctx.db,ctx.env,ctx.orgId,fileId,(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(90000)}));
  const cap=200*1024*1024;
  if(source.size>cap)throw badRequest('Quality inspection requires a video at most 200 MiB.');
  const dir=await mkdtemp(join(tmpdir(),'kk-quality-'));
  try{
    const input=join(dir,'video');
    let received=0;
    const limiter=new Transform({transform(chunk,_encoding,done){received+=chunk.length;if(received>cap)done(new Error('Quality input exceeds limit.'));else done(null,chunk);}});
    await pipeline(Readable.fromWeb(source.body as import('node:stream/web').ReadableStream),limiter,createWriteStream(input,{mode:0o600}));
    const {stdout}=await exec('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,avi,mpegts,mpeg,flv','-show_streams','-show_format','-of','json',input],{timeout:15000,maxBuffer:256*1024});
    const probe=JSON.parse(stdout) as {format?:{duration?:string};streams?:{codec_type?:string;width?:number;height?:number;duration?:string}[]};
    const stream=probe.streams?.find(s=>s.codec_type==='video');
    const duration=Number(probe.format?.duration??stream?.duration);
    if(!stream?.width||!stream.height||!Number.isFinite(duration)||duration<=0||duration>45)throw badRequest('Video dimensions/duration cannot be inspected safely.');
    const audio=!!probe.streams?.some(s=>s.codec_type==='audio');
    const defects:string[]=[];
    if(Math.abs(duration-requirements.duration)>Math.max(0.75,requirements.duration*0.06))defects.push('Match the planned video duration.');
    const ratio=requirements.aspectRatio.match(/^(\d+):(\d+)/);
    if(ratio&&Math.abs((stream.width/stream.height)/(Number(ratio[1])/Number(ratio[2]))-1)>0.06)defects.push('Render using the requested aspect ratio.');
    if(requirements.requireAudio&&!audio)defects.push('Required audio track is missing.');
    const {stderr}=await exec('ffmpeg',['-nostdin','-hide_banner','-v','info','-threads','1','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,avi,mpegts,mpeg,flv','-i',input,'-an','-vf','scale=320:-2,blackdetect=d=0.5:pix_th=0.10,freezedetect=n=-55dB:d=1.5','-f','null','-'],{timeout:90000,maxBuffer:1024*1024});
    if(/black_duration:[0-9.]+/.test(stderr))defects.push('Remove prolonged black frames.');
    if(/freeze_start:/.test(stderr))defects.push('Remove unintended frozen frames longer than 1.5 seconds.');
    return {duration,width:stream.width,height:stream.height,audio,defects};
  }finally{await rm(dir,{recursive:true,force:true});}
}
