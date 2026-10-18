export const metadata = { title: 'Terms of Service · Creator OS' };

export default function Terms() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Terms of Service</h1>
      <p>
        Creator OS is a private tool run by Vipul Goyal for his own accounts. It is not a public service and
        is provided without any warranty. Only the owner and people he explicitly invites may use it.
      </p>
      <p>
        By connecting an Instagram account the owner confirms he is authorised to manage it and that he will
        follow the Instagram Platform Terms and Meta Platform Terms. The tool never sends messages or posts
        without the owner&apos;s explicit confirmation.
      </p>
      <p>
        See the{' '}
        <a className="text-accent underline" href="/legal/privacy">
          Privacy Policy
        </a>{' '}
        for how data is handled.
      </p>
    </>
  );
}
