/** Minimal system interface: everything that ticks implements this. */
export interface System {
  update(dt: number, time: number): void;
}
