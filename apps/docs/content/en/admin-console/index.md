---
title: Admin console
description: A guided first visit to the console, then one page for each area it manages.
---

# Admin console

The console is where you run Odudu with a mouse. You sign in, pick a tenant, and manage its people, applications, keys and settings from one menu. Everything it does goes through the same admin API your scripts can call, so a change made here is checked and recorded exactly as one made there.

The console signs an administrator in through the same flow your users meet, and keeps the tokens on the server. The browser holds a session cookie and nothing else. Every change an administrator makes is checked against the version they read and recorded in the audit trail.

## Start with the tour

[A first visit](./tour.mdx) takes ten minutes. You sign in, enter a tenant, find your way around the menu, look at one person and see the change that made them recorded in the audit trail.

## Then pick the area you need

Each page below does one job. It says what the area is for, walks through the common tasks in order, names the actions that cannot be undone, and ends with how to do the same through the API.

1. [Overview](./overview.mdx): what needs attention, and the tenant's addresses.

### Identity

2. [Subjects](./subjects.mdx): the people and services that sign in.
3. [Groups](./groups.mdx): sets of subjects that share roles.
4. [Roles](./roles.mdx): the names that tokens carry, and what holds them.

### Applications

5. [Clients](./clients.mdx): the applications that sign people in.
   - [Client branding](./client-branding.mdx): a client's own colours, logo and layout over the tenant's.
6. [Scopes](./scopes.mdx): what an application can ask to be let do.
7. [Registration tokens](./registration-tokens.mdx): let an application register itself.

### Security

8. [Sign-in flow](./sign-in-flow.mdx): what a person is asked, and in what order.
9. [Signing keys](./signing-keys.mdx): rotate the keys that sign tokens.
10. [Sessions](./sessions.mdx): see who is signed in and end it.

### Tenant

11. [Settings](./settings.mdx): lifetimes, password rules, lockouts and retention.
12. [Branding](./branding.mdx): the colours, logo and layout of the sign-in and account pages.
13. [Email](./email.mdx): the relay that sends verification and reset mail.

### Observe

14. [Audit trail](./audit-trail.mdx): every change and every refusal.

### System

For an administrator of the system tenant only.

15. [Tenants](./tenants.mdx): create, export, import, disable and delete a tenant. The Export entry of the menu is on this page too.
16. [System administrators](./system-administrators.mdx): who can reach every tenant.

## When you need the exact request

The [Console paths](../reference/transcripts/console-paths/index.md) transcripts record every route the console uses, with the real output. [An admin signs in and changes a user](../guides/admin-signs-in-and-changes-a-user.md) follows one administrator from sign-in to a change.
