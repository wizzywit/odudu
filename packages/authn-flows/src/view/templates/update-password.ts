export const UPDATE_PASSWORD_TEMPLATE = `{{intro}}
<p>{{t "updatePassword.intro"}}</p>
{{error}}{{form.open}}
  {{fields}}
  {{submit}}
{{form.close}}`;
