/**
 * Small least-recently-used cache (task 13.20). The VoicePlayer keeps at most `capacity` decoded
 * buffers besides the pinned greeting and confirm lines. `get` and `set` mark a key as most recent.
 * `set` returns the keys it evicted.
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('LruCache capacity must be a positive integer.');
  }
  get size(): number {
    return this.map.size;
  }
  has(key: K): boolean {
    return this.map.has(key);
  }
  /** Read without changing the order. */
  peek(key: K): V | undefined {
    return this.map.get(key);
  }
  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }
  set(key: K, value: V): K[] {
    this.map.delete(key);
    this.map.set(key, value);
    const evicted: K[] = [];
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next();
      if (oldest.done === true) break;
      this.map.delete(oldest.value);
      evicted.push(oldest.value);
    }
    return evicted;
  }
  clear(): void {
    this.map.clear();
  }
  keys(): K[] {
    return [...this.map.keys()];
  }
}
