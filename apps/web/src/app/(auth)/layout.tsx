import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="grid min-h-dvh place-items-center p-4">{children}</main>;
}
