import { expect, it } from 'vitest';
import {
  minimalFailureView,
  rootFailureView,
  routeFailureView,
} from '#/widgets/failure/services/failureView';

const SHOWN = { details: 'Error ID: ABCD2345', message: null, messageLabel: '' };

it('says the page failed where the shell stays, and the shell failed where it does not', () => {
  expect(routeFailureView(false, SHOWN).panel.text).toMatch(/^This page could not be shown\./u);
  expect(routeFailureView(true, SHOWN).panel.text).toMatch(/^The console could not draw this/u);
});

it('carries the shown message and details into the panel, beside the shared wording', () => {
  const view = routeFailureView(false, {
    details: 'Error ID: ABCD2345',
    message: 'secret',
    messageLabel: 'Message',
  });
  expect(view.panel).toMatchObject({
    kicker: 'Unexpected error',
    title: 'Something went wrong',
    details: 'Error ID: ABCD2345',
    message: 'secret',
    messageLabel: 'Message',
  });
  expect([view.tryAgain, view.backToOverview, view.reload]).toEqual([
    'Try again',
    'Back to overview',
    'Reload the console',
  ]);
});

it('names the product on every standalone screen, and offers a reload at the root', () => {
  expect(routeFailureView(true, SHOWN).brand).toBe('odudu');
  expect(rootFailureView(SHOWN)).toMatchObject({ brand: 'odudu', reload: 'Reload the console' });
  expect(rootFailureView(SHOWN).panel.text).toMatch(/^The console stopped before/u);
});

it('names the id on the minimal page only when one could be made', () => {
  expect(minimalFailureView({ id: 'ABCD2345', route: '/', time: 't' }).idLine).toBe(
    'Error ID: ABCD2345',
  );
  expect(minimalFailureView(null).idLine).toBeNull();
});
