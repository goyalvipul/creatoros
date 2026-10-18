import { ImageResponse } from 'next/og';

export const dynamic = 'force-static';

export async function GET(_req: Request, ctx: { params: Promise<{ size: string }> }) {
  const { size } = await ctx.params;
  const px = size === '1024' ? 1024 : size === '512' ? 512 : 192;
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg,#5b5bf0,#8b5cf6)',
        color: 'white',
        fontSize: px * 0.46,
        fontWeight: 800,
        letterSpacing: -px * 0.02,
      }}
    >
      C/OS
    </div>,
    { width: px, height: px },
  );
}

export function generateStaticParams() {
  return [{ size: '192' }, { size: '512' }, { size: '1024' }];
}
