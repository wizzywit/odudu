import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

async function read(file: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, file), 'utf8');
}

function jobNames(workflow: string): string[] {
  const jobs = workflow.slice(workflow.indexOf('\njobs:\n'));
  return [...jobs.matchAll(/^ {2}([a-z][\w-]*):\s*$/gmu)].map((m) => m[1] ?? '');
}

function gateNeeds(workflow: string): string[] {
  const gate = workflow.slice(workflow.indexOf('\n  gate:\n'));
  const block = /needs:\n((?: {6}- [\w-]+\n)+)/u.exec(gate)?.[1] ?? '';
  return [...block.matchAll(/- ([\w-]+)/gu)].map((m) => m[1] ?? '');
}

describe('the CI workflow', () => {
  it('has a gate that waits for every other job, so no job can be added outside it', async () => {
    const workflow = await read('.github/workflows/verify.yml');
    const others = jobNames(workflow).filter((name) => name !== 'gate');
    expect(others.length).toBeGreaterThan(5);
    expect(gateNeeds(workflow).sort()).toEqual(others.sort());
  });

  it('hashes the shard into every test task, or a slice would replay another slice from cache', async () => {
    const turbo: unknown = JSON.parse(await read('turbo.json'));
    const tasks = (turbo as { tasks: Record<string, { env?: string[] }> }).tasks;
    const missing = Object.entries(tasks)
      .filter(([name]) => name === 'test' || name.endsWith('#test'))
      .filter(([, task]) => !(task.env ?? []).includes('ODUDU_TEST_SHARD'))
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it('gives each shard of a package a slice that vitest accepts', async () => {
    const workflow = await read('.github/workflows/verify.yml');
    const shards = [...workflow.matchAll(/package: '([^']+)', shard: '([^']*)'/gu)];
    expect(shards.length).toBeGreaterThan(0);
    const byPackage = new Map<string, string[]>();
    for (const [, pkg = '', shard = ''] of shards) {
      byPackage.set(pkg, [...(byPackage.get(pkg) ?? []), shard]);
    }
    for (const [pkg, slices] of byPackage) {
      const counts = new Set(slices.map((s) => s.split('/')[1]));
      expect(counts.size, `${pkg} mixes shard counts`).toBe(1);
      const count = Number([...counts][0] ?? '1');
      const indexes = slices.map((s) => (s === '' ? 1 : Number(s.split('/')[0])));
      expect(indexes.sort(), pkg).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    }
  });

  it('runs the gate whatever happened upstream, and fails it when changes decided nothing', async () => {
    const workflow = await read('.github/workflows/verify.yml');
    const gate = workflow.slice(workflow.indexOf('\n  gate:\n'));
    expect(gate).toMatch(/^ {4}if: always\(\)$/mu);
    expect(gate).toContain('needs.changes.outputs.server');
    expect(gate).toContain('changes wrote no outputs');
  });

  it('has verify wait for each of its parts', async () => {
    const workflow = await read('.github/workflows/verify.yml');
    const verify = workflow.slice(workflow.indexOf('\n  verify:\n'));
    expect(verify).toMatch(/needs: \[static, test, test-rest, trace\]/u);
    expect(verify).toMatch(/^ {4}if: always\(\)$/mu);
  });

  it('leaves test-rest exactly the packages the matrix and the docs job do not run', async () => {
    const workflow = await read('.github/workflows/verify.yml');
    const sliced = new Set(
      [...workflow.matchAll(/package: '([^']+)', shard:/gu)].map((m) => m[1] ?? ''),
    );
    const filter = /FILTER: .*&& '([^']+)' \|\|/u.exec(workflow)?.[1] ?? '';
    const excluded = [...filter.matchAll(/--filter=!(\S+)/gu)].map((m) => m[1] ?? '');
    expect(excluded.sort()).toEqual([...sliced, '@odudu/docs'].sort());
  });

  it('fails an upload of a test report that finds no file', async () => {
    const workflow = await read('.github/workflows/verify.yml');
    const uploads = [...workflow.matchAll(/name: trace-[^\n]*\n(?: {10}[^\n]*\n)+/gu)];
    expect(uploads.length).toBe(3);
    for (const [upload] of uploads) {
      expect(upload).toContain('if-no-files-found: error');
    }
  });

  describe('the console e2e job', () => {
    async function e2eShards(): Promise<string[]> {
      const workflow = await read('.github/workflows/verify.yml');
      const job = workflow.slice(workflow.indexOf('\n  e2e-shards:\n'));
      const line = /shard: \[([^\]]*)\]/u.exec(job)?.[1] ?? '';
      return [...line.matchAll(/'([^']*)'/gu)].map((m) => m[1] ?? '');
    }

    it('cuts the specs into slices playwright accepts, each of them run once', async () => {
      const slices = await e2eShards();
      expect(slices.length).toBeGreaterThan(1);
      const totals = new Set(slices.map((s) => s.split('/')[1]));
      expect(totals.size).toBe(1);
      const total = Number([...totals][0]);
      expect(slices.map((s) => Number(s.split('/')[0])).sort()).toEqual(
        Array.from({ length: total }, (_, i) => i + 1),
      );
    });

    it('takes the slice from the matrix alone, and run.sh passes it on to playwright', async () => {
      const workflow = await read('.github/workflows/verify.yml');
      expect(workflow).toContain('E2E_SHARD: ${{ matrix.shard }}');
      expect(await read('apps/admin-console/e2e/run.sh')).toContain('--shard "$E2E_SHARD"');
    });

    it('keeps `e2e` as one job that waits for every slice and is skipped as they are', async () => {
      const workflow = await read('.github/workflows/verify.yml');
      const job = workflow.slice(workflow.indexOf('\n  e2e:\n'));
      const block = job.slice(0, job.indexOf('\n  conformance:\n'));
      expect(block).toContain('needs: [changes, e2e-shards]');
      expect(block).toMatch(/^ {4}if: always\(\) && needs\.changes\.outputs\.server == 'true'$/mu);
      expect(block).toContain('needs.e2e-shards.result');
      expect(block).toContain('case "$RESULTS" in success) ;; *) exit 1 ;; esac');
      expect(jobNames(workflow)).toContain('e2e-shards');
    });

    it('gives each slice a runner and a report of its own', async () => {
      const workflow = await read('.github/workflows/verify.yml');
      const job = workflow.slice(workflow.indexOf('\n  e2e-shards:\n'));
      const block = job.slice(0, job.indexOf('\n  e2e:\n'));
      expect(block).toContain('runs-on: ubuntu-latest');
      expect(block).toContain('fail-fast: false');
      expect(block).toMatch(/name: playwright-report-\$\{\{ strategy\.job-index \}\}/u);
    });
  });

  describe('the image build', () => {
    it('is one action every job that runs the image uses, with one writer of the cache', async () => {
      const workflow = await read('.github/workflows/verify.yml');
      const uses = workflow.match(/uses: \.\/\.github\/actions\/image/gu) ?? [];
      expect(uses).toHaveLength(6);
      expect(workflow).toContain(
        "save-cache: ${{ strategy.job-index == 0 && github.event_name == 'push' }}",
      );
      expect(workflow.match(/save-cache:/gu)).toHaveLength(1);
      const action = await read('.github/actions/image/action.yml');
      expect(action).toContain('cache-from: type=gha,scope=odudu-image');
      expect(action).toContain('scope=odudu-image,mode=max');
    });

    it('starts the prebuilt image, labelled with the commit, in both scripts', async () => {
      const workflow = await read('.github/workflows/verify.yml');
      const job = (name: string, next: string): string => {
        const from = workflow.slice(workflow.indexOf(`\n  ${name}:\n`));
        return from.slice(0, from.indexOf(`\n  ${next}:\n`));
      };
      const smoke = job('container', 'e2e-shards');
      expect(smoke).toContain("ODUDU_PREBUILT: '1'");
      expect(smoke).toContain('ODUDU_REVISION: ${{ github.sha }}');
      const e2e = job('e2e-shards', 'e2e');
      expect(e2e).toContain("E2E_PREBUILT: '1'");
      expect(e2e).toContain('ODUDU_REVISION: ${{ github.sha }}');
      expect(workflow).toContain('revision: ${{ github.sha }}');
    });

    it('refuses, naming both revisions, a prebuilt image built from another commit', async () => {
      for (const file of ['apps/admin-console/e2e/run.sh', 'infra/docker/smoke.sh']) {
        const script = await read(file);
        expect(script, file).toContain('org.opencontainers.image.revision');
        expect(script, file).toContain('was built from');
      }
    });

    it('tags the image with the name compose gives it in each script that starts it', async () => {
      const action = await read('.github/actions/image/action.yml');
      const run = await read('apps/admin-console/e2e/run.sh');
      const smoke = await read('infra/docker/smoke.sh');
      const shots = await read('apps/docs/scripts/console-shots/with-stack.sh');
      const e2eProject = /E2E_COMPOSE_PROJECT:-([\w-]+)/u.exec(run)?.[1];
      const smokeProject = /COMPOSE_PROJECT_NAME=([\w-]+)/u.exec(smoke)?.[1];
      const shotsProject = /SHOTS_COMPOSE_PROJECT:-([\w-]+)/u.exec(shots)?.[1];
      expect(action).toContain(`${String(e2eProject)}-odudu\n`);
      expect(action).toContain(`${String(smokeProject)}-odudu\n`);
      expect(action).toContain(`${String(shotsProject)}-odudu\n`);
    });
  });

  describe('the brand derivative check', () => {
    it('runs in the docs job, after Chromium is installed, and fails there if it cannot run', async () => {
      const workflow = await read('.github/workflows/verify.yml');
      const from = workflow.slice(workflow.indexOf('\n  docs:\n'));
      const block = from.slice(0, from.indexOf('\n  # The four steps'));
      const install = block.indexOf('uses: ./.github/actions/playwright');
      const step = block.indexOf('ODUDU_REQUIRE_CHROMIUM');
      expect(install).toBeGreaterThan(0);
      expect(step).toBeGreaterThan(install);
      expect(block).toContain('tests/lint/brand-assets.test.ts');
      expect(block).toMatch(/ODUDU_REQUIRE_CHROMIUM: '1'/u);
    });

    it('skips by name where no Chromium is installed, and never when it is required', async () => {
      const test = await read('tests/lint/brand-assets.test.ts');
      expect(test).toContain("process.env.ODUDU_REQUIRE_CHROMIUM === '1'");
      expect(test).toContain('if (!REQUIRED && stderr.includes(NO_BROWSER))');
      expect(test).toContain('context.skip(');
    });

    it('leaves the jobs without a browser out of it', async () => {
      const workflow = await read('.github/workflows/verify.yml');
      const rest = workflow.slice(
        workflow.indexOf('\n  test-rest:\n'),
        workflow.indexOf('\n  trace:\n'),
      );
      expect(rest).not.toContain('ODUDU_REQUIRE_CHROMIUM');
    });
  });

  describe('the console capture job', () => {
    async function job(): Promise<string> {
      const workflow = await read('.github/workflows/verify.yml');
      const from = workflow.slice(workflow.indexOf('\n  console-shots:\n'));
      return from.slice(0, from.indexOf('\n  conformance:\n'));
    }

    it('runs only when changes found the console or the documentation touched, and the gate waits for it', async () => {
      const block = await job();
      expect(block).toContain('needs: changes');
      expect(block).toMatch(/^ {4}if: needs\.changes\.outputs\.buildImage == 'true'$/mu);
      const workflow = await read('.github/workflows/verify.yml');
      expect(gateNeeds(workflow)).toContain('console-shots');
    });

    it('checks the console against the committed records, on the image built from this commit', async () => {
      const block = await job();
      expect(block).toContain('apps/docs/scripts/console-shots/with-stack.sh --check');
      expect(block).toContain("SHOTS_PREBUILT: '1'");
      expect(block).toContain('ODUDU_REVISION: ${{ github.sha }}');
      expect(block).toContain('uses: ./.github/actions/image');
      expect(block).toContain('cp infra/docker/.env.example infra/docker/.env');
    });

    it('never closes a pipe early on a command that prints more, which fails the run under pipefail', async () => {
      const shots = await read('apps/docs/scripts/console-shots/with-stack.sh');
      const code = shots
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');
      expect(code).not.toMatch(/\|\s*head\b/u);
      expect(code).not.toMatch(/\|\s*grep -q\b/u);
    });

    it('names the step and the command that failed, with the line and the status', async () => {
      const shots = await read('apps/docs/scripts/console-shots/with-stack.sh');
      expect(shots).toMatch(/^trap '[^']*BASH_COMMAND[^']*LINENO[^']*' ERR$/mu);
      expect(shots).toContain('set -E');
      for (const step of [
        'start the stack',
        'wait for the console',
        'make the administrator',
        'run the capture',
      ]) {
        expect(shots, step).toContain(`step '${step}'`);
      }
    });

    it('keeps what the password step prints to stderr out of the void', async () => {
      const shots = await read('apps/docs/scripts/console-shots/with-stack.sh');
      const line =
        shots.split('\n').find((l) => !l.trimStart().startsWith('#') && l.includes('seed admin')) ??
        '';
      expect(line).not.toBe('');
      expect(line).not.toContain('2>/dev/null');
    });

    it('waits for the console itself, not only the health check, for a bounded time', async () => {
      const shots = await read('apps/docs/scripts/console-shots/with-stack.sh');
      expect(shots).toMatch(/for attempt in \$\(seq 1 \d+\)/u);
      expect(shots).toContain('/console/');
      expect(shots).toContain('the console did not answer');
    });

    it('is the same capture a writer runs: one script starts the stack, whose records the check reads', async () => {
      const shots = await read('apps/docs/scripts/console-shots/with-stack.sh');
      expect(shots).toContain('run.ts "$@"');
      expect(shots).toContain('org.opencontainers.image.revision');
      const run = await read('apps/docs/scripts/console-shots/run.ts');
      expect(run).toContain("process.argv.includes('--check')");
    });

    it('never builds for a pull request that touches neither the console nor the documentation', async () => {
      const { classifyChanges } = await import('../../tools/ci/src/changes.ts');
      expect(classifyChanges(['docs/NEXT.md']).buildImage).toBe(false);
      expect(classifyChanges(['apps/admin-console/src/main.tsx']).buildImage).toBe(true);
      expect(classifyChanges(['apps/docs/content/en/roadmap.md']).buildImage).toBe(true);
    });
  });

  describe('the examples job', () => {
    async function job(): Promise<string> {
      const workflow = await read('.github/workflows/verify.yml');
      const from = workflow.slice(workflow.indexOf('\n  examples:\n') + 1);
      const next = /\n {2}[a-z][\w-]*:\n/u.exec(from.slice(1));
      return next === null ? from : from.slice(0, next.index + 1);
    }

    it('runs every example on the image built from this commit, and the gate waits for it', async () => {
      const block = await job();
      expect(block).toContain('needs: changes');
      expect(block).toMatch(/^ {4}if: needs\.changes\.outputs\.buildImage == 'true'$/mu);
      expect(block).toContain('uses: ./.github/actions/image');
      expect(block).toContain('quickstart/stack.sh up odudu-smoke-odudu 3205');
      expect(block).toContain('examples/_shared/provision.sh');
      expect(block).toContain('npm ci --ignore-scripts');
      expect(block).toContain('npm test');
      expect(block).toContain('npm run typecheck');
      expect(block).toMatch(
        /if: matrix\.example == 'web-app' \|\| matrix\.example == 'single-page-app'/u,
      );
      expect(block).toMatch(/^ {4}timeout-minutes: \d+$/mu);
      expect(block).not.toMatch(/:3000\b/u);
      expect(block).toMatch(/if: always\(\)\n\s+run: quickstart\/stack\.sh down/u);
      const workflow = await read('.github/workflows/verify.yml');
      expect(gateNeeds(workflow)).toContain('examples');
    });

    it('has one matrix leg per example directory with a lockfile and a test', async () => {
      const block = await job();
      const legs = /example: \[([^\]]+)\]/u.exec(block)?.[1]?.split(', ').sort() ?? [];
      const directories = (await readdir(path.join(REPO_ROOT, 'examples'), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
        .map((entry) => entry.name)
        .sort();
      expect(legs).toEqual(directories);
      for (const name of directories) {
        await read(`examples/${name}/test.ts`);
      }
    });
  });

  describe('the MCP clients job', () => {
    async function job(): Promise<string> {
      const workflow = await read('.github/workflows/verify.yml');
      const from = workflow.slice(workflow.indexOf('\n  mcp:\n') + 1);
      const next = /\n {2}[a-z][\w-]*:\n/u.exec(from.slice(1));
      return next === null ? from : from.slice(0, next.index + 1);
    }

    it('runs when the server can have changed, is bounded, and the gate waits for it', async () => {
      const block = await job();
      expect(block).toContain('needs: changes');
      expect(block).toMatch(/^ {4}if: needs\.changes\.outputs\.server == 'true'$/mu);
      expect(block).toMatch(/^ {4}timeout-minutes: \d+$/mu);
      const workflow = await read('.github/workflows/verify.yml');
      expect(gateNeeds(workflow)).toContain('mcp');
    });

    it('runs the script on the image built from this commit, named as its compose file names it', async () => {
      const block = await job();
      expect(block).toContain('uses: ./.github/actions/image');
      expect(block).toContain('docker tag odudu-smoke-odudu odudu-mcp-odudu');
      expect(block).toContain('./infra/conformance/run-mcp.sh');
      expect(block).toContain("MCP_PREBUILT: '1'");
      expect(await read('infra/conformance/run-mcp.sh')).toContain('PROJECT=odudu-mcp\n');
    });

    it('pins both clients to an exact version', async () => {
      const script = await read('infra/conformance/run-mcp.sh');
      expect(script).toMatch(/^INSPECTOR_VERSION=\d+\.\d+\.\d+$/mu);
      expect(script).toMatch(/^SDK_CLIENT_VERSION=\d+\.\d+\.\d+$/mu);
    });
  });

  describe('the quick start job', () => {
    async function job(): Promise<string> {
      const workflow = await read('.github/workflows/verify.yml');
      const from = workflow.slice(workflow.indexOf('\n  quickstart:\n') + 1);
      const next = /\n {2}[a-z][\w-]*:\n/u.exec(from.slice(1));
      return next === null ? from : from.slice(0, next.index + 1);
    }

    it('runs when the image can have changed, is bounded, and the gate waits for it', async () => {
      const block = await job();
      expect(block).toContain('needs: changes');
      expect(block).toMatch(/^ {4}if: needs\.changes\.outputs\.buildImage == 'true'$/mu);
      expect(block).toMatch(/^ {4}timeout-minutes: \d+$/mu);
      const workflow = await read('.github/workflows/verify.yml');
      expect(gateNeeds(workflow)).toContain('quickstart');
    });

    it("runs the repository's own compose file with the image named as the file names it", async () => {
      const block = await job();
      expect(block).toContain('uses: ./.github/actions/image');
      expect(block).toContain('docker tag odudu-smoke-odudu ghcr.io/wizzywit/odudu:0.0.0');
      expect(block).toContain('quickstart/prove.sh');
      expect(block).toContain('uses: ./.github/actions/playwright');
      expect(block).not.toMatch(/:3000\b|sed |ODUDU_IMAGE/u);
      const compose = await read('quickstart/compose.yaml');
      expect(compose).toContain('${ODUDU_IMAGE:-ghcr.io/wizzywit/odudu:0.0.0}');
    });

    it('starts the stack bare, as a stranger does, and proves a sign-in inside a budget', async () => {
      const proof = await read('quickstart/prove.sh');
      const commands = proof
        .split('\n')
        .filter((line) => line.trim().startsWith('docker compose up'));
      expect(commands).toEqual(['  docker compose up -d']);
      expect(proof).toContain('BUDGET_SECONDS=600');
      expect(proof).toContain('"$REPO/quickstart/prove.ts"');
      expect(proof).toContain('docs_served');
      expect(proof).toContain('Odudu is ready.');
      expect(proof).toContain('docker compose down -v --remove-orphans');
    });

    it('treats a change to the proof or the compose file as a change to the image', async () => {
      const { classifyChanges } = await import('../../tools/ci/src/changes.ts');
      expect(classifyChanges(['quickstart/prove.sh']).buildImage).toBe(true);
      expect(classifyChanges(['quickstart/compose.yaml']).buildImage).toBe(true);
    });
  });

  describe('the Playwright action', () => {
    it('hands both installs to a script that retries, and keeps the browser cache', async () => {
      const action = await read('.github/actions/playwright/action.yml');
      expect(action.match(/\$\{\{ github\.action_path \}\}\/install\.sh/gu)).toHaveLength(2);
      expect(action).toContain('install.sh "${{ inputs.package }}" install\n');
      expect(action).toContain('install.sh "${{ inputs.package }}" install-deps\n');
      expect(action).toContain('key: playwright-${{ runner.os }}-chromium-');
    });

    it('makes apt fail fast, waits for a lock, and uses the main mirror in both source formats', async () => {
      const script = await read('.github/actions/playwright/install.sh');
      for (const setting of [
        'Acquire::Retries "5";',
        'Acquire::http::Timeout "20";',
        'Acquire::https::Timeout "20";',
        'Acquire::ForceIPv4 "true";',
        'DPkg::Lock::Timeout "300";',
        '/etc/apt/apt.conf.d/80-odudu-retries',
        // the runner image names its mirrors in a list, not in the sources
        'if [ -f /etc/apt/apt-mirrors.txt ]; then',
        "printf 'http://archive.ubuntu.com/ubuntu/\\tpriority:1\\nhttp://security.ubuntu.com/ubuntu/\\tpriority:2\\n'",
        's|http://azure.archive.ubuntu.com|http://archive.ubuntu.com|g',
      ]) {
        expect(script, setting).toContain(setting);
      }
    });

    it('kills a stalled attempt with the apt it started, and tries again, three times', async () => {
      const script = await read('.github/actions/playwright/install.sh');
      expect(script).toContain('attempts=3');
      expect(script).toContain('setsid --wait timeout -s TERM -k 15 "$limit"');
      expect(script).toContain('limit="${ODUDU_INSTALL_TIMEOUT:-8m}"');
      expect(script).toContain('echo "attempt $attempt of $attempts"');
      // the retry must not start while the last attempt's apt holds the lock
      const loop = script.slice(script.indexOf('for attempt in'));
      expect(loop.indexOf('clear_apt')).toBeGreaterThan(loop.indexOf('exit 0'));
      expect(script).toContain('for name in apt-get apt dpkg; do $sudo_cmd pkill -KILL -x "$name"');
      expect(script).toContain(
        '/var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/cache/apt/archives/lock',
      );
      expect(script).toContain('dpkg --configure -a');
      expect(script).toContain('::error::');
      expect(script).toMatch(/^exit 1$/mu);
    });

    it('is the only place the workflows install browsers or call apt', async () => {
      const files = [
        '.github/workflows/verify.yml',
        '.github/workflows/docs-commands.yml',
        '.github/workflows/release.yml',
        '.github/actions/setup/action.yml',
        '.github/actions/image/action.yml',
      ];
      for (const file of files) {
        expect(await read(file), file).not.toMatch(/apt-get|playwright install/u);
      }
    });
  });

  it("runs the guides' commands in a workflow of its own, on pull requests, and always tears down", async () => {
    const workflow = await read('.github/workflows/docs-commands.yml');
    expect(workflow).toMatch(/^on:\n {2}pull_request:\s*$/mu);
    expect(jobNames(workflow)).toEqual(['docs-commands']);
    expect(workflow).toContain(
      'node tools/docs-run/src/index.ts apps/docs/content/en/quick-start apps/docs/content/en/guides apps/docs/content/en/operating',
    );
    // `docker compose exec` in a guide finds the stack by these two variables,
    // which a reader's own folder and project name stand in for.
    expect(workflow).toContain('COMPOSE_FILE=$GITHUB_WORKSPACE/quickstart/compose.yaml');
    expect(workflow).toContain('COMPOSE_PROJECT_NAME=odudu-quickstart-stack');
    // `docker compose run` resolves the image, which `exec` never does.
    expect(workflow).toContain('ODUDU_IMAGE=odudu-smoke-odudu');
    expect(workflow).toContain('quickstart/stack.sh up odudu-smoke-odudu 3195');
    expect(workflow).toContain('ODUDU_BASE=http://localhost:3195');
    expect(workflow).toMatch(/if: always\(\)\n\s+run: quickstart\/stack\.sh down/u);
  });
});
