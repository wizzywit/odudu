# area

The catalogue of console areas: the path, label, capability and paging
behaviour of each page the rail lists, and the address an area lives at
under a tenant.

## Rules owned

- Which areas exist, in what groups, and which of them only a system
  administrator sees (`SYSTEM_AREAS`).
- What capability an area's first read needs.
- An area's address under a tenant, its name encoded (`areaHref`), and where a failed page sends a person back to: the
  tenant's overview, or the console root (`overviewHref`).

Imports `shared` only. Whether a principal sees an area is not decided here.
