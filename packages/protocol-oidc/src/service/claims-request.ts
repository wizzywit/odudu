import { z } from 'zod';

// Chosen, not specified: comfortably above any legitimate §5.5 document and
// far below the sort of input the size check exists to refuse before it
// reaches JSON.parse. `/authorize` takes this parameter by GET or POST, so
// no transport ceiling bounds it for us.
export const MAX_CLAIMS_PARAMETER_BYTES = 8192;

export interface ClaimRequestEntry {
  readonly essential: boolean;
  readonly value?: string;
  readonly values?: readonly string[];
}

export type ClaimsRequestMember = Readonly<Record<string, ClaimRequestEntry>>;

export interface ClaimsRequest {
  readonly idToken: ClaimsRequestMember;
  readonly userinfo: ClaimsRequestMember;
}

// What an absent parameter parses to, and what every code-minting door
// parks on a request that never carried one — `{}` members, not a missing
// field, so a reader never has to distinguish "requested nothing" from
// "never asked".
export const EMPTY_CLAIMS_REQUEST: ClaimsRequest = { idToken: {}, userinfo: {} };

export type ClaimsRequestOutcome =
  | { readonly kind: 'ok'; readonly request: ClaimsRequest }
  | {
      readonly kind: 'invalid';
      readonly reason?: 'too_large' | 'invalid_json' | 'invalid_shape';
    };

const claimEntrySchema = z
  .object({
    essential: z.boolean().optional(),
    value: z.string().optional(),
    values: z.array(z.string()).optional(),
  })
  .nullable();

const claimsMemberSchema = z.record(z.string(), claimEntrySchema).optional();

const claimsRequestSchema = z.object({
  id_token: claimsMemberSchema,
  userinfo: claimsMemberSchema,
});

type ParsedEntry = z.infer<typeof claimEntrySchema>;
type ParsedMember = z.infer<typeof claimsMemberSchema>;

function toEntry(entry: ParsedEntry | undefined): ClaimRequestEntry {
  if (entry === null || entry === undefined) return { essential: false };
  return {
    essential: entry.essential ?? false,
    ...(entry.value !== undefined ? { value: entry.value } : {}),
    ...(entry.values !== undefined ? { values: entry.values } : {}),
  };
}

function toMember(member: ParsedMember): ClaimsRequestMember {
  if (member === undefined) return {};
  const result: Record<string, ClaimRequestEntry> = {};
  for (const [name, entry] of Object.entries(member)) {
    result[name] = toEntry(entry);
  }
  return result;
}

export function parseClaimsRequest(raw: string | undefined): ClaimsRequestOutcome {
  if (raw === undefined) {
    return { kind: 'ok', request: { idToken: {}, userinfo: {} } };
  }

  if (Buffer.byteLength(raw, 'utf8') > MAX_CLAIMS_PARAMETER_BYTES) {
    return { kind: 'invalid', reason: 'too_large' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'invalid', reason: 'invalid_json' };
  }

  const result = claimsRequestSchema.safeParse(parsed);
  if (!result.success) {
    return { kind: 'invalid', reason: 'invalid_shape' };
  }

  return {
    kind: 'ok',
    request: {
      idToken: toMember(result.data.id_token),
      userinfo: toMember(result.data.userinfo),
    },
  };
}
