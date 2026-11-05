import { type DomainCode } from '@odudu/domain-tenant';
import {
  DOMAIN_CANONICAL_DETAIL,
  DOMAIN_DETAILS,
  DOMAIN_FAILED_DETAIL,
  DOMAIN_NOT_VERIFIED_DETAIL,
  DOMAIN_SWITCH_CONFLICT_DETAIL,
  DOMAIN_VERIFY_THROTTLED_DETAIL,
} from '#/service/domain-messages';
import { problem, type Problem } from '#/view/problem';

// One entry per code `registerDomain` can refuse with. A route answers the
// entry its code names, so a code has the one status and type everywhere.
export const REGISTER_REFUSALS: Readonly<Record<DomainCode, Problem>> = {
  domain_system_tenant: problem(
    409,
    'about:blank#domain-system-tenant',
    'Conflict',
    DOMAIN_DETAILS.domain_system_tenant,
  ),
  domain_no_base_url: problem(
    409,
    'about:blank#domain-no-base-url',
    'Conflict',
    DOMAIN_DETAILS.domain_no_base_url,
  ),
  domain_limit: problem(409, 'about:blank#domain-limit', 'Conflict', DOMAIN_DETAILS.domain_limit),
  domain_already_registered: problem(
    409,
    'about:blank#domain-already-registered',
    'Conflict',
    DOMAIN_DETAILS.domain_already_registered,
  ),
  domain_verified_elsewhere: problem(
    409,
    'about:blank#domain-verified-elsewhere',
    'Conflict',
    DOMAIN_DETAILS.domain_verified_elsewhere,
  ),
  domain_host_ip_literal: problem(
    422,
    'about:blank#domain-host-ip-literal',
    'Unprocessable Content',
    DOMAIN_DETAILS.domain_host_ip_literal,
  ),
  domain_host_localhost: problem(
    422,
    'about:blank#domain-host-localhost',
    'Unprocessable Content',
    DOMAIN_DETAILS.domain_host_localhost,
  ),
  domain_host_operator: problem(
    422,
    'about:blank#domain-host-operator',
    'Unprocessable Content',
    DOMAIN_DETAILS.domain_host_operator,
  ),
  domain_host_reserved: problem(
    422,
    'about:blank#domain-host-reserved',
    'Unprocessable Content',
    DOMAIN_DETAILS.domain_host_reserved,
  ),
  domain_host_invalid: problem(
    422,
    'about:blank#domain-host-invalid',
    'Unprocessable Content',
    DOMAIN_DETAILS.domain_host_invalid,
  ),
};

export const notVerifiedProblem = (): Problem =>
  problem(409, 'about:blank#domain-not-verified', 'Conflict', DOMAIN_NOT_VERIFIED_DETAIL);

export const failedProblem = (): Problem =>
  problem(409, 'about:blank#domain-failed', 'Conflict', DOMAIN_FAILED_DETAIL);

export const canonicalProblem = (): Problem =>
  problem(409, 'about:blank#domain-canonical', 'Conflict', DOMAIN_CANONICAL_DETAIL);

export const switchConflictProblem = (): Problem =>
  problem(409, 'about:blank#domain-switch-conflict', 'Conflict', DOMAIN_SWITCH_CONFLICT_DETAIL);

export const verifyThrottledProblem = (): Problem =>
  problem(
    429,
    'about:blank#domain-verify-throttled',
    'Too Many Requests',
    DOMAIN_VERIFY_THROTTLED_DETAIL,
  );
