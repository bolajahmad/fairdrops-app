import { RoleGuard } from "@/components/layout/role-guard"
import RootProvider from "@/lib/context/web3-auth"

export default function GameLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <RootProvider>
      {/* <RoleGuard expected="player" /> */}
      <div>
        {children}
      </div>
    </RootProvider>
  )
}
