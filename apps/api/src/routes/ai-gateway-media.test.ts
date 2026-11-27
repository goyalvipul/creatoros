import { describe, expect, it } from 'vitest';
import { decodeMedia, gatewayMediaLimit, DEFAULT_MEDIA_BYTES, MAX_MEDIA_BYTES, MAX_MEDIA_BASE64_CHARS, MAX_GATEWAY_MEDIA_JSON_BYTES, MAX_GATEWAY_INVOKE_BODY_BYTES } from './ai-gateway-media';
describe('gateway media validation',()=>{
 const png=Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');
 it('accepts a matching signature before full media probing',()=>expect(decodeMedia({fileName:'ref.png',mime:'image/png',base64:png},'IMAGE').ext).toBe('png'));
 it('keeps the configured limit and transport budgets bounded',()=>{
  expect(gatewayMediaLimit(undefined)).toBe(DEFAULT_MEDIA_BYTES);
  expect(gatewayMediaLimit('2')).toBe(2*1024*1024);
  for(const invalid of ['0','6','NaN','2.5','-1',' 5','1e0'])expect(()=>gatewayMediaLimit(invalid)).toThrow();
  expect(MAX_MEDIA_BASE64_CHARS).toBe(Math.ceil(MAX_MEDIA_BYTES/3)*4);
  expect(MAX_GATEWAY_MEDIA_JSON_BYTES).toBeGreaterThan(MAX_MEDIA_BASE64_CHARS);
  expect(MAX_GATEWAY_INVOKE_BODY_BYTES).toBeGreaterThan(MAX_GATEWAY_MEDIA_JSON_BYTES);
  expect(MAX_GATEWAY_INVOKE_BODY_BYTES).toBeLessThan(10*1024*1024);
 });
 it('accepts a payload at the decoded cap and rejects one byte over',()=>{
  const bytes=Buffer.alloc(MAX_MEDIA_BYTES);
  Buffer.from(png,'base64').copy(bytes);
  const input={fileName:'ref.png',mime:'image/png',base64:bytes.toString('base64')};
  expect(decodeMedia(input,'IMAGE').bytes.length).toBe(MAX_MEDIA_BYTES);
  expect(()=>decodeMedia({...input,base64:Buffer.concat([bytes,Buffer.from([0])]).toString('base64')},'IMAGE')).toThrow();
 });
 it('rejects paths, mismatches and malformed base64',()=>{
  for(const name of ['../ref.png','a/b.png','CON.png','a..png'])expect(()=>decodeMedia({fileName:name,mime:'image/png',base64:png},'IMAGE')).toThrow();
  expect(()=>decodeMedia({fileName:'ref.png',mime:'audio/wav',base64:png},'IMAGE')).toThrow();
  expect(()=>decodeMedia({fileName:'ref.png',mime:'image/png',base64:'AAAA'},'IMAGE')).toThrow();
  expect(()=>decodeMedia({fileName:'ref.png',mime:'image/png',base64:png},'AUDIO')).toThrow();
 });
});
