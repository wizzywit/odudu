import * as events from '../transport/events';
import build, { createEvents as make } from '../transport/events';

export const viaMember = events.createEvents();
export const viaAlias = make();
export const viaDefault = build();
