const SIDES = [
  'top',
  'right',
  'bottom',
  'left',
  'inline',
  'block',
  'inline-start',
  'inline-end',
  'block-start',
  'block-end',
];
const CORNERS = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'start-start',
  'start-end',
  'end-start',
  'end-end',
];

function buildProperties(): ReadonlySet<string> {
  const names = [
    'color background-color border-color border-width border-style border-radius outline',
    'outline-color outline-width outline-style outline-offset width min-width max-width height',
    'min-height max-height inline-size block-size min-inline-size max-inline-size',
    'min-block-size max-block-size gap row-gap column-gap display flex flex-grow flex-shrink',
    'flex-basis flex-direction flex-wrap flex-flow grid-template-columns grid-template-rows',
    'align-items align-content align-self justify-content justify-items justify-self position',
    'overflow opacity box-shadow text-align text-transform text-decoration text-decoration-color',
    'text-decoration-line text-decoration-style text-decoration-thickness text-underline-offset',
    'letter-spacing line-height font-size font-weight font-style font-family white-space',
    'word-break list-style list-style-type list-style-position background background-image',
    'background-size background-position background-repeat object-fit cursor content',
  ].join(' ');
  const all = new Set(names.split(' '));
  for (const base of ['margin', 'padding', 'border']) {
    all.add(base);
    for (const side of SIDES) {
      all.add(`${base}-${side}`);
      if (base === 'border') {
        for (const part of ['width', 'style', 'color']) all.add(`border-${side}-${part}`);
      }
    }
  }
  for (const corner of CORNERS) all.add(`border-${corner}-radius`);
  return all;
}

export const PROPERTIES = buildProperties();
