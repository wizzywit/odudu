import { type PageScript, type RenderedPage } from '@odudu/kernel';

// Minimal, dependency-free HTML: every interpolated value on a rendered
// page passes through this so neither a realm name nor an error string
// opens a reflected-XSS hole.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The one document shell for every page protocol-oidc renders. `body` is
// what a theme may replace; `html` is what the server sends today. See
// ADR 0030 for why a theme is handed the body and never the document.
export function page(title: string, body: string, script: PageScript | null = null): RenderedPage {
  return {
    title,
    body,
    script,
    html: `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body>
${body}
</body>
</html>`,
  };
}
