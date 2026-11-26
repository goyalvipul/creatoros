import { describe, expect, it } from 'vitest';
import { decodeMedia } from './ai-gateway-media';
describe('gateway media validation',()=>{
 const png=Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');
 it('accepts a matching signature before full media probing',()=>expect(decodeMedia({fileName:'ref.png',mime:'image/png',base64:png},'IMAGE').ext).toBe('png'));
 it('rejects paths, mismatches and malformed base64',()=>{
  for(const name of ['../ref.png','a/b.png','CON.png','a..png'])expect(()=>decodeMedia({fileName:name,mime:'image/png',base64:png},'IMAGE')).toThrow();
  expect(()=>decodeMedia({fileName:'ref.png',mime:'audio/wav',base64:png},'IMAGE')).toThrow();
  expect(()=>decodeMedia({fileName:'ref.png',mime:'image/png',base64:'AAAA'},'IMAGE')).toThrow();
  expect(()=>decodeMedia({fileName:'ref.png',mime:'image/png',base64:png},'AUDIO')).toThrow();
 });
});
