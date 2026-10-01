import { connection } from "next/server";
import type { GiveawayView, Hex, SessionView } from "@fairdrops/shared";
import { isGiveawayId } from "@/lib/ids";
import { ManageGiveaway } from "@/components/host/manage-giveaway";
import { EmptyState } from "@/components/empty-state";
import { Shell } from "@/components/shell";
import { serverFairDrops } from "@/lib/fairdrops";

export default async function ManagePage({
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
  let session: SessionView | null = null;
  try {
    const fd = serverFairDrops();
    giveaway = await fd.giveaways.get(id, giveawayId.toLowerCase() as Hex);
    session = giveaway.session ? await fd.sessions.get(giveaway.session.id) : null;
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
  return (
    <Shell>
      <ManageGiveaway giveaway={giveaway} session={session} />
    </Shell>
  );
}
