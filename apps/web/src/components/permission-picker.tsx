'use client';

import { useState } from 'react';
import { OAUTH_PERMISSIONS, type OauthPermissionProvider } from '@creatoros/domain';
import { post } from '@/lib/api';
import { ActionButton, Button, Dialog } from '@/components/ui';

const NAMES: Record<OauthPermissionProvider, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  threads: 'Threads',
  tiktok: 'TikTok',
  snapchat: 'Snapchat',
};

/** Connect or reconnect asks only for the permissions left checked. */
export function PermissionConnect({
  provider,
  granted = [],
  extra = [],
  label,
  variant = 'secondary',
  size = 'md',
}: {
  provider: OauthPermissionProvider;
  granted?: string[];
  extra?: string[];
  label: string;
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  const catalog = OAUTH_PERMISSIONS[provider];
  const initial = new Set([
    ...catalog.filter((item) => item.required).map((item) => item.scope),
    ...granted.filter((scope) => catalog.some((item) => item.scope === scope)),
    ...extra,
  ]);
  const [chosen, setChosen] = useState<string[]>([...initial]);

  const show = () => {
    setChosen([...initial]);
    setNonce((n) => n + 1);
    setOpen(true);
  };

  return (
    <>
      <Button variant={variant} size={size} onClick={show}>
        {label}
      </Button>
      <Dialog
        open={open}
        nonce={nonce}
        onClose={() => setOpen(false)}
        title={`${NAMES[provider]} permissions`}
        wide
      >
        <p className="text-sm text-muted">
          {provider === 'snapchat'
            ? 'Check Public Profile only if this Snapchat app is allowlisted for it. Leaving it off does not open Snapchat, so a missing approval does not fail the login. Posting and analytics stay off until a later check shows Snapchat allowed them.'
            : 'Check the permissions this login should ask for. One permission the app has not approved makes the whole login fail, so leave that box off and connect with the rest. A feature that needs a skipped permission stays off until you reconnect and add it.'}
        </p>
        <ul className="mt-3 space-y-2">
          {catalog.map((item) => {
            const on = chosen.includes(item.scope);
            const had = granted.includes(item.scope);
            return (
              <li key={item.scope}>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={on}
                    disabled={item.required}
                    onChange={(e) =>
                      setChosen((cur) =>
                        e.target.checked ? [...cur, item.scope] : cur.filter((scope) => scope !== item.scope),
                      )
                    }
                  />
                  <span>
                    <span className="font-medium">{item.label}</span>
                    {item.required && <span className="text-muted"> · required</span>}
                    {had && <span className="text-muted"> · already granted</span>}
                    <span className="block text-xs text-muted">{item.detail}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <ActionButton
            variant="primary"
            onAction={async () => {
              const r = await post(`/integrations/${provider}/oauth/start`, {
                scopes: chosen,
                reconnect: granted.length > 0,
              });
              if (!r.authorizeUrl) throw new Error(r.steps?.[0] ?? 'This integration is not available yet.');
              window.location.href = r.authorizeUrl;
            }}
          >
            Continue to {NAMES[provider]}
          </ActionButton>
        </div>
      </Dialog>
    </>
  );
}
