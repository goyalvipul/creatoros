/** Strings the installed MiniMax node accepts on resolution.aspect_ratio. */
export const H3_ASPECTS = [
  '1:1 (Square)',
  '2:3 (Portrait Photo)',
  '3:2 (Photo)',
  '3:4 (Portrait Standard)',
  '4:3 (Standard)',
  '9:16 (Portrait Widescreen)',
  '16:9 (Widescreen)',
  '21:9 (Ultrawide)',
] as const;

const H3_ASPECT_ALIASES: Record<string, (typeof H3_ASPECTS)[number]> = {
  '16:9 (Landscape Widescreen)': '16:9 (Widescreen)',
  '3:4 (Portrait)': '3:4 (Portrait Standard)',
  '4:3 (Landscape)': '4:3 (Standard)',
  '2:3 (Portrait)': '2:3 (Portrait Photo)',
  '3:2 (Landscape)': '3:2 (Photo)',
};

/** The name ComfyUI will accept, or null when the value is not a known frame. */
export function h3AspectRatio(value: string): (typeof H3_ASPECTS)[number] | null {
  if ((H3_ASPECTS as readonly string[]).includes(value)) return value as (typeof H3_ASPECTS)[number];
  const alias = H3_ASPECT_ALIASES[value];
  if (alias) return alias;
  if (value === '9:16' || value.startsWith('9:16')) return '9:16 (Portrait Widescreen)';
  if (value === '16:9' || value.includes('16:9')) return '16:9 (Widescreen)';
  return null;
}
