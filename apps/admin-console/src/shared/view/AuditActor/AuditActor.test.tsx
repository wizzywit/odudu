import type { AuditEvent } from '@odudu/contracts/admin';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { AuditActor } from '#/shared/view/AuditActor/AuditActor.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const ID = '0192f7a4-5c1e-7b3a-9d2e-6f8a1b2c3d4e';

type Actor = Pick<AuditEvent, 'actor_subject_id' | 'actor_name' | 'actor_origin'>;

function actor(overrides: Partial<Actor> = {}): Actor {
  return { actor_subject_id: ID, actor_name: 'grace', actor_origin: 'tenant', ...overrides };
}

it('names the actor, keeping the id on hover and to copy', () => {
  render(<AuditActor event={actor()} />);
  expect(screen.getByText('grace')).toHaveAttribute('title', ID);
  expect(screen.getByRole('button', { name: 'Copy actor subject id' })).toBeVisible();
  expect(screen.queryByText('from elsewhere')).toBeNull();
});

it('says a name is not shown when the row carries none', () => {
  render(<AuditActor event={actor({ actor_name: null })} />);
  expect(screen.getByText('name not shown')).toHaveAttribute('title', ID);
});

it('marks a system administrator as a caller from elsewhere', () => {
  render(<AuditActor event={actor({ actor_name: null, actor_origin: 'system' })} />);
  expect(screen.getByText('a system administrator')).toBeVisible();
  expect(screen.getByText('from elsewhere')).toBeVisible();
});

it("marks another tenant's caller as from elsewhere", () => {
  render(<AuditActor event={actor({ actor_name: null, actor_origin: 'other-tenant' })} />);
  expect(screen.getByText("another tenant's caller")).toBeVisible();
  expect(screen.getByText('from elsewhere')).toBeVisible();
});

it('says when no subject acted', () => {
  render(<AuditActor event={actor({ actor_subject_id: null, actor_name: null })} />);
  expect(screen.getByText('no subject')).toBeVisible();
  expect(screen.queryByRole('button')).toBeNull();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <ul>
        <li>
          <AuditActor event={actor()} />
        </li>
        <li>
          <AuditActor event={actor({ actor_name: null, actor_origin: 'system' })} />
        </li>
      </ul>
    )),
  ).toEqual({ light: [], dark: [] });
});
