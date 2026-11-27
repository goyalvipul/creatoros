import { describe, expect, it } from 'vitest';
import { buildLocalImageGraph, localImageInputSchema } from './local-image';
const template=()=>({
  id:'test',graph:{
    '1':{class_type:'LoadImage',inputs:{image:'placeholder.png'}},
    '2':{class_type:'CLIPTextEncode',inputs:{text:'placeholder'}},
    '3':{class_type:'Sampler',inputs:{seed:0,width:512,height:512}},
    '4':{class_type:'SaveImage',inputs:{filename_prefix:'old',images:['3',0]}},
  },
  prompt:{node:'2',input:'text'},references:[{node:'1',input:'image'}],
  seed:{node:'3',input:'seed'},width:{node:'3',input:'width'},height:{node:'3',input:'height'},outputNode:'4',
});
describe('local image workflow mapping',()=>{
  it('clones only owner-mapped inputs and pins a unique output prefix',()=>{
    const t=template();
    const graph=buildLocalImageGraph(t,{prompt:'New outfit',names:['actual.png'],seed:123,width:720,height:1280,id:'job'});
    expect(graph['1']!.inputs.image).toBe('actual.png');
    expect(graph['2']!.inputs.text).toBe('New outfit');
    expect(graph['3']!.inputs).toEqual({seed:123,width:720,height:1280});
    expect(graph['4']!.inputs.filename_prefix).toBe('kemokem/local_job');
    expect(t.graph['1'].inputs.image).toBe('placeholder.png');
  });
  it('refuses missing reference slots and mapped graph connections',()=>{
    const t=template(),input={prompt:'x',names:[],seed:1,width:512,height:512,id:'job'};
    expect(()=>buildLocalImageGraph(t,input)).toThrow();
    expect(()=>buildLocalImageGraph({...t,prompt:{node:'4',input:'images'}},{...input,names:['ref.png']})).toThrow();
    expect(()=>buildLocalImageGraph({...t,outputNode:'3'},{...input,names:['ref.png']})).toThrow();
  });
  it('bounds dimensions before queueing',()=>{
    const id='12345678-1234-4234-8234-123456789abc';
    const input={projectId:id,workerId:id,rootId:id,workflowId:'test',prompt:'x',referenceFileIds:[id],width:720,height:1280};
    expect(localImageInputSchema.safeParse(input).success).toBe(true);
    expect(localImageInputSchema.safeParse({...input,width:721}).success).toBe(false);
    expect(localImageInputSchema.safeParse({...input,height:4096}).success).toBe(false);
  });
});
