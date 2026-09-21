import "server-only";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { LogoutButton } from "@/components/home/logout-button";
import { Avatar } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { href } from "@/lib/routes";

export function SidebarAccountDock({
  user,
  canAccessAdmin,
}: {
  user: { name: string | null; image: string | null; loginIdentifier: string };
  canAccessAdmin: boolean;
}) {
  return (
    <div className="app-sidebar-bottom">
      <Link href="/profile" prefetch={false} className="user-pill">
        <Avatar name={user.name} identifier={user.loginIdentifier} image={user.image} size="small" />
        {user.name || user.loginIdentifier}
      </Link>
      <div className="app-sidebar-bottom-actions">
        {canAccessAdmin ? (
          <Link href={href("admin")} prefetch={false} className="icon-button" aria-label="관리자">
            <ShieldCheck size={17} aria-hidden />
          </Link>
        ) : null}
        <ThemeToggle />
        <LogoutButton />
      </div>
    </div>
  );
}
