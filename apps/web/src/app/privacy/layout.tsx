import type { ReactNode } from 'react';
import { PublicDoc } from '@/components/public-doc';

export default function PrivacyLayout({ children }: { children: ReactNode }) {
  return <PublicDoc>{children}</PublicDoc>;
}
