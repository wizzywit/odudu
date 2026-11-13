export const UPDATE_PROFILE_TEMPLATE = `{{intro}}
<p>{{t "updateProfile.intro"}}</p>
{{error}}{{form.open}}
  {{fields}}
  {{submit}}
{{form.close}}`;
