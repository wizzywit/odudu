# tenant

What more than one area reads of a tenant: its settings record, whether it
may be disabled, and which languages it offers.

## Rules owned

- One settings record per tenant, read and amended under one ETag: a save on
  one page rebases the sections of the others (`TENANT_SETTINGS_RECORD`).
- The system tenant cannot be disabled, and the reason is fixed text.
- What disabling a tenant costs, including the operator's own session when
  they are signed in to it.
- Which locales a tenant offers: the tags in its settings, ignoring
  anything that is not one.

The tenant record, its list and its creation are one page's and stay in
`pages/tenants`. Settings stay the contract's loose record; this entity's
adapter is the only reader of it.

Imports `shared` only. The four slices that save settings reach the adapter
and the repository through `use-cases/tenantSettingsAccess`.
