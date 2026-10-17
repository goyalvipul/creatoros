/** Built-in content templates -> stage checklists, deliverables and per-channel variants. User editable copies are stored in DB. */

export interface TemplateItem {
  label: string;
  required: boolean;
  stage?: string;
}

export interface BuiltInTemplate {
  key: string;
  name: string;
  contentType: string;
  items: TemplateItem[];
  variants: string[];
}

const common: TemplateItem[] = [
  { label: 'Approve creative direction / brief', required: true, stage: 'DRAFT' },
  { label: 'Final export approved', required: true, stage: 'QA' },
  { label: 'Thumbnail / cover selected', required: false, stage: 'QA' },
  { label: 'Captions & hashtags drafted per platform', required: true, stage: 'READY' },
  { label: 'Sponsor / AI-content disclosure checked', required: true, stage: 'READY' },
];

export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  {
    key: 'general',
    name: 'General project',
    contentType: 'OTHER',
    variants: ['MASTER', 'SHORT_FORM'],
    items: [{ label: 'Goal and audience written down', required: true, stage: 'DRAFT' }, ...common],
  },
  {
    key: 'music_single',
    name: 'Music single',
    contentType: 'MUSIC_SINGLE',
    variants: ['MASTER', 'LYRIC_VIDEO', 'SHORT_FORM', 'THUMBNAIL'],
    items: [
      { label: 'Lyrics finalised', required: true, stage: 'DRAFT' },
      { label: 'Suno version chosen & audio master saved', required: true, stage: 'DRAFT' },
      { label: 'Storyboard / scene plan', required: true, stage: 'APPROVED' },
      { label: 'All scenes generated and a final selected for each', required: true, stage: 'GENERATING' },
      { label: 'Long-form music video edited', required: true, stage: 'EDITING' },
      { label: 'Short-form cut-downs exported', required: false, stage: 'EDITING' },
      ...common,
    ],
  },
  {
    key: 'lyric_video',
    name: 'Lyric video',
    contentType: 'LYRIC_VIDEO',
    variants: ['LYRIC_VIDEO', 'SHORT_FORM'],
    items: [{ label: 'Timed lyrics (SRT) ready', required: true, stage: 'DRAFT' }, ...common],
  },
  {
    key: 'performance_reel',
    name: 'Performance Reel',
    contentType: 'PERFORMANCE_REEL',
    variants: ['REEL', 'SHORTS'],
    items: [{ label: 'Hook (first 3s) approved', required: true, stage: 'DRAFT' }, ...common],
  },
  {
    key: 'shorts',
    name: 'Shorts',
    contentType: 'SHORTS',
    variants: ['SHORTS', 'REEL'],
    items: common,
  },
  {
    key: 'behind_the_scenes',
    name: 'Behind-the-scenes',
    contentType: 'BEHIND_THE_SCENES',
    variants: ['SHORT_FORM'],
    items: common,
  },
  {
    key: 'product_ugc',
    name: 'Product UGC',
    contentType: 'PRODUCT_UGC',
    variants: ['REEL', 'SHORTS'],
    items: [
      { label: 'Brand brief & usage rights confirmed', required: true, stage: 'DRAFT' },
      { label: 'Brand approval received (confirmed by owner)', required: true, stage: 'QA' },
      ...common,
    ],
  },
  {
    key: 'travel_vlog',
    name: 'Travel vlog',
    contentType: 'TRAVEL_VLOG',
    variants: ['LONG_FORM', 'SHORTS'],
    items: [{ label: 'Script & shot list', required: true, stage: 'DRAFT' }, ...common],
  },
  {
    key: 'education',
    name: 'Education',
    contentType: 'EDUCATION',
    variants: ['LONG_FORM', 'SHORTS'],
    items: [{ label: 'Script fact-checked', required: true, stage: 'DRAFT' }, ...common],
  },
];
