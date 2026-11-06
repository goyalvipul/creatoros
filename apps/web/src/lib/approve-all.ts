export type ApprovalSend = { id: string; text: string; label: string };

/** Sends each approval in order. One refusal does not stop the rest. */
export async function sendApprovals(
  items: ApprovalSend[],
  send: (item: ApprovalSend) => Promise<unknown>,
): Promise<{ sent: number; failed: string[] }> {
  let sent = 0;
  const failed: string[] = [];
  for (const item of items) {
    const text = item.text.trim();
    if (!text) {
      failed.push(`${item.label}: reply is empty`);
      continue;
    }
    try {
      await send({ ...item, text });
      sent += 1;
    } catch (e) {
      failed.push(`${item.label}: ${e instanceof Error ? e.message : 'not sent'}`);
    }
  }
  return { sent, failed };
}

export function approveAllResult(sent: number, failed: string[]): string | null {
  if (!failed.length) return null;
  return `Sent ${sent}. ${failed.length} not sent. ${failed.slice(0, 3).join(' ')}`;
}

/** Closes each approval without sending. One failure does not stop the rest. */
export async function ignoreApprovals(
  items: { id: string; label: string }[],
  ignore: (id: string) => Promise<unknown>,
): Promise<{ ignored: number; failed: string[] }> {
  let ignored = 0;
  const failed: string[] = [];
  for (const item of items) {
    try {
      await ignore(item.id);
      ignored += 1;
    } catch (e) {
      failed.push(`${item.label}: ${e instanceof Error ? e.message : 'still waiting'}`);
    }
  }
  return { ignored, failed };
}

export function ignoreAllResult(ignored: number, failed: string[]): string | null {
  if (!failed.length) return null;
  return `Ignored ${ignored}. ${failed.length} still waiting. ${failed.slice(0, 3).join(' ')}`;
}
