import { OduduError } from '#/errors';

// Ctx is left generic here: kernel knows nothing about subjects, users or
// tenants. The concrete context (whatever a mapper needs to compute its
// claims from) is defined by whichever protocol package instantiates this
// registry.
export interface ClaimMapper<Ctx> {
  readonly name: string;
  // A mapper runs when the granted scopes intersect this set at all — most
  // mappers declare exactly one scope, but a mapper is free to answer to
  // more than one.
  readonly scopes: readonly string[];
  // The claim names this mapper is capable of producing, declared
  // statically so discovery can advertise `claims_supported` without
  // invoking `map` against a real subject.
  readonly claims: readonly string[];
  map(ctx: Ctx): Promise<Record<string, unknown>>;
}

export class ClaimMapperRegistry<Ctx> {
  readonly #mappers = new Map<string, ClaimMapper<Ctx>>();

  register(mapper: ClaimMapper<Ctx>): this {
    if (this.#mappers.has(mapper.name)) {
      throw new OduduError(
        'claim_mapper_duplicate',
        `Claim mapper "${mapper.name}" is already registered`,
      );
    }
    this.#mappers.set(mapper.name, mapper);
    return this;
  }

  // A scope named in `bindings` reaches exactly the mappers listed for it,
  // replacing its default reach; a scope absent from `bindings` (never one
  // mapped to an empty list) falls back to every mapper that declares it.
  // The caller resolves this once per issuance, the same way it resolves
  // roles and groups — a mapper never reads a binding itself.
  #firesFor(
    mapper: ClaimMapper<Ctx>,
    scopes: readonly string[],
    bindings: ReadonlyMap<string, readonly string[]> | undefined,
  ): boolean {
    return scopes.some((scope) => {
      const bound = bindings?.get(scope);
      return bound === undefined ? mapper.scopes.includes(scope) : bound.includes(mapper.name);
    });
  }

  // Every mapper whose declared scopes intersect what was granted
  // contributes its claims; later mappers merge on top of earlier ones
  // rather than replacing the accumulated result.
  async assemble(
    scopes: readonly string[],
    ctx: Ctx,
    bindings?: ReadonlyMap<string, readonly string[]>,
  ): Promise<Record<string, unknown>> {
    let claims: Record<string, unknown> = {};

    for (const mapper of this.#mappers.values()) {
      if (this.#firesFor(mapper, scopes, bindings)) {
        claims = { ...claims, ...(await mapper.map(ctx)) };
      }
    }

    return claims;
  }

  // Every registered mapper's own name — what a caller binding a scope to
  // a chosen mapper set validates against, so it can never bind a name
  // `assemble` itself would not recognise.
  mapperNames(): readonly string[] {
    return [...this.#mappers.keys()];
  }

  // The full set of claim names this registry can ever produce, across
  // every registered mapper regardless of scope — what `claims_supported`
  // is built from, so it can never diverge from what `assemble` actually
  // returns.
  claimNames(): readonly string[] {
    const names = new Set<string>();
    for (const mapper of this.#mappers.values()) {
      for (const claim of mapper.claims) names.add(claim);
    }
    return [...names];
  }

  // Same reach `assemble` computes, without a subject to run mappers
  // against — what a tenant's own `claims_supported` is built from, so a
  // tenant that narrowed a scope's bindings advertises exactly that.
  claimNamesForScopes(
    scopes: readonly string[],
    bindings: ReadonlyMap<string, readonly string[]>,
  ): readonly string[] {
    const names = new Set<string>();
    for (const mapper of this.#mappers.values()) {
      if (this.#firesFor(mapper, scopes, bindings)) {
        for (const claim of mapper.claims) names.add(claim);
      }
    }
    return [...names];
  }
}
