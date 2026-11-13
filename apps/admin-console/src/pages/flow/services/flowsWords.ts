import { FLOW_LIMIT, FLOW_NAME_MAX } from '@odudu/contracts/admin';

const LIMIT_NOTE = `A tenant holds at most ${String(FLOW_LIMIT)} flows.`;

export const FLOWS_WORDS = {
  list: {
    title: 'Flows',
    rule: `The default flow is what a sign-in runs when nothing names another, and it is never deleted. ${LIMIT_NOTE}`,
    label: 'Flows',
    loading: 'Loading the flows',
    failed: 'The flows could not be loaded',
    defaultTag: 'Default',
    columns: { name: 'Name', steps: 'Steps', clients: 'Clients', actions: 'Actions' },
    edit: 'Edit',
    delete: 'Delete',
    makeDefault: 'Make default',
    newFlow: 'New flow',
    lastAction: 'Last flow action',
  },
  create: {
    title: 'New flow',
    description:
      'A flow of its own, which a client runs once it is chosen under Sign-in flow on the client’s Advanced tab.',
    nameLabel: 'Name',
    nameHelp: `Unique within the tenant, at most ${String(FLOW_NAME_MAX)} characters. It starts with the steps of the default flow; change them once it is made.`,
    noun: 'flow',
  },
  record: {
    title: 'Flow',
    defaultTag: 'Default',
    steps: 'Steps',
    loading: 'Loading the flow',
    failed: 'The flow could not be loaded',
    nameLabel: 'Name',
    nameHelp: `Unique within the tenant, at most ${String(FLOW_NAME_MAX)} characters.`,
    noticeTitle: 'Flow',
    defaultNote: 'This is the default flow. It is edited here and as the sign-in flow above.',
  },
} as const;

export type FlowsWords = typeof FLOWS_WORDS;
