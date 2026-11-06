import type { ReactNode } from 'react';
import { PublicDoc } from '@/components/public-doc';

export default function LegalLayout({ children }: { children: ReactNode }) {
  return <PublicDoc>{children}</PublicDoc>;
}
