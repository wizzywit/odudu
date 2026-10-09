import { type RenderedPage } from '@odudu/kernel';

const TITLE = 'Sign-in failed';
const BODY = `<h1>Sign-in failed</h1>
<p>The sign-in could not be completed.</p>
<p><a href="/console/">Sign in again</a></p>`;

// Deliberately the same page for every refusal, so a response says nothing
// about which check a forged or stale callback failed.
export function renderSignInRefused(): RenderedPage {
  return {
    title: TITLE,
    body: BODY,
    script: null,
    frames: [],
    html: `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${TITLE}</title></head>
<body>
${BODY}
</body>
</html>`,
  };
}
