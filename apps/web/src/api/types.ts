/**
 * Contract types come from packages/shared-types (generated from the FastAPI OpenAPI schema, with
 * a CI drift check). This file only re-exports them under the names the app uses and adds the few
 * client-side shapes that are not part of the contract. Type-only: nothing here exists at runtime.
 */
import type {
  ApiErrorCode,
  ApiErrorDetail,
  ApiErrorResponse,
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
} from '@zeekr-companion/shared-types';

export type {
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

/** What the reminder forms edit and the queue sends. Required fields are never null. */
export interface ReminderEdit {
  kind?: ReminderKind;
  title?: string;
  due_date?: string | null;
  due_odometer?: number | null;
  notes?: string | null;
  completed_on?: string | null;
}
