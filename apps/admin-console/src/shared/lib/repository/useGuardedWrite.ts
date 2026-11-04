import { useRef } from 'react';
import { useGatewayWrite, type Write } from '#/shared/lib/repository/useWrite';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';

// One press is one write, however often it is pressed before the first
// answer; `settled` runs once whatever the answer was.
export function useGuardedWrite<Input, Answer>(
  send: (gateway: Gateway, input: Input) => Promise<GatewayResult<Answer>>,
  settled: () => void,
): Write<Input, GatewayResult<Answer>> {
  const sending = useRef(false);
  const write = useGatewayWrite({
    send,
    onSettled: () => {
      sending.current = false;
      settled();
    },
  });
  return {
    busy: write.busy,
    run: (input) => {
      if (sending.current) return Promise.resolve({ ok: false, kind: 'defect' });
      sending.current = true;
      return write.run(input);
    },
  };
}
