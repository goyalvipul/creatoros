import type { Metadata } from 'next';
import Link from 'next/link';
import { OnThisPage } from '@/components/public-doc';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = {
  title: { absolute: 'Privacy Policy · Kemokem' },
  description: `How ${LEGAL.operator} handles information in Kemokem.`,
  robots: { index: true, follow: true },
  alternates: { canonical: `${LEGAL.site}/privacy` },
};

export default function Privacy() {
  return (
    <>
      <p className="text-sm text-muted">Effective {LEGAL.updated}</p>
      <h1 className="font-serif text-3xl font-semibold tracking-tight">Privacy Policy</h1>
      <OnThisPage
        items={[
          { id: 'who', label: 'Who operates it' },
          { id: 'collected', label: 'What is stored' },
          { id: 'why', label: 'Why' },
          { id: 'others', label: 'Other services' },
          { id: 'kit', label: 'Public kit' },
          { id: 'security', label: 'Safeguards' },
          { id: 'retention', label: 'Retention' },
          { id: 'rights', label: 'Your rights' },
        ]}
      />
      <p>
        This policy describes {LEGAL.product} at {LEGAL.site}. A platform returns data only after the account holder
        approves that platform&apos;s authorization screen. A category below is stored only when that approval, and a
        successful read, actually happen.
      </p>

      <h2 id="who" className="pt-2 text-xl font-semibold">Who operates it</h2>
      <p>
        {LEGAL.operator}, as an individual, in {LEGAL.region}, operates {LEGAL.product}. Contact{' '}
        <a className="text-accent underline" href={`mailto:${LEGAL.email}`}>
          {LEGAL.email}
        </a>
        . The app is invitation-only and is not directed at children.
      </p>

      <h2 id="collected" className="pt-2 text-xl font-semibold">What is stored</h2>
      <p>
        Sign-in stores an email, a password hash, a role, a timezone, session records, and an optional authenticator
        secret. The password itself is not stored.
      </p>
      <p>
        Access tokens and refresh tokens are encrypted before they are written to the database. They are used to call
        the platform that issued them.
      </p>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          Instagram, when those permissions are approved: account id and username, profile details, posts, captions,
          links, thumbnails, comments, and inbox messages, including a sender&apos;s public id and username. View,
          reach, follower totals, and a demographic breakdown are stored when insights access is approved and
          Instagram returns them.
        </li>
        <li>
          Facebook Page, when those permissions are approved: Page id and name, posts, comments, reactions, shares,
          and Page messages. View and follower totals, and country or city counts, are stored when insights access is
          approved and the Page returns them.
        </li>
        <li>
          YouTube, when those permissions are approved: the channel, video titles, descriptions, public statistics,
          comments, and watch time or audience percentages from YouTube Analytics. A video file is uploaded only after
          someone confirms that upload or saves a schedule for it.
        </li>
        <li>
          TikTok, only if a developer app is configured and someone connects: basic account information and that
          person&apos;s own video list. Direct messages are not available. Direct posting is not enabled.
        </li>
        <li>
          Gmail, when connected: message and thread identifiers and the text needed to show the inbox. Mail is not
          sent unless a separate send permission is approved and the sender confirms it.
        </li>
      </ul>
      <p>
        Files made on the operator&apos;s computers stay on those computers. {LEGAL.product} stores the path,
        technical details, and a preview. Project notes, invoices, and captions are whatever a member types.
      </p>

      <h2 id="why" className="pt-2 text-xl font-semibold">Why</h2>
      <p>
        The purposes are sign-in, showing connected accounts, drafting and sending confirmed or scheduled posts,
        reading comments and messages that were imported, analytics the granted scopes allow, file indexing, and
        troubleshooting. Counts are dated snapshots. A real zero stays zero. A number the platform did not return
        stays unknown. Follower totals are not added across platforms.
      </p>

      <h2 id="others" className="pt-2 text-xl font-semibold">Other services</h2>
      <p>
        Calling Instagram, Facebook, YouTube, Google, or TikTok sends that request to the platform. Those companies
        process it on their own systems, which may be outside Canada. {LEGAL.product} does not give them a copy of
        its database. Summaries in the app are calculated on the operator&apos;s server. This application does not
        send stored text to a hosted chat model. Video and voice generation runs on the operator&apos;s own computers
        when someone starts a job.
      </p>
      <p>
        The public site is served over HTTPS. The database is not published on the public internet.
      </p>

      <h2 id="kit" className="pt-2 text-xl font-semibold">Public media kit</h2>
      <p>
        The operator can publish a media kit at a public address under {LEGAL.site}/kit/. It shows only what he
        chooses to publish: a name, a short description, photos, handles, follower counts, and a few post titles with
        view counts. It does not list individual followers, comments, or messages. Private analytics stay behind
        sign-in.
      </p>

      <h2 id="security" className="pt-2 text-xl font-semibold">Safeguards and cookies</h2>
      <p>
        Tokens are encrypted with a key that is not stored in the database. Passwords are hashed. The session cookie
        is HttpOnly. Webhook logs omit the verification secret. This is not a promise that the system cannot be
        breached.
      </p>
      <p>
        Sign-in uses that session cookie. Theme and a few studio choices are stored in the browser. No advertising
        cookie or third-party analytics script is loaded by these pages. The installed app registers a service worker
        that does not cache page content.
      </p>

      <h2 id="retention" className="pt-2 text-xl font-semibold">Retention, disconnect, and backups</h2>
      <p>
        The application does not delete posts, comments, messages, analytics, or previews after a fixed number of
        days. They remain until someone deletes them or a deletion request is carried out. Disconnecting a platform
        deletes that connection&apos;s token and sync cursor. It does not by itself delete imported posts, comments,
        messages, or analytics. Steps are on the{' '}
        <Link className="text-accent underline" href="/legal/data-deletion">
          data deletion
        </Link>{' '}
        page.
      </p>
      <p>
        A database backup can still hold a copy after the live row is gone, until that backup file is deleted. The
        application does not expire backup files on a schedule.
      </p>
      <p>
        YouTube&apos;s developer policies expect data obtained from the YouTube API to be removed within seven days
        after access is revoked. {LEGAL.product} revokes the Google token on disconnect and does not yet delete the
        imported YouTube rows on that same action.
      </p>

      <h2 id="rights" className="pt-2 text-xl font-semibold">Access, correction, and deletion</h2>
      <p>
        You can ask for access, correction, or deletion of information {LEGAL.product} holds about you. Email{' '}
        <a className="text-accent underline" href={`mailto:${LEGAL.email}`}>
          {LEGAL.email}
        </a>{' '}
        from an address that shows you control the account, and name the platform and the account. Do not send a
        password or an access token. Canadian privacy law can apply to a private tool. A complaint can also be made
        to the Office of the Privacy Commissioner of Canada, or to the Office of the Information and Privacy
        Commissioner for British Columbia.
      </p>
      <p>
        The date at the top changes when this policy changes. Use of the tool is covered by the{' '}
        <Link className="text-accent underline" href="/terms">
          Terms of Service
        </Link>
        .
      </p>
    </>
  );
}
