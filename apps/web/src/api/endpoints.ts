import { assertUuid, request } from './client';
import type {
  ClaimEdit,
  CoverageEdit,
  WarrantyClaim,
  WarrantyClaimCreate,
  WarrantyClaimList,
  WarrantyCoverage,
  WarrantyCoverageCreate,
  WarrantyCoverageList,
  WarrantyTemplateList,
  Expense,
  ExpenseCreate,
  ExpenseEdit,
  ExpensePage,
  Reminder,
  ReminderCreate,
  ReminderList,
  ReminderTemplateList,
  ServiceRecord,
  ServiceRecordCreate,
  ServiceRecordPage,
  ServiceRecordPatch,
  ReminderEdit,
  TokenResponse,
  Vehicle,
  VehicleInput,
} from './types';

export async function login(password: string): Promise<TokenResponse> {
  const { data } = await request<TokenResponse>({
    method: 'POST',
    path: '/auth/token',
    body: { password },
    auth: false,
  });
  return data;
}

export async function getVehicle(): Promise<Vehicle> {
  return (await request<Vehicle>({ method: 'GET', path: '/vehicle' })).data;
}

export async function putVehicle(vehicle: VehicleInput): Promise<Vehicle> {
  return (await request<Vehicle>({ method: 'PUT', path: '/vehicle', body: vehicle })).data;
}

export async function listServiceRecords(
  limit: number,
  cursor: string | null,
): Promise<ServiceRecordPage> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (cursor !== null) q.set('cursor', cursor);
  return (
    await request<ServiceRecordPage>({ method: 'GET', path: `/service-records?${q.toString()}` })
  ).data;
}

const recordPath = (id: string) => `/service-records/${encodeURIComponent(assertUuid(id))}`;

export async function getServiceRecord(id: string): Promise<ServiceRecord> {
  return (await request<ServiceRecord>({ method: 'GET', path: recordPath(id) })).data;
}

export async function createServiceRecord(body: ServiceRecordCreate): Promise<ServiceRecord> {
  return (await request<ServiceRecord>({ method: 'POST', path: '/service-records', body })).data;
}

export async function patchServiceRecord(
  id: string,
  body: ServiceRecordPatch,
): Promise<ServiceRecord> {
  return (await request<ServiceRecord>({ method: 'PATCH', path: recordPath(id), body })).data;
}

export async function deleteServiceRecord(id: string): Promise<void> {
  await request({ method: 'DELETE', path: recordPath(id) });
}

/** Always asks for completed reminders too: the device keeps them all and filters locally. */
export async function listReminders(): Promise<ReminderList> {
  return (await request<ReminderList>({ method: 'GET', path: '/reminders?include_completed=true' }))
    .data;
}

const reminderPath = (id: string) => `/reminders/${encodeURIComponent(assertUuid(id))}`;

export async function createReminder(body: ReminderCreate): Promise<Reminder> {
  return (await request<Reminder>({ method: 'POST', path: '/reminders', body })).data;
}

export async function patchReminder(id: string, body: ReminderEdit): Promise<Reminder> {
  return (await request<Reminder>({ method: 'PATCH', path: reminderPath(id), body })).data;
}

export async function deleteReminder(id: string): Promise<void> {
  await request({ method: 'DELETE', path: reminderPath(id) });
}

export async function listExpenses(limit: number, cursor: string | null): Promise<ExpensePage> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (cursor !== null) q.set('cursor', cursor);
  return (await request<ExpensePage>({ method: 'GET', path: `/expenses?${q.toString()}` })).data;
}

export async function createExpense(body: ExpenseCreate): Promise<Expense> {
  return (await request<Expense>({ method: 'POST', path: '/expenses', body })).data;
}

const expensePath = (id: string) => `/expenses/${encodeURIComponent(assertUuid(id))}`;

export async function patchExpense(id: string, body: ExpenseEdit): Promise<Expense> {
  return (await request<Expense>({ method: 'PATCH', path: expensePath(id), body })).data;
}

export async function deleteExpense(id: string): Promise<void> {
  await request({ method: 'DELETE', path: expensePath(id) });
}

export async function getReminderTemplates(): Promise<ReminderTemplateList> {
  return (await request<ReminderTemplateList>({ method: 'GET', path: '/reminder-templates' })).data;
}

export async function listCoverages(): Promise<WarrantyCoverageList> {
  return (await request<WarrantyCoverageList>({ method: 'GET', path: '/warranty-coverages' })).data;
}

export async function listClaims(): Promise<WarrantyClaimList> {
  return (await request<WarrantyClaimList>({ method: 'GET', path: '/warranty-claims' })).data;
}

export async function getWarrantyTemplates(): Promise<WarrantyTemplateList> {
  return (await request<WarrantyTemplateList>({ method: 'GET', path: '/warranty-templates' })).data;
}

const coveragePath = (id: string) => `/warranty-coverages/${encodeURIComponent(assertUuid(id))}`;
const claimPath = (id: string) => `/warranty-claims/${encodeURIComponent(assertUuid(id))}`;

export async function createCoverage(body: WarrantyCoverageCreate): Promise<WarrantyCoverage> {
  return (await request<WarrantyCoverage>({ method: 'POST', path: '/warranty-coverages', body }))
    .data;
}

export async function patchCoverage(id: string, body: CoverageEdit): Promise<WarrantyCoverage> {
  return (await request<WarrantyCoverage>({ method: 'PATCH', path: coveragePath(id), body })).data;
}

export async function deleteCoverage(id: string): Promise<void> {
  await request({ method: 'DELETE', path: coveragePath(id) });
}

export async function createClaim(body: WarrantyClaimCreate): Promise<WarrantyClaim> {
  return (await request<WarrantyClaim>({ method: 'POST', path: '/warranty-claims', body })).data;
}

export async function patchClaim(id: string, body: ClaimEdit): Promise<WarrantyClaim> {
  return (await request<WarrantyClaim>({ method: 'PATCH', path: claimPath(id), body })).data;
}

export async function deleteClaim(id: string): Promise<void> {
  await request({ method: 'DELETE', path: claimPath(id) });
}
