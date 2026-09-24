import { AppLayout } from "@/components/layout/root-layout"
import { RoleGuard } from "@/components/layout/role-guard"
import HostWeb3Provider from "@/lib/context/host-web3-context"

export default function HostLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <HostWeb3Provider>
      <RoleGuard expected="host" />
      <AppLayout>{children}</AppLayout>
    </HostWeb3Provider>
  )
}
