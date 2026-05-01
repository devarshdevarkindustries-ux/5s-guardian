"use client";

import { useEffect, useMemo, useState } from "react";
import supabase from "@/lib/supabase";

type LeaderRow = {
  id: string;
  name: string | null;
  xp: number | null;
  streak_days: number | null;
  zone_id: string | null;
  zones?: { name: string | null } | { name: string | null }[] | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; leaders: LeaderRow[] };

type LevelName = "Rookie" | "Trainee" | "Keeper" | "Champion" | "Sensei";

function getZoneName(leader: LeaderRow) {
  const z = leader.zones;
  if (!z) return null;
  if (Array.isArray(z)) return z[0]?.name ?? null;
  return z.name ?? null;
}

function levelFromXp(xp: number): LevelName {
  if (xp >= 5000) return "Sensei";
  if (xp >= 2000) return "Champion";
  if (xp >= 800) return "Keeper";
  if (xp >= 300) return "Trainee";
  return "Rookie";
}

function levelBadgeClass(level: LevelName) {
  switch (level) {
    case "Sensei":
      return "bg-indigo-50 text-indigo-700 ring-indigo-200";
    case "Champion":
      return "bg-purple-50 text-purple-700 ring-purple-200";
    case "Keeper":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "Trainee":
      return "bg-blue-50 text-blue-700 ring-blue-200";
    case "Rookie":
    default:
      return "bg-zinc-100 text-zinc-700 ring-zinc-200";
  }
}

function rankLabel(rank: number) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

export default function LeaderboardPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("zone_leaders")
        .select("id,name,xp,streak_days,zone_id,zones(name)")
        .order("xp", { ascending: false });

      if (cancelled) return;

      if (error) {
        setState({ status: "error", message: error.message });
        return;
      }

      setState({ status: "ready", leaders: (data ?? []) as LeaderRow[] });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => {
    if (state.status !== "ready" || state.leaders.length === 0) return null;

    // Placeholder "current user" = first leader for now
    const current = state.leaders[0];
    const currentXp = Number(current.xp ?? 0);
    const yourRank = 1;

    const next = state.leaders[1] ?? null;
    const nextXp = next ? Number(next.xp ?? 0) : null;
    const xpToPass = nextXp == null ? 0 : Math.max(0, nextXp - currentXp + 1);

    return { yourRank, currentXp, xpToPass };
  }, [state]);

  return (
    <div className="min-h-screen bg-zinc-100 px-4 py-6 text-zinc-950 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-3xl">
        <div className="text-2xl font-semibold tracking-tight">Leaderboard</div>
        <div className="mt-1 text-sm text-zinc-600">
          Ranked by XP (zone leader performance).
        </div>

        {state.status === "loading" ? (
          <div className="mt-6 rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
            <div className="h-5 w-44 animate-pulse rounded bg-zinc-200" />
            <div className="mt-4 h-20 animate-pulse rounded-2xl bg-zinc-200" />
          </div>
        ) : state.status === "error" ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
            <div className="text-lg font-semibold text-rose-700">Error</div>
            <div className="mt-2 text-sm text-rose-700">{state.message}</div>
          </div>
        ) : state.leaders.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
            <div className="text-sm text-zinc-600">No leaders yet.</div>
          </div>
        ) : (
          <>
            {summary && (
              <div className="mt-6 rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
                <div className="text-sm font-semibold text-zinc-600">
                  Your summary
                </div>
                <div className="mt-2 text-base font-semibold text-zinc-900">
                  Your Rank: <span className="text-blue-700">#{summary.yourRank}</span>{" "}
                  <span className="text-zinc-300">|</span> XP:{" "}
                  <span className="text-blue-700">{summary.currentXp.toLocaleString()}</span>{" "}
                  <span className="text-zinc-300">|</span> Next rank in{" "}
                  <span className="text-blue-700">{summary.xpToPass.toLocaleString()}</span> XP
                </div>
              </div>
            )}

            <div className="mt-4 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
              <div className="divide-y divide-zinc-100">
                {state.leaders.map((l, idx) => {
                  const rank = idx + 1;
                  const xp = Number(l.xp ?? 0);
                  const streak = Number(l.streak_days ?? 0);
                  const level = levelFromXp(xp);
                  const zoneName = getZoneName(l) ?? "Unknown zone";
                  const isCurrent = idx === 0;

                  return (
                    <div
                      key={l.id}
                      className={[
                        "flex min-h-12 items-center gap-3 px-4 py-4 sm:px-6",
                        isCurrent ? "bg-blue-50" : "bg-white",
                      ].join(" ")}
                    >
                      <div className="w-12 shrink-0 text-center text-lg font-semibold text-zinc-800">
                        {rankLabel(rank)}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-base font-semibold text-zinc-900">
                            {l.name ?? "Leader"}
                          </div>
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${levelBadgeClass(
                              level,
                            )}`}
                          >
                            {level}
                          </span>
                          {streak > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-700 ring-1 ring-orange-200">
                              <span aria-hidden>🔥</span>
                              {streak}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-sm text-zinc-500">
                          {zoneName}
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <div className="text-base font-semibold text-blue-700">
                          {xp.toLocaleString()} XP
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

