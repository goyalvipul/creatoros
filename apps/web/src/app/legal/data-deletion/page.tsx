export const metadata = { title: 'Data deletion · Creator OS' };

export default function DataDeletion() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Data deletion instructions</h1>
      <p>You can remove everything Creator OS holds about an Instagram account in either of these ways:</p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          In Instagram: Settings &rarr; Apps and websites (Website permissions) &rarr; find the app and remove
          it. Creator OS can then no longer read the account, and its stored access token stops working.
        </li>
        <li>
          Ask for deletion: send a direct message to the @mehakviking Instagram account with the words
          &quot;delete my data&quot; from the account concerned. The operator will delete the stored comments,
          messages, sender details, posts and tokens for that account within 30 days and confirm by message.
        </li>
      </ol>
      <p>
        The owner can also disconnect an account at any time inside Creator OS (Integrations &rarr;
        Disconnect), which erases the stored token immediately.
      </p>
      <p>
        See the{' '}
        <a className="text-accent underline" href="/legal/privacy">
          Privacy Policy
        </a>
        .
      </p>
    </>
  );
}
