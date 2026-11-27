import {describe,expect,it} from 'vitest';
import {socialCoverLimit,decodeSocialCoverBase64} from './social-cover';
import {productionQualityReportSchema,constrainEvidence,reviewEligibility} from './production-external';
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

describe('production package readiness is not creative approval',()=>{
 const stored=()=>{const p=report();return {verdict:'REVIEW',technical:{duration:8,width:544,height:960,audio:true,defects:[] as string[]},semantic:constrainEvidence(p,requirements),evidence:p.evidence,requirements};};
 it('allows clean technical results and disclosed uncertainty for human review',()=>{
  expect(reviewEligibility(stored())).toMatchObject({eligible:true,humanReviewRequired:true,unresolvedChecks:['motion','audio','lipSync']});
 });
 it('blocks missing or malformed reports, required audio missing, and observed failures even alongside uncertainty',()=>{
  expect(reviewEligibility(null).eligible).toBe(false);
  expect(reviewEligibility({verdict:'PASS'}).eligible).toBe(false);
  const r=stored();r.technical.audio=false;expect(reviewEligibility(r).eligible).toBe(false);
  r.technical.audio=true;r.technical.defects=['Frozen frames'];expect(reviewEligibility(r).eligible).toBe(false);
  r.technical.defects=[];r.semantic.checks[0]={criterion:'identity',status:'FAIL',evidence:'Observed different identity.',seconds:0,correction:'Restore reference identity.'};
  expect(reviewEligibility(r).eligible).toBe(false);
  expect(qualityDecision(r.technical,r.semantic,r.requirements).verdict).toBe('FAIL');
 });
});
