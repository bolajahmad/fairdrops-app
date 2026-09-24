import Link from "next/link"
import {
  AuthenticateUser,
  DisplayNavbarNavigationMenu,
  NavbarRoleSelector,
} from "./user-role-selector"

export const Navbar = () => (
  <nav className="fixed right-0 bottom-0 left-0 z-50 border-t border-border bg-background/80 backdrop-blur-lg md:top-0 md:bottom-auto md:border-t-0 md:border-b">
    <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
      <div className="flex items-center gap-4">
        <Link href="/">
          <div
            className="flex cursor-pointer items-center gap-2 text-xl font-bold tracking-tighter"
          >
            <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <span className="-mt-0.5 text-lg leading-none">Ṣ</span>
              <div className="absolute bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary-foreground" />
            </div>
            <span className="hidden sm:inline">
              WONDER<span className="text-primary">Ṣ</span>
            </span>
          </div>
        </Link>

        <div>
          <NavbarRoleSelector />
        </div>
      </div>

      <div>
        <DisplayNavbarNavigationMenu />
      </div>

      <div className="hidden items-center gap-4 md:flex">
        <AuthenticateUser />
      </div>
    </div>
  </nav>
)
