// Public, types-only entry point. Everything here is erased at compile time.
// The source of truth is the FastAPI OpenAPI schema (see src/api.d.ts, generated).
// Do not import React, the DOM or any runtime code in this package.
import type { components, paths } from "./api";

export type { components, paths };

type Schemas = components["schemas"];

export type TokenRequest = Schemas["TokenRequest"];
export type TokenResponse = Schemas["TokenResponse"];

export type Vehicle = Schemas["VehicleOut"];
export type VehicleInput = Schemas["VehicleIn"];

export type ServiceRecord = Schemas["ServiceRecordOut"];
export type ServiceRecordCreate = Schemas["ServiceRecordCreate"];
export type ServiceRecordPatch = Schemas["ServiceRecordPatch"];
export type ServiceRecordPage = Schemas["ServiceRecordPage"];

export type Reminder = Schemas["ReminderOut"];
export type ReminderCreate = Schemas["ReminderCreate"];
export type ReminderPatch = Schemas["ReminderPatch"];
export type ReminderList = Schemas["ReminderList"];
export type ReminderKind = Reminder["kind"];
export type ReminderStatus = Reminder["status"];
export type CurrentOdometer = Schemas["CurrentOdometer"];
export type ReminderTemplate = Schemas["ReminderTemplate"];
export type ReminderTemplateList = Schemas["ReminderTemplateList"];
export type TemplateCheckpoint = Schemas["TemplateCheckpoint"];

export type Expense = Schemas["ExpenseOut"];
export type ExpenseCreate = Schemas["ExpenseCreate"];
export type ExpensePatch = Schemas["ExpensePatch"];
export type ExpensePage = Schemas["ExpensePage"];
export type ExpenseSummary = Schemas["ExpenseSummary"];
export type ExpenseCategoryTotal = Schemas["ExpenseCategoryTotal"];
export type ExpenseMonthTotal = Schemas["ExpenseMonthTotal"];
export type ExpenseCategory = Expense["category"];

/** Error body returned for every non-2xx response under /api. */
export type ApiErrorResponse = Schemas["ErrorResponse"];
export type ApiError = Schemas["ErrorBody"];
export type ApiErrorDetail = Schemas["ErrorDetail"];
export type ApiErrorCode = ApiError["code"];

/** HTTP statuses the contract defines for errors, and the code each one carries. */
export interface ErrorStatusCodes {
  400: "validation_error";
  401: "unauthenticated";
  404: "not_found";
  405: "method_not_allowed";
  409: "conflict";
  429: "rate_limited";
  500: "internal_error";
}
export type ApiErrorStatus = keyof ErrorStatusCodes;

/** 429 also carries a `Retry-After` header (seconds); it is not part of the JSON body. */
export interface RateLimitedResponse extends ApiErrorResponse {
  error: ApiError & { code: "rate_limited" };
}
