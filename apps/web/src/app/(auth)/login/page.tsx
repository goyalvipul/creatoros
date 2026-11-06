'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api, ApiError, post, refresh } from '@/lib/api';
import Link from 'next/link';
import { BrandLogo, BrandSplash } from '@/components/brand-mark';
import { Button, Card, ErrorNote, Field, Input } from '@/components/ui';

function safeNext(n: string | null) {
  return n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/login') ? n : '/';
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // fresh install -> setup; already signed in -> app
    (async () => {
      try {
        const s = await api<{ initialized: boolean }>('/setup/status', { silent401: true });
        if (!s.initialized) return router.replace('/setup');
        try {
          await api('/me', { silent401: true });
          router.replace(safeNext(params.get('next')));
          return;
        } catch {
          /* not signed in */
        }
      } catch {
        /* server unreachable: show the form and let submit report it */
      }
      setChecking(false);
    })();
  }, [router, params]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(
        '/auth/login',
        { email: email.trim(), password, totp: totp || undefined },
        { silent401: true },
      );
      await refresh();
      router.replace(safeNext(params.get('next')));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TOTP_REQUIRED') setNeedTotp(true);
      else setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (checking) return <BrandSplash label="Checking" />;
  return (
    <Card className="w-full max-w-sm">
      <div className="mb-5 text-center">
        <BrandLogo className="mx-auto mb-3 h-16" />
        <h1 className="text-xl font-semibold">Sign in to Kemokem</h1>
        <p className="mt-1 text-sm text-muted">
          Private workspace. No account is shared or hosted elsewhere.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-3" aria-label="Sign in">
        <Field label="E-mail">
          <Input
            type="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {needTotp && (
          <Field label="Authenticator code" hint="Open your authenticator app and enter the 6-digit code.">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
            />
          </Field>
        )}
        {error != null && <ErrorNote error={error} />}
        <Button type="submit" variant="primary" busy={busy} className="w-full">
          Sign in
        </Button>
      </form>
      <nav className="mt-4 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted" aria-label="Policies">
        <Link href="/about" className="hover:text-text">About</Link>
        <Link href="/terms" className="hover:text-text">Terms</Link>
        <Link href="/privacy" className="hover:text-text">Privacy</Link>
        <Link href="/legal/data-deletion" className="hover:text-text">Data deletion</Link>
      </nav>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<BrandSplash label="Loading" />}>
      <LoginForm />
    </Suspense>
  );
}
