import { describe, expect, it } from 'vitest';
import { triageReply } from './triage';

describe('triageReply', () => {
  const cases: [string, string][] = [
    ['', 'MEDIA'],
    ['😍😍🔥', 'EMOJI'],
    ['Hi, we are a brand and would love a paid collaboration', 'BUSINESS'],
    ['mail me at agent@studio.com', 'BUSINESS'],
    ['Follow back please check my page https://x.co', 'SPAM'],
    ['Please make a new song', 'REQUEST'],
    ['When is the next video coming?', 'REQUEST'],
    ['What camera do you use?', 'QUESTION'],
    ['kya ye real hai', 'QUESTION'],
    ['This looks fake and cringe', 'CRITICISM'],
    ['So very nice voice', 'COMPLIMENT'],
    ['bahut sundar', 'COMPLIMENT'],
    ['ok then', 'OTHER'],
    ['hmm', 'EMOJI'],
  ];
  it.each(cases)('%s -> %s', (text, expected) => expect(triageReply(text)).toBe(expected));
});
