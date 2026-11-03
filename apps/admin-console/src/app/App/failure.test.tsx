import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lazyFeatureRoute } from '#/app/lazyFeatureRoute';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard';
import { resetConsole } from '#/testing/resetConsole';
import { failingAt } from '#/testing/mountFailing';
import { graceRoutes, renderConsoleAt } from '#/testing/renderConsole';

const broken = vi.hoisted(() => ({ page: true, shell: false, toasts: false }));

vi.mock('#/pages/subjects', async (importOriginal) => {
  const { createElement } = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SubjectsPage: () => {
      if (broken.page) throw new Error('subjects secret detail');
      return createElement('h1', null, 'Subjects are fine');
    },
  };
});

vi.mock('#/pages/overview', async (importOriginal) => {
  const { createElement } = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    OverviewPage: () => createElement('h1', null, 'Overview is fine'),
  };
});

vi.mock('#/app/ToastLayer', () => ({
  ToastLayer: () => {
    if (broken.toasts) throw new Error('toast layer secret');
    return null;
  },
}));

vi.mock('#/widgets/shell', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const Real = actual.TenantShell as (props: { tenant: string; children: unknown }) => unknown;
  return {
    ...actual,
    TenantShell: (props: { tenant: string; children: unknown }) => {
      if (broken.shell) throw new Error('shell secret detail');
      return Real(props);
    },
  };
});

const ALL = ['view-users', 'manage-tenant'];
const routes = () => graceRoutes(ALL, {}, {});

beforeEach(() => {
  Object.assign(broken, { page: true, shell: false, toasts: false });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubEnv('DEV', false);
});

afterEach(() => {
  resetConsole();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function violations(): Promise<string[]> {
  const result = await axe.run(document.body);
  return result.violations.map((v) => `${v.id}: ${v.help}`);
}

function details(): string {
  return screen.getByRole('region', { name: 'error details' }).textContent;
}

function shownId(): string {
  return /Error ID: ([0-9A-Z]{8})/u.exec(details())?.[1] ?? '';
}

describe('a page that fails', () => {
  it('shows the panel inside the shell, which stays, with focus on its heading', async () => {
    renderConsoleAt('/console/acme/subjects', routes());
    const heading = await screen.findByRole('heading', { level: 1, name: 'Something went wrong' });
    const region = screen.getByRole('region', { name: 'Something went wrong' });
    expect(region).toContainElement(heading);
    // Only the summary is the alert: the heading is read by taking focus, the
    // buttons and details are not announced a second time.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('This page could not be shown');
    expect(alert).not.toContainElement(heading);
    expect(alert).not.toContainElement(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('navigation', { name: 'Areas of acme' })).toBeVisible();
    expect(screen.getByRole('main')).toContainElement(heading);
    expect(heading).toHaveFocus();
    expect(await violations()).toEqual([]);
  });

  it('names an id, the route template and the time, and never what the error said', async () => {
    renderConsoleAt('/console/acme/subjects?filter=ada', routes());
    await screen.findByRole('heading', { name: 'Something went wrong' });
    expect(document.body.textContent).not.toContain('subjects secret detail');
    expect(shownId()).toMatch(/^[0-9A-Z]{8}$/u);
    const text = details();
    expect(text).toMatch(
      /^Error ID: [0-9A-Z]{8}\nPage: \/\$tenant\/subjects\nTime: \d{4}-\d\d-\d\dT[\d:.]+Z$/u,
    );
    expect(text).not.toMatch(/acme|ada|filter/u);
  });

  it('copies exactly what it shows, and no more', async () => {
    const user = userEvent.setup();
    renderConsoleAt('/console/acme/subjects?filter=ada', routes());
    await screen.findByRole('heading', { name: 'Something went wrong' });
    const shown = screen.getByRole('region', { name: 'error details' }).textContent;
    await user.click(screen.getByRole('button', { name: 'Copy error details' }));
    expect(await navigator.clipboard.readText()).toBe(shown);
  });

  it('logs the same id with the whole error, for a developer to match', async () => {
    renderConsoleAt('/console/acme/subjects', routes());
    await screen.findByRole('heading', { name: 'Something went wrong' });
    const id = shownId();
    await waitFor(() => {
      expect(console.error).toHaveBeenCalledWith(
        `odudu console failure ${id} (rendering) at /$tenant/subjects`,
        expect.objectContaining({ message: 'subjects secret detail' }),
      );
    });
  });

  it('shows the message in a development build, and only there', async () => {
    vi.stubEnv('DEV', true);
    renderConsoleAt('/console/acme/subjects', routes());
    await screen.findByRole('heading', { name: 'Something went wrong' });
    expect(screen.getByText('subjects secret detail')).toBeVisible();
  });

  it('tries again, and shows the page once nothing throws', async () => {
    const user = userEvent.setup();
    renderConsoleAt('/console/acme/subjects', routes());
    await screen.findByRole('heading', { name: 'Something went wrong' });
    broken.page = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Subjects are fine' })).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('puts focus in the page, not on the document, once trying again recovers', async () => {
    const user = userEvent.setup();
    renderConsoleAt('/console/acme/subjects', routes());
    await screen.findByRole('heading', { name: 'Something went wrong' });
    broken.page = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Subjects are fine' })).toBeVisible();
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('does not ask the guard before trying again, since nothing is left', async () => {
    const user = userEvent.setup();
    renderConsoleAt('/console/acme/subjects', routes());
    await screen.findByRole('heading', { name: 'Something went wrong' });
    act(() => {
      useUnsavedGuard.getState().setDirty('client/general', 'General');
    });
    broken.page = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Subjects are fine' })).toBeVisible();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks the guard before Back to overview leaves the page', async () => {
    const user = userEvent.setup();
    const { router } = renderConsoleAt('/console/acme/subjects', routes());
    await screen.findByRole('heading', { name: 'Something went wrong' });
    act(() => {
      useUnsavedGuard.getState().setDirty('client/general', 'General');
    });
    await user.click(screen.getByRole('link', { name: 'Back to overview' }));
    expect(await screen.findByRole('alertdialog', { name: 'Leave without saving?' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/acme/subjects');
  });

  it('takes a new id when trying again fails again', async () => {
    const user = userEvent.setup();
    renderConsoleAt('/console/acme/subjects', routes());
    await screen.findByRole('heading', { name: 'Something went wrong' });
    const first = shownId();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(shownId()).not.toBe(first);
    });
  });

  it('resets on navigation, to the page it was sent to', async () => {
    const user = userEvent.setup();
    renderConsoleAt('/console/acme/subjects', routes());
    await screen.findByRole('heading', { name: 'Something went wrong' });
    await user.click(screen.getByRole('link', { name: 'Back to overview' }));
    expect(await screen.findByRole('heading', { name: 'Overview is fine' })).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Areas of acme' })).toBeVisible();
  });

  it('works from the keyboard alone', async () => {
    const user = userEvent.setup();
    renderConsoleAt('/console/acme/subjects', routes());
    const heading = await screen.findByRole('heading', { name: 'Something went wrong' });
    expect(heading).toHaveFocus();
    const region = screen.getByRole('region', { name: 'Something went wrong' });
    const names: string[] = [];
    for (let step = 0; step < 4; step += 1) {
      await user.tab();
      names.push(document.activeElement?.textContent ?? '');
    }
    expect(names.slice(0, 3)).toEqual(['Try again', 'Back to overview', 'Reload the console']);
    expect(within(region).getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('still asks before a reload throws unsaved work away', async () => {
    const user = userEvent.setup();
    const { leavePage } = renderConsoleAt('/console/acme/subjects', routes());
    await screen.findByRole('heading', { name: 'Something went wrong' });
    act(() => {
      useUnsavedGuard.getState().setDirty('client/general', 'General');
    });
    await user.click(screen.getByRole('button', { name: 'Reload the console' }));
    expect(await screen.findByRole('alertdialog', { name: 'Leave without saving?' })).toBeVisible();
    expect(leavePage).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Discard changes and leave' }));
    expect(leavePage).toHaveBeenCalledOnce();
  });
});

describe('a shell that fails', () => {
  it('shows the panel alone on the page, with a way back, and the shell gone', async () => {
    broken.shell = true;
    renderConsoleAt('/console/acme/subjects', routes());
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Something went wrong' }),
    ).toHaveFocus();
    expect(screen.queryByRole('navigation', { name: 'Areas of acme' })).toBeNull();
    expect(screen.getByRole('main')).toHaveTextContent('odudu');
    expect(screen.getByRole('link', { name: 'Back to overview' })).toHaveAttribute(
      'href',
      '/console/acme',
    );
    expect(document.body.textContent).not.toContain('shell secret detail');
    expect(await violations()).toEqual([]);
  });
});

describe('a failure outside every route', () => {
  it('shows the standalone fallback, which reads no context the tree provided', async () => {
    broken.toasts = true;
    renderConsoleAt('/console/acme/subjects', routes());
    const heading = await screen.findByRole('heading', { level: 1, name: 'Something went wrong' });
    expect(heading).toHaveFocus();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reload the console' })).toBeVisible();
    expect(document.body.textContent).not.toContain('toast layer secret');
    expect(shownId()).toMatch(/^[0-9A-Z]{8}$/u);
    expect(await violations()).toEqual([]);
  });
});

describe('a chunk that did not arrive', () => {
  it('keeps its own reload page, and is not the failure panel', async () => {
    const Chunked = lazyFeatureRoute(
      () => Promise.reject(new TypeError('Failed to fetch')),
      'Loading clients',
    );
    render(failingAt('/acme/clients', () => <Chunked />));
    expect(
      await screen.findByRole('heading', { name: 'This part of the console could not be loaded' }),
    ).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Something went wrong' })).toBeNull();
  });
});
