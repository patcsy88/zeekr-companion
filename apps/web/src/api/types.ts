/**
 * Contract types come from packages/shared-types (generated from the FastAPI OpenAPI schema, with
 * a CI drift check). This file only re-exports them under the names the app uses and adds the few
 * client-side shapes that are not part of the contract. Type-only: nothing here exists at runtime.
 */
import type {
  components,
  ApiErrorCode,
  ApiErrorDetail,
  ApiErrorResponse,
  CurrentOdometer,
  Expense,
  ExpenseCategory,
  ExpenseCategoryTotal,
  ExpenseCreate,
  ExpenseMonthTotal,
  ExpensePage,
  ExpenseSummary,
  Reminder,
  ReminderCreate,
  ReminderKind,
  ReminderList,
  ReminderTemplate,
  ReminderTemplateList,
  ServiceRecord,
  ServiceRecordCreate,
  ServiceRecordPage,
  ServiceRecordPatch,
  TemplateCheckpoint,
  TokenResponse,
  Vehicle,
  VehicleInput,
} from '@zeekr-companion/shared-types';

export type {
  Expense,
  ExpenseCategory,
  ExpenseCategoryTotal,
  ExpenseCreate,
  ExpenseMonthTotal,
  ExpensePage,
  ExpenseSummary,
  CurrentOdometer,
  Reminder,
  ReminderCreate,
  ReminderKind,
  ReminderList,
  ReminderTemplate,
  ReminderTemplateList,
  ServiceRecord,
  ServiceRecordCreate,
  ServiceRecordPage,
  ServiceRecordPatch,
  TemplateCheckpoint,
  TokenResponse,
  Vehicle,
  VehicleInput,
};
export type FieldIssue = ApiErrorDetail;
export type ErrorCode = ApiErrorCode;
export type ApiErrorBody = ApiErrorResponse;

/**
 * What the UI edits. The contract's PATCH type allows null for every field; the client never
 * sends null for required fields, which keeps merging an edit into a queued create type-safe.
 */
export interface RecordEdit {
  date?: string;
  odometer?: number;
  description?: string;
  cost_minor?: number;
  provider?: string | null;
  notes?: string | null;
}

/** What the expense forms edit and the queue sends. Only notes may be null. */
export interface ExpenseEdit {
  date?: string;
  category?: ExpenseCategory;
  amount_minor?: number;
  notes?: string | null;
  energy_wh?: number | null;
}

/** What the reminder forms edit and the queue sends. Required fields are never null. */
export interface ReminderEdit {
  kind?: ReminderKind;
  title?: string;
  due_date?: string | null;
  due_odometer?: number | null;
  notes?: string | null;
  completed_on?: string | null;
}

type Schemas = components['schemas'];
export type WarrantyCoverage = Schemas['WarrantyCoverageOut'];
export type WarrantyCoverageCreate = Schemas['WarrantyCoverageCreate'];
export type WarrantyCoverageList = Schemas['WarrantyCoverageList'];
export type WarrantyClaim = Schemas['WarrantyClaimOut'];
export type WarrantyClaimCreate = Schemas['WarrantyClaimCreate'];
export type WarrantyClaimList = Schemas['WarrantyClaimList'];
export type WarrantyTemplate = Schemas['WarrantyTemplate'];
export type WarrantyTemplateItem = Schemas['WarrantyTemplateItem'];
export type WarrantyTemplateList = Schemas['WarrantyTemplateList'];
export type ProviderType = WarrantyCoverage['provider_type'];
export type VerificationStatus = WarrantyCoverage['verification_status'];
export type WarrantyStatusValue = WarrantyCoverage['status'];
export type ClaimStatus = WarrantyClaim['status'];

/** What the coverage forms edit and the queue sends. `source_kind` and `template_ref` never change. */
export interface CoverageEdit {
  name?: string;
  provider_type?: ProviderType;
  start_date?: string;
  end_date?: string | null;
  km_limit?: number | null;
  notes?: string | null;
  verification_status?: VerificationStatus;
  source_note?: string | null;
}

/** What the claim forms edit and the queue sends. `coverage_id` never changes. */
export interface ClaimEdit {
  date?: string;
  odometer?: number;
  description?: string;
  status?: ClaimStatus;
  cost_covered_minor?: number | null;
  notes?: string | null;
}
