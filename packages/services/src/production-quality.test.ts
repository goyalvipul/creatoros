import { describe, expect, it } from 'vitest';
import { qualityCriteria, qualityDecision, qualityReportSchema, type SemanticQuality } from './production-quality';
const requirements={duration:20,aspectRatio:'9:16',requireAudio:true,requireLipSync:true,requirePhysicalAccuracy:true};
const technical={duration:20,width:720,height:1280,audio:true,defects:[]};
const report=():SemanticQuality=>({checks:qualityCriteria.map(criterion=>({criterion,status:'PASS',evidence:'Observed footage evidence.',seconds:0,correction:''}))});
describe('production quality decision',()=>{
  it('does not pass without both technical and semantic evidence',()=>{
    expect(qualityDecision(technical,null,requirements).verdict).toBe('REVIEW');
    expect(qualityDecision({...technical,defects:['Frozen frames']},null,requirements).verdict).toBe('FAIL');
    expect(qualityDecision(technical,report(),requirements).verdict).toBe('PASS');
  });
  it('blocks unverifiable identity and missing required checks',()=>{
    const r=report();
    r.checks[0]!.status='UNCERTAIN';
    expect(qualityDecision(technical,r,requirements).verdict).toBe('REVIEW');
    r.checks[0]!.status='NOT_APPLICABLE';
    expect(qualityDecision(technical,r,requirements).verdict).toBe('REVIEW');
  });
  it('requires evidence and bounded concrete corrections for failures',()=>{
    const r=report();r.checks[1]!.status='FAIL';
    expect(qualityReportSchema.safeParse(r).success).toBe(false);
    r.checks[1]!.correction='Reduce camera speed and match pose timing.';
    expect(qualityReportSchema.safeParse(r).success).toBe(true);
    expect(qualityDecision(technical,r,requirements)).toMatchObject({verdict:'FAIL',corrections:['motion at 0s: Reduce camera speed and match pose timing.']});
    r.checks[2]!.criterion=r.checks[1]!.criterion;
    expect(qualityReportSchema.safeParse(r).success).toBe(false);
  });
});
