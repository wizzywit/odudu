import '#/zodConfig.ts';
import { createRoot } from 'react-dom/client';
import { App } from '#/app/App.tsx';
import { createConsoleRouter } from '#/app/router.tsx';

const root = document.getElementById('root');
if (root === null) throw new Error('the console shell has no #root element');
createRoot(root).render(<App router={createConsoleRouter()} />);
