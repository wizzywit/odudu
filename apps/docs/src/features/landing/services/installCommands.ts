import { RELEASE_URL } from '@site/src/features/landing/services/release';

// What the hero terminal types, one command per shell. A test ties each to the
// quick start's.

export type Shell = 'unix' | 'windows';

export interface ShellCommand {
  shell: Shell;
  label: string;
  command: string;
}

export const COMMANDS: ShellCommand[] = [
  {
    shell: 'unix',
    label: 'bash or zsh',
    command: `curl -fsSLO ${RELEASE_URL} && docker compose up -d`,
  },
  {
    shell: 'windows',
    label: 'PowerShell',
    command: `curl.exe -fsSLO ${RELEASE_URL}; if ($?) { docker compose up -d }`,
  },
];

// What the quick start's second step shows, which the hero's terminal plays
// after the command. A test holds each line to the quick start's own text.
export const FOLLOW_UP = {
  command: 'docker compose logs setup',
  output: ['Odudu is ready.', ' console:  http://localhost:3000/console/'],
} as const;
