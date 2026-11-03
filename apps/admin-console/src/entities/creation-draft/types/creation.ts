// A tenant's guided creation, as far as it has gone. The typed values are
// kept so a reload resumes it; the one-time password never is.
export type Creation =
  | { step: 'tenant'; name: string; displayName: string }
  | {
      step: 'administrator';
      tenant: string;
      // Where the tenant came from, which decides what the page says of it.
      origin: 'created' | 'imported' | 'existing';
      username: string;
      email: string;
      subjectId: string | null;
      granted: boolean;
      // What the grant gives: tenant-admin, or a set of capabilities.
      holdings: readonly string[];
    }
  | { step: 'done'; tenant: string; username: string; holdings?: readonly string[] | undefined };

// Creating a tenant, adding an administrator to one existing tenant, and
// adding one of system's own: each flow keeps its own progress, so a page
// only ever resumes its own.
export type CreationFlow = 'tenant' | 'system-administrator' | `administrator/${string}`;
