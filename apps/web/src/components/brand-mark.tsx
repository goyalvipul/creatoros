import clsx from 'clsx';
import { Spinner } from '@/components/ui';

/** Wordmark for the sidebar, login page, and site header. Theme is on <html data-theme>. */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <span className={clsx('brand-mark shrink-0', className)}>
      <img src="/brand/kemokem-logo-light.png?v=2" alt="Kemokem" className="brand-on-light" />
      <img src="/brand/kemokem-logo-dark.png?v=2" alt="" className="brand-on-dark" />
    </span>
  );
}

/** Ribbon mark for loading screens, and for the installed app where the wordmark does not fit. */
export function BrandSymbol({ className }: { className?: string }) {
  return <img src="/brand/kemokem-symbol-transparent.png" alt="Kemokem" className={clsx('shrink-0 object-contain', className)} />;
}

export function BrandSplash({ label }: { label: string }) {
  return (
    <div className="grid justify-items-center gap-1 text-center">
      <BrandSymbol className="size-16" />
      <Spinner label={label} />
    </div>
  );
}
