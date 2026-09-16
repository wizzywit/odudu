import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

// The maximum password length is enforced where a form is read, because the
// sign-in route verifies a candidate rather than evaluating it against the
// realm's policy (ADR 0023). A new route reading the field directly would
// bypass the cap and break no existing test, so "every reader goes through
// readPasswordField" is checked here rather than asserted in a comment.

// Every spelling of the read that reaches the parsed form body. The capture
// is what precedes it, so the check is not "the file mentions
// readPasswordField somewhere" — which a file doing both would satisfy.
const FORM_READ =
  /(?<prefix>[\s\S]{0,24})(?:request\.)?body(?:\.password\b|\[['"]password['"]\])/gu;

const SOURCE_TREES = ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'];

export interface PasswordReads {
  readonly direct: string[];
  readonly throughKernel: number;
}

export function passwordReads(source: string): PasswordReads {
  const direct: string[] = [];
  let throughKernel = 0;
  for (const match of source.matchAll(FORM_READ)) {
    const prefix = match.groups?.prefix ?? '';
    if (/readPasswordField\(\s*$/u.test(prefix)) {
      throughKernel += 1;
      continue;
    }
    direct.push(match[0].trimStart());
  }
  return { direct, throughKernel };
}

function directPasswordReads(source: string): string[] {
  return passwordReads(source).direct;
}

describe('the password field is read through one function', () => {
  it('holds across every source tree', async () => {
    const offenders: string[] = [];
    let compliant = 0;

    for (const pattern of SOURCE_TREES) {
      for await (const file of glob(pattern)) {
        if (file.endsWith('.test.ts')) continue;
        const source = await readFile(file, 'utf8');
        const reads = passwordReads(source);
        compliant += reads.throughKernel;
        for (const read of reads.direct) {
          offenders.push(
            `${file} — reads the password field directly (${read}). Read it through ` +
              `readPasswordField from @odudu/kernel, or the maximum length does not apply here.`,
          );
        }
      }
    }

    expect(offenders, offenders.join('\n')).toEqual([]);
    // Without this the check passes on a glob that matched nothing, which
    // is the same green as a repository with no bypass in it.
    expect(
      compliant,
      'fewer password reads found than the four routes that have one — the trees above matched nothing',
    ).toBeGreaterThanOrEqual(4);
  });
});

// A rule with no positive control passes on a broken matcher exactly as it
// passes on compliant code.
describe('the rule catches the bypass it exists for', () => {
  it('reports a direct property read', () => {
    expect(directPasswordReads('const p = firstString(body.password);\n')).toHaveLength(1);
  });

  it('reports the bracket spelling', () => {
    expect(directPasswordReads("const p = body['password'];\n")).toHaveLength(1);
  });

  it('reports a read off request.body', () => {
    expect(directPasswordReads('const p = request.body.password;\n')).toHaveLength(1);
  });

  it('reports a file that reads directly as well as through the helper', () => {
    const source =
      'const a = readPasswordField(body.password);\nconst b = firstString(body.password);\n';
    expect(directPasswordReads(source)).toHaveLength(1);
  });

  it('accepts the read the cap is applied at', () => {
    expect(directPasswordReads('const a = readPasswordField(body.password);\n')).toEqual([]);
    expect(directPasswordReads('const a = readPasswordField(request.body.password);\n')).toEqual(
      [],
    );
  });

  it('leaves an unrelated password reference alone', () => {
    expect(directPasswordReads('await hashPassword(input.password);\n')).toEqual([]);
  });
});
