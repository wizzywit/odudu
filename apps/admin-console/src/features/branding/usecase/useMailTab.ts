import type { Client, MailBrandingView, ThemeView } from '@odudu/contracts/admin';
import { useState } from 'react';
import { mailPreviewSource } from '#/features/branding/repository/mailPreview';
import { useMailBranding } from '#/features/branding/repository/useMailBranding';
import {
  DEFAULT_MAIL_CHOICE,
  mailChoiceWith,
  mailClientId,
  mailClientOf,
  mailFrameKey,
  type MailChoice,
  type MailClient,
  type Scheme,
} from '#/features/branding/service';
import { useClientPicker } from '#/shared/repository/useClientPicker';
import type { PickerState } from '#/shared/service/picker';
import type { Read } from '#/shared/service/read';

export interface MailTab {
  choice: MailChoice;
  src: string;
  frameKey: string;
  loading: boolean;
  onLoaded: () => void;
  setScheme: (scheme: Scheme) => void;
  setLocale: (locale: string) => void;
  // The client whose mail is shown, or none for the tenant's own.
  client: MailClient | null;
  picker: PickerState<Client>;
  chooseClient: (ids: readonly string[]) => void;
  showTenantOwn: () => void;
  branding: Read<MailBrandingView>;
  // The address the console is served from.
  origin: string;
}

// The verification mail as the published theme dresses it, the tenant's own or
// that of a client's sign-in, and what it inherits.
export function useMailTab(tenant: string, view: ThemeView | undefined, asked: boolean): MailTab {
  const [scheme, setScheme] = useState(DEFAULT_MAIL_CHOICE.scheme);
  const [locale, setLocale] = useState(DEFAULT_MAIL_CHOICE.locale);
  const [client, setClient] = useState<MailClient | null>(null);
  const [loaded, setLoaded] = useState('');
  const picker = useClientPicker(tenant, asked);
  const choice = mailChoiceWith(DEFAULT_MAIL_CHOICE, {
    scheme,
    locale,
    client: mailClientId(client),
  });
  const version = view?.published?.version;
  const frameKey = mailFrameKey(version, choice);
  return {
    choice,
    src: mailPreviewSource(tenant, choice),
    frameKey,
    loading: loaded !== frameKey,
    onLoaded: () => {
      setLoaded(frameKey);
    },
    setScheme,
    setLocale,
    client,
    picker,
    chooseClient: (ids) => {
      setClient(mailClientOf(picker.options, ids));
    },
    showTenantOwn: () => {
      setClient(null);
    },
    origin: globalThis.location.origin,
    branding: useMailBranding(tenant, version, choice.client, asked),
  };
}
