export type ErrorCode =
  | 'config_invalid'
  | 'module_duplicate'
  | 'module_unknown_dependency'
  | 'module_cycle'
  | 'module_stop_failed'
  | 'realm_context_missing'
  | 'kek_invalid'
  | 'signing_key_not_found'
  | 'jwt_header_invalid'
  | 'jwt_kid_missing'
  | 'jwt_unknown_key'
  | 'jwt_alg_mismatch'
  | 'jwt_typ_mismatch'
  | 'claim_mapper_duplicate'
  | 'invalid_email'
  | 'seed_invalid_options'
  | 'seed_conflict'
  | 'insert_returned_no_row';

export class OduduError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OduduError';
    this.code = code;
  }
}
