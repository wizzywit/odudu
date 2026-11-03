// Who is signed in, as GET /console/api/session reports it: the tenant is
// the one the session was issued by, which a system administrator carries
// into every tenant they enter.
export interface Principal {
  tenant: string;
  subjectId: string;
  username: string;
}
