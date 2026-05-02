"use client";

import { useEffect, useMemo, useState } from "react";
import supabase from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import type { UserProfile } from "@/lib/auth";

type StatsRow = {
  user_id: string;
  zone_id: string | null;
  org_id: string | null;
  plant_id: string | null;
  xp: number | null;
  streak_days: number | null;
};

type LeaderRow = {
  user_id: string;
  full_name: string | null;
  zone_name: string | null;
  xp: number;
  streak_days: number;
  rank: number;
};

type LevelName = "Rookie" | "Trainee" | "Keeper" | "Champion" | "Sensei";

type TabKey = "plant" | "org";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      profile: UserProfile;
      plantRows: LeaderRow[];
      orgRows: LeaderRow[];
    };

function levelFromXp(xp: number): LevelName {
  if (xp >= 5000) return "Sensei";
  if (xp >= 2000) return "Champion";
  if (xp >= 800) return "Keeper";
  if (xp >= 300) return "Trainee";
  return "Rookie";
}

function xpToNextTier(xp: number): number {
  if (xp < 300) return 300 - xp;
  if (xp < 800) return 800 - xp;
  if (xp < 2000) return 2000 - xp;
  if (xp < 5000) return 5000 - xp;
  return 0;
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

async function enrichStatsRows(rows: StatsRow[]): Promise<LeaderRow[]> {
  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const zoneIds = [
    ...new Set(rows.map((r) => r.zone_id).filter(Boolean)),
  ] as string[];

  const [profilesRes, zonesRes] = await Promise.all([
    userIds.length
      ? supabase.from("user_profiles").select("id,full_name").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
    zoneIds.length
      ? supabase.from("zones").select("id,name").in("id", zoneIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const nameByUser = new Map(
    ((profilesRes.data ?? []) as { id: string; full_name: string | null }[]).map(
      (p) => [p.id, p.full_name],
    ),
  );
  const zoneById = new Map(
    ((zonesRes.data ?? []) as { id: string; name: string | null }[]).map((z) => [
      z.id,
      z.name,
    ]),
  );

  const sorted = [...rows].sort(
    (a, b) => Number(b.xp ?? 0) - Number(a.xp ?? 0),
  );

  return sorted.map((r, idx) => ({
    user_id: r.user_id,
    full_name: nameByUser.get(r.user_id) ?? null,
    zone_name: r.zone_id ? zoneById.get(r.zone_id) ?? null : null,
    xp: Number(r.xp ?? 0),
    streak_days: Number(r.streak_days ?? 0),
    rank: idx + 1,
  }));
}

export default function LeaderboardPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [tab, setTab] = useState<TabKey>("plant");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const profile = await getCurrentUser();
      if (cancelled) return;

      if (!profile) {
        setState({ status: "error", message: "Not signed in." });
        return;
      }

      if (!profile.plant_id || !profile.org_id) {
        setState({
          status: "error",
          message:
            "Your profile needs both organisation and plant assignment to view the leaderboard.",
        });
        return;
      }

      const plantId = profile.plant_id;
      const orgId = profile.org_id;

      const [plantStatsRes, orgStatsRes] = await Promise.all([
        supabase
          .from("zone_leader_stats")
          .select("user_id,zone_id,org_id,plant_id,xp,streak_days")
          .eq("plant_id", plantId)
          .order("xp", { ascending: false }),
        supabase
          .from("zone_leader_stats")
          .select("user_id,zone_id,org_id,plant_id,xp,streak_days")
          .eq("org_id", orgId)
          .order("xp", { ascending: false }),
      ]);

      if (cancelled) return;

      if (plantStatsRes.error) {
        setState({ status: "error", message: plantStatsRes.error.message });
        return;
      }
      if (orgStatsRes.error) {
        setState({ status: "error", message: orgStatsRes.error.message });
        return;
      }

      const plantRows = await enrichStatsRows(
        (plantStatsRes.data ?? []) as StatsRow[],
      );
      const orgRows = await enrichStatsRows(
        (orgStatsRes.data ?? []) as StatsRow[],
      );

      setState({
        status: "ready",
        profile,
        plantRows,
        orgRows,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const rows =
    state.status === "ready"
      ? tab === "plant"
        ? state.plantRows
        : state.orgRows
      : [];

  const meRow = useMemo(() => {
    if (state.status !== "ready") return null;
    const list = tab === "plant" ? state.plantRows : state.orgRows;
    return list.find((r) => r.user_id === state.profile.id) ?? null;
  }, [state, tab]);

  const shell =
    "min-h-full w-full bg-zinc-100 px-4 pb-28 pt-6 text-zinc-950 sm:px-6 sm:pb-32 sm:pt-8";

  if (state.status === "loading") {
    return (
      <div className={shell}>
        <div className="mx-auto w-full max-w-3xl space-y-4">
          <div className="h-8 w-48 animate-pulse rounded-lg bg-zinc-200" />
          <div className="h-24 animate-pulse rounded-2xl bg-zinc-200/90" />
          <div className="h-64 animate-pulse rounded-2xl bg-zinc-200/90" />
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className={shell}>
        <div className="mx-auto max-w-md rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm">
          <p className="font-semibold text-rose-800">{state.message}</p>
        </div>
      </div>
    );
  }

  const { profile } = state;

  const displayRank = meRow?.rank ?? null;
  const displayXp = meRow?.xp ?? 0;
  const nextTierXp = xpToNextTier(displayXp);

  return (
    <div className={shell}>
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          Leaderboard
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Zone leaders ranked by XP
        </p>

        <div className="mt-5 flex rounded-xl border border-zinc-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setTab("plant")}
            className={[
              "min-h-11 flex-1 rounded-lg text-sm font-semibold transition",
              tab === "plant"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-zinc-600 hover:bg-zinc-50",
            ].join(" ")}
          >
            Plant
          </button>
          <button
            type="button"
            onClick={() => setTab("org")}
            className={[
              "min-h-11 flex-1 rounded-lg text-sm font-semibold transition",
              tab === "org"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-zinc-600 hover:bg-zinc-50",
            ].join(" ")}
          >
            Organisation
          </button>
        </div>

        <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50/90 p-4 shadow-sm ring-1 ring-blue-100 sm:p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-blue-800">
            Your summary
          </div>
          <p className="mt-2 text-sm font-semibold text-zinc-900 sm:text-base">
            Your Rank:{" "}
            <span className="text-blue-700">
              {displayRank != null ? `#${displayRank}` : "—"}
            </span>{" "}
            <span className="font-normal text-zinc-400">|</span> XP:{" "}
            <span className="text-blue-700 tabular-nums">
              {displayXp.toLocaleString()}
            </span>{" "}
            <span className="font-normal text-zinc-400">|</span> Next tier in{" "}
            <span className="text-blue-700 tabular-nums">
              {nextTierXp.toLocaleString()}
            </span>{" "}
            XP
          </p>
          {meRow == null && (
            <p className="mt-2 text-xs text-zinc-600">
              You’re not listed as a zone leader in this view — only zone
              leaders earn leaderboard XP.
            </p>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-600 shadow-sm">
            No zone leaders in this {tab === "plant" ? "plant" : "organisation"}{" "}
            yet.
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <div className="divide-y divide-zinc-100">
              {rows.map((l) => {
                const level = levelFromXp(l.xp);
                const isMe = l.user_id === profile.id;
                return (
                  <div
                    key={`${tab}-${l.user_id}`}
                    className={[
                      "flex min-h-[72px] items-center gap-3 px-4 py-4 sm:px-6",
                      isMe ? "bg-sky-50" : "bg-white",
                    ].join(" ")}
                  >
                    <div className="w-14 shrink-0 text-center text-lg font-bold text-zinc-800">
                      {rankLabel(l.rank)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-base font-semibold text-zinc-900">
                          {l.full_name ?? "Zone leader"}
                        </span>
                        <span
                          className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${levelBadgeClass(level)}`}
                        >
                          {level}
                        </span>
                        {l.streak_days > 0 ? (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-800 ring-1 ring-orange-200">
                            🔥 {l.streak_days}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 truncate text-sm text-zinc-500">
                        {l.zone_name ?? "—"}
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <span className="text-lg font-bold tabular-nums text-blue-600">
                        {l.xp.toLocaleString()}
                      </span>
                      <span className="text-xs font-medium text-blue-500"> XP</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
