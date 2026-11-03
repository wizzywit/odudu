import type { RegistrationToken } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal } from '#/entities/session';
import { useTokenList } from '#/features/registration-tokens/repository/useTokenList';
import {
  useTokenMint,
  useTokenRevoke,
} from '#/features/registration-tokens/repository/useTokenWrites';
import {
  DEFAULT_MINT,
  mintProblems,
  type MintErrors,
} from '#/features/registration-tokens/services/mint';
import { mintedText, mintFailure } from '#/features/registration-tokens/services/mintOutcome';
import { askedConsequence, revokeOutcome } from '#/features/registration-tokens/services/revoke';
import { useToast } from '#/shared/repository/useToasts';
import { isEmptyRecord, withoutField } from '#/shared/services/fieldErrors';
import type { ResourceListState } from '#/shared/services/resourceList';
import { useAnnouncedAction } from '#/shared/use-cases/useAnnouncedAction';

export interface RegistrationTokensPage {
  list: ResourceListState<RegistrationToken>;
  uses: number;
  lifetime: number;
  editUses: (value: number) => void;
  editLifetime: (value: number) => void;
  errors: MintErrors;
  message: string | null;
  minting: boolean;
  mint: () => void;
  // For the SecretDialog, and for nothing else.
  secret: string | null;
  closeSecret: () => void;
  revoking: RegistrationToken | null;
  consequence: string;
  revokeBusy: boolean;
  revokeProblem: string | null;
  // What the last revoke came to, for the line beside the list.
  notice: string | null;
  // How many revokes have ended the token, for a view that moves focus once the dialog is gone.
  revoked: number;
  ask: (token: RegistrationToken) => void;
  cancel: () => void;
  confirm: () => Promise<boolean>;
}

export function useRegistrationTokensPage(tenant: string): RegistrationTokensPage {
  const refusal = useRefusal(tenant);
  const toast = useToast();
  const list = useTokenList(tenant);
  const revoke = useTokenRevoke(tenant);
  const [uses, setUses] = useState(DEFAULT_MINT.uses);
  const [lifetime, setLifetime] = useState(DEFAULT_MINT.ttl_seconds);
  const [errors, setErrors] = useState<MintErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const action = useAnnouncedAction<RegistrationToken>({
    refusal,
    capability: 'manage-clients',
    send: (token) => revoke.run(token.id),
    outcomeOf: (_token, result) => revokeOutcome(result),
  });
  const minting = useTokenMint(tenant, {
    minted: (token) => {
      toast.succeeded(mintedText(token));
    },
    failed: (failure) => {
      const outcome = mintFailure(failure);
      setErrors(outcome.errors);
      setMessage(outcome.message);
      if (outcome.report) refusal.report(failure, 'manage-clients');
    },
  });
  return {
    list,
    uses,
    lifetime,
    editUses: (value) => {
      setUses(value);
      setErrors((was) => withoutField(was, 'uses'));
    },
    editLifetime: (value) => {
      setLifetime(value);
      setErrors((was) => withoutField(was, 'ttl_seconds'));
    },
    errors,
    message,
    minting: minting.busy,
    mint: () => {
      const problems = mintProblems({ uses, ttl_seconds: lifetime });
      setErrors(problems);
      setMessage(null);
      if (isEmptyRecord(problems)) minting.start({ uses, ttl_seconds: lifetime });
    },
    secret: minting.secret,
    closeSecret: minting.close,
    revoking: action.asked,
    consequence: askedConsequence(action.asked),
    revokeBusy: revoke.busy,
    revokeProblem: action.problem,
    notice: action.notice,
    revoked: action.done,
    ask: action.ask,
    cancel: action.cancel,
    confirm: action.confirm,
  };
}
