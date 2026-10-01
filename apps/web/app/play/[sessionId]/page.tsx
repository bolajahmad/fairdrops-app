"use client";

import { useParams } from "next/navigation";
import { LivePlay } from "@/components/play/live-play";

export default function PlayPage() {
  const params = useParams<{ sessionId: string }>();
  return <LivePlay sessionId={params.sessionId} />;
}
