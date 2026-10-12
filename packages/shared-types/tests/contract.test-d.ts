// Compile-time checks (run by `npm run typecheck`). They fail the build if the generated types
// stop matching the API contract (docs/architecture/api-contracts.md).
import type {
  ApiErrorCode,
  ApiErrorResponse,
  ErrorStatusCodes,
  paths,
  ServiceRecord,
  ServiceRecordPage,
  Vehicle,
} from "../src/index";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// Error codes: the contract table, exactly.
export type ErrorCodesMatchContract = Expect<
  Equal<ApiErrorCode, ErrorStatusCodes[keyof ErrorStatusCodes]>
>;

// Error shape: { error: { code, message, details: [{ field, issue }] } }
export type ErrorShape = Expect<
  Equal<
    ApiErrorResponse,
    { error: { code: ApiErrorCode; message: string; details: { field: string; issue: string }[] } }
  >
>;

// 429 is documented on the login endpoint, with the error shape.
type LoginResponses = paths["/api/v1/auth/token"]["post"]["responses"];
export type LoginHas429 = Expect<
  Equal<LoginResponses[429]["content"]["application/json"], ApiErrorResponse>
>;
export type LoginHas401 = Expect<
  Equal<LoginResponses[401]["content"]["application/json"], ApiErrorResponse>
>;
export type LoginRetryAfter = Expect<
  Equal<LoginResponses[429]["headers"]["Retry-After"], number>
>;

// Field names are snake_case and money/distances are numbers.
export type RecordFields = Expect<
  Equal<
    keyof ServiceRecord,
    | "id"
    | "date"
    | "odometer"
    | "provider"
    | "description"
    | "cost_minor"
    | "currency"
    | "notes"
    | "created_at"
    | "updated_at"
  >
>;
export type VehicleFields = Expect<
  Equal<
    keyof Vehicle,
    | "id"
    | "model"
    | "variant"
    | "drive"
    | "steering"
    | "registration"
    | "vin"
    | "purchase_date"
    | "purchase_price_minor"
    | "currency"
    | "tyre_spec"
  >
>;
export type PageShape = Expect<
  Equal<keyof ServiceRecordPage, "items" | "next_cursor">
>;
export type NextCursor = Expect<Equal<ServiceRecordPage["next_cursor"], string | null>>;
