import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { expect, it } from 'vitest';
import {
  FormSkeleton,
  ListSkeleton,
  RecordSkeleton,
  Skeleton,
  SkeletonBar,
  TableSkeleton,
  TermsSkeleton,
} from '#/shared/view/Skeleton.tsx';
import css from '#/shared/view/Skeleton.module.css?raw';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const COLUMNS = [
  { header: 'Name' },
  { header: 'Status' },
  { header: 'Created', secondary: true },
] as const;

// One status line says what is loading; the shape beside it is hidden.
function expectOneStatus(container: HTMLElement, label: string): Element {
  const statuses = screen.getAllByRole('status');
  expect(statuses).toHaveLength(1);
  expect(statuses[0]).toHaveTextContent(label);
  const shape = container.querySelector('[role="status"] > [aria-hidden="true"]');
  expect(shape).not.toBeNull();
  return shape ?? container;
}

it('says what is loading and hides its placeholder bars', () => {
  const { container } = render(<Skeleton label="Loading clients" lines={4} />);
  const shape = expectOneStatus(container, 'Loading clients');
  expect(screen.getByRole('status')).not.toHaveAttribute('aria-busy');
  expect(shape.children).toHaveLength(4);
});

it('draws a table as its own header over five rows in its own columns', () => {
  const { container } = render(<TableSkeleton label="Loading clients" columns={COLUMNS} />);
  const shape = expectOneStatus(container, 'Loading clients');
  expect([...shape.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
    'Name',
    'Status',
    'Created',
  ]);
  const rows = shape.querySelectorAll('tbody tr');
  expect(rows).toHaveLength(5);
  for (const row of rows) expect(row.querySelectorAll('td')).toHaveLength(3);
  const [name, , created] = shape.querySelectorAll('thead th');
  const secondary = [...(created?.classList ?? [])].filter((c) => !name?.classList.contains(c));
  expect(secondary).toHaveLength(1);
  expect(rows[0]?.querySelectorAll('td')[2]?.classList).toContain(secondary[0]);
});

it('draws a record as a title bar, its tab strip and sections of labelled fields', () => {
  const { container } = render(
    <RecordSkeleton label="Loading the subject" tabs={['Profile', 'Credentials']} />,
  );
  const shape = expectOneStatus(container, 'Loading the subject');
  expect(shape.querySelector('[data-part="title"]')).not.toBeNull();
  expect(
    [...shape.querySelectorAll('[data-part="tabs"] > *')].map((tab) => tab.textContent),
  ).toEqual(['Profile', 'Credentials']);
  const sections = shape.querySelectorAll('[data-part="section"]');
  expect(sections.length).toBeGreaterThanOrEqual(2);
  for (const section of sections) {
    expect(section.querySelectorAll('[data-part="field"]').length).toBeGreaterThan(0);
  }
});

it('draws a form as label-and-field rows', () => {
  const { container } = render(<FormSkeleton label="Loading the profile" fields={4} />);
  const shape = expectOneStatus(container, 'Loading the profile');
  const fields = shape.querySelectorAll('[data-part="field"]');
  expect(fields).toHaveLength(4);
  for (const field of fields) expect(field.children).toHaveLength(2);
});

it('draws terms beside their values', () => {
  const { container } = render(<TermsSkeleton label="Loading the discovery document" rows={3} />);
  const shape = expectOneStatus(container, 'Loading the discovery document');
  const rows = shape.querySelectorAll('[data-part="term"]');
  expect(rows).toHaveLength(3);
  for (const row of rows) expect(row.children).toHaveLength(2);
});

it('draws a list as items of a name over a detail', () => {
  const { container } = render(<ListSkeleton label="Loading subjects" items={3} />);
  const shape = expectOneStatus(container, 'Loading subjects');
  expect(shape.querySelectorAll('[data-part="item"]')).toHaveLength(3);
});

it('offers a bare bar, hidden, for a value inside something already drawn', () => {
  const { container } = render(<SkeletonBar />);
  expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  expect(screen.queryByRole('status')).toBeNull();
});

it('shimmers only for somebody who has not asked for less motion', () => {
  const source = css.replace(/\/\*[\s\S]*?\*\//gu, '');
  const outside = source.replace(
    /@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\n\}/u,
    '',
  );
  expect(source).toMatch(
    /@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*animation:[^;]*shimmer/u,
  );
  expect(outside).not.toMatch(/animation\s*:/u);
});

const SHAPES: readonly (() => ReactElement)[] = [
  () => <Skeleton label="Loading clients" />,
  () => <TableSkeleton label="Loading clients" columns={COLUMNS} />,
  () => <RecordSkeleton label="Loading the subject" tabs={['Profile']} />,
  () => <FormSkeleton label="Loading the profile" />,
  () => <TermsSkeleton label="Loading the discovery document" />,
  () => <ListSkeleton label="Loading subjects" />,
];

it('passes axe in both themes, in every shape', async () => {
  for (const shape of SHAPES) {
    expect(await axeInBothThemes(shape)).toEqual({ light: [], dark: [] });
  }
});
