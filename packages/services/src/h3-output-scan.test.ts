import {describe,it,expect} from 'vitest';
import {selectOutputRoot} from './h3-output-scan';
describe('H3 targeted output scan',()=>{
  const devices=[{id:'a',hostname:'pc24',tailscale:'100.64.1.2',urls:[]},{id:'b',hostname:'pc12',tailscale:'100.64.1.3',urls:[]}];
  const roots=[{id:'out',deviceId:'a',path:'D:\\ComfyUI\\output',state:'ACTIVE'},{id:'desktop',deviceId:'a',path:'C:\\Users\\owner\\Desktop',state:'ACTIVE'},{id:'other',deviceId:'b',path:'D:\\ComfyUI\\output',state:'ACTIVE'}];
  it('chooses only the verified worker output root',()=>{
    expect(selectOutputRoot('http://100.64.1.2:8188',devices,roots)?.id).toBe('out');
    expect(selectOutputRoot('http://unknown:8188',devices,roots)).toBeNull();
    expect(selectOutputRoot('http://pc24:8188',devices,[...roots,{...roots[0]!,id:'duplicate'}])).toBeNull();
    expect(selectOutputRoot('http://pc24:8188',devices,roots.map(r=>({...r,state:'PAUSED'})))).toBeNull();
  });
});
