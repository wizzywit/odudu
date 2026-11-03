# group

What more than one area reads of a group: its record as the server states it,
where it lives in the console and the list to pick one from.

## Rules owned

- One address for the groups list, a group, a new group (under a parent) and
  the trail above a group.
- A group is offered by its path, with its description after it.

The wire's field names are kept (`parent_id`, `admin_reach`): shared
capability rules read them as they come.

Imports `shared` only. Creating, moving, mapping roles onto and removing a
group are `pages/groups`'.
