import { beforeEach, expect, it, vi } from 'vitest';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';

beforeEach(() => {
  useUnsavedGuard.getState().reset();
});

const guard = () => useUnsavedGuard.getState();

it('lets a departure through at once when nothing is unsaved', () => {
  const leave = vi.fn();
  expect(guard().request(leave)).toBe(true);
  expect(leave).toHaveBeenCalledOnce();
  expect(guard().pending).toBeNull();
});

it('blocks a departure while any section is dirty, and holds it for an answer', () => {
  guard().setDirty('client/general', 'General');
  const leave = vi.fn();
  expect(guard().request(leave)).toBe(false);
  expect(leave).not.toHaveBeenCalled();
  expect(guard().pending).not.toBeNull();
  expect(guard().unsaved()).toEqual(['General']);
});

it('releases the block once the section is clean again', () => {
  guard().setDirty('client/general', 'General');
  guard().setDirty('client/general', null);
  const leave = vi.fn();
  expect(guard().request(leave)).toBe(true);
  expect(leave).toHaveBeenCalledOnce();
});

it('lets a held departure through once nothing is left unsaved under it', () => {
  guard().setDirty('client/general', 'General');
  const leave = vi.fn();
  guard().request(leave);
  guard().setDirty('client/general', null);
  expect(leave).toHaveBeenCalledOnce();
  expect(guard().pending).toBeNull();
});

it('holds a departure still when the dirty section goes because it was unmounted, not saved', () => {
  guard().setDirty('client/general', 'General');
  const leave = vi.fn();
  guard().request(leave);
  guard().forget('client/general');
  expect(leave).not.toHaveBeenCalled();
  expect(guard().pending).not.toBeNull();
  expect(guard().unsaved()).toEqual([]);
});

it('stays when told to, dropping the held departure', () => {
  guard().setDirty('client/general', 'General');
  const leave = vi.fn();
  guard().request(leave);
  guard().stay();
  expect(leave).not.toHaveBeenCalled();
  expect(guard().pending).toBeNull();
  expect(guard().unsaved()).toEqual(['General']);
});

it('leaves when told to, forgetting the work it discards', () => {
  guard().setDirty('client/general', 'General');
  guard().setDirty('client/tokens', 'Tokens');
  const leave = vi.fn();
  guard().request(leave);
  guard().leave();
  expect(leave).toHaveBeenCalledOnce();
  expect(guard().pending).toBeNull();
  expect(guard().unsaved()).toEqual([]);
});

it('answers only the latest departure it holds', () => {
  guard().setDirty('client/general', 'General');
  const first = vi.fn();
  const second = vi.fn();
  guard().request(first);
  guard().request(second);
  guard().leave();
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledOnce();
});

it('tells a held departure it was refused when the answer is stay', () => {
  guard().setDirty('client/general', 'General');
  const proceed = vi.fn();
  const refused = vi.fn();
  guard().request(proceed, refused);
  guard().stay();
  expect(refused).toHaveBeenCalledOnce();
  expect(proceed).not.toHaveBeenCalled();
});

it('refuses a held departure that a later one replaces', () => {
  guard().setDirty('client/general', 'General');
  const refused = vi.fn();
  guard().request(vi.fn(), refused);
  guard().request(vi.fn());
  expect(refused).toHaveBeenCalledOnce();
});

it('counts each leave, so sections still on screen can say they are dirty again', () => {
  guard().setDirty('client/general', 'General');
  const before = guard().generation;
  guard().request(vi.fn());
  guard().leave();
  expect(guard().generation).toBe(before + 1);
});

it('marks the page released once a full-page departure is under way', () => {
  expect(guard().released).toBe(false);
  guard().release();
  expect(guard().released).toBe(true);
  guard().reset();
  expect(guard().released).toBe(false);
});
