import type { EditorPoint } from "@ide/contracts";

export interface NavigationHistoryLocation {
  filePath: string;
  point: EditorPoint;
}
const same = (a: NavigationHistoryLocation, b: NavigationHistoryLocation) =>
  a.filePath === b.filePath &&
  a.point.lineNumber === b.point.lineNumber &&
  a.point.column === b.point.column;
const copy = (entry: NavigationHistoryLocation): NavigationHistoryLocation => ({
  filePath: entry.filePath,
  point: { ...entry.point },
});

/** Bounded view history. Entries contain locations, never document text or provider authority. */
export class NavigationHistory {
  private entries: NavigationHistoryLocation[] = [];
  private index = -1;
  constructor(private readonly limit = 100) {}
  get current() {
    return this.entries[this.index];
  }
  clear() {
    this.entries = [];
    this.index = -1;
  }
  updateCurrent(location: NavigationHistoryLocation) {
    if (this.current?.filePath === location.filePath) this.entries[this.index] = copy(location);
  }
  record(origin: NavigationHistoryLocation | null, destination: NavigationHistoryLocation) {
    // A file-open render may already have observed this transition before its explicit reveal.
    if (
      origin &&
      origin.filePath !== destination.filePath &&
      this.current?.filePath === destination.filePath &&
      this.entries[this.index - 1]?.filePath === origin.filePath
    ) {
      this.entries[this.index - 1] = copy(origin);
      this.entries[this.index] = copy(destination);
      return;
    }
    if (origin) {
      if (this.current?.filePath === origin.filePath) this.updateCurrent(origin);
      else this.append(origin);
    }
    this.append(destination);
  }
  private append(location: NavigationHistoryLocation) {
    if (this.current && same(this.current, location)) return;
    this.entries = [...this.entries.slice(0, this.index + 1), copy(location)].slice(-this.limit);
    this.index = this.entries.length - 1;
  }
  rename(changes: readonly { oldPath: string; path: string }[]) {
    const paths = new Map(changes.map((change) => [change.oldPath, change.path]));
    this.entries = this.entries.map((entry) => ({
      ...entry,
      filePath: paths.get(entry.filePath) ?? entry.filePath,
    }));
  }
  destination(direction: -1 | 1, available: (path: string) => boolean = () => true) {
    for (
      let index = this.index + direction;
      index >= 0 && index < this.entries.length;
      index += direction
    ) {
      if (available(this.entries[index]!.filePath))
        return { index, location: copy(this.entries[index]!) };
    }
    return null;
  }
  commit(index: number, origin: NavigationHistoryLocation | null) {
    if (index < 0 || index >= this.entries.length) return false;
    if (origin) this.updateCurrent(origin);
    this.index = index;
    return true;
  }
}
