import '#/shared/view/fonts.css';
import '#/shared/view/tokens.css';
import '#/shared/view/global.css';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Gallery, type GalleryDialog, type GalleryTheme } from '#/gallery/Gallery.tsx';

// ?theme=dark and ?dialog=typed make every state the screenshots need
// reachable from a URL alone.
const params = new URLSearchParams(window.location.search);
const DIALOGS = ['plain', 'typed', 'secret', 'unsaved'] as const;
const requested = params.get('dialog');
const dialog: GalleryDialog | null = DIALOGS.find((d) => d === requested) ?? null;

function applyTheme(theme: GalleryTheme): void {
  document.documentElement.dataset.theme = theme;
}

function Root() {
  const [theme, setTheme] = useState<GalleryTheme>(
    params.get('theme') === 'dark' ? 'dark' : 'light',
  );
  applyTheme(theme);
  return <Gallery initialDialog={dialog} theme={theme} onThemeChange={setTheme} />;
}

const root = document.getElementById('root');
if (root === null) throw new Error('the gallery page has no #root element');
createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
