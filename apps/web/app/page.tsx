import type { LeaderboardsView } from "@fairdrops/shared";
import { connection } from "next/server";
import { Discover } from "@/components/discover";
import { serverFairDrops } from "@/lib/fairdrops";

export default async function HomePage() {
  await connection();
  let items: Awaited<ReturnType<ReturnType<typeof serverFairDrops>["giveaways"]["list"]>>["items"] =
    [];
  let error = false;
  let boards: LeaderboardsView | null = null;
  try {
    // Open giveaways, plus recently finished ones for the Finished tab.
    const fd = serverFairDrops();
    const [active, finalized] = await Promise.all([
      fd.giveaways.list({ status: "ACTIVE", limit: 24 }),
      fd.giveaways.list({ status: "FINALIZED", limit: 12 }),
    ]);
    items = [...active.items, ...finalized.items];
    boards = await fd.leaderboards.get().catch(() => null);
  } catch {
    error = true;
  }
  return <Discover items={items} error={error} boards={boards} />;
}
