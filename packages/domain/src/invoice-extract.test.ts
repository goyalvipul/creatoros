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
  it('judges a reply on its new text, not on the quoted earlier mail', () => {
    const body =
      'Thanks, will do!\n\nOn Mon, Sep 21, 2026 at 9:00 AM Studio <a@b.com> wrote:\n> Invoice INV-55 total due: $900.00 USD';
    expect(extractInvoiceHints({ subject: 'Re: hello', body, direction: 'OUTBOUND' })).toBeNull();
  });
  it('does not suggest from a bare amount next to the word invoice', () => {
    expect(
      extractInvoiceHints({
        subject: 'Plan',
        body: 'I will send an invoice for $500 soon',
        direction: 'OUTBOUND',
      }),
    ).toBeNull();
  });
  it('suggests from an invoice-named attachment alone', () => {
    const h = extractInvoiceHints({
      subject: 'Your invoice',
      body: 'Attached.',
      direction: 'INBOUND',
      attachmentNames: ['2026-001_invoice.pdf'],
    });
    expect(h).not.toBeNull();
    expect(h!.amountMinor).toBeNull();
  });
});
