// Per-entity version gate (CLAUDE.md §3.2): a live event is applied only when its version is
// newer than the one the client already holds, so late or duplicate events never roll UI back.
// The held version only ever rises: a snapshot fetched before a newer event must not lower it.

export type VersionGate = {
  /** Live event: true (and remembers `version`) only when newer than the held one; unknown ids are accepted. */
  accept(id: string, version: number): boolean;
  /** Snapshot row: true (and remembers it) when `version >= held` — apply the row only then. */
  snapshot(id: string, version: number): boolean;
  /** Raise the held version to at least `version`; never lowers it. */
  set(id: string, version: number): void;
};

export function createVersionGate(): VersionGate {
  const versions = new Map<string, number>();
  const raise = (id: string, version: number) => {
    const held = versions.get(id);
    if (held === undefined || version > held) versions.set(id, version);
  };
  return {
    accept(id, version) {
      const held = versions.get(id);
      if (held !== undefined && version <= held) return false;
      versions.set(id, version);
      return true;
    },
    snapshot(id, version) {
      const held = versions.get(id);
      if (held !== undefined && version < held) return false;
      versions.set(id, version);
      return true;
    },
    set: raise,
  };
}
