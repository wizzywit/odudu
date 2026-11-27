// Runs the stand-in model server on PROVIDER_STUB_PORT (4100 by default).
import { startProviderStub } from './provider-stub.ts';

const port = Number(process.env.PROVIDER_STUB_PORT ?? '4100');
startProviderStub(port)
  .then(() => {
    process.stdout.write(`provider stub listening on ${String(port)}\n`);
  })
  .catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
