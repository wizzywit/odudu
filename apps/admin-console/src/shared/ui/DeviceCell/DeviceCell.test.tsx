import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DeviceCell } from '#/shared/ui/DeviceCell';

const DEVICE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

it('shows the start of a device id, copies all of it, and keeps the whole value readable', () => {
  render(<DeviceCell device={DEVICE} />);
  expect(screen.getByText('a1b2c3d4…')).toBeInTheDocument();
  expect(screen.getByText(DEVICE)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy device id' })).toBeVisible();
});

it('shows a dash for a session opened before the id was recorded', () => {
  render(<DeviceCell device={null} />);
  expect(screen.getByText('—')).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
});
