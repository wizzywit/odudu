import { type AmendSubjectMail } from '#/usecase/subjects';

/** For a test that amends a subject without changing its address, so no mail is ever asked for. */
export const NO_AMEND_MAIL: AmendSubjectMail = {
  sendLink: () => Promise.reject(new Error('no link was expected')),
  deploymentSmtp: false,
  resolveMailLook: () => Promise.resolve({ branding: null, overrides: {} }),
  now: () => new Date(),
};
