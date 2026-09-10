export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export class FakeClock implements Clock {
  #current: Date;

  constructor(start: Date) {
    this.#current = new Date(start);
  }

  now(): Date {
    return new Date(this.#current);
  }

  advance(ms: number): void {
    this.#current = new Date(this.#current.getTime() + ms);
  }

  set(at: Date): void {
    this.#current = new Date(at);
  }
}
