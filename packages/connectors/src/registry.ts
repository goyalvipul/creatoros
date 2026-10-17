import type { Provider } from '@creatoros/domain';
import { GmailConnector } from './google/gmail';
import { YouTubeConnector } from './google/youtube';
import { TodoConnector } from './todo';
import { GatedConnector, InstagramConnector, PostizConnector, TikTokConnector } from './social';
import type { Connector } from './types';

const gmail = new GmailConnector();
const youtube = new YouTubeConnector();
const todo = new TodoConnector();
const postiz = new PostizConnector();
const meta = new InstagramConnector();
const tiktok = new TikTokConnector();
const snapchat = new GatedConnector(
  'snapchat',
  ['Snapchat has no public read/publish API suitable for a creator profile; use manual publication records.'],
  ['Record Snapchat posts manually with a link and date (USER_ENTERED).'],
);
const google = new GatedConnector(
  'google',
  ['"google" is an umbrella OAuth client. Connect Gmail and YouTube individually.'],
  ['Open Integrations and connect Gmail and/or YouTube.'],
);
const manual = new GatedConnector(
  'manual',
  ['Manual intake is always available and needs no connector.'],
  [],
);

export const CONNECTORS: Record<Provider, Connector<any, any>> = {
  gmail,
  youtube,
  todo,
  postiz,
  meta,
  tiktok,
  snapchat,
  google,
  manual,
};

export function getConnector(provider: Provider): Connector<any, any> {
  return CONNECTORS[provider];
}

export const gmailConnector = gmail;
export const youtubeConnector = youtube;
export const todoConnector = todo;
export const tiktokConnector = tiktok;
