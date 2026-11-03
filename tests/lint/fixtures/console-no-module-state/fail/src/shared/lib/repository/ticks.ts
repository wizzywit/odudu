const clock = { ticks: 0 };

export function tick(): number {
  return clock.ticks++;
}
