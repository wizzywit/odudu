export const CONSENT_TEMPLATE = `{{client}}{{links}}
{{form.open}}
  {{scopes}}
  {{submit.allow}}
  {{submit.deny}}
{{form.close}}`;
