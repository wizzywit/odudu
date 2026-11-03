export interface StartStep {
  title: string;
  body: string;
}

export const STEPS: StartStep[] = [
  {
    title: 'Start it',
    body: 'One command downloads the Compose file and starts Postgres, a one-time setup step and the server.',
  },
  {
    title: 'Sign in to the console',
    body: "The setup step prints the console address and the first administrator's sign-in, once.",
  },
  {
    title: 'Sign a person in to an app',
    body: 'Make a tenant, register an app and sign someone in, from the console or the command line.',
  },
];
