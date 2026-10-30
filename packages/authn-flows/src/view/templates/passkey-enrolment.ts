export const PASSKEY_ENROLMENT_TEMPLATE = `{{intro}}
{{error}}<p>{{t "passkey.intro"}}</p>
{{form.open}}
  {{fields}}
  {{submit}}
{{form.close}}
{{script}}`;
