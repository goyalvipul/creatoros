/** Permissions Kemokem may ask Meta for. The owner picks a subset at connect time. */

export interface OauthPermission {
  scope: string;
  label: string;
  detail: string;
  required: boolean;
}

export const OAUTH_PERMISSIONS = {
  facebook: [
    { scope: 'pages_show_list', label: 'Pages you manage', detail: 'Needed to find the Page and connect it.', required: true },
    { scope: 'pages_read_engagement', label: 'Reactions, comments, and shares', detail: 'Reads engagement on Page posts.', required: false },
    { scope: 'pages_read_user_content', label: 'Page posts and comments', detail: 'Imports the posts and comments already on the Page.', required: false },
    { scope: 'pages_manage_engagement', label: 'Reply to comments', detail: 'A reply is sent only after you confirm it.', required: false },
    { scope: 'pages_messaging', label: 'Page messages', detail: 'Reads the Page inbox. A reply is sent only after you confirm it.', required: false },
    { scope: 'pages_manage_metadata', label: 'Page webhook subscription', detail: 'Lets the Page notify Kemokem about new messages.', required: false },
    { scope: 'read_insights', label: 'Page and post insights', detail: 'Views, clicks, and follower counts. Meta rejects the login if the app does not have this permission yet.', required: false },
    { scope: 'pages_manage_posts', label: 'Publish Page videos', detail: 'A video is posted only after you confirm it.', required: false },
  ],
  instagram: [
    { scope: 'instagram_business_basic', label: 'Profile and posts', detail: 'Needed to connect the professional account and import posts.', required: true },
    { scope: 'instagram_business_manage_insights', label: 'Insights', detail: 'Views, reach, saves, and account totals.', required: false },
    { scope: 'instagram_business_manage_comments', label: 'Comments', detail: 'Reads comments. A reply is sent only after you confirm it.', required: false },
    { scope: 'instagram_business_manage_messages', label: 'Messages', detail: 'Reads the professional inbox. A reply is sent only after you confirm it.', required: false },
    { scope: 'instagram_business_content_publish', label: 'Publish', detail: 'A post is sent only after you confirm it.', required: false },
  ],
  threads: [
    { scope: 'threads_basic', label: 'Profile and posts', detail: 'Needed to connect the Threads account and import posts.', required: true },
    { scope: 'threads_manage_insights', label: 'Insights', detail: 'Views, likes, replies, and followers.', required: false },
    { scope: 'threads_read_replies', label: 'Read replies', detail: 'Reads replies on your posts.', required: false },
    { scope: 'threads_manage_replies', label: 'Reply', detail: 'A reply is sent only after you confirm it.', required: false },
    { scope: 'threads_manage_mentions', label: 'Mentions', detail: 'Reads posts that mention the account.', required: false },
    { scope: 'threads_profile_discovery', label: 'Public profiles', detail: 'Looks up public Threads profiles.', required: false },
    { scope: 'threads_content_publish', label: 'Publish', detail: 'A post is sent only after you confirm it.', required: false },
    { scope: 'threads_delete', label: 'Delete posts', detail: 'A delete runs only after you confirm that one post.', required: false },
    { scope: 'threads_share_to_instagram', label: 'Share to Instagram', detail: 'Shares a Threads post to the linked Instagram account after you confirm it.', required: false },
  ],
  tiktok: [
    { scope: 'user.info.basic', label: 'Basic profile', detail: 'Needed to connect the account.', required: true },
    { scope: 'user.info.profile', label: 'Profile details', detail: 'Username and bio.', required: false },
    { scope: 'user.info.stats', label: 'Account totals', detail: 'Followers, following, likes, and video count.', required: false },
    { scope: 'video.list', label: 'Video list', detail: 'Imports the videos already on the account.', required: false },
    { scope: 'video.publish', label: 'Publish', detail: 'A post is sent only after you confirm it. TikTok may still limit an unaudited app to private posts.', required: false },
    { scope: 'video.upload', label: 'Upload to TikTok inbox', detail: 'Sends the video to your TikTok inbox. You finish it in the TikTok app.', required: false },
  ],
  snapchat: [
    {
      scope: 'snapchat-profile-api',
      label: 'Public profile',
      detail: 'Reads the Snapchat public profile after Snapchat has allowlisted this app. Leave this off if Snapchat has not approved it yet. Posting and analytics are not requested.',
      required: false,
    },
  ],
} as const satisfies Record<string, readonly OauthPermission[]>;

export type OauthPermissionProvider = keyof typeof OAUTH_PERMISSIONS;

/** Keeps the required permission and drops anything this app does not know. */
export function oauthScopes(provider: OauthPermissionProvider, requested?: readonly string[]): string[] {
  const catalog = OAUTH_PERMISSIONS[provider];
  const known = new Set<string>(catalog.map((item) => item.scope));
  const required = catalog.filter((item) => item.required).map((item) => item.scope);
  const picked = (requested ?? required).filter((scope) => known.has(scope));
  return [...new Set([...required, ...picked])];
}
