import { assertUuid, request } from './client';
import type {
  ServiceRecord,
  ServiceRecordCreate,
  ServiceRecordPage,
  ServiceRecordPatch,
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
