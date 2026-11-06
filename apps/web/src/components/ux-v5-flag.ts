/** Baked at build time. The preview image sets this to 1. A normal build leaves the current shell. */
export function uxV5(): boolean {
  return process.env.NEXT_PUBLIC_CREATOROS_UX_V5 === '1';
}
