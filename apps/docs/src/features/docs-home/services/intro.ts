export type Audience = 'installation' | 'public';

const INTROS: Record<Audience, string> = {
  installation:
    'This is the documentation for the Odudu installation you are running. It walks from a running server to signed-in users and an administrator who can manage them.',
  public:
    'These pages walk from a running server to signed-in users and an administrator who can manage them.',
};

export function introOf(audience: Audience): string {
  return INTROS[audience];
}
