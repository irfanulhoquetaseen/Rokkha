// Per-entity version gate (CLAUDE.md §3.2): a live event is applied only when its version is
// newer than the one the client already holds, so late or duplicate events never roll UI back.

export type VersionGate = {
  /** True (and remembers `version`) only when `version` is newer than the stored one; unknown ids are accepted. */
  accept(id: string, version: number): boolean;
  /** Seed from a freshly fetched snapshot — the snapshot is what is on screen, so it is authoritative. */
  set(id: string, version: number): void;
};

export function createVersionGate(): VersionGate {
  const versions = new Map<string, number>();
  return {
    accept(id, version) {
      const held = versions.get(id);
      if (held !== undefined && version <= held) return false;
      versions.set(id, version);
      return true;
    },
    set(id, version) {
      versions.set(id, version);
    },
  };
}
