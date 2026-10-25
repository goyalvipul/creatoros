import { pgEnum } from 'drizzle-orm/pg-core';
import * as d from '@creatoros/domain';

export const userRole = pgEnum('user_role', d.USER_ROLE);
export const userStatus = pgEnum('user_status', d.USER_STATUS);
export const membershipStatus = pgEnum('membership_status', d.MEMBERSHIP_STATUS);
export const platform = pgEnum('platform', d.PLATFORM);
export const provider = pgEnum('provider', d.PROVIDER);
export const connectionState = pgEnum('connection_state', d.CONNECTION_STATE);
export const provenance = pgEnum('provenance', d.PROVENANCE);

export const deviceState = pgEnum('device_state', d.DEVICE_STATE);
export const rootState = pgEnum('root_state', d.ROOT_STATE);
export const accessMethod = pgEnum('access_method', d.ACCESS_METHOD);
export const hashMode = pgEnum('hash_mode', d.HASH_MODE);
export const fileAvailability = pgEnum('file_availability', d.FILE_AVAILABILITY);
export const fileOperationKind = pgEnum('file_operation_kind', d.FILE_OPERATION_KIND);
export const fileOperationStatus = pgEnum('file_operation_status', d.FILE_OPERATION_STATUS);
export const probeState = pgEnum('probe_state', d.PROBE_STATE);
export const fileKind = pgEnum('file_kind', d.FILE_KIND);
export const scanJobType = pgEnum('scan_job_type', d.SCAN_JOB_TYPE);
export const scanStatus = pgEnum('scan_status', d.SCAN_STATUS);
export const verificationState = pgEnum('verification_state', d.VERIFICATION_STATE);
export const duplicateState = pgEnum('duplicate_state', d.DUPLICATE_STATE);
export const duplicateMethod = pgEnum('duplicate_method', d.DUPLICATE_METHOD);
export const previewStatus = pgEnum('preview_status', d.PREVIEW_STATUS);

export const assetKind = pgEnum('asset_kind', d.ASSET_KIND);
export const creativeState = pgEnum('creative_state', d.CREATIVE_STATE);
export const approvalState = pgEnum('approval_state', d.APPROVAL_STATE);
export const variantType = pgEnum('variant_type', d.VARIANT_TYPE);
export const ideaStatus = pgEnum('idea_status', d.IDEA_STATUS);
export const projectStage = pgEnum('project_stage', d.PROJECT_STAGE);
export const projectType = pgEnum('project_type', d.PROJECT_TYPE);
export const clipState = pgEnum('clip_state', d.CLIP_STATE);
export const generationStatus = pgEnum('generation_status', d.GENERATION_STATUS);
export const outputSelection = pgEnum('output_selection', d.OUTPUT_SELECTION);
export const contentFormat = pgEnum('content_format', d.CONTENT_FORMAT);

export const publicationState = pgEnum('publication_state', d.PUBLICATION_STATE);
export const scheduleStatus = pgEnum('schedule_status', d.SCHEDULE_STATUS);
export const privacy = pgEnum('privacy', d.PRIVACY);

export const dealStage = pgEnum('deal_stage', d.DEAL_STAGE);
export const compensationType = pgEnum('compensation_type', d.COMPENSATION_TYPE);
export const deliverableStatus = pgEnum('deliverable_status', d.DELIVERABLE_STATUS);
export const contractStatus = pgEnum('contract_status', d.CONTRACT_STATUS);
export const messageDirection = pgEnum('message_direction', d.MESSAGE_DIRECTION);
export const actionableState = pgEnum('actionable_state', d.ACTIONABLE_STATE);
export const triageState = pgEnum('triage_state', d.TRIAGE_STATE);
export const messageSource = pgEnum('message_source', d.MESSAGE_SOURCE);
export const invoiceStatus = pgEnum('invoice_status', d.INVOICE_STATUS);
export const paymentMethod = pgEnum('payment_method', d.PAYMENT_METHOD);
export const expenseCategory = pgEnum('expense_category', d.EXPENSE_CATEGORY);
export const externalOrgKind = pgEnum('external_org_kind', d.EXTERNAL_ORG_KIND);

export const actionState = pgEnum('action_state', d.ACTION_STATE);
export const priority = pgEnum('priority', d.PRIORITY);
export const severity = pgEnum('severity', d.SEVERITY);
export const syncState = pgEnum('sync_state', d.SYNC_STATE);
export const jobStatus = pgEnum('job_status', d.JOB_STATUS);
export const backupState = pgEnum('backup_state', d.BACKUP_STATE);
export const goalKind = pgEnum('goal_kind', d.GOAL_KIND);
export const goalPeriod = pgEnum('goal_period', d.GOAL_PERIOD);
export const goalMetric = pgEnum('goal_metric', d.GOAL_METRIC);
export const outboxState = pgEnum('outbox_state', d.OUTBOX_STATE);
