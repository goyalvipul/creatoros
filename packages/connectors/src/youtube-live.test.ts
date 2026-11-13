import { describe, expect, it } from 'vitest';
import { setLiveAgeRestriction, setLivePaidPromotion, updateLiveMonetization, updateLiveVideo } from './youtube-live';

describe('updateLiveVideo', () => {
  it('reads the current video and keeps tags that this edit does not change', async () => {
    const calls: { url: string; body?: any }[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: href, body });
      if (href.includes('/videos?part=snippet') && !init?.method) {
        return new Response(
          JSON.stringify({
            items: [
              {
                snippet: { title: 'Old', description: 'Keep me', tags: ['keep'], categoryId: '10' },
                status: { privacyStatus: 'public', license: 'youtube', selfDeclaredMadeForKids: false },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ id: 'vid' }), { status: 200 });
    }) as typeof fetch;
    await updateLiveVideo(fetchImpl, 'token', 'vid', { title: 'New title' });
    const put = calls.find((c) => c.body);
    expect(put?.body.snippet.tags).toEqual(['keep']);
    expect(put?.body.snippet.description).toBe('Keep me');
    expect(put?.body.snippet.title).toBe('New title');
    expect(put?.body.status.privacyStatus).toBe('public');
    expect(JSON.stringify(put?.body)).not.toContain('token');
  });
});

describe('live extras', () => {
  it('sends age restriction, paid promotion, and mid-roll ads as their own writes', async () => {
    const calls: { url: string; body?: any }[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({ id: 'vid' }), { status: 200 });
    }) as typeof fetch;
    await setLiveAgeRestriction(fetchImpl, 'token', 'vid');
    await setLivePaidPromotion(fetchImpl, 'token', 'vid', true);
    await updateLiveMonetization(fetchImpl, 'token', 'vid', 'on');
    expect(calls[0]?.body.contentDetails.contentRating.ytRating).toBe('ytAgeRestricted');
    expect(calls[1]?.body.paidProductPlacementDetails.hasPaidProductPlacement).toBe(true);
    expect(calls[2]?.body.monetizationDetails.adsMonetizationStatus).toBe('on');
    expect(JSON.stringify(calls)).not.toContain('token');
  });
});
