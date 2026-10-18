export const metadata = { title: 'Privacy Policy · Creator OS' };

export default function Privacy() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Privacy Policy</h1>
      <p>
        Creator OS is a private, self-hosted tool operated by Vipul Goyal for managing his own creative
        brands (including the Instagram accounts @mehakviking and other accounts he owns). It is not offered to the
        public and has no public sign-up.
      </p>
      <h2 className="text-lg font-semibold">What is collected</h2>
      <p>
        Only when the owner connects an Instagram professional account: the account id, username and profile
        details; the account&apos;s posts (captions, links, thumbnails, counts); comments on those posts; and direct
        messages in the account&apos;s inbox, together with the sender&apos;s public Instagram id and username.
      </p>
      <h2 className="text-lg font-semibold">How it is used</h2>
      <p>
        To show the owner one inbox of comments and messages, to organise follow-ups and collaborations, and to
        let the owner write replies that he approves before anything is sent. Nothing is posted or sent
        automatically.
      </p>
      <h2 className="text-lg font-semibold">Storage and sharing</h2>
      <p>
        Data is stored in a database on the owner&apos;s own server. Access tokens are encrypted at rest. Data is
        not sold, shared with third parties or used for advertising or to train AI models.
      </p>
      <h2 className="text-lg font-semibold">Retention and deletion</h2>
      <p>
        Data is kept until the owner disconnects the account or asks for deletion. See{' '}
        <a className="text-accent underline" href="/legal/data-deletion">
          Data deletion
        </a>
        .
      </p>
      <h2 className="text-lg font-semibold">Contact</h2>
      <p>Vipul Goyal, via direct message to the @mehakviking Instagram account.</p>
    </>
  );
}
