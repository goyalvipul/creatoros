import { extractMoney } from './classify';

export type InvoiceDirection = 'SENT_BY_ME' | 'BILL_TO_ME' | 'PAYMENT_NOTICE' | 'UNKNOWN';

export interface InvoiceHint {
  invoiceNo: string | null;
  amountMinor: number | null;
  currency: string | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  direction: InvoiceDirection;
  confidence: number;
  signals: string[];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const CUR = '(?:USD|CAD|EUR|GBP|INR|AUD)\\s?|[$€£₹]\\s?';

function toIso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m && dt.getUTCDate() === d
    ? dt.toISOString().slice(0, 10)
    : null;
}

function findDueDate(text: string): string | null {
  const m =
    /(?:due(?:\s+date)?|payable\s+by|pay\s+by|payment\s+due)\s*(?:on|by|:|-)?\s*(20\d{2}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+20\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+20\d{2})/i.exec(
      text,
    );
  if (!m) return null;
  const v = m[1]!;
  const iso = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(v);
  if (iso) return toIso(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const a = /([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})/i.exec(v);
  if (a) return toIso(Number(a[3]), MONTHS.indexOf(a[1]!.toLowerCase()), Number(a[2]));
  const b = /(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?,?\s+(20\d{2})/i.exec(v);
  if (b) return toIso(Number(b[3]), MONTHS.indexOf(b[2]!.toLowerCase()), Number(b[1]));
  return null;
}

/** Drops quoted earlier messages ("On … wrote:", "> …", forwarded headers) so a reply is judged on what it newly says. */
export function stripQuoted(body: string): string {
  const cut =
    /\bOn\s.{5,160}?\bwrote:|-{2,}\s*(?:Original Message|Forwarded message)\s*-{2,}|\bFrom:\s.{3,100}?\bSent:\s/is.exec(
      body,
    );
  const head = cut ? body.slice(0, cut.index) : body;
  return head
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('>'))
    .join('\n');
}

/**
 * Deterministic invoice spotting in one email. Returns null unless the text talks about an invoice AND carries an invoice
 * number or an amount. The result is only a suggestion: nothing is created without the owner confirming it.
 */
export function extractInvoiceHints(input: {
  subject?: string | null;
  body?: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  attachmentNames?: string[];
}): InvoiceHint | null {
  const text = `${input.subject ?? ''}\n${stripQuoted(input.body ?? '')}`.slice(0, 20000);
  const names = (input.attachmentNames ?? []).join(' ');
  const signals: string[] = [];
  const word = /\binvoices?\b|\binv[-_ ]?\d{2,}|\btax invoice\b|\bamount due\b|\bbalance due\b/i.test(text);
  const attach = /invoice|\binv[-_ ]?\d/i.test(names);
  if (!word && !attach) return null;
  if (word) signals.push('mentions an invoice');
  if (attach) signals.push('invoice-like attachment name');

  let invoiceNo: string | null = null;
  const nm = /\b(?:invoice|inv)\s*(?:no\.?|number|num\.?|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9\-/_]{2,24})/gi;
  for (let m = nm.exec(text); m; m = nm.exec(text)) {
    if (/\d/.test(m[1]!)) {
      invoiceNo = m[1]!.replace(/[-/_]+$/, '');
      break;
    }
  }
  if (!invoiceNo) {
    const fromFile = /\b(?:invoice|inv)[-_ ]?([A-Z0-9][A-Z0-9\-_]{2,24})\.(?:pdf|docx?|png|jpe?g)/i.exec(
      names,
    );
    if (fromFile && /\d/.test(fromFile[1]!)) invoiceNo = fromFile[1]!;
  }
  if (invoiceNo) signals.push('invoice number');

  let money: { amountMinor: number; currency: string } | null = null;
  const near = new RegExp(
    `(?:total(?:\\s+due)?|amount\\s+(?:due|payable)|balance\\s+due|grand\\s+total|invoice\\s+(?:amount|total)|amount)\\s*(?:\\(.*?\\))?\\s*[:\\-]?\\s*((?:${CUR})?\\d[\\d,]*(?:\\.\\d{1,2})?(?:\\s?(?:USD|CAD|EUR|GBP|INR|AUD))?)`,
    'i',
  ).exec(text);
  let strongAmount = false;
  if (near && /(?:USD|CAD|EUR|GBP|INR|AUD|[$€£₹])/i.test(near[1]!)) {
    money = extractMoney(near[1]!);
    strongAmount = money !== null;
  }
  money ??= extractMoney(text);
  if (money && money.amountMinor > 0) signals.push('amount');
  else money = null;

  // An invoice-named attachment alone is enough to suggest: the owner fills in what the email text does not say.
  // A bare dollar figure next to the word "invoice" is too weak ("I will send an invoice for $500"): need a number, an
  // invoice-named attachment, or an explicit "amount/total/balance due" figure.
  if (!invoiceNo && !attach && !strongAmount) return null;
  const dueDate = findDueDate(text);
  if (dueDate) signals.push('due date');

  let direction: InvoiceDirection = 'UNKNOWN';
  if (input.direction === 'OUTBOUND') direction = 'SENT_BY_ME';
  else if (
    /\b(?:payment|paid|transfer|remittance)\b.{0,40}\b(?:sent|made|processed|received|completed|issued)\b|\bhas been paid\b|\bwe(?:'ve| have) paid\b/i.test(
      text,
    )
  )
    direction = 'PAYMENT_NOTICE';
  else if (
    /\b(?:please\s+(?:find|see|pay)|amount due|payment due|due (?:on|by|date)|balance due|invoice (?:is )?(?:attached|enclosed))\b/i.test(
      text,
    )
  )
    direction = 'BILL_TO_ME';

  const confidence = Math.min(
    1,
    (word ? 0.35 : 0) +
      (attach ? 0.15 : 0) +
      (invoiceNo ? 0.25 : 0) +
      (money ? 0.2 : 0) +
      (dueDate ? 0.05 : 0),
  );
  // A payment notice without an invoice number is a receipt of money, not an invoice.
  if (direction === 'PAYMENT_NOTICE' && !invoiceNo) return null;
  return {
    invoiceNo,
    amountMinor: money?.amountMinor ?? null,
    currency: money?.currency ?? null,
    dueDate,
    direction,
    confidence: Math.round(confidence * 100) / 100,
    signals,
  };
}
