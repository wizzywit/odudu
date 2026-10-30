import type { ReactElement } from 'react';
import { vertical, WIDTH } from '@site/src/shared/service/diagram';
import { DiagramArrow } from '@site/src/shared/view/DiagramArrow/DiagramArrow';
import { DiagramBox } from '@site/src/shared/view/DiagramBox/DiagramBox';
import { DiagramText } from '@site/src/shared/view/DiagramText/DiagramText';
import { DiagramWall } from '@site/src/shared/view/DiagramWall/DiagramWall';

export interface Drawing {
  height: number;
  draw: (head: string) => ReactElement;
}

const MID = WIDTH / 2;

function tenants(): Drawing {
  const tenant = (y: number, name: string): ReactElement => (
    <g key={name}>
      <DiagramBox x={10} y={y} w={320} h={140} />
      <DiagramText x={24} y={y + 28} anchor="start" bold size={15}>
        {`Tenant: ${name}`}
      </DiagramText>
      <DiagramText x={24} y={y + 48} anchor="start" mono ink="muted">
        {`/tenants/${name}/…`}
      </DiagramText>
      {[
        ['Users', 24, 62],
        ['Clients', 178, 62],
        ['Signing keys', 24, 100],
        ['Sessions', 178, 100],
      ].map(([label, cx, cy]) => (
        <g key={String(label)}>
          <DiagramBox x={Number(cx)} y={y + Number(cy)} w={138} h={30} tone="accent" />
          <DiagramText x={Number(cx) + 69} y={y + Number(cy) + 20}>
            {String(label)}
          </DiagramText>
        </g>
      ))}
    </g>
  );
  return {
    height: 380,
    draw: () => (
      <>
        {tenant(8, 'demo')}
        <DiagramWall y={166} />
        <DiagramText x={MID} y={188} ink="muted">
          one tenant never reads the other’s rows
        </DiagramText>
        {tenant(204, 'acme')}
        <DiagramText x={MID} y={370}>
          The tenant is named in every address
        </DiagramText>
      </>
    ),
  };
}

function clients(): Drawing {
  return {
    height: 392,
    draw: (head) => (
      <>
        <DiagramBox x={10} y={8} w={320} h={76} />
        <DiagramText x={MID} y={34} bold size={15}>
          Public client
        </DiagramText>
        <DiagramText x={MID} y={54} ink="muted">
          a browser or mobile app
        </DiagramText>
        <DiagramText x={MID} y={72} ink="muted">
          holds no secret
        </DiagramText>
        <DiagramArrow head={head} d={vertical(MID, 86, 130)} />
        <DiagramText x={MID + 14} y={114} anchor="start" ink="accent" bold>
          code + PKCE verifier
        </DiagramText>
        <DiagramBox x={10} y={132} w={320} h={124} tone="accent" />
        <DiagramText x={MID} y={158} bold size={15}>
          The tenant’s token endpoint
        </DiagramText>
        {[
          'checks the client_id',
          'checks the redirect address',
          'checks the PKCE verifier',
          'checks the secret, if there is one',
        ].map((line, index) => (
          <DiagramText key={line} x={MID} y={182 + index * 19}>
            {line}
          </DiagramText>
        ))}
        <DiagramArrow head={head} d={vertical(MID, 300, 258)} />
        <DiagramText x={MID + 14} y={286} anchor="start" ink="accent" bold>
          code, verifier, secret
        </DiagramText>
        <DiagramBox x={10} y={302} w={320} h={78} />
        <DiagramText x={MID} y={328} bold size={15}>
          Confidential client
        </DiagramText>
        <DiagramText x={MID} y={348} ink="muted">
          a server-side app or service
        </DiagramText>
        <DiagramText x={MID} y={366} ink="muted">
          holds a secret and proves it
        </DiagramText>
      </>
    ),
  };
}

function scopes(): Drawing {
  const steps: {
    y: number;
    h: number;
    tone: 'panel' | 'accent';
    title: string;
    lines: string[];
  }[] = [
    { y: 8, h: 54, tone: 'panel', title: 'The client asks', lines: ['scope=openid email'] },
    {
      y: 84,
      h: 72,
      tone: 'panel',
      title: 'Sorted against its scopes',
      lines: ['default: always given', 'optional: the person chooses'],
    },
    {
      y: 178,
      h: 72,
      tone: 'accent',
      title: 'Consent',
      lines: ['shown if required', 'or if the request says prompt=consent'],
    },
    { y: 272, h: 54, tone: 'panel', title: 'Granted', lines: ['what the person allowed'] },
  ];
  return {
    height: 470,
    draw: (head) => (
      <>
        {steps.map((step, index) => (
          <g key={step.title}>
            <DiagramBox x={10} y={step.y} w={320} h={step.h} tone={step.tone} />
            <DiagramText x={MID} y={step.y + 24} bold size={15}>
              {step.title}
            </DiagramText>
            {step.lines.map((line, row) => (
              <DiagramText key={line} x={MID} y={step.y + 44 + row * 18} ink="muted">
                {line}
              </DiagramText>
            ))}
            {index < steps.length - 1 ? (
              <DiagramArrow
                head={head}
                d={vertical(MID, step.y + step.h + 2, (steps[index + 1]?.y ?? 0) - 2)}
              />
            ) : null}
          </g>
        ))}
        <DiagramText x={MID} y={356}>
          Where the granted scopes show up
        </DiagramText>
        {[
          ['Access token', 'roles, groups, scope'],
          ['ID token', 'who signed in'],
          ['UserInfo', 'only the claims asked for'],
        ].map(([name, note], index) => (
          <g key={String(name)}>
            <DiagramBox x={10} y={368 + index * 32} w={320} h={28} tone="accent" />
            <DiagramText x={24} y={387 + index * 32} anchor="start" bold>
              {String(name)}
            </DiagramText>
            <DiagramText x={316} y={387 + index * 32} anchor="end">
              {String(note)}
            </DiagramText>
          </g>
        ))}
      </>
    ),
  };
}

function rolesAndGroups(): Drawing {
  return {
    height: 470,
    draw: (head) => (
      <>
        <DiagramBox x={10} y={8} w={320} h={56} />
        <DiagramText x={MID} y={32} mono>
          /engineering
        </DiagramText>
        <DiagramText x={MID} y={52} ink="muted">
          role: engineering-lead
        </DiagramText>
        <DiagramArrow head={head} d={vertical(MID, 66, 98)} />
        <DiagramText x={MID + 14} y={88} anchor="start" ink="muted">
          roles reach down
        </DiagramText>
        <DiagramBox x={10} y={100} w={320} h={56} />
        <DiagramText x={MID} y={124} mono>
          /engineering/backend
        </DiagramText>
        <DiagramText x={MID} y={144} ink="muted">
          role: reviewer
        </DiagramText>
        <DiagramArrow head={head} d={vertical(MID, 200, 158)} dashed />
        <DiagramBox x={10} y={202} w={320} h={36} tone="accent" />
        <DiagramText x={MID} y={225}>
          Ada joins only /engineering/backend
        </DiagramText>
        <DiagramText x={MID} y={272} bold>
          What Ada’s access token carries
        </DiagramText>
        <DiagramBox x={10} y={284} w={320} h={80} tone="accent" />
        <DiagramText x={MID} y={308} bold size={15}>
          roles claim
        </DiagramText>
        <DiagramText x={MID} y={330} mono>
          reviewer
        </DiagramText>
        <DiagramText x={MID} y={350} mono>
          engineering-lead
        </DiagramText>
        <DiagramBox x={10} y={378} w={320} h={80} tone="accent" />
        <DiagramText x={MID} y={402} bold size={15}>
          groups claim
        </DiagramText>
        <DiagramText x={MID} y={424} mono>
          /engineering/backend
        </DiagramText>
        <DiagramText x={MID} y={446} ink="muted">
          direct memberships only
        </DiagramText>
      </>
    ),
  };
}

function sessions(): Drawing {
  const segments: [string, number, boolean][] = [
    ['active', 70, true],
    ['quiet', 44, false],
    ['active', 70, true],
    ['too long', 106, false],
  ];
  // Each segment starts where the one before it ends.
  const lefts = segments.map((_, index) =>
    segments.slice(0, index).reduce((sum, [, width]) => sum + width, 14),
  );
  return {
    height: 360,
    draw: (head) => (
      <>
        <DiagramText x={14} y={28} anchor="start" ink="accent" bold>
          Sign in
        </DiagramText>
        <DiagramText x={326} y={28} anchor="end" ink="accent" bold>
          Ceiling
        </DiagramText>
        {segments.map(([label, width, busy], index) => {
          const left = lefts[index] ?? 14;
          return (
            <g key={`${label}${String(index)}`}>
              <DiagramBox x={left} y={40} w={width} h={34} tone={busy ? 'accent' : 'panel'} />
              <DiagramText x={left + width / 2} y={62} ink={busy ? 'ink' : 'muted'}>
                {label}
              </DiagramText>
            </g>
          );
        })}
        <line x1={326} x2={326} y1={36} y2={80} stroke="var(--ink-muted)" strokeWidth={2} />
        <DiagramArrow head={head} d={vertical(274, 108, 78)} />
        <DiagramText x={MID} y={128}>
          Short quiet stretches keep the session alive.
        </DiagramText>
        <DiagramText x={MID} y={148}>
          One longer than the idle limit ends it.
        </DiagramText>
        <DiagramBox x={10} y={170} w={320} h={84} />
        <DiagramText x={MID} y={196} bold size={15}>
          Idle limit
        </DiagramText>
        <DiagramText x={MID} y={218} ink="muted">
          quiet for too long, and it ends
        </DiagramText>
        <DiagramText x={MID} y={238} ink="muted">
          default 30 minutes
        </DiagramText>
        <DiagramBox x={10} y={266} w={320} h={84} />
        <DiagramText x={MID} y={292} bold size={15}>
          Absolute limit
        </DiagramText>
        <DiagramText x={MID} y={314} ink="muted">
          however busy, it ends at the ceiling
        </DiagramText>
        <DiagramText x={MID} y={334} ink="muted">
          default 10 hours
        </DiagramText>
      </>
    ),
  };
}

function tokens(): Drawing {
  const cards: [number, number, 'accent' | 'panel', string, string[]][] = [
    [
      36,
      96,
      'accent',
      'Access token',
      ['sent to your API', 'a signed JWT, typed at+jwt', 'lives 300 seconds by default'],
    ],
    [144, 74, 'panel', 'ID token', ['read by the app', 'says who signed in']],
    [
      230,
      96,
      'panel',
      'Refresh token',
      ['kept by the app, opaque', 'trades for new tokens', 'works once'],
    ],
  ];
  return {
    height: 498,
    draw: (head) => (
      <>
        <DiagramText x={MID} y={20} bold>
          One sign-in gives the app three tokens
        </DiagramText>
        <path
          d="M12 84 L5 84 L5 278 L12 278 M5 181 L12 181"
          fill="none"
          stroke="var(--ink-muted)"
          strokeWidth={1.8}
        />
        {cards.map(([y, h, tone, title, lines]) => (
          <g key={title}>
            <DiagramBox x={14} y={y} w={316} h={h} tone={tone} />
            <DiagramText x={172} y={y + 24} bold size={15}>
              {title}
            </DiagramText>
            {lines.map((line, row) => (
              <DiagramText key={line} x={172} y={y + 44 + row * 18} ink="muted">
                {line}
              </DiagramText>
            ))}
          </g>
        ))}
        <DiagramText x={MID} y={360} bold>
          A refresh token used twice
        </DiagramText>
        {['R1', 'R2', 'R3'].map((name, index) => (
          <g key={name}>
            <DiagramBox x={24 + index * 112} y={374} w={72} h={36} tone="accent" />
            <DiagramText x={60 + index * 112} y={397} mono>
              {name}
            </DiagramText>
          </g>
        ))}
        <DiagramArrow head={head} d="M98 392 L134 392" />
        <DiagramArrow head={head} d="M210 392 L246 392" />
        <DiagramArrow head={head} d={vertical(60, 414, 444)} dashed />
        <DiagramBox x={10} y={446} w={320} h={40} />
        <DiagramText x={MID} y={471}>
          R1 again: the whole family is revoked
        </DiagramText>
      </>
    ),
  };
}

function consentAndAudit(): Drawing {
  return {
    height: 540,
    draw: (head) => (
      <>
        <DiagramBox x={10} y={8} w={320} h={216} />
        <DiagramText x={24} y={32} anchor="start" bold size={15}>
          Consent
        </DiagramText>
        {[
          ['The client asks', 46],
          ['The person decides', 96],
          ['A grant is recorded', 146],
        ].map(([label, y]) => (
          <g key={String(label)}>
            <DiagramBox x={24} y={Number(y)} w={292} h={34} tone="accent" />
            <DiagramText x={MID} y={Number(y) + 22}>
              {String(label)}
            </DiagramText>
          </g>
        ))}
        <DiagramArrow head={head} d={vertical(MID, 82, 94)} />
        <DiagramArrow head={head} d={vertical(MID, 132, 144)} />
        <DiagramText x={MID} y={208} ink="muted">
          asked again only for something more
        </DiagramText>
        <DiagramBox x={10} y={240} w={320} h={216} />
        <DiagramText x={24} y={264} anchor="start" bold size={15}>
          Audit trail
        </DiagramText>
        {[
          'sign-ins and refusals',
          'sessions started and ended',
          'tokens issued and revoked',
          'changes an admin made',
        ].map((row, index) => (
          <g key={row}>
            <DiagramBox x={24} y={278 + index * 40} w={292} h={32} tone="accent" />
            <DiagramText x={MID} y={299 + index * 40}>
              {row}
            </DiagramText>
          </g>
        ))}
        <DiagramText x={MID} y={486}>
          Both are kept for each tenant.
        </DiagramText>
        <DiagramText x={MID} y={506}>
          Audit events: 90 days by default.
        </DiagramText>
        <DiagramText x={MID} y={526} ink="muted">
          Refusals are bounded for each client.
        </DiagramText>
      </>
    ),
  };
}

function branding(): Drawing {
  const layers: { y: number; title: string; line: string; tone: 'panel' | 'accent' }[] = [
    { y: 8, title: 'The client', line: 'only the pieces it sets', tone: 'accent' },
    { y: 104, title: 'The tenant', line: 'the pieces the client left alone', tone: 'accent' },
    { y: 200, title: 'Instrument', line: 'what neither one set', tone: 'panel' },
  ];
  return {
    height: 380,
    draw: (head) => (
      <>
        {layers.map(({ y, title, line, tone }) => (
          <g key={title}>
            <DiagramBox x={10} y={y} w={320} h={72} tone={tone} />
            <DiagramText x={MID} y={y + 30} bold size={15}>
              {title}
            </DiagramText>
            <DiagramText x={MID} y={y + 52} ink="muted">
              {line}
            </DiagramText>
          </g>
        ))}
        <DiagramArrow head={head} d={vertical(MID, 80, 102)} />
        <DiagramArrow head={head} d={vertical(MID, 176, 198)} />
        <DiagramArrow head={head} d={vertical(MID, 272, 304)} />
        <DiagramText x={MID} y={326} bold>
          Each piece comes from the first layer that has it
        </DiagramText>
        <DiagramText x={MID} y={348} ink="muted">
          colours, font, images, stylesheet, page layouts
        </DiagramText>
        <DiagramText x={MID} y={368} ink="muted">
          a piece is never mixed, only chosen
        </DiagramText>
      </>
    ),
  };
}

function brandingPublishing(): Drawing {
  const boxes: { y: number; title: string; line: string; tone: 'panel' | 'accent' }[] = [
    { y: 8, title: 'Draft', line: 'one only, saved whole, seen by no one', tone: 'panel' },
    { y: 120, title: 'Published version', line: 'what people see now', tone: 'accent' },
    { y: 232, title: 'Versions', line: 'the twenty newest, kept', tone: 'panel' },
  ];
  return {
    height: 430,
    draw: (head) => (
      <>
        {boxes.map(({ y, title, line, tone }) => (
          <g key={title}>
            <DiagramBox x={10} y={y} w={320} h={72} tone={tone} />
            <DiagramText x={MID} y={y + 30} bold size={15}>
              {title}
            </DiagramText>
            <DiagramText x={MID} y={y + 52} ink="muted">
              {line}
            </DiagramText>
          </g>
        ))}
        <DiagramArrow head={head} d={vertical(MID, 82, 118)} />
        <DiagramText x={MID + 14} y={106} anchor="start" ink="accent" bold>
          Publish: all or nothing
        </DiagramText>
        <DiagramArrow head={head} d={vertical(MID, 194, 230)} />
        <DiagramText x={MID + 14} y={218} anchor="start" ink="accent" bold>
          the version it replaces
        </DiagramText>
        <DiagramText x={MID} y={330}>
          Discard draft deletes only the draft.
        </DiagramText>
        <DiagramText x={MID} y={352}>
          Restore publishes a copy of a version.
        </DiagramText>
        <DiagramText x={MID} y={374} ink="muted">
          Reset unpublishes; the versions remain.
        </DiagramText>
        <DiagramText x={MID} y={394} ink="muted">
          Publishing uses the draft up.
        </DiagramText>
        <DiagramText x={MID} y={414} ink="muted">
          Restore leaves the draft alone.
        </DiagramText>
      </>
    ),
  };
}

function brandingParts(): Drawing {
  const slots = ['{{error}}', '{{form.open}}', '{{fields}} {{submit}}', '{{form.close}}'];
  const filled = [
    'the form tags',
    'every hidden field',
    'the anti-forgery proof',
    'inputs and buttons',
  ];
  return {
    height: 420,
    draw: (head) => (
      <>
        <DiagramBox x={10} y={8} w={320} h={160} />
        <DiagramText x={MID} y={32} bold size={15}>
          The tenant’s template
        </DiagramText>
        <DiagramText x={MID} y={56} mono>
          {'{{t "login.title"}}'}
        </DiagramText>
        {slots.map((slot, index) => (
          <DiagramText key={slot} x={MID} y={80 + index * 22} mono ink="accent">
            {slot}
          </DiagramText>
        ))}
        <DiagramArrow head={head} d={vertical(MID, 170, 212)} />
        <DiagramText x={MID + 14} y={196} anchor="start" ink="accent" bold>
          the server fills each slot
        </DiagramText>
        <DiagramBox x={10} y={214} w={320} h={162} tone="accent" />
        <DiagramText x={MID} y={240} bold size={15}>
          The page people get
        </DiagramText>
        {filled.map((line, index) => (
          <DiagramText key={line} x={MID} y={266 + index * 22}>
            {line}
          </DiagramText>
        ))}
        <DiagramText x={MID} y={366} ink="muted">
          all written by the server
        </DiagramText>
        <DiagramText x={MID} y={402} ink="muted">
          a template cannot drop or forge any of it
        </DiagramText>
      </>
    ),
  };
}

export const DRAWINGS = {
  tenants: tenants(),
  clients: clients(),
  scopes: scopes(),
  'roles-and-groups': rolesAndGroups(),
  sessions: sessions(),
  tokens: tokens(),
  'consent-and-audit': consentAndAudit(),
  branding: branding(),
  'branding-publishing': brandingPublishing(),
  'branding-parts': brandingParts(),
} satisfies Record<string, Drawing>;

export type DiagramName = keyof typeof DRAWINGS;
