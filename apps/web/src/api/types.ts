/**
 * Contract types come from packages/shared-types (generated from the FastAPI OpenAPI schema, with
 * a CI drift check). This file only re-exports them under the names the app uses and adds the few
 * client-side shapes that are not part of the contract. Type-only: nothing here exists at runtime.
 */
import type {
  ApiErrorCode,
  ApiErrorDetail,
  ApiErrorResponse,
  ServiceRecord,
  ServiceRecordCreate,
  ServiceRecordPage,
  ServiceRecordPatch,
  TokenResponse,
  Vehicle,
  VehicleInput,
} from '@zeekr-companion/shared-types';

export type {
  ServiceRecord,
  ServiceRecordCreate,
  ServiceRecordPage,
  ServiceRecordPatch,
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
