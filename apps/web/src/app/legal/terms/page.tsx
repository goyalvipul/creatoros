import type { Metadata } from 'next';
import Link from 'next/link';
import { OnThisPage } from '@/components/public-doc';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = {
  title: { absolute: 'Terms of Service · Kemokem' },
  description: `Terms for Kemokem, a free invitation-only tool operated by ${LEGAL.operator}.`,
  robots: { index: true, follow: true },
  alternates: { canonical: `${LEGAL.site}/terms` },
};

export default function Terms() {
  return (
    <>
      <p className="text-sm text-muted">Effective {LEGAL.updated}</p>
      <h1 className="font-serif text-3xl font-semibold tracking-tight">Terms of Service</h1>
      <OnThisPage
        items={[
          { id: 'operator', label: 'Operator' },
          { id: 'access', label: 'Access' },
          { id: 'service', label: 'The service' },
          { id: 'platforms', label: 'Platforms' },
          { id: 'publishing', label: 'Publishing' },
          { id: 'content', label: 'Your content' },
          { id: 'assistance', label: 'Assistance' },
          { id: 'use', label: 'Acceptable use' },
          { id: 'law', label: 'Law and contact' },
        ]}
      />
      <p>
        These terms apply to {LEGAL.product} at {LEGAL.site}. Signing in means you accept them.
      </p>

      <h2 id="operator" className="pt-2 text-xl font-semibold">Operator</h2>
      <p>
        {LEGAL.product} is operated by {LEGAL.operator}, as an individual, in {LEGAL.region}. Accounts are free.
        There is no paid subscription.
      </p>

      <h2 id="access" className="pt-2 text-xl font-semibold">Access</h2>
      <p>
        {LEGAL.product} is invitation-only. There is no public registration. The operator creates the first account
        and can invite other people. You keep your own password. You can end a session from the app. An optional
        authenticator code can be turned on. An invite does not transfer ownership of a connected social account.
      </p>
      <p>
        The operator can disable or delete another member&apos;s sign-in. Files and posts that person worked on stay.
        There is no control that erases the whole workspace in one step.
      </p>

      <h2 id="service" className="pt-2 text-xl font-semibold">The service</h2>
      <p>
        {LEGAL.product} is a private workspace for creative work: ideas, production projects, a library of files on
        the operator&apos;s computers, publishing drafts, a calendar, collaborations, and a social inbox. Scanning a
        folder does not move, rename, or delete the original file. The app can be offline during maintenance, or when
        a computer that holds the files is off.
      </p>

      <h2 id="platforms" className="pt-2 text-xl font-semibold">Connected accounts</h2>
      <p>
        Instagram, Facebook, YouTube, and TikTok connect only through that platform&apos;s own authorization screen.
        You must be allowed to manage the account. A permission added in a developer console is not used until it is
        approved on a fresh authorization. You follow that platform&apos;s terms for each connection you approve.
        {LEGAL.product} does not remove a platform&apos;s upload limits or review requirements.
      </p>
      <p>
        Disconnecting inside {LEGAL.product} deletes the stored access token and the sync cursor. Google and YouTube
        connections are also revoked at Google. Instagram and Facebook tokens are removed here. Those platforms do
        not get a matching revoke call from this app, so you should also remove the app in their settings. Imported
        posts, comments, messages, and analytics stay until they are deleted as described on the{' '}
        <Link className="text-accent underline" href="/legal/data-deletion">
          data deletion
        </Link>{' '}
        page.
      </p>

      <h2 id="publishing" className="pt-2 text-xl font-semibold">Publishing and replies</h2>
      <p>
        A post, comment, message, upload, or payment is sent only after a person confirms it, with two exceptions
        that are themselves choices. Saving a schedule sends that post when the chosen time arrives, without a second
        prompt at that moment. A workflow can send a social reply on its own only when that account is set to fully
        automatic sending, the global pause is off, and the message is not flagged as sensitive. Otherwise the reply
        waits for approval. The default is approval.
      </p>
      <p>
        The person who confirms a post is responsible for it, including music, likeness, and sponsor disclosure. A
        record typed in by hand is marked as entered by the operator. It is not a figure verified by the platform.
      </p>

      <h2 id="content" className="pt-2 text-xl font-semibold">Your content</h2>
      <p>
        You keep ownership of the media and text you put into {LEGAL.product}. Connecting a platform does not give
        the operator ownership of that account. {LEGAL.product} and its name belong to the operator. A suggestion or
        an analytics note is not a promise of results.
      </p>

      <h2 id="assistance" className="pt-2 text-xl font-semibold">Assistance inside the app</h2>
      <p>
        Summaries and follow-ups are calculated on the operator&apos;s server from data already stored. This
        application does not send that text to a hosted chat model. Video and voice jobs run on the operator&apos;s
        own computers when someone starts them. Output can be wrong, incomplete, or similar to someone else&apos;s
        work. Review it before you use it.
      </p>

      <h2 id="use" className="pt-2 text-xl font-semibold">Acceptable use</h2>
      <p>
        Do not use {LEGAL.product} to break a platform&apos;s rules, to access an account you are not allowed to
        manage, or to send anything that has not been confirmed under the rules above. The operator can remove an
        invite or disconnect a platform.
      </p>

      <h2 id="law" className="pt-2 text-xl font-semibold">Law, changes, and contact</h2>
      <p>
        These terms are meant to be read under the laws of British Columbia and the federal laws of Canada. How
        information is handled is in the{' '}
        <Link className="text-accent underline" href="/privacy">
          Privacy Policy
        </Link>
        . The date at the top changes when these terms change. Continued use after that date is acceptance of the
        update.
      </p>
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
