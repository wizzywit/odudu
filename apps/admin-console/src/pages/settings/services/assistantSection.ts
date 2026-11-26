import { ASSISTANT_SETTING_DEFAULTS } from '@odudu/contracts/admin';
import type { SettingsSection } from '#/pages/settings/services/sectionTypes';

// The cache key the assistant's settings are read and saved under.
export const ASSISTANT_RECORD = 'assistant-settings';
export const ASSISTANT_SECTION_ID = 'assistant';
export const ASSISTANT_HEADING_ID = 'settings-assistant';
export const ASSISTANT_NAV_GROUP = 'Assistant';

export const ASSISTANT_WORDS = {
  title: 'Console assistant',
  description:
    'Whether this tenant’s administrators are offered the assistant, what it may do by default, what it keeps and how much it may spend. Every setting starts at a safe default.',
  noun: 'the assistant settings',
  loading: 'Loading the assistant settings',
  failed: 'The assistant settings could not be loaded',
  needs: ['manage-assistant'],
  groups: {
    availability: 'Availability',
    privacy: 'Privacy and records',
    limits: 'Limits',
  },
} as const;

type Switch = 'assistant_enabled' | 'assistant_mask_emails' | 'assistant_auditor_visible';
type Amount =
  | 'assistant_trace_retention_days'
  | 'assistant_monthly_tokens_fast'
  | 'assistant_monthly_tokens_standard'
  | 'assistant_monthly_tokens_deep'
  | 'assistant_max_concurrent'
  | 'assistant_max_steps_per_turn';

// What a fresh tenant holds, said the way the field says its value, so a
// person can tell a setting they changed from one nobody has.
function defaultOnOff(name: Switch): string {
  return `Default: ${ASSISTANT_SETTING_DEFAULTS[name] ? 'on' : 'off'}.`;
}

function defaultMode(): string {
  return `Default: ${ASSISTANT_SETTING_DEFAULTS.assistant_default_mode === 'act' ? 'Act' : 'Ask'}.`;
}

function defaultAmount(name: Amount, unit: string): string {
  return `Default: ${ASSISTANT_SETTING_DEFAULTS[name].toLocaleString('en-US')} ${unit}.`;
}

export const ASSISTANT_SECTION: SettingsSection = {
  id: ASSISTANT_SECTION_ID,
  title: ASSISTANT_WORDS.title,
  description: ASSISTANT_WORDS.description,
  fields: [
    {
      name: 'assistant_enabled',
      label: 'Offer the assistant',
      control: 'toggle',
      group: ASSISTANT_WORDS.groups.availability,
      description: `Off stops offering it to anyone in this tenant; nothing already recorded is deleted. ${defaultOnOff('assistant_enabled')}`,
    },
    {
      name: 'assistant_default_mode',
      label: 'Starts in',
      control: 'choice',
      group: ASSISTANT_WORDS.groups.availability,
      description: `The mode a person starts in; they can switch it in the panel. ${defaultMode()}`,
      options: [
        { id: 'ask', label: 'Ask: the assistant only reads' },
        { id: 'act', label: 'Act: it may propose changes, each waiting for approval' },
      ],
    },
    {
      name: 'assistant_mask_emails',
      label: 'Mask email addresses',
      control: 'toggle',
      group: ASSISTANT_WORDS.groups.privacy,
      description: `Replace email addresses before anything is sent to the model provider. ${defaultOnOff('assistant_mask_emails')}`,
    },
    {
      name: 'assistant_auditor_visible',
      label: 'Auditors can read conversations',
      control: 'toggle',
      group: ASSISTANT_WORDS.groups.privacy,
      description: `People who can read assistant activity see what was asked and what the assistant did. Everyone using the assistant is told so. ${defaultOnOff('assistant_auditor_visible')}`,
    },
    {
      name: 'assistant_trace_retention_days',
      label: 'Keep traces for',
      control: 'count',
      unit: 'days',
      group: ASSISTANT_WORDS.groups.privacy,
      description: `How long the step-by-step record of a conversation is kept. ${defaultAmount('assistant_trace_retention_days', 'days')}`,
      more: 'The audit trail keeps its own rows for as long as its retention says; a trace is the detail behind them and is the first to go.',
    },
    {
      name: 'assistant_monthly_tokens_fast',
      label: 'Fast model, each month',
      control: 'count',
      unit: 'tokens',
      group: ASSISTANT_WORDS.groups.limits,
      description: `Titles, summaries and small reads. ${defaultAmount('assistant_monthly_tokens_fast', 'tokens')}`,
      more: 'When a limit is reached the assistant stops and says which one. It never falls back to a cheaper model on its own. The panel warns at 80%.',
    },
    {
      name: 'assistant_monthly_tokens_standard',
      label: 'Standard model, each month',
      control: 'count',
      unit: 'tokens',
      group: ASSISTANT_WORDS.groups.limits,
      description: `The main conversation. ${defaultAmount('assistant_monthly_tokens_standard', 'tokens')}`,
    },
    {
      name: 'assistant_monthly_tokens_deep',
      label: 'Deep model, each month',
      control: 'count',
      unit: 'tokens',
      group: ASSISTANT_WORDS.groups.limits,
      description: `Planning and hard reasoning. ${defaultAmount('assistant_monthly_tokens_deep', 'tokens')}`,
    },
    {
      name: 'assistant_max_concurrent',
      label: 'Answers at once',
      control: 'count',
      unit: 'answers',
      group: ASSISTANT_WORDS.groups.limits,
      description: `How many answers the tenant may have in progress together. ${defaultAmount('assistant_max_concurrent', 'answers')}`,
    },
    {
      name: 'assistant_max_steps_per_turn',
      label: 'Steps in one answer',
      control: 'count',
      unit: 'steps',
      group: ASSISTANT_WORDS.groups.limits,
      description: `The most model and tool calls one answer may take before it stops. ${defaultAmount('assistant_max_steps_per_turn', 'steps')}`,
    },
  ],
};

// What the fields of the section are laid out from, as a section plan is.
export const ASSISTANT_PLAN = { section: ASSISTANT_SECTION } as const;
