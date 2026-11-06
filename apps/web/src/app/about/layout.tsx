import type { ReactNode } from 'react';
import { PublicDoc } from '@/components/public-doc';

export default function AboutLayout({ children }: { children: ReactNode }) {
  return <PublicDoc>{children}</PublicDoc>;
}
