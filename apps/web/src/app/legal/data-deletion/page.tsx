import type { Metadata } from 'next';
import Link from 'next/link';
import { OnThisPage } from '@/components/public-doc';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = {
  title: { absolute: 'Data deletion · Kemokem' },
  description: `How to disconnect a platform and how to ask ${LEGAL.operator} to delete data held in Kemokem.`,
  robots: { index: true, follow: true },
  alternates: { canonical: `${LEGAL.site}/legal/data-deletion` },
};

export default function DataDeletion() {
  return (
    <>
      <p className="text-sm text-muted">Effective {LEGAL.updated}</p>
      <h1 className="font-serif text-3xl font-semibold tracking-tight">Data deletion</h1>
      <OnThisPage
        items={[
          { id: 'disconnect', label: 'Disconnect' },
          { id: 'revoke', label: 'Revoke at the platform' },
          { id: 'request', label: 'Ask for deletion' },
          { id: 'kept', label: 'What can remain' },
        ]}
      />
      <p>
        {LEGAL.product} is operated by {LEGAL.operator}. Disconnecting an account, revoking it at the platform, and
        deleting stored data are three different steps. Doing one of them does not do the others.
      </p>

      <h2 id="disconnect" className="pt-2 text-xl font-semibold">Disconnect a social account</h2>
      <p>
        A signed-in owner can disconnect a platform under Integrations. That deletes the stored access token and the
        sync cursor for that connection. Google and YouTube connections are also revoked at Google. Instagram and
        Facebook tokens are deleted in {LEGAL.product}. This app does not call Meta to revoke those tokens. Imported
        posts, comments, messages, and analytics remain.
      </p>

      <h2 id="revoke" className="pt-2 text-xl font-semibold">Revoke access at the platform</h2>
      <p>Removing the app in the platform&apos;s own settings stops the token from working.</p>
      <ul className="list-disc space-y-2 pl-5">
        <li>Instagram: Settings, Apps and websites, remove the app.</li>
        <li>Facebook: Settings, Apps and websites, remove the app.</li>
        <li>
          Google and YouTube:{' '}
          <a className="text-accent underline" href="https://security.google.com/settings/security/permissions">
            Google account permissions
          </a>
          .
        </li>
        <li>TikTok: Settings, Security, Apps and services.</li>
        <li>
          Threads: Settings, Account, Apps and websites, remove the app. That notice drops the stored Threads login.
          A deletion request from Threads also removes imported Threads posts. The link Threads is given shows when
          that request is complete.
        </li>
      </ul>

      <h2 id="request" className="pt-2 text-xl font-semibold">Ask for stored data to be deleted</h2>
      <p>
        Email{' '}
        <a className="text-accent underline" href={`mailto:${LEGAL.email}`}>
          {LEGAL.email}
        </a>{' '}
        and include the platform, the account name or id, and the words &quot;delete my data&quot;. Send it from an
        address that shows you control that account. Do not include a password, an access token, or a recovery code.
      </p>
      <p>
        {LEGAL.operator} will use that message to find the imported comments, messages, sender details, posts,
        analytics snapshots, and any remaining token for that account, and will reply on the same email thread when
        the deletion is done. There is no public form. A person who only commented or sent a message cannot press a
        button inside {LEGAL.product} to do this themselves.
      </p>

      <h2 id="kept" className="pt-2 text-xl font-semibold">What can remain</h2>
      <p>
        Original files stay on the computer that holds them. Deleting a library record does not delete that original.
        A preview on the server is removed when its file record is removed. A clip saved from the trim tool is a new
        file on that computer and is deleted only by a separate confirmed action.
      </p>
      <p>
        The owner can delete another member&apos;s sign-in from Settings. Files and posts they worked on stay. There
        is no control that deletes the operator&apos;s projects and library in one step.
      </p>
      <p>
        A database backup can still hold a copy after the live row is deleted. Backup files are not expired on a
        schedule. Disconnect does not take down a post that a platform has already published, and it does not cancel
        that publication&apos;s copy on the platform.
      </p>
      <p>
        See the{' '}
        <Link className="text-accent underline" href="/privacy">
          Privacy Policy
        </Link>
        .
      </p>
    </>
  );
}
