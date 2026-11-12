import { renderHelp } from '#/cli/help';
import { CLI_COMMANDS } from '#/cli/registry';

const firstArgument = process.argv[2];

function refuseUnknownCommand(message: string): never {
  console.error(`${message}\n`);
  process.stderr.write(renderHelp(CLI_COMMANDS, []));
  process.exit(2);
}

if (firstArgument === 'help') {
  try {
    process.stdout.write(renderHelp(CLI_COMMANDS, process.argv.slice(3)));
  } catch (err) {
    refuseUnknownCommand(err instanceof Error ? err.message : String(err));
  }
  process.exit(0);
}

if (firstArgument === '--help' || firstArgument === '-h') {
  process.stdout.write(renderHelp(CLI_COMMANDS, []));
  process.exit(0);
}

if (firstArgument === '--version') {
  console.log(process.env.ODUDU_VERSION ?? 'dev');
  process.exit(0);
}

if (
  firstArgument !== undefined &&
  !CLI_COMMANDS.some((command) => command.name === firstArgument)
) {
  refuseUnknownCommand(`unknown command ${JSON.stringify(firstArgument)}`);
}

if (process.argv[2] === 'init') {
  try {
    await (await import('#/cli/init')).initCommand(process.argv.slice(3));
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (process.argv[2] === 'reap') {
  try {
    console.log(JSON.stringify(await (await import('#/cli/reap')).reapCommand()));
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (process.argv[2] === 'domains') {
  try {
    console.log(
      JSON.stringify(await (await import('#/cli/domains')).domainsCommand(process.argv.slice(3))),
    );
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (process.argv[2] === 'breached-passwords') {
  try {
    console.log(
      JSON.stringify(
        await (
          await import('#/cli/breached-passwords')
        ).breachedPasswordsCommand(process.argv.slice(3)),
      ),
    );
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (process.argv[2] === 'send-mail') {
  try {
    console.log(JSON.stringify(await (await import('#/cli/send-mail')).sendMailCommand()));
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (process.argv[2] === 'send-logouts') {
  try {
    console.log(JSON.stringify(await (await import('#/cli/send-logouts')).sendLogoutsCommand()));
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (process.argv[2] === 'console') {
  try {
    console.log(await (await import('#/cli/console')).consoleCommand(process.argv.slice(3)));
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (process.argv[2] === 'mcp') {
  const { mcpCommand, processMcpIo } = await import('#/cli/mcp');
  process.exit(await mcpCommand(process.argv.slice(3), processMcpIo()));
}

if (process.argv[2] === 'client-origins') {
  try {
    console.log(
      await (await import('#/cli/client-origins')).clientOriginsCommand(process.argv.slice(3)),
    );
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (process.argv[2] === 'seed') {
  const { seed } = await import('#/cli/seed');
  const { resolveSeedInvocation } = await import('#/cli/seed-invocation');
  const invocation = resolveSeedInvocation(process.argv.slice(3));
  const { BidiControlError } = await import('@odudu/kernel');
  let result;
  try {
    result =
      invocation.kind === 'command' ? await seed(invocation.argv) : await seed(invocation.options);
  } catch (err) {
    // A refused value is the operator's to correct, so it is one line, not a stack.
    if (!(err instanceof BidiControlError)) throw err;
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
  // An initial access token is a bearer credential a shell is meant to
  // capture (`TOKEN=$(odudu seed registration-token …)`), so it leaves
  // alone on stdout rather than wrapped in the JSON report every other
  // subcommand prints.
  if ('command' in result && result.command === 'registration-token') {
    console.log(result.token);
  } else {
    console.log(JSON.stringify(result));
  }
  process.exit(0);
}

await import('#/serve');
