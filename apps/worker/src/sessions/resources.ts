import type { ResourceRef } from "@fairdrops/game-kit";
import type { Hex } from "@fairdrops/shared";
import type { Database } from "../infra/prisma.module.js";

export interface LoadedResource extends ResourceRef {
  content: unknown;
}

/** Loads the resources a game asked for. Missing ones are left out; `check` reports them. */
export async function loadResources(db: Database, refs: ResourceRef[]): Promise<LoadedResource[]> {
  if (refs.length === 0) return [];
  const rows = await db.gameResource.findMany({
    where: { hash: { in: refs.map((ref) => ref.hash) } },
  });
  return refs.flatMap((ref) => {
    const row = rows.find((r) => r.hash === ref.hash && r.kind === ref.kind);
    return row ? [{ kind: ref.kind, hash: ref.hash, content: row.content }] : [];
  });
}

export function resourceMap(resources: LoadedResource[]): Map<Hex, unknown> {
  return new Map(resources.map((r) => [r.hash, r.content]));
}
