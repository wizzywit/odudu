export const ACCEPT_TERMS_TEMPLATE = `{{intro}}
<p>{{t "acceptTerms.intro"}}</p>
{{error}}{{form.open}}
  {{fields}}
  {{submit}}
{{form.close}}`;
