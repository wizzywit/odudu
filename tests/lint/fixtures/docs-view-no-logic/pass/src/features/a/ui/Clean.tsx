import type { ReactElement } from 'react';

const LOOKS = { plain: 'band', sunken: 'band sunken' };

interface Props {
  items: { id: string; label: string; flag: boolean }[];
  tone: 'plain' | 'sunken';
  note: string;
  visible: boolean;
}

export function Clean({ items, tone, note, visible }: Props): ReactElement {
  return (
    <section className={LOOKS[tone]} hidden={!visible}>
      {visible ? <p>{note}</p> : null}
      {note && <span>{note}</span>}
      {visible ? <p>on</p> : <p>off</p>}
      <ul>
        {items.map((item) => (
          <li key={item.id} data-flag={String(item.flag)}>
            {item.flag ? <b>{item.label}</b> : null}
            {`${item.id}-x`}
          </li>
        ))}
      </ul>
    </section>
  );
}

export const ORIGIN = <rect x={-30} y={-13} />;
