"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ShareScreen } from "@/components/share-screen";

function Share() {
  const params = useParams<{ chainId: string; giveawayId: string }>();
  const search = useSearchParams();
  return (
    <ShareScreen
      chainId={params.chainId}
      giveawayId={params.giveawayId}
      title={search.get("title") ?? "Your giveaway"}
    />
  );
}

export default function SharePage() {
  return (
    <Suspense fallback={<p className="p-6">Loading…</p>}>
      <Share />
    </Suspense>
  );
}
