import { AppLayout } from "@/components/layout/root-layout"

export default function GameLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <AppLayout>
      <div>
        {children}
      </div>
    </AppLayout>
  )
}
