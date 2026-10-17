/** Money is always integer minor units + ISO 4217 code. FX rates are decimals with a date and source. */

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF']);
const THREE_DECIMAL = new Set(['BHD', 'KWD', 'OMR', 'JOD', 'TND']);

export function minorExponent(currency: string): number {
  const c = currency.toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

export function toMinor(major: number, currency: string): number {
  return Math.round(major * 10 ** minorExponent(currency));
}

export function toMajor(minor: number, currency: string): number {
  return minor / 10 ** minorExponent(currency);
}

export function formatMinor(minor: number | null | undefined, currency: string, locale = 'en-CA'): string {
  if (minor == null) return '—';
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(toMajor(minor, currency));
}

export interface PaymentLike {
  amountMinor: number;
}

export function invoiceBalance(invoiceAmountMinor: number, payments: PaymentLike[]): { paid: number; due: number } {
  const paid = payments.reduce((s, p) => s + p.amountMinor, 0);
  return { paid, due: Math.max(0, invoiceAmountMinor - paid) };
}

export function deriveInvoiceStatus(args: {
  status: string;
  amountMinor: number;
  paidMinor: number;
  dueAt: Date | string | null;
  now?: Date;
}): 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'VOID' {
  if (args.status === 'VOID') return 'VOID';
  if (args.status === 'DRAFT') return 'DRAFT';
  if (args.paidMinor >= args.amountMinor && args.amountMinor > 0) return 'PAID';
  const overdue = args.dueAt && new Date(args.dueAt).getTime() < (args.now ?? new Date()).getTime();
  if (overdue) return 'OVERDUE';
  if (args.paidMinor > 0) return 'PARTIALLY_PAID';
  return 'ISSUED';
}

export function convertWithRate(minor: number, from: string, to: string, rate: number): number {
  const major = toMajor(minor, from) * rate;
  return toMinor(major, to);
}
