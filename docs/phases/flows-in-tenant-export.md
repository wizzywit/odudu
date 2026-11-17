# Flows in the tenant export and import

A small increment after P4f, not a phase. P4f placed "an export carries the
default flow only" on P7 with the document's move between installations. The
placement gave no topic reason: flows, `client_oidc_config.flow_id` and step
settings were P4f's, and the document already carried step `settings`. It was
done here instead.

What it does: the document gains `flow_name`, `flows` and `clients[].flow`,
all optional under version 1 (design: `2026-11-17-flows-in-tenant-export-design.md`, under
`docs/superpowers/specs/` and then `docs/archive/specs/`). The
export reads the tenant's flows once; an import validates them like the default
flow, then writes the default (renamed), the named flows and the clients in the
one import transaction.

What it found:

- A client may be pinned to the default flow's row, so the export names that
  flow by the default's name and an import resolves it back to the default row;
  exporting it as "follows the default" would have changed what the client runs
  once the default changed.
- The default is found by its flag, never by name: a tenant can rename it or
  make another flow the default, and a named flow may then be called `default`.
  An import renames the default before it creates the others.

Still on P7: the published theme, the clients' themes and the images they use.

- The export reads its tables in separate statements at the default isolation
  level. A flow created and assigned by another administrator during an export
  could be missing from the list of flows, so the export reads the clients
  first and the flows after: a flow a client names cannot be deleted while it
  is named. The rest of the document (roles, groups, scopes) has the same
  exposure and is not fixed here; one repeatable-read snapshot of the whole
  export is placed on P7 with the document's move between installations.
