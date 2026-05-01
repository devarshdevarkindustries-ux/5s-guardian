"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import supabase from "@/lib/supabase";

type ZoneLeader = {
  id: string;
  name: string | null;
  xp: number | null;
  level: number | null;
  streak_days: number | null;
  zone_id: string | null;
  zones?: { name: string | null } | { name: string | null }[] | null;
};

type DashboardStats = {
  openNcrs: number | null;
  auditsThisWeek: number | null;
  leaderboardRank: number | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; leader: ZoneLeader; stats: DashboardStats };

type LevelInfo = {
  level: number;
  name: "Rookie" | "Trainee" | "Keeper" | "Champion" | "Sensei";
  minXp: number;
  maxXp: number | null;
};

const LEVELS: LevelInfo[] = [
  { level: 1, name: "Rookie", minXp: 0, maxXp: 299 },
  { level: 2, name: "Trainee", minXp: 300, maxXp: 799 },
  { level: 3, name: "Keeper", minXp: 800, maxXp: 1999 },
  { level: 4, name: "Champion", minXp: 2000, maxXp: 4999 },
  { level: 5, name: "Sensei", minXp: 5000, maxXp: null },
];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function startOfWeekLocal(d = new Date()) {
  const date = new Date(d);
  const day = date.getDay(); // 0..6 (Sun..Sat)
  const diff = (day + 6) % 7; // days since Monday
  date.setDate(date.getDate() - diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getZoneName(leader: ZoneLeader) {
  const zones = leader.zones;
  if (!zones) return null;
  if (Array.isArray(zones)) return zones[0]?.name ?? null;
  return zones.name ?? null;
}

function getLevelFromXp(xp: number): LevelInfo {
  const match = LEVELS.find(
    (l) => xp >= l.minXp && (l.maxXp === null || xp <= l.maxXp),
  );
  return match ?? LEVELS[0];
}

function getGreeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: leader, error: leaderError } = await supabase
        .from("zone_leaders")
        .select("id,name,xp,level,streak_days,zone_id,zones(name)")
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      if (leaderError) {
        setState({ status: "error", message: leaderError.message });
        return;
      }

      if (!leader) {
        setState({
          status: "error",
          message: "No zone leader found. Seed the database, then refresh.",
        });
        return;
      }

      const leaderId = leader.id as string;
      const zoneId = (leader as ZoneLeader).zone_id as string | null;

      const [openNcrsRes, auditsRes, leaderboardRes] = await Promise.all([
        supabase
          .from("ncrs")
          .select("id", { count: "exact", head: true })
          .eq("status", "open"),
        supabase
          .from("audit_sessions")
          .select("id", { count: "exact", head: true })
          .gte("created_at", startOfWeekLocal().toISOString()),
        supabase
          .from("zone_leaders")
          .select("id,xp")
          .order("xp", { ascending: false })
          .limit(500),
      ]);

      if (cancelled) return;

      if (openNcrsRes.error) {
        setState({ status: "error", message: openNcrsRes.error.message });
        return;
      }
      if (auditsRes.error) {
        setState({ status: "error", message: auditsRes.error.message });
        return;
      }
      if (leaderboardRes.error) {
        setState({ status: "error", message: leaderboardRes.error.message });
        return;
      }

      const openNcrs = openNcrsRes.count ?? 0;
      const auditsThisWeek = auditsRes.count ?? 0;

      const leaderboard = leaderboardRes.data ?? [];
      const rankIndex = leaderboard.findIndex((l) => l.id === leaderId);
      const leaderboardRank = rankIndex >= 0 ? rankIndex + 1 : null;

      setState({
        status: "ready",
        leader: leader as ZoneLeader,
        stats: {
          openNcrs,
          auditsThisWeek,
          leaderboardRank,
        },
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const computed = useMemo(() => {
    if (state.status !== "ready") return null;

    const xp = Number(state.leader.xp ?? 0);
    const levelInfo = getLevelFromXp(xp);
    const nextLevel = LEVELS.find((l) => l.level === levelInfo.level + 1) ?? null;

    const xpIntoLevel = xp - levelInfo.minXp;
    const levelSpan =
      levelInfo.maxXp === null ? 0 : levelInfo.maxXp - levelInfo.minXp + 1;

    const progress =
      levelInfo.maxXp === null ? 1 : clamp(xpIntoLevel / levelSpan, 0, 1);

    const xpToNext =
      nextLevel === null ? 0 : Math.max(0, nextLevel.minXp - xp);

    const score = clamp((xp / 5000) * 100, 0, 100);
    const scoreColor =
      score >= 80
        ? "text-emerald-600"
        : score >= 60
          ? "text-amber-500"
          : "text-rose-600";
    const scoreTrack =
      score >= 80
        ? "stroke-emerald-500"
        : score >= 60
          ? "stroke-amber-500"
          : "stroke-rose-500";

    return {
      xp,
      levelInfo,
      nextLevel,
      progress,
      xpToNext,
      score,
      scoreColor,
      scoreTrack,
    };
  }, [state]);

  const greeting = useMemo(() => getGreeting(), []);

  return (
    <div className="min-h-screen w-full bg-zinc-100 px-4 py-6 text-zinc-950 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-md sm:max-w-2xl">
        {state.status === "loading" ? (
          <div className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm sm:p-8">
            <div className="h-6 w-40 animate-pulse rounded bg-zinc-200" />
            <div className="mt-4 h-4 w-64 animate-pulse rounded bg-zinc-200" />
            <div className="mt-8 h-40 animate-pulse rounded-2xl bg-zinc-200" />
          </div>
        ) : state.status === "error" ? (
          <div className="rounded-2xl border border-rose-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="text-lg font-semibold text-rose-700">
              Couldn&apos;t load dashboard
            </div>
            <div className="mt-2 text-sm text-rose-700">{state.message}</div>
            <div className="mt-6 text-xs text-zinc-500">
              Tip: confirm your `.env.local` is in the `5s-guardian` folder and
              restart `npm run dev`.
            </div>
          </div>
        ) : (
          (() => {
            const leader = state.leader;
            const zoneName = getZoneName(leader) ?? "Unknown zone";
            const name = leader.name ?? "Leader";
            const streak = Number(leader.streak_days ?? 0);
            const c = computed!;

            const radius = 44;
            const circumference = 2 * Math.PI * radius;
            const dashOffset = circumference * (1 - c.score / 100);

            return (
              <div className="space-y-4 sm:space-y-6">
                <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <div className="text-sm font-medium text-zinc-500">
                        {greeting},
                      </div>
                      <div className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
                        {name}
                      </div>
                      <div className="mt-1 text-sm text-zinc-600">
                        Zone: <span className="font-medium">{zoneName}</span>
                      </div>
                    </div>
                    <div className="mt-2 inline-flex w-fit items-center gap-2 rounded-full bg-orange-50 px-3 py-1 text-sm font-semibold text-orange-700 sm:mt-0">
                      <span aria-hidden>🔥</span>
                      <span>{streak} day streak</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
                    <div className="text-sm font-semibold text-zinc-600">
                      Zone Health
                    </div>
                    <div className="mt-4 flex items-center gap-4">
                      <div className="relative h-28 w-28">
                        <svg
                          viewBox="0 0 120 120"
                          className="h-28 w-28 -rotate-90"
                        >
                          <circle
                            cx="60"
                            cy="60"
                            r={radius}
                            className="stroke-zinc-200"
                            strokeWidth="10"
                            fill="none"
                          />
                          <circle
                            cx="60"
                            cy="60"
                            r={radius}
                            className={c.scoreTrack}
                            strokeWidth="10"
                            fill="none"
                            strokeLinecap="round"
                            strokeDasharray={circumference}
                            strokeDashoffset={dashOffset}
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <div
                            className={`text-2xl font-semibold ${c.scoreColor}`}
                          >
                            {Math.round(c.score)}
                          </div>
                          <div className="text-xs font-medium text-zinc-500">
                            / 100
                          </div>
                        </div>
                      </div>

                      <div className="flex-1">
                        <div className="text-lg font-semibold">
                          {c.levelInfo.name}
                        </div>
                        <div className="mt-1 text-sm text-zinc-600">
                          Level {c.levelInfo.level} • {c.xp.toLocaleString()} XP
                        </div>
                        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-200">
                          <div
                            className="h-full rounded-full bg-zinc-900 transition-all"
                            style={{ width: `${Math.round(c.progress * 100)}%` }}
                          />
                        </div>
                        <div className="mt-2 text-xs text-zinc-600">
                          {c.nextLevel ? (
                            <>
                              {c.xpToNext.toLocaleString()} XP to{" "}
                              <span className="font-semibold">
                                {c.nextLevel.name}
                              </span>{" "}
                              (Level {c.nextLevel.level})
                            </>
                          ) : (
                            <>Max level reached</>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
                    <div className="text-sm font-semibold text-zinc-600">
                      XP Progress
                    </div>
                    <div className="mt-3 text-3xl font-semibold tracking-tight">
                      {c.xp.toLocaleString()}
                      <span className="ml-2 text-base font-semibold text-zinc-500">
                        XP
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-zinc-600">
                      Current level:{" "}
                      <span className="font-semibold">{c.levelInfo.name}</span>{" "}
                      (Level {c.levelInfo.level})
                    </div>
                    <div className="mt-4 rounded-xl bg-zinc-50 p-4">
                      <div className="text-sm font-semibold text-zinc-700">
                        Next milestone
                      </div>
                      <div className="mt-1 text-sm text-zinc-600">
                        {c.nextLevel ? (
                          <>
                            Reach{" "}
                            <span className="font-semibold">
                              {c.nextLevel.minXp.toLocaleString()} XP
                            </span>{" "}
                            to become a{" "}
                            <span className="font-semibold">
                              {c.nextLevel.name}
                            </span>
                            .
                          </>
                        ) : (
                          <>You&apos;re already a Sensei.</>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
                    <div className="text-sm font-semibold text-zinc-600">
                      Open NCRs
                    </div>
                    <div className="mt-2 text-3xl font-semibold tracking-tight">
                      {state.stats.openNcrs ?? "—"}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      Status = open
                    </div>
                  </div>

                  <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
                    <div className="text-sm font-semibold text-zinc-600">
                      Audits This Week
                    </div>
                    <div className="mt-2 text-3xl font-semibold tracking-tight">
                      {state.stats.auditsThisWeek ?? "—"}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      Since Monday
                    </div>
                  </div>

                  <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
                    <div className="text-sm font-semibold text-zinc-600">
                      Leaderboard Rank
                    </div>
                    <div className="mt-2 text-3xl font-semibold tracking-tight">
                      {state.stats.leaderboardRank
                        ? `#${state.stats.leaderboardRank}`
                        : "—"}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">By XP</div>
                  </div>
                </div>

                <Link
                  href="/audit"
                  className="block w-full rounded-2xl bg-blue-600 px-6 py-5 text-center text-lg font-semibold text-white shadow-[0_0_0_1px_rgba(59,130,246,.2),0_10px_30px_rgba(59,130,246,.35)] transition hover:bg-blue-500 active:scale-[0.99]"
                >
                  Start Today&apos;s Audit
                </Link>
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}

