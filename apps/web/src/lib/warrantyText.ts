import type { ClaimStatus, ProviderType, VerificationStatus, WarrantyCoverage } from '../api/types';

/** AC-53: the only status wording. Never "covered" or "not covered". */
export function statusLabel(c: Pick<WarrantyCoverage, 'status' | 'expired_by'>): string {
  switch (c.status) {
    case 'active':
      return 'Active by the dates and km you entered';
    case 'expiring_soon':
      return 'Expiring soon';
    case 'not_started':
      return 'Not started';
    case 'expired': {
      const date = c.expired_by.includes('date');
      const km = c.expired_by.includes('odometer');
      return date && km ? 'Expired by date and km' : km ? 'Expired by km' : 'Expired by date';
    }
  }
}

export const TERMS_LINE =
  'Terms and exclusions are in your warranty documents. This app only records what you enter and does not say what any warranty includes or excludes.';

export const COMPUTED_OFFLINE =
  "Status is worked out on this device from your warranty entries, your service records and today's date in Malaysia. It is computed offline too and may differ from the server until the next sync.";

export const SOURCE_NOTE_WARNING =
  'Do not type identifiers here, such as certificate, policy, VIN or plate numbers.';

export const TYPE_LABELS: Record<ProviderType, string> = {
  factory: 'Factory warranty',
  extended: 'Extended warranty',
};
export const TYPES: ProviderType[] = ['factory', 'extended'];

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  confirmed: 'Confirmed',
  proposed: 'Proposed',
  unverified: 'Unverified',
};
export const VERIFICATIONS: VerificationStatus[] = ['unverified', 'proposed', 'confirmed'];

export const SOURCE_KIND_LABELS: Record<WarrantyCoverage['source_kind'], string> = {
  owner_entered: 'Entered by you',
  template: 'From the suggested template',
};

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  completed: 'Completed',
};
export const CLAIM_STATUSES: ClaimStatus[] = ['submitted', 'approved', 'rejected', 'completed'];
