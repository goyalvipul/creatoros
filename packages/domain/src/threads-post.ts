/** Threads post rules from the Threads publishing docs. Text is 500 units, and an emoji counts as its UTF-8 bytes. */

export const THREADS_REPLIES = [
  { id: 'everyone', label: 'Everyone' },
  { id: 'accounts_you_follow', label: 'Accounts you follow' },
  { id: 'followers_only', label: 'Followers' },
  { id: 'mentioned_only', label: 'Mentioned only' },
] as const;

const REPLY_IDS = new Set<string>(THREADS_REPLIES.map((row) => row.id));

export function threadsTextUnits(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Returns a sentence when the post cannot be sent. An empty string means the fields are usable. */
export function threadsPostError(input: { text: string; topic: string; reply: string; ai: string }): string {
  if (threadsTextUnits(input.text) > 500)
    return 'A Threads post can be at most 500 characters. An emoji counts as more than one.';
  const topic = input.topic.trim().replace(/^#/, '');
  if (topic && (topic.length > 50 || /[.&]/.test(topic) || /\s/.test(topic)))
    return 'A Threads topic is one word, up to 50 characters, with no period or ampersand.';
  if (!REPLY_IDS.has(input.reply)) return 'Choose who can reply on Threads.';
  if (input.ai !== 'YES' && input.ai !== 'NO') return 'Choose whether this post should show the Threads AI label.';
  return '';
}
