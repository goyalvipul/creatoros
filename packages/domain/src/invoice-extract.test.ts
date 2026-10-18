import { describe, expect, it } from 'vitest';
import { extractInvoiceHints } from './invoice-extract';

describe('extractInvoiceHints', () => {
  it('reads number, amount and due date', () => {
    const h = extractInvoiceHints({
      subject: 'Invoice INV-2026-0042 for your campaign',
      body: 'Please find attached the invoice.\nTotal due: $1,250.50 USD\nDue date: Nov 15, 2026',
      direction: 'INBOUND',
    });
    expect(h).toMatchObject({
      invoiceNo: 'INV-2026-0042',
      amountMinor: 125050,
      currency: 'USD',
      dueDate: '2026-11-15',
      direction: 'BILL_TO_ME',
    });
    expect(h!.confidence).toBeGreaterThan(0.8);
  });
  it('marks outbound mail as sent by me', () => {
    const h = extractInvoiceHints({
      subject: 'Invoice #1001',
      body: 'Amount due: CAD 500',
      direction: 'OUTBOUND',
    });
    expect(h).toMatchObject({ direction: 'SENT_BY_ME', amountMinor: 50000, currency: 'CAD' });
  });
  it('flags payment notices', () => {
    const h = extractInvoiceHints({
      subject: 'Payment sent for invoice INV-77',
      body: 'Payment has been sent for invoice INV-77, $300.',
      direction: 'INBOUND',
    });
    expect(h?.direction).toBe('PAYMENT_NOTICE');
  });
  it('ignores mail without invoice number or amount, and unrelated mail', () => {
    expect(
      extractInvoiceHints({ subject: 'Please send your invoice', body: 'Thanks!', direction: 'INBOUND' }),
    ).toBeNull();
    expect(
      extractInvoiceHints({ subject: 'Hello', body: 'Lets collab for $500', direction: 'INBOUND' }),
    ).toBeNull();
  });
});
