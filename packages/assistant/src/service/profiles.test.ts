import { TOOLS } from '@odudu/mcp';
import { describe, expect, it } from 'vitest';
import {
  activeToolsFor,
  FREE_CHAT,
  modeForProfile,
  profileById,
  PROFILES,
  REVIEW_CLIENT,
  SIGN_IN_TROUBLE,
} from '#/service/profiles';
import { assistantTools, assistantWriteTools } from '#/service/tool-set';

const OFFERED = [...assistantTools(TOOLS), ...assistantWriteTools(TOOLS)];
const READS = new Set(TOOLS.filter((tool) => tool.access === 'read').map((tool) => tool.name));

describe('the profiles', () => {
  it('are found by id and unknown ids are not', () => {
    expect(profileById('free-chat')).toBe(FREE_CHAT);
    expect(profileById('why-cant-sign-in')).toBe(SIGN_IN_TROUBLE);
    expect(profileById('review-client')).toBe(REVIEW_CLIENT);
    expect(profileById('nonesuch')).toBeUndefined();
  });

  it('name tools that exist, and only reads the assistant may use', () => {
    const allowed = new Set(assistantTools(TOOLS).map((tool) => tool.name));
    for (const profile of PROFILES) {
      if (profile.tools === 'all') continue;
      for (const name of profile.tools) {
        expect(READS.has(name), `${profile.id}: ${name}`).toBe(true);
        expect(allowed.has(name), `${profile.id}: ${name}`).toBe(true);
      }
    }
  });

  it('give the sign-in profile what decides whether someone can sign in', () => {
    expect(SIGN_IN_TROUBLE.tools).toEqual(
      expect.arrayContaining([
        'get_subject',
        'get_subject_lockout',
        'get_subject_required_actions',
        'list_subject_sessions',
        'get_subject_roles',
      ]),
    );
  });

  it('give the client review what a client is configured with', () => {
    expect(REVIEW_CLIENT.tools).toEqual(
      expect.arrayContaining(['get_client', 'get_client_installation', 'list_scopes']),
    );
  });

  it('read only, and take no sub-agent', () => {
    for (const profile of [SIGN_IN_TROUBLE, REVIEW_CLIENT]) {
      expect(profile.mode).toBe('ask');
      expect(profile.subagents).toBe('never');
    }
  });
});

describe('activeToolsFor', () => {
  it('offers a read profile only its own tools', () => {
    const names = activeToolsFor(SIGN_IN_TROUBLE, OFFERED).map((tool) => tool.name);
    expect(names.sort()).toEqual([...SIGN_IN_TROUBLE.tools].sort());
  });

  it('offers free chat every read and every change the conversation could use', () => {
    expect(activeToolsFor(FREE_CHAT, OFFERED)).toEqual(OFFERED);
  });

  it('never offers a write to a profile that is Ask only, whatever it lists', () => {
    const wide = { ...REVIEW_CLIENT, tools: 'all' as const };
    const offered = activeToolsFor(wide, OFFERED);
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.every((tool) => tool.access === 'read')).toBe(true);
  });
});

describe('modeForProfile', () => {
  const actOnly = { ...FREE_CHAT, mode: 'act' as const };

  it('starts an any-mode profile in the mode asked for, Ask by default', () => {
    expect(modeForProfile(FREE_CHAT, undefined)).toBe('ask');
    expect(modeForProfile(FREE_CHAT, 'act')).toBe('act');
  });

  it('starts an Ask profile in Ask and refuses Act for it', () => {
    expect(modeForProfile(REVIEW_CLIENT, undefined)).toBe('ask');
    expect(modeForProfile(REVIEW_CLIENT, 'act')).toBeNull();
  });

  it('starts an Act-only profile in Act and refuses Ask for it', () => {
    expect(modeForProfile(actOnly, undefined)).toBe('act');
    expect(modeForProfile(actOnly, 'ask')).toBeNull();
  });
});
