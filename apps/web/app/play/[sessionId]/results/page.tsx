"use client";

import { useParams } from "next/navigation";
import { ResultsScreen } from "@/components/play/results-screen";

export default function PlayResultsPage() {
  const params = useParams<{ sessionId: string }>();
  return <ResultsScreen sessionId={params.sessionId} />;
}
