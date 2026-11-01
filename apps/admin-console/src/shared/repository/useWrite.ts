import { useMutation } from '@tanstack/react-query';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { useTransport } from '#/shared/transport/useTransport';

export interface Write<A, R> {
  busy: boolean;
  run: (arg: A) => Promise<R>;
}

export interface WriteOptions<A, R> {
  // Names the write while it runs, for a page to ask whether it does.
  mutationKey?: readonly string[];
  send: (gateway: Gateway, arg: A) => Promise<R>;
  onSuccess?: (result: R, arg: A) => void;
  // The result is undefined when the send itself rejected.
  onSettled?: (result: R | undefined, arg: A) => void;
}

export function useWrite<A, R>({
  send,
  onSuccess,
  onSettled,
  mutationKey,
}: WriteOptions<A, R>): Write<A, R> {
  const { gateway } = useTransport();
  const mutation = useMutation({
    ...(mutationKey === undefined ? {} : { mutationKey }),
    mutationFn: (arg: A) => send(gateway, arg),
    onSuccess: (result, arg) => {
      onSuccess?.(result, arg);
    },
    onSettled: (result, _error, arg) => {
      onSettled?.(result, arg);
    },
  });
  const { isPending, mutateAsync } = mutation;
  return { busy: isPending, run: (arg) => mutateAsync(arg) };
}

// A write whose rejection is answered as a defect rather than thrown.
export function useGatewayWrite<A, T>(
  options: WriteOptions<A, GatewayResult<T>>,
): Write<A, GatewayResult<T>> {
  return useWrite({
    ...options,
    send: (gateway, arg) =>
      options.send(gateway, arg).catch((): GatewayResult<T> => {
        return { ok: false, kind: 'defect' };
      }),
  });
}
