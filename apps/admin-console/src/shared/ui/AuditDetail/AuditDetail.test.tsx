import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { AuditDetail } from '#/shared/ui/AuditDetail/AuditDetail';
import { auditEvent } from '#/testing/auditFixtures';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

const EVENT = auditEvent({
  id: '01a0ee8c-69d4-7064-bae0-23af3f0d9bf6',
  occurred_at: '2026-09-28T13:41:05.250Z',
  actor_tenant_id: 'tenant-1',
  actor_client_id: 'client-9',
  actor_name: 'grace',
  resource_id: 'c1',
  detail: { enabled: { before: true, after: false }, reason: 'builtin_admin_guarded' },
});

function field(name: string): HTMLElement {
  const term = screen.getByText(name, { selector: 'dt' });
  const value = term.nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`no value for ${name}`);
  return value;
}

it('shows every field the audit event has', () => {
  render(<AuditDetail event={EVENT} zone="Africa/Lagos" />);
  expect(field('Event id')).toHaveTextContent('01a0ee8c-69d4-7064-bae0-23af3f0d9bf6');
  expect(field('When')).toHaveTextContent('2026-09-28 14:41:05 Africa/Lagos (UTC+01:00)');
  expect(field('When')).toHaveTextContent('2026-09-28 13:41:05 UTC');
  expect(field('Event type')).toHaveTextContent('admin_mutation');
  expect(field('Action')).toHaveTextContent('client.update');
  expect(field('Outcome')).toHaveTextContent('allowed');
  expect(field('Actor')).toHaveTextContent('grace');
  expect(field('Actor tenant')).toHaveTextContent('tenant-1');
  expect(field('Actor client')).toHaveTextContent('client-9');
  expect(field('Resource type')).toHaveTextContent('client');
  expect(field('Resource id')).toHaveTextContent('c1');
  expect(field('Request id')).toHaveTextContent('req-7f3a9c');
  expect(field('Address')).toHaveTextContent('203.0.113.9');
});

it('copies each id, and says what is not there', () => {
  render(
    <AuditDetail
      event={auditEvent({
        actor_client_id: null,
        actor_tenant_id: null,
        ip: null,
        request_id: null,
      })}
      zone="UTC"
    />,
  );
  for (const name of ['event id', 'actor subject id', 'resource id']) {
    expect(screen.getByRole('button', { name: `Copy ${name}` })).toBeVisible();
  }
  expect(field('Actor client')).toHaveTextContent('none');
  expect(field('Request id')).toHaveTextContent('none sent');
  expect(field('Address')).toHaveTextContent('none');
});

it('reads the detail as keys and values, a change as before and after', () => {
  render(<AuditDetail event={EVENT} zone="UTC" />);
  const detail = screen.getByRole('region', { name: 'Detail' });
  expect(within(detail).getByText('enabled')).toBeVisible();
  expect(within(detail).getByText('true → false')).toBeVisible();
  expect(within(detail).getByText('builtin_admin_guarded')).toBeVisible();
  expect(detail).toHaveTextContent('before → after');
});

it('says when no detail was recorded', () => {
  render(<AuditDetail event={auditEvent({ detail: {} })} zone="UTC" />);
  expect(screen.getByText('No further detail was recorded for this event.')).toBeVisible();
});

it('puts a value that looks like markup on the page as text', () => {
  render(
    <AuditDetail
      event={auditEvent({ detail: { note: '<img src=x onerror=alert(1)>' } })}
      zone="UTC"
    />,
  );
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
  expect(document.querySelector('img')).toBeNull();
});

it('cuts a long value, and shows the rest on request', async () => {
  const user = userEvent.setup();
  const long = `start-${'x'.repeat(400)}-end`;
  render(<AuditDetail event={auditEvent({ detail: { note: long } })} zone="UTC" />);
  expect(screen.queryByText(long)).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Show the whole value of note' }));
  expect(screen.getByText(long)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Show less of note' }));
  expect(screen.queryByText(long)).toBeNull();
});

it('links the resource and the actor where the page knows a place for them', () => {
  render(
    <AuditDetail
      event={EVENT}
      zone="UTC"
      resourceHref="/console/acme/clients/c1"
      actorHref="/console/acme/subjects/s1"
    />,
  );
  expect(screen.getByRole('link', { name: 'Open the client' })).toHaveAttribute(
    'href',
    '/console/acme/clients/c1',
  );
  expect(screen.getByRole('link', { name: 'Open the actor' })).toHaveAttribute(
    'href',
    '/console/acme/subjects/s1',
  );
});

it('explains a caller from elsewhere, who cannot be named here', () => {
  render(
    <AuditDetail event={auditEvent({ actor_name: null, actor_origin: 'system' })} zone="UTC" />,
  );
  expect(field('Actor')).toHaveTextContent('from elsewhere');
  expect(field('Actor')).toHaveTextContent(/system administrator acting across tenants/u);
});

it('says why a name is not shown for an actor of this tenant', () => {
  render(<AuditDetail event={auditEvent({ actor_name: null })} zone="UTC" />);
  expect(field('Actor')).toHaveTextContent(/holds view-users/u);
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => <AuditDetail event={EVENT} zone="UTC" resourceHref="/x" />),
  ).toEqual({ light: [], dark: [] });
});
