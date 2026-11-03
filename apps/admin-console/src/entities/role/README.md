# role

What more than one area reads of a role: its record as the server states it,
where it lives in the console, whose it is, the list to pick one from and the
roles a group or a scope hands on.

## Rules owned

- One address for the roles list, a role, a new role and the trail above a
  role.
- A role is told apart by its owner, spoken as well as shown: a tenant role,
  or the client whose key a token carries it under. The picker's wording and
  the tag read it from one service; the capabilities owner words the short and
  the tag forms.
- The roles a group or a scope maps are named from the picker's list and
  from what the mapping answers, a role with no record by its id, and the
  picker's description wins.
- What a role going away, or its edges changing, alters in the console: the
  group reads, the role and group records that name it, the lists, the picker
  and what anybody holds.

The wire's field names are kept (`client_key`, `admin_reach`): shared
capability rules and other entities read them as they come.

Imports `shared` only. Creating, amending, nesting and removing a role are
`pages/roles`'. `repository/rolesGoneReach` reaches other slices through
`use-cases/roleCache`.
