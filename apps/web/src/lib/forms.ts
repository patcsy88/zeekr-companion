import type { FieldIssue } from '../api/types';

/** Server field names (API) -> form field ids. */
export function issuesByField(details: FieldIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of details) {
    out[d.field] = out[d.field] ? `${out[d.field] ?? ''}; ${d.issue}` : d.issue;
  }
  return out;
}
