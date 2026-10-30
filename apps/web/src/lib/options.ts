'use client';

import {
  ASSET_KIND,
  CONTENT_FORMAT,
  CREATIVE_STATE,
  DEAL_STAGE,
  EXPENSE_CATEGORY,
  IDEA_STATUS,
  PAYMENT_METHOD,
  PLATFORM,
  PRIORITY,
  PROJECT_STAGE,
  PROJECT_TYPE,
  VARIANT_TYPE,
} from '@creatoros/domain';
import { useApi } from './api';

export const IDEA_FORMATS = CONTENT_FORMAT;
export const IDEA_STATUSES = IDEA_STATUS;
export const PRIORITIES = PRIORITY;
export const PROJECT_TYPES = PROJECT_TYPE;
export const PROJECT_STAGES = PROJECT_STAGE;

export const PROJECT_STAGE_LABELS: Record<(typeof PROJECT_STAGE)[number], string> = {
  DRAFT: 'Draft',
  IN_PROGRESS: 'In-Progress',
  READY: 'Ready',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};

export function projectStageLabel(stage: string): string {
  return PROJECT_STAGE_LABELS[stage as keyof typeof PROJECT_STAGE_LABELS] ?? stage;
}
export const PLATFORMS = PLATFORM;
export const ASSET_KINDS = ASSET_KIND;
export const CREATIVE_STATES = CREATIVE_STATE;
export const VARIANT_TYPES = VARIANT_TYPE;
export const DEAL_STAGES = DEAL_STAGE;
export const EXPENSE_CATEGORIES = EXPENSE_CATEGORY;
export const PAYMENT_METHODS = PAYMENT_METHOD;

export interface Brand {
  id: string;
  name: string;
  channels: {
    id: string;
    name: string;
    purpose?: string | null;
    accounts: { id: string; platform: string; handle: string; channelId: string; [k: string]: any }[];
  }[];
  [k: string]: any;
}

/** Brand → channel → account tree. Cached by SWR, so cheap to call from many components. */
export function useCatalog() {
  return useApi<Brand[]>('/catalog');
}

export function useBrands(): Brand[] {
  return useCatalog().data ?? [];
}

export function useAccounts() {
  const brands = useBrands();
  return brands.flatMap((b) =>
    b.channels.flatMap((c) => c.accounts.map((a) => ({ ...a, brandName: b.name, channelName: c.name }))),
  );
}

/** /roots returns { root, deviceName, fileCount... }; the UI works with the flattened shape. */
export function useRoots(refreshInterval?: number) {
  const res = useApi<any[]>('/roots', { refreshInterval });
  const data = res.data?.map((r) => ({
    ...r.root,
    deviceName: r.deviceName,
    deviceState: r.deviceState,
    fileCount: Number(r.fileCount ?? 0),
    missingCount: Number(r.missingCount ?? 0),
    stillWritingCount: Number(r.stillWritingCount ?? 0),
    totalBytes: Number(r.totalBytes ?? 0),
  }));
  return { ...res, data } as typeof res & { data: any[] | undefined };
}
