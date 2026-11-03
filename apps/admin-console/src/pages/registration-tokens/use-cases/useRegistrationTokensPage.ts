import type { RegistrationToken } from '@odudu/contracts/admin';
import { useState } from 'react';
import type { Area } from '#/entities/area';
import { useRefusal } from '#/entities/session';
import { useTokenList } from '#/pages/registration-tokens/repository/useTokenList';
import {
  useTokenMint,
  useTokenRevoke,
} from '#/pages/registration-tokens/repository/useTokenWrites';
import {
  DEFAULT_MINT,
  mintProblems,
  type MintErrors,
} from '#/pages/registration-tokens/services/mint';
import { mintedText, mintFailure } from '#/pages/registration-tokens/services/mintOutcome';
import {
  revokeLabel,
  tokensArea,
  TOKEN_WORDS,
  type TokenWords,
} from '#/pages/registration-tokens/services/tokenWording';
import { askedConsequence, revokeOutcome } from '#/pages/registration-tokens/services/revoke';
import { useToast } from '#/shared/repository/useToasts';
import { isEmptyRecord, withoutField } from '#/shared/services/fieldErrors';
import type { ResourceListState } from '#/shared/services/resourceList';
import { useAnnouncedAction } from '#/shared/use-cases/useAnnouncedAction';

// The gate wraps the page, so it takes the area and the title here.
export function useTokensArea(): { area: Area; title: string } {
  return tokensArea();
}

export interface MintSection {
  uses: number;
  lifetime: number;
  editUses: (value: number) => void;
  editLifetime: (value: number) => void;
  errors: MintErrors;
  message: string | null;
  busy: boolean;
  start: () => void;
  // For the SecretDialog, and for nothing else.
  secret: string | null;
  closeSecret: () => void;
}

export interface RevokeSection {
  asked: RegistrationToken | null;
  consequence: string;
  busy: boolean;
  problem: string | null;
  // What the last revoke came to, for the line beside the list.
  notice: string | null;
  // How many revokes have ended the token, for a view that moves focus once the dialog is gone.
  count: number;
  ask: (token: RegistrationToken) => void;
  cancel: () => void;
  confirm: () => Promise<boolean>;
  label: (id: string) => string;
}

export interface RegistrationTokensPage {
  title: string;
  words: TokenWords;
  list: ResourceListState<RegistrationToken>;
  mint: MintSection;
  revoke: RevokeSection;
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
    title: tokensArea().title,
    words: TOKEN_WORDS,
    list,
    mint: {
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
      busy: minting.busy,
      start: () => {
        const problems = mintProblems({ uses, ttl_seconds: lifetime });
        setErrors(problems);
        setMessage(null);
        if (isEmptyRecord(problems)) minting.start({ uses, ttl_seconds: lifetime });
      },
      secret: minting.secret,
      closeSecret: minting.close,
    },
    revoke: {
      asked: action.asked,
      consequence: askedConsequence(action.asked),
      busy: revoke.busy,
      problem: action.problem,
      notice: action.notice,
      count: action.done,
      ask: action.ask,
      cancel: action.cancel,
      confirm: action.confirm,
      label: revokeLabel,
    },
  };
}
