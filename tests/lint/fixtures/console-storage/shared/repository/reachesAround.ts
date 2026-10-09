// The fixtures typecheck under Node, which has storage but no window.
declare const window: Record<string, Storage>;
declare const document: { readonly defaultView: { readonly localStorage: Storage } | null };

export const bracketed = window['localStorage'];
export const viaDocument = document.defaultView?.localStorage;
export const shorthand = { localStorage };
export const templated = window[`sessionStorage`];
