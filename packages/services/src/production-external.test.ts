import {describe,expect,it} from 'vitest';
import {socialCoverLimit,decodeSocialCoverBase64} from './social-cover';
import {productionQualityReportSchema,constrainEvidence} from './production-external';
import {qualityCriteria,qualityDecision,type SemanticQuality} from './production-quality';
const MiB=1024*1024;
const requirements={duration:8,aspectRatio:'9:16',requireAudio:true,requireLipSync:true,requirePhysicalAccuracy:false};
const report=()=>productionQualityReportSchema.parse({
 jobId:'00000000-0000-4000-8000-000000000001',fileId:'00000000-0000-4000-8000-000000000002',
 assessment:{checks:qualityCriteria.map(criterion=>({criterion,status:'PASS',evidence:'Observed test footage.',seconds:0,correction:''}))} satisfies SemanticQuality,
 evidence:{frameSeconds:[0,2,4,7.5],continuousMotion:false,audioHeard:false,lipSyncObserved:false},
 requireAudio:true,requireLipSync:true,requirePhysicalAccuracy:false,
});
describe('configurable publishing covers',()=>{
 it('defaults to five decoded MiB and accepts smaller configured limits',()=>{
  expect(socialCoverLimit(undefined)).toBe(5*MiB);
  expect(socialCoverLimit('3')).toBe(3*MiB);
  for(const value of ['0','6','2.5','-1','NaN'])expect(()=>socialCoverLimit(value)).toThrow();
 });
 it('accepts the exact configured decoded boundary, rejects one extra byte and noncanonical Base64',()=>{
  const limit=socialCoverLimit('5');
  const bytes=Buffer.alloc(limit,42);
  expect(decodeSocialCoverBase64(bytes.toString('base64'),limit).equals(bytes)).toBe(true);
  expect(()=>decodeSocialCoverBase64(Buffer.alloc(limit+1,42).toString('base64'),limit)).toThrow();
  expect(()=>decodeSocialCoverBase64(bytes.toString('base64'),2*MiB)).toThrow();
  expect(()=>decodeSocialCoverBase64('Zh==',limit)).toThrow();
 });
});
describe('ChatGPT quality evidence',()=>{
 it('does not allow isolated frame observations to certify continuous motion or audio',()=>{
  const p=report();
  const assessment=constrainEvidence(p,requirements);
  for(const key of ['motion','audio','lipSync'])expect(assessment.checks.find(c=>c.criterion===key)?.status).toBe('UNCERTAIN');
  expect(qualityDecision({duration:8,width:720,height:1280,audio:true,defects:[]},assessment,requirements).verdict).toBe('REVIEW');
 });
 it('allows complete observed evidence to pass the separate technical gate',()=>{
  const p=report();
  p.evidence={...p.evidence,continuousMotion:true,audioHeard:true,lipSyncObserved:true};
  const assessment=constrainEvidence(p,requirements);
  expect(qualityDecision({duration:8,width:720,height:1280,audio:true,defects:[]},assessment,requirements).verdict).toBe('PASS');
  expect(qualityDecision({duration:8,width:720,height:1280,audio:true,defects:['Frozen frames']},assessment,requirements).verdict).toBe('FAIL');
 });
});
