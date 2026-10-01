"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-auto rounded-t-[28px] bg-surface-raised p-6 shadow-[var(--lift)] sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px]">
          <span className="mx-auto mb-4 block h-1 w-10 rounded-full bg-line sm:hidden" />
          <Dialog.Title className="title-l m-0">{title}</Dialog.Title>
          <div className="mt-4 flex flex-col gap-3">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
