import { connection } from "next/server";
import type { GiveawayView, Hex } from "@fairdrops/shared";
import { GiveawayScreen } from "@/components/giveaway-screen";
import { isGiveawayId } from "@/lib/ids";
import { EmptyState } from "@/components/empty-state";
import { Shell } from "@/components/shell";
import { serverFairDrops } from "@/lib/fairdrops";

export default async function GiveawayPage({
  params,
}: {
  params: Promise<{ chainId: string; giveawayId: string }>;
}) {
  await connection();
  const { chainId, giveawayId } = await params;
  const id = Number(chainId);
  if (!Number.isInteger(id) || !isGiveawayId(giveawayId)) {
    return (
      <Shell>
        <EmptyState icon="alert" title={"This giveaway can't be shown"}>
          The link may be wrong, or the giveaway hasn&apos;t reached FairDrops yet. Try again in a
          minute.
        </EmptyState>
      </Shell>
    );
  }
  let giveaway: GiveawayView | null = null;
  let players = 0;
  let endsAt: string | null = null;
  try {
    const fd = serverFairDrops();
    giveaway = await fd.giveaways.get(id, giveawayId.toLowerCase() as Hex);
    if (giveaway.session) {
      const session = await fd.sessions.get(giveaway.session.id);
      players = session.playerCount;
      endsAt = session.endsAt;
    }
  } catch {
    giveaway = null;
  }
  if (!giveaway) {
    return (
      <Shell>
        <EmptyState icon="alert" title={"This giveaway can't be shown"}>
          The link may be wrong, or the giveaway hasn&apos;t reached FairDrops yet. Try again in a
          minute.
        </EmptyState>
      </Shell>
    );
  }
  return <GiveawayScreen giveaway={giveaway} players={players} endsAt={endsAt} />;
}
