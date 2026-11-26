import {describe,it,expect} from 'vitest';
import {coverSeconds} from './production-postprocess';
describe('production cover timecodes',()=>{
 it('uses the observed timestamp, bounds invalid and out-of-range inputs',()=>{
  expect(coverSeconds('00:15')).toBe(15);
  expect(coverSeconds('0:03.5')).toBe(3.5);
  expect(coverSeconds('0')).toBe(0);
  expect(coverSeconds('99:00')).toBe(1);
  expect(coverSeconds('foo')).toBe(1);
  expect(coverSeconds(null)).toBe(1);
 });
});
