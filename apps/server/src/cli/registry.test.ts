import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { CLI_COMMANDS } from '#/cli/registry';
import { SEED_COMMANDS } from '#/cli/seed';
import type { CliCommand } from '#/cli/command-types';

function everyCommand(commands: readonly CliCommand[]): CliCommand[] {
  return commands.flatMap((command) => [command, ...everyCommand(command.subcommands)]);
}

describe('CLI_COMMANDS', () => {
  it('names every subcommand main.ts routes', () => {
    const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
    const routed = [...main.matchAll(/process\.argv\[2\] === '([^']+)'/g)].map((m) => m[1]);

    expect(routed.length).toBeGreaterThan(0);
    for (const name of routed) {
      expect(
        CLI_COMMANDS.map((command) => command.name),
        name,
      ).toContain(name);
    }
  });

  it('names every seed subcommand SEED_COMMANDS lists', () => {
    const seed = CLI_COMMANDS.find((command) => command.name === 'seed');

    expect(seed?.subcommands.map((command) => command.name).sort()).toEqual(
      [...SEED_COMMANDS].sort(),
    );
  });

  it('gives every option a summary of at least 12 characters', () => {
    for (const command of everyCommand(CLI_COMMANDS)) {
      for (const option of command.options) {
        expect(option.summary.length, `${command.name} --${option.name}`).toBeGreaterThanOrEqual(
          12,
        );
      }
    }
  });

  it('writes only options the command has in its example', () => {
    // A command with subcommands shows one of theirs, with that one's options.
    for (const command of everyCommand(CLI_COMMANDS).filter((c) => c.subcommands.length === 0)) {
      const known = new Set([
        command.name.replace(/^--/, ''),
        ...command.options.map((o) => o.name),
      ]);
      for (const [, flag] of command.example.matchAll(/ --([a-z][a-z-]*)/g)) {
        expect(known.has(flag ?? ''), `${command.name} --${flag ?? ''}`).toBe(true);
      }
    }
  });

  it('describes the client_credentials scope flag of seed client', () => {
    const seed = CLI_COMMANDS.find((command) => command.name === 'seed');
    const client = seed?.subcommands.find((command) => command.name === 'client');
    const option = client?.options.find((o) => o.name === 'client-credentials-scope');
    expect(option?.summary).toMatch(/client_credentials/);
  });

  it('describes the audience flag of seed client', () => {
    const seed = CLI_COMMANDS.find((command) => command.name === 'seed');
    const client = seed?.subcommands.find((command) => command.name === 'client');
    const option = client?.options.find((o) => o.name === 'audience');
    expect(option?.summary).toMatch(/resource/);
  });

  it('has an example that starts with odudu', () => {
    for (const command of everyCommand(CLI_COMMANDS)) {
      expect(command.example, command.name).toMatch(/^odudu /);
    }
  });

  it('writes a group in an example as a path, which begins with a slash', () => {
    const named = everyCommand(CLI_COMMANDS).filter((command) =>
      command.example.includes('--group '),
    );
    expect(named.length).toBeGreaterThan(0);
    for (const command of named) {
      expect(command.example, command.name).toMatch(/--group \//);
    }
  });

  it('gives every command a summary', () => {
    for (const command of everyCommand(CLI_COMMANDS)) {
      expect(command.summary.length, command.name).toBeGreaterThanOrEqual(12);
    }
  });

  it('lists help and --version, which main.ts answers before routing', () => {
    const names = CLI_COMMANDS.map((command) => command.name);

    expect(names).toContain('help');
    expect(names).toContain('--version');
  });
});

const CLI_DIR = new URL('./', import.meta.url);

function sources(): { file: string; text: string }[] {
  return readdirSync(CLI_DIR)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => ({ file, text: readFileSync(new URL(file, CLI_DIR), 'utf8') }));
}

describe('option metadata', () => {
  it('is the table parseArgs reads, never an inline copy', () => {
    let calls = 0;
    for (const { file, text } of sources()) {
      const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'parseArgs'
        ) {
          calls += 1;
          const config = node.arguments[0];
          const options =
            config && ts.isObjectLiteralExpression(config)
              ? config.properties.find(
                  (p): p is ts.PropertyAssignment =>
                    ts.isPropertyAssignment(p) && p.name.getText() === 'options',
                )
              : undefined;
          expect(options?.initializer.getText() ?? '', `${file}: ${node.getText()}`).toMatch(
            /^[A-Z][A-Z_]*_OPTIONS$/,
          );
        }
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }
    expect(calls).toBeGreaterThan(10);
  });

  it('recognises every shape of requires message the CLI emits', () => {
    const known = /^requires (--[a-z]|either --|ODUDU_|an email address|a client secret)/;
    for (const { file, text } of sources()) {
      for (const match of text.matchAll(/requires [^\n]{0,24}/g)) {
        expect(match[0], file).toMatch(known);
      }
    }
  });

  it('marks required exactly the options the command refuses to run without', () => {
    const refused = new Map<string, string[]>();
    const pattern = /(seed|console)( [a-z-]+)? requires ((?:--[a-z-]+(?:, | and )?)+)/g;
    for (const { text } of sources()) {
      for (const match of text.matchAll(pattern)) {
        const key = `${match[1] ?? ''}${match[2] ?? ''}`;
        if (refused.has(key)) continue;
        refused.set(
          key,
          [...(match[3] ?? '').matchAll(/--([a-z-]+)/g)].map((m) => m[1] ?? ''),
        );
      }
    }

    const seed = CLI_COMMANDS.find((command) => command.name === 'seed');
    const console_ = CLI_COMMANDS.find((command) => command.name === 'console');
    const checked: [string, CliCommand | undefined][] = [
      ['seed', seed],
      ...(seed?.subcommands ?? []).map((c): [string, CliCommand] => [`seed ${c.name}`, c]),
      ['console assertion', console_?.subcommands.find((c) => c.name === 'assertion')],
    ];
    for (const [key, command] of checked) {
      const required = (command?.options ?? [])
        .filter((option) => option.required)
        .map((option) => option.name);
      expect(required.sort(), key).toEqual([...(refused.get(key) ?? [])].sort());
    }
    expect(refused.size).toBe(checked.length);
  });
});

describe('main.ts before it dispatches', () => {
  const SRC = new URL('../', import.meta.url);

  function staticImports(file: string): { local: string[]; packages: string[] } {
    const text = readFileSync(new URL(file, SRC), 'utf8');
    const specifiers = [...text.matchAll(/^(?:import|export)[^;]*?from '([^']+)';/gms)].map(
      (m) => m[1] ?? '',
    );
    return {
      local: specifiers.filter((s) => s.startsWith('#/')).map((s) => `${s.slice(2)}.ts`),
      packages: specifiers.filter((s) => !s.startsWith('#/')),
    };
  }

  it('statically imports neither the server nor a database, so help and --version stay fast', () => {
    const seen = new Set<string>();
    const packages = new Set<string>();
    const queue = ['main.ts'];
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
      if (seen.has(file)) continue;
      seen.add(file);
      const found = staticImports(file);
      found.packages.forEach((p) => packages.add(p));
      queue.push(...found.local);
    }

    expect([...seen].sort()).toEqual([
      'cli/command-types.ts',
      'cli/help.ts',
      'cli/init-options.ts',
      'cli/init-plan.ts',
      'cli/mcp-options.ts',
      'cli/registry.ts',
      'cli/seed-options.ts',
      'main.ts',
    ]);
    expect([...packages].sort()).toEqual(['@odudu/kernel']);
  });
});

describe('what the seed help promises', () => {
  const options = (name: string) =>
    CLI_COMMANDS.find((command) => command.name === 'seed')?.subcommands.find(
      (command) => command.name === name,
    )?.options ?? [];
  const summary = (command: string, option: string) =>
    options(command).find((candidate) => candidate.name === option)?.summary ?? '';

  // A second `seed client` for the same client fails with seed_conflict, so the
  // help must not say it updates.
  it('says seed client creates, fails on an existing client and where to change one', () => {
    const text = summary('client', 'client-id');
    expect(text).not.toMatch(/update/iu);
    expect(text).toMatch(/fails if that client exists/iu);
    expect(text).toMatch(/console or the admin API/iu);
  });

  it('says seed scope creates and fails on an existing scope', () => {
    const text = summary('scope', 'name');
    expect(text).not.toMatch(/update/iu);
    expect(text).toMatch(/fails if it exists/iu);
  });

  it('documents --email-verified on seed user and seed profile', () => {
    expect(summary('user', 'email-verified')).toMatch(/--email/u);
    expect(summary('profile', 'email-verified')).toMatch(/verified/iu);
  });
});
