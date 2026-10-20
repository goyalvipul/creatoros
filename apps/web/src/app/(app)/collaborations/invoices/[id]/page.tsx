'use client';

import { useParams } from 'next/navigation';
import { InvoiceEditor } from '../../invoice-editor';

export default function EditInvoicePage() {
  const { id } = useParams<{ id: string }>();
  return <InvoiceEditor invoiceId={id} />;
}