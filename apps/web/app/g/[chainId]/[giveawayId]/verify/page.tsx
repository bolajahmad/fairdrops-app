"use client";

import { useParams } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { Shell } from "@/components/shell";
import { isGiveawayId } from "@/lib/ids";
import { VerifyScreen } from "@/components/play/results-screen";

export default function VerifyPage() {
  const params = useParams<{ chainId: string; giveawayId: string }>();
  const chainId = Number(params.chainId);
  if (!Number.isInteger(chainId) || !isGiveawayId(params.giveawayId)) {
    return (
      <Shell>
        <EmptyState icon="alert" title="This giveaway can't be shown">
          Check the link and try again.
        </EmptyState>
      </Shell>
    );
  }
  return (
    <VerifyScreen chainId={chainId} giveawayId={params.giveawayId.toLowerCase() as `0x${string}`} />
  );
}
