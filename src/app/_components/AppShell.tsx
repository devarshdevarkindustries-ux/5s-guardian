"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";
import supabase from "@/lib/supabase";

const NAV = [
  { href: "/dashboard", label: "Home", icon: "🏠" },
  { href: "/audit", label: "Audit", icon: "📋" },
  { href: "/ncr-board", label: "NCRs", icon: "⚠️" },
  { href: "/leaderboard", label: "Leaderboard", icon: "🏆" },
  { href: "/admin", label: "Admin", icon: "⚙️" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const showChrome = pathname !== "/login";

  const activeHref = useMemo(() => {
    if (!pathname) return "";
    const exact = NAV.find((n) => n.href === pathname)?.href;
    if (exact) return exact;
    const prefix = NAV.find((n) => pathname.startsWith(n.href + "/"))?.href;
    return prefix ?? "";
  }, [pathname]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (!showChrome) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-40 w-full border-b border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="text-sm font-semibold tracking-tight text-zinc-900">
            5S Guardian
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50 active:scale-[0.99]"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="pb-[80px]">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-50 w-full border-t border-zinc-200 bg-white">
        <div className="grid w-full grid-cols-5">
          {NAV.map((item) => {
            const active = activeHref === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "flex min-h-[60px] w-full flex-col items-center justify-center gap-1 px-2 py-2 text-xs font-semibold",
                  active ? "text-blue-600" : "text-zinc-600",
                ].join(" ")}
                aria-current={active ? "page" : undefined}
              >
                <div className="text-lg leading-none" aria-hidden>
                  {item.icon}
                </div>
                <div className="leading-none">{item.label}</div>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

