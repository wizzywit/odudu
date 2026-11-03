export class Counter {
  static count = 0;
  static readonly LIMIT = 10;

  static inc(): void {
    Counter.count += 1;
  }
}

class Bus {
  items: string[] = [];

  push(item: string): void {
    this.items.push(item);
  }
}

export const bus = new Bus();
export const tally = {
  n: 0,
  inc() {
    this.n += 1;
  },
};
