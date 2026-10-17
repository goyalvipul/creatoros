/**
 * Deterministic, offline message screening. The result is only ever a *suggestion* placed in a
 * "possibly collaboration" queue; nothing here creates a committed deal. Message text is treated as
 * untrusted data and is never interpreted as instructions.
 */

export interface ClassificationInput {
  subject?: string | null;
  body?: string | null;
  fromEmail?: string | null;
  fromName?: string | null;
}

export interface ClassificationResult {
  category: 'COLLABORATION' | 'PAYMENT' | 'NEWSLETTER' | 'UNRELATED';
  confidence: number;
  signals: string[];
  extracted: {
    amountMinor?: number;
    currency?: string;
    deadline?: string;
    brandGuess?: string;
    compensation?: 'FLAT_FEE' | 'GIFTED' | 'AFFILIATE' | 'COMMISSION' | 'UNKNOWN';
    missingTerms: string[];
  };
}

const COLLAB_TERMS: [RegExp, number, string][] = [
  [/\bcollab(oration|orate)?\b/i, 0.3, 'mentions collaboration'],
  [/\bsponsor(ed|ship)?\b/i, 0.3, 'mentions sponsorship'],
  [/\bpartnership\b/i, 0.25, 'mentions partnership'],
  [/\bpaid (promotion|post|campaign|partnership)\b/i, 0.35, 'mentions paid promotion'],
  [/\binfluencer\b/i, 0.2, 'mentions influencer'],
  [/\b(brand|campaign|ambassador)\b/i, 0.15, 'brand/campaign wording'],
  [/\b(rate card|media kit|usage rights|deliverables?)\b/i, 0.3, 'commercial terms'],
  [/\b(budget|fee|compensation|commission|affiliate)\b/i, 0.2, 'compensation wording'],
  [/\b(reel|youtube|tiktok|instagram|shorts|video)\b/i, 0.1, 'platform wording'],
  [/\b(gift(ed)?|free product|pr package)\b/i, 0.15, 'gifted product'],
];
const PAYMENT_TERMS = /\b(invoice|payment (received|sent|reminder)|remittance|paid you)\b/i;
const NEWSLETTER_TERMS = /\b(unsubscribe|newsletter|view in browser|no[- ]?reply)\b/i;

export function classifyMessage(input: ClassificationInput): ClassificationResult {
  const text = `${input.subject ?? ''}\n${input.body ?? ''}`;
  const signals: string[] = [];
  let score = 0;
  for (const [re, pts, label] of COLLAB_TERMS) {
    if (re.test(text)) {
      score += pts;
      signals.push(label);
    }
  }
  const isNewsletter = NEWSLETTER_TERMS.test(text) || /no[-_.]?reply@/i.test(input.fromEmail ?? '');
  if (isNewsletter) {
    score -= 0.4;
    signals.push('looks like a bulk/newsletter sender');
  }
  const money = extractMoney(text);
  const deadline = extractDeadline(text);
  const compensation = /\bgift(ed)?|free product|pr package\b/i.test(text)
    ? 'GIFTED'
    : /\baffiliate\b/i.test(text)
      ? 'AFFILIATE'
      : /\bcommission\b/i.test(text)
        ? 'COMMISSION'
        : money
          ? 'FLAT_FEE'
          : 'UNKNOWN';
  const missing: string[] = [];
  if (!money) missing.push('amount');
  if (!deadline) missing.push('deadline');
  if (!/\b(usage rights|licen[sc]e|exclusiv)/i.test(text)) missing.push('usage rights');
  if (!/\b(deliverables?|\d+\s*(reels?|videos?|posts?|shorts?))\b/i.test(text)) missing.push('deliverables');
  const confidence = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  let category: ClassificationResult['category'] = confidence >= 0.35 ? 'COLLABORATION' : 'UNRELATED';
  if (PAYMENT_TERMS.test(text) && confidence < 0.6) category = 'PAYMENT';
  if (isNewsletter && confidence < 0.5) category = 'NEWSLETTER';
  return {
    category,
    confidence,
    signals,
    extracted: {
      ...(money ?? {}),
      ...(deadline ? { deadline } : {}),
      brandGuess: guessBrand(input),
      compensation,
      missingTerms: missing,
    },
  };
}

function extractMoney(text: string): { amountMinor: number; currency: string } | null {
  const m =
    /(?:(USD|CAD|EUR|GBP|INR|AUD)\s?|([$€£₹]))\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s?(USD|CAD|EUR|GBP|INR|AUD)?/i.exec(text);
  if (!m) return null;
  const sym = m[2];
  const cur = (m[1] ?? m[5] ?? (sym === '€' ? 'EUR' : sym === '£' ? 'GBP' : sym === '₹' ? 'INR' : 'USD')).toUpperCase();
  const whole = Number(m[3].replace(/,/g, ''));
  const frac = m[4] ? Number(m[4].padEnd(2, '0')) : 0;
  return { amountMinor: whole * 100 + frac, currency: cur };
}

function extractDeadline(text: string): string | undefined {
  const iso = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(text);
  if (iso) return iso[1];
  const named =
    /\b(?:by|before|due|deadline[: ]*)\s*(?:on\s*)?((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*20\d{2})?)/i.exec(
      text,
    );
  return named?.[1];
}

function guessBrand(input: ClassificationInput): string | undefined {
  const email = input.fromEmail ?? '';
  const domain = email.split('@')[1]?.toLowerCase();
  const free = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'proton.me', 'protonmail.com'];
  if (domain && !free.includes(domain)) {
    const name = domain.split('.')[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return input.fromName ?? undefined;
}

export const DEFAULT_FOLLOW_UP_RULES = [
  { key: 'inbound_unanswered', label: 'Inbound message not replied to', hours: 24 },
  { key: 'reply_sla_warning', label: 'Approaching reply SLA', hours: 4 },
  { key: 'quote_followup', label: 'Quote follow-up', days: 5 },
  { key: 'deliverable_due', label: 'Deliverable due soon', days: [7, 3, 1] },
  { key: 'approval_overdue', label: 'Brand approval overdue', days: 3 },
  { key: 'report_due', label: 'Campaign report due', days: 2 },
  { key: 'invoice_due', label: 'Invoice due / overdue', days: 3 },
  { key: 'commission_payout', label: 'Expected commission payout', days: 2 },
  { key: 'thank_you', label: 'Post-campaign thank-you', days: 2 },
] as const;
