import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBff } from '#/testing/fake-bff';
import { OduduProvider } from '#/ui/OduduProvider';
import { SignedIn } from '#/ui/SignedIn';
import { SignedOut } from '#/ui/SignedOut';
import { useAuth } from '#/use-cases/use-auth';

const mode = { kind: 'bff', baseUrl: '/bff' } as const;

function tree() {
  return (
    <OduduProvider mode={mode}>
      <SignedIn>in</SignedIn>
      <SignedOut>out</SignedOut>
    </OduduProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fakeBff('/bff').fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SignedIn and SignedOut', () => {
  it('render by status and nothing while loading', async () => {
    render(tree());
    expect(screen.queryByText('in')).toBeNull();
    expect(screen.queryByText('out')).toBeNull();
    expect(await screen.findByText('in')).toBeDefined();
    expect(screen.queryByText('out')).toBeNull();
  });

  it('show the signed-out side when there is no session', async () => {
    const bff = fakeBff('/bff');
    bff.authenticated = false;
    vi.stubGlobal('fetch', bff.fetch);
    render(tree());
    await waitFor(() => {
      expect(screen.queryByText('out')).not.toBeNull();
    });
    expect(screen.queryByText('in')).toBeNull();
  });

  it('render nothing when the session check failed, so an outage cannot loop a sign-in', async () => {
    const bff = fakeBff('/bff');
    bff.sessionStatus = 503;
    vi.stubGlobal('fetch', bff.fetch);
    function Probe() {
      return <span>{useAuth().status}</span>;
    }
    render(
      <OduduProvider mode={mode}>
        <SignedIn>in</SignedIn>
        <SignedOut>out</SignedOut>
        <Probe />
      </OduduProvider>,
    );
    await screen.findByText('signedOut');
    expect(screen.queryByText('out')).toBeNull();
    expect(screen.queryByText('in')).toBeNull();
  });
});
