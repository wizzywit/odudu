import { schedule } from './timers';

export const record = { document: 'a', navigator: 'b' };
export const later = (run: () => void): (() => void) => schedule(run, 10);
export const { document: owner } = record;
export const named = ({ window: win }: { window: number }): number => win;
