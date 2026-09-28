import '#/zodConfig.ts';
import '#/shared/view/fonts.css';
import '#/shared/view/tokens.css';
import '#/shared/view/global.css';
import { createRoot } from 'react-dom/client';
import { App } from '#/app/App.tsx';
import { createConsoleRouter } from '#/app/router.tsx';
import { applyRememberedTheme } from '#/shared/repository/themeChoice.ts';

applyRememberedTheme();

const root = document.getElementById('root');
if (root === null) throw new Error('the console shell has no #root element');
createRoot(root).render(<App router={createConsoleRouter()} />);
