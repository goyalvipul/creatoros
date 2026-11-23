import type { Provider } from '@creatoros/domain';
import { GmailConnector } from './google/gmail';
import { GoogleDriveConnector } from './google/drive';
import { YouTubeConnector } from './google/youtube';
import { TodoConnector } from './todo';
import { InstagramLoginConnector } from './meta/instagram';
import { ThreadsConnector } from './meta/threads';
import { SnapchatConnector } from './snapchat';
import { GatedConnector, InstagramConnector, PostizConnector, TikTokConnector } from './social';
import type { Connector } from './types';

const gmail = new GmailConnector();
const youtube = new YouTubeConnector();
const todo = new TodoConnector();
const postiz = new PostizConnector();
const meta = new InstagramConnector();
const tiktok = new TikTokConnector();
const instagram = new InstagramLoginConnector();
const facebook = new GatedConnector(
  'facebook',
  [
    'Needs FACEBOOK_APP_ID and FACEBOOK_APP_SECRET (parent Meta app) in .env; then use Connect Facebook Page.',
  ],
  [
    'Set FACEBOOK_APP_ID / FACEBOOK_APP_SECRET, add the Facebook Login redirect URI and the Page webhook (docs/socials/FACEBOOK_SETUP.md).',
  ],
);
const threads = new ThreadsConnector();
const snapchat = new SnapchatConnector();
const google = new GoogleDriveConnector();
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
  instagram,
  facebook,
  threads,
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
export const snapchatConnector = snapchat;
