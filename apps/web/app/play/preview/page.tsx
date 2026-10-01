"use client";

import { Suspense } from "react";
import { PreviewPlay } from "@/components/play/preview-play";

export default function PreviewPage() {
  return (
    <Suspense fallback={<p className="p-6">Opening the preview…</p>}>
      <PreviewPlay />
    </Suspense>
  );
}
