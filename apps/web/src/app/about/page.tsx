import type { Metadata } from 'next';
import Link from 'next/link';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = {
  title: { absolute: 'Kemokem' },
  description: 'Kemokem is a free, invitation-only workspace. There is no public sign-up.',
  robots: { index: true, follow: true },
  alternates: { canonical: `${LEGAL.site}/about` },
};

export default function About() {
  return (
    <>
      <p className="text-sm text-muted">{LEGAL.region}</p>
      <h1 className="font-serif text-3xl font-semibold tracking-tight">Kemokem</h1>
      <p>
        {LEGAL.product} is a private workspace operated by {LEGAL.operator}. It is free. There is no public
        sign-up and no subscription. A person can sign in only after {LEGAL.operator} invites them.
      </p>
      <p>
        Invited people use it to keep creative projects, index files that stay on their own computers, and connect
        social accounts they are allowed to manage. A post or message is sent when they confirm it, or at a time they
        schedule. Instagram, Facebook, and YouTube can be connected for that work. TikTok posting and TikTok direct
        messages are not available.
      </p>
      <p>
        <Link className="text-accent underline" href="/login">
          Sign in
        </Link>{' '}
        if you already have an invite.
      </p>
      <h2 className="pt-2 text-xl font-semibold">Policies</h2>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          <Link className="text-accent underline" href="/terms">
            Terms of Service
          </Link>
        </li>
        <li>
          <Link className="text-accent underline" href="/privacy">
            Privacy Policy
          </Link>
        </li>
        <li>
          <Link className="text-accent underline" href="/legal/data-deletion">
            Data deletion
          </Link>
        </li>
      </ul>
      <p>
        Contact{' '}
        <a className="text-accent underline" href={`mailto:${LEGAL.email}`}>
          {LEGAL.email}
        </a>
        .
      </p>
    </>
  );
}
