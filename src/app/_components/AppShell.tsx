"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { getCurrentUser } from "@/lib/auth";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  match: "path" | "pathOrHash";
};

function itemIsActive(
  item: NavItem,
  pathname: string,
  hash: string,
  siblings: NavItem[],
): boolean {
  if (item.match === "pathOrHash") {
    const [path, frag] = item.href.split("#");
    return pathname === path && Boolean(frag) && hash === frag;
  }
  const base = item.href.split("#")[0];
  if (pathname !== base && !pathname.startsWith(base + "/")) return false;
  if (base === "/admin") {
    const hashTab = siblings.find((x) => x.match === "pathOrHash");
    if (hashTab) {
      const frag = hashTab.href.split("#")[1];
      if (frag && hash === frag) return false;
    }
  }
  return true;
}

function navForRole(role: string | null): NavItem[] | "none" | null {
  if (role == null) return null;
  const r = String(role).toLowerCase();
  if (r === "super_admin") return "none";
  if (r === "auditor")
    return [
      { href: "/audit", label: "Audit", icon: "📋", match: "path" },
      { href: "/ncr-board", label: "NCRs", icon: "⚠️", match: "path" },
      { href: "/leaderboard", label: "Leaderboard", icon: "🏆", match: "path" },
    ];
  if (r === "admin")
    return [
      { href: "/admin", label: "Home", icon: "🏠", match: "path" },
      { href: "/ncr-board", label: "NCRs", icon: "⚠️", match: "path" },
      { href: "/leaderboard", label: "Leaderboard", icon: "🏆", match: "path" },
      {
        href: "/admin#admin-zones",
        label: "Admin",
        icon: "⚙️",
        match: "pathOrHash",
      },
    ];
  return [
    { href: "/dashboard", label: "Home", icon: "🏠", match: "path" },
    { href: "/audit", label: "Audit", icon: "📋", match: "path" },
    { href: "/ncr-board", label: "NCRs", icon: "⚠️", match: "path" },
    { href: "/leaderboard", label: "Leaderboard", icon: "🏆", match: "path" },
  ];
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [hash, setHash] = useState("");
  const [navRole, setNavRole] = useState<string | null>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const showChrome = pathname !== "/login" && pathname !== "/onboarding";

  useEffect(() => {
    const sync = () => setHash(window.location.hash.replace(/^#/, ""));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    if (!showChrome) return;
    let cancelled = false;
    (async () => {
      const u = await getCurrentUser();
      if (!cancelled) setNavRole(u?.role ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, showChrome]);

  const navConfig = useMemo(() => navForRole(navRole), [navRole]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (!showChrome) {
    return <>{children}</>;
  }

  const isSuperAdmin = navRole && String(navRole).toLowerCase() === "super_admin";
  const showBottomNav = navConfig !== "none" && Array.isArray(navConfig);
  const navLoading = navConfig == null;
  const gridCols =
    showBottomNav && navConfig
      ? navConfig.length === 3
        ? "grid-cols-3"
        : navConfig.length === 4
          ? "grid-cols-4"
          : "grid-cols-5"
      : "grid-cols-1";

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-40 w-full border-b border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-900">
            <span>5S Guardian</span>
            {isSuperAdmin ? (
              <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-indigo-800">
                Super admin
              </span>
            ) : null}
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

      <main
        className={
          showBottomNav || navLoading ? "pb-[80px]" : "pb-6"
        }
      >
        {children}
      </main>

      {navLoading ? (
        <nav
          className="fixed inset-x-0 bottom-0 z-50 w-full border-t border-zinc-200 bg-zinc-50"
          aria-hidden
        >
          <div className="h-[60px] w-full animate-pulse bg-zinc-100" />
        </nav>
      ) : showBottomNav && navConfig ? (
        <nav className="fixed inset-x-0 bottom-0 z-50 w-full border-t border-zinc-200 bg-white">
          <div className={`grid w-full ${gridCols}`}>
            {navConfig.map((item) => {
              const active = itemIsActive(
                item,
                pathname ?? "",
                hash,
                navConfig,
              );
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
      ) : null}
    </div>
  );
}
