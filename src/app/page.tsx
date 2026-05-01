import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 font-sans text-zinc-950 dark:bg-black dark:text-zinc-50">
      <main className="w-full max-w-4xl rounded-2xl border border-black/5 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-zinc-950 sm:p-12">
        <div className="flex flex-col gap-4">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            5S Guardian
          </h1>
          <p className="max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-300">
            Gamified 5S manufacturing audits for factory zone leaders. Start from
            the dashboard, run an audit, manage zones, log NCRs, and climb the
            leaderboard.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { href: "/dashboard", title: "Dashboard", desc: "Today’s focus, streaks, quick actions." },
            { href: "/audit", title: "Audit", desc: "Run a 5S audit and capture evidence." },
            { href: "/zones", title: "Zones", desc: "Manage zones, owners, and schedules." },
            { href: "/ncr-board", title: "NCR Board", desc: "Track nonconformances and actions." },
            { href: "/leaderboard", title: "Leaderboard", desc: "Gamified rankings across zones." },
            { href: "/admin", title: "Admin", desc: "Configure rubrics, users, and settings." },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group rounded-xl border border-black/5 bg-zinc-50 p-5 transition hover:bg-white hover:shadow-sm dark:border-white/10 dark:bg-zinc-900/40 dark:hover:bg-zinc-900"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold">{item.title}</div>
                  <div className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                    {item.desc}
                  </div>
                </div>
                <div className="text-zinc-400 transition group-hover:translate-x-0.5 dark:text-zinc-500">
                  →
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
