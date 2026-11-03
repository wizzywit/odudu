import {
  chooseScheme,
  SCHEME_PREVIEW_WORDS,
  type Scheme,
  type ThemeView,
} from '#/features/branding-editor';
import type { Client } from '#/entities/client';
import type { MailBrandingView } from '#/pages/branding/types/mailBranding';
import { useState } from 'react';
import { mailPreviewSource, pageOrigin } from '#/pages/branding/repository/mailPreview';
import { useMailBranding } from '#/pages/branding/repository/useMailBranding';
import {
  DEFAULT_MAIL_CHOICE,
  mailChoiceWith,
  mailClientId,
  mailClientOf,
  mailFrameKey,
  type MailChoice,
  type MailClient,
} from '#/pages/branding/services/mailChoice';
import {
  chooseLocale,
  inheritsView,
  mailClientChoice,
  mailPreviewView,
  MAIL_BRANDING_WORDS,
  type ClientChoiceView,
  type InheritsView,
  type MailPreviewView,
} from '#/pages/branding/services/mailTabView';
import { useClientPicker } from '#/entities/client';
import type { PickerState } from '#/shared/services/picker';
import { mapRead, type Read } from '#/shared/services/read';

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
  // What the preview, its choices and the client choice say.
  preview: MailPreviewView;
  clientChoice: ClientChoiceView;
  chooseScheme: (id: string) => void;
  chooseLocale: (id: string) => void;
  inherits: { words: typeof MAIL_BRANDING_WORDS; read: Read<InheritsView> };
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
  const origin = pageOrigin();
  const branding = useMailBranding(tenant, version, choice.client, asked);
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
    origin,
    branding,
    preview: mailPreviewView(choice, client, SCHEME_PREVIEW_WORDS),
    clientChoice: mailClientChoice(client),
    chooseScheme: (id) => {
      chooseScheme(id, setScheme);
    },
    chooseLocale: (id) => {
      chooseLocale(id, setLocale);
    },
    inherits: {
      words: MAIL_BRANDING_WORDS,
      read: mapRead(branding, (data) =>
        inheritsView(data, { origin, client, schemes: SCHEME_PREVIEW_WORDS }),
      ),
    },
  };
}
