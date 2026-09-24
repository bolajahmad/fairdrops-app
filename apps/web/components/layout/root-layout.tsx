import { ReactNode } from "react"
import { Navbar } from "./navbar"

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background font-sans text-foreground selection:bg-primary selection:text-primary-foreground">
      <Navbar />

      <div className="mx-auto max-w-7xl px-4 pt-6 pb-24 md:pt-24 md:pb-12">
        {children}
      </div>
    </div>
  )
}
