export const VERIFY_EMAIL_TEMPLATE = `{{intro}}
<p>{{t "verifyEmail.intro"}}</p>
{{error}}{{form.open}}
  {{fields}}
  {{submit}}
{{form.close}}`;
