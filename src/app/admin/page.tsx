"use client";

import { useEffect, useMemo, useState } from "react";
import supabase from "@/lib/supabase";

type ZoneRow = {
  id: string;
  name: string | null;
};

type LeaderRow = {
  id: string;
  name: string | null;
  xp: number | null;
  level: number | null;
  streak_days: number | null;
  zone_id: string | null;
  zones?: { name: string | null } | { name: string | null }[] | null;
};

type AuditSessionRow = {
  zone_id: string | null;
  score: number | null;
  created_at: string | null;
  completed_at: string | null;
};

type NcrOpenRow = {
  id: string;
  title: string | null;
  severity: string | null;
  s_pillar: string | null;
  status: string | null;
  created_at: string | null;
  zone_id: string | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      zones: ZoneRow[];
      leaders: LeaderRow[];
      weeklySessions: AuditSessionRow[];
      recentSessions: AuditSessionRow[];
      openNcrs: NcrOpenRow[];
    };

type LevelName = "Rookie" | "Trainee" | "Keeper" | "Champion" | "Sensei";

function startOfWeekLocal(d = new Date()) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day + 6) % 7;
  date.setDate(date.getDate() - diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getZoneNameFromRelation(
  rel: { name: string | null } | { name: string | null }[] | null | undefined,
) {
  if (!rel) return null;
  if (Array.isArray(rel)) return rel[0]?.name ?? null;
  return rel.name ?? null;
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

function scoreStyle(score: number | null) {
  if (score == null || Number.isNaN(score)) {
    return {
      text: "text-zinc-400",
      border: "border-zinc-200",
      label: "—",
    };
  }
  const s = Number(score);
  if (s >= 80)
    return { text: "text-emerald-600", border: "border-emerald-300", label: `${Math.round(s)}` };
  if (s >= 60)
    return { text: "text-amber-600", border: "border-amber-300", label: `${Math.round(s)}` };
  return { text: "text-rose-600", border: "border-rose-300", label: `${Math.round(s)}` };
}

function formatAuditDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function sessionSortTime(s: AuditSessionRow) {
  const c = s.completed_at ? new Date(s.completed_at).getTime() : NaN;
  const cr = s.created_at ? new Date(s.created_at).getTime() : NaN;
  return Math.max(Number.isFinite(c) ? c : 0, Number.isFinite(cr) ? cr : 0);
}

function daysOpen(iso: string | null) {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  return Math.max(0, Math.floor((Date.now() - then) / (86_400_000)));
}

function severityRank(sev: string | null) {
  const s = (sev ?? "").toLowerCase();
  if (s === "critical") return 0;
  if (s === "major") return 1;
  if (s === "minor") return 2;
  return 3;
}

function severityBadgeClass(sev: string | null) {
  const s = (sev ?? "").toLowerCase();
  if (s === "critical") return "bg-rose-100 text-rose-800 ring-rose-200";
  if (s === "major") return "bg-amber-100 text-amber-800 ring-amber-200";
  return "bg-emerald-100 text-emerald-800 ring-emerald-200";
}

function pillarTagClass(pillar: string | null) {
  const p = (pillar ?? "").toLowerCase();
  if (p === "sort") return "bg-blue-50 text-blue-700 ring-blue-200";
  if (p === "set") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (p === "shine") return "bg-yellow-50 text-yellow-800 ring-yellow-200";
  if (p === "standardise" || p === "standardize")
    return "bg-purple-50 text-purple-700 ring-purple-200";
  if (p === "sustain") return "bg-orange-50 text-orange-700 ring-orange-200";
  if (p === "safety") return "bg-rose-50 text-rose-700 ring-rose-200";
  return "bg-zinc-100 text-zinc-700 ring-zinc-200";
}

function SurpriseAuditModal({
  open,
  zones,
  onClose,
  onTriggered,
}: {
  open: boolean;
  zones: ZoneRow[];
  onClose: () => void;
  onTriggered: (zoneName: string) => void;
}) {
  const [zoneId, setZoneId] = useState<string>("");

  useEffect(() => {
    if (open && zones.length > 0 && !zoneId) {
      setZoneId(zones[0]!.id);
    }
  }, [open, zones, zoneId]);

  if (!open) return null;

  const selected = zones.find((z) => z.id === zoneId);
  const zoneName = selected?.name ?? "Zone";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="surprise-audit-title"
      onMouseDown={(e) => {
        if (e.currentTarget === e.target) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl">
        <h2 id="surprise-audit-title" className="text-lg font-semibold text-zinc-900">
          Trigger surprise audit
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          Select a zone. Notifications will be wired up later—this only confirms
          your selection.
        </p>

        <label className="mt-4 block">
          <span className="text-sm font-semibold text-zinc-700">Zone</span>
          <select
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value)}
            className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm font-medium text-zinc-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name ?? "Unnamed zone"}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onTriggered(zoneName);
              onClose();
            }}
            className="inline-flex min-h-12 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-500"
          >
            Trigger audit
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [surpriseOpen, setSurpriseOpen] = useState(false);
  const [surpriseMessage, setSurpriseMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const weekStart = startOfWeekLocal().toISOString();

      const [
        zonesRes,
        leadersRes,
        weeklyRes,
        recentRes,
        ncrsRes,
      ] = await Promise.all([
        supabase.from("zones").select("id,name").order("name", { ascending: true }),
        supabase
          .from("zone_leaders")
          .select("id,name,xp,level,streak_days,zone_id,zones(name)")
          .order("name", { ascending: true }),
        supabase
          .from("audit_sessions")
          .select("zone_id,score,created_at,completed_at")
          .gte("created_at", weekStart),
        supabase
          .from("audit_sessions")
          .select("zone_id,score,created_at,completed_at")
          .order("completed_at", { ascending: false, nullsFirst: false })
          .limit(800),
        supabase
          .from("ncrs")
          .select("id,title,severity,s_pillar,status,created_at,zone_id")
          .eq("status", "open")
          .order("created_at", { ascending: false }),
      ]);

      if (cancelled) return;

      const firstErr =
        zonesRes.error ??
        leadersRes.error ??
        weeklyRes.error ??
        recentRes.error ??
        ncrsRes.error;
      if (firstErr) {
        setState({ status: "error", message: firstErr.message });
        return;
      }

      setState({
        status: "ready",
        zones: (zonesRes.data ?? []) as ZoneRow[],
        leaders: (leadersRes.data ?? []) as LeaderRow[],
        weeklySessions: (weeklyRes.data ?? []) as AuditSessionRow[],
        recentSessions: (recentRes.data ?? []) as AuditSessionRow[],
        openNcrs: (ncrsRes.data ?? []) as NcrOpenRow[],
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const derived = useMemo(() => {
    if (state.status !== "ready") return null;

    const { zones, leaders, weeklySessions, recentSessions, openNcrs } = state;

    const auditsThisWeek = weeklySessions.length;
    const openNcrCount = openNcrs.length;

    const avgWeekScore =
      auditsThisWeek === 0
        ? null
        : weeklySessions.reduce((acc, s) => acc + Number(s.score ?? 0), 0) /
          auditsThisWeek;

    const latestByZone = new Map<
      string,
      { score: number; at: string | null }
    >();
    const sortedRecent = [...recentSessions].sort(
      (a, b) => sessionSortTime(b) - sessionSortTime(a),
    );
    for (const s of sortedRecent) {
      const zid = s.zone_id;
      if (!zid) continue;
      if (latestByZone.has(zid)) continue;
      latestByZone.set(zid, {
        score: Number(s.score ?? 0),
        at: s.completed_at ?? s.created_at,
      });
    }

    const leadersByZone = new Map<string, LeaderRow>();
    for (const L of leaders) {
      if (L.zone_id && !leadersByZone.has(L.zone_id)) leadersByZone.set(L.zone_id, L);
    }

    const zoneNameById = new Map(zones.map((z) => [z.id, z.name ?? "—"]));

    const sortedNcrs = [...openNcrs].sort((a, b) => {
      const sev = severityRank(a.severity) - severityRank(b.severity);
      if (sev !== 0) return sev;
      return daysOpen(b.created_at) - daysOpen(a.created_at);
    });

    const topLeaders = [...leaders]
      .sort((a, b) => Number(b.xp ?? 0) - Number(a.xp ?? 0))
      .slice(0, 5);

    return {
      auditsThisWeek,
      openNcrCount,
      avgWeekScore,
      latestByZone,
      leadersByZone,
      sortedNcrs,
      topLeaders,
      zoneCount: zones.length,
      zoneNameById,
    };
  }, [state]);

  const pageShell =
    "min-h-screen w-full bg-gradient-to-b from-zinc-100 to-zinc-200/80 px-4 py-6 text-zinc-950 sm:px-6 sm:py-10";

  if (state.status === "loading") {
    return (
      <div className={pageShell}>
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="h-10 w-64 animate-pulse rounded-lg bg-zinc-300/80" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-2xl bg-white/80 shadow-sm"
              />
            ))}
          </div>
          <div className="h-64 animate-pulse rounded-2xl bg-white/60" />
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className={pageShell}>
        <div className="mx-auto max-w-2xl rounded-2xl border border-rose-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-rose-800">
            Admin dashboard unavailable
          </h1>
          <p className="mt-2 text-sm text-rose-700">{state.message}</p>
        </div>
      </div>
    );
  }

  const d = derived!;
  const avgStyle = scoreStyle(d.avgWeekScore);

  return (
    <div className={pageShell}>
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="flex flex-col gap-4 border-b border-zinc-200/80 pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
              Plant operations
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
              5S Guardian — Admin
            </h1>
            <p className="mt-1 max-w-xl text-sm text-zinc-600">
              Zone health, audits, and corrective actions at a glance.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <button
              type="button"
              disabled={state.zones.length === 0}
              onClick={() => setSurpriseOpen(true)}
              title={
                state.zones.length === 0
                  ? "Add zones in the database first"
                  : undefined
              }
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-5 text-sm font-semibold text-white shadow-lg shadow-zinc-900/20 transition hover:bg-zinc-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-zinc-900"
            >
              <span aria-hidden>⚡</span>
              Trigger surprise audit
            </button>
          </div>
        </header>

        {surpriseMessage && (
          <div
            className="flex items-start justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-sm"
            role="status"
          >
            <span className="font-medium">{surpriseMessage}</span>
            <button
              type="button"
              onClick={() => setSurpriseMessage(null)}
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 1. Header summary */}
        <section aria-label="Summary statistics">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-white/80 bg-white p-5 shadow-sm ring-1 ring-black/5">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Total zones
              </div>
              <div className="mt-2 text-3xl font-bold tabular-nums text-zinc-900">
                {d.zoneCount}
              </div>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white p-5 shadow-sm ring-1 ring-black/5">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Audits this week
              </div>
              <div className="mt-2 text-3xl font-bold tabular-nums text-blue-700">
                {d.auditsThisWeek}
              </div>
              <div className="mt-1 text-xs text-zinc-500">Since Monday (local)</div>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white p-5 shadow-sm ring-1 ring-black/5">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Open NCRs
              </div>
              <div className="mt-2 text-3xl font-bold tabular-nums text-amber-700">
                {d.openNcrCount}
              </div>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white p-5 shadow-sm ring-1 ring-black/5">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Avg zone score (week)
              </div>
              <div
                className={`mt-2 text-3xl font-bold tabular-nums ${avgStyle.text}`}
              >
                {d.avgWeekScore == null ? "—" : `${Math.round(d.avgWeekScore)}`}
                {d.avgWeekScore != null && (
                  <span className="text-lg font-semibold text-zinc-400">/100</span>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* 2. Zone health grid */}
        <section aria-label="Zone health">
          <div className="mb-4 flex items-end justify-between gap-2">
            <h2 className="text-lg font-semibold text-zinc-900">Zone health</h2>
            <span className="text-xs text-zinc-500">Latest audit per zone</span>
          </div>
          {state.zones.length === 0 ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-600">
              No zones configured.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {state.zones.map((zone) => {
                const leader = d.leadersByZone.get(zone.id) ?? null;
                const latest = d.latestByZone.get(zone.id) ?? null;
                const scoreVal = latest ? latest.score : null;
                const st = scoreStyle(scoreVal);
                const xp = Number(leader?.xp ?? 0);
                const lvl = levelFromXp(xp);
                const streak = Number(leader?.streak_days ?? 0);

                return (
                  <div
                    key={zone.id}
                    className={[
                      "rounded-2xl border-2 bg-white p-5 shadow-sm transition",
                      st.border,
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-base font-bold text-zinc-900">
                          {zone.name ?? "Unnamed zone"}
                        </div>
                        <div className="mt-0.5 text-sm text-zinc-600">
                          Leader:{" "}
                          <span className="font-medium text-zinc-800">
                            {leader?.name ?? "Unassigned"}
                          </span>
                        </div>
                      </div>
                      <div
                        className={`text-2xl font-bold tabular-nums ${st.text}`}
                      >
                        {st.label}
                        {scoreVal != null && (
                          <span className="text-sm font-semibold text-zinc-400">
                            /100
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {streak > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-800 ring-1 ring-orange-200">
                          <span aria-hidden>🔥</span>
                          {streak} day streak
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${levelBadgeClass(
                          lvl,
                        )}`}
                      >
                        L{leader?.level ?? "—"} · {lvl}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200">
                        {xp.toLocaleString()} XP
                      </span>
                    </div>

                    <div className="mt-4 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
                      Last audit:{" "}
                      <span className="font-medium text-zinc-700">
                        {formatAuditDate(latest?.at ?? null)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 gap-8 xl:grid-cols-5">
          {/* 3. Open NCRs table */}
          <section className="xl:col-span-3" aria-label="Open NCRs">
            <h2 className="mb-4 text-lg font-semibold text-zinc-900">
              Open NCRs
            </h2>
            <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-4 py-3">Title</th>
                      <th className="px-4 py-3">Zone</th>
                      <th className="px-4 py-3">Severity</th>
                      <th className="px-4 py-3">S-pillar</th>
                      <th className="px-4 py-3">Days open</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {d.sortedNcrs.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-8 text-center text-zinc-500"
                        >
                          No open NCRs.
                        </td>
                      </tr>
                    ) : (
                      d.sortedNcrs.map((n) => {
                        const zname =
                          (n.zone_id && d.zoneNameById.get(n.zone_id)) ?? "—";
                        const days = daysOpen(n.created_at);
                        return (
                          <tr key={n.id} className="bg-white hover:bg-zinc-50/80">
                            <td className="max-w-[200px] px-4 py-3 font-medium text-zinc-900">
                              <span className="line-clamp-2">
                                {n.title ?? "Untitled"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-zinc-700">{zname}</td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${severityBadgeClass(
                                  n.severity,
                                )}`}
                              >
                                {n.severity ?? "—"}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${pillarTagClass(
                                  n.s_pillar,
                                )}`}
                              >
                                {n.s_pillar ?? "—"}
                              </span>
                            </td>
                            <td className="px-4 py-3 tabular-nums text-zinc-700">
                              {days}
                            </td>
                            <td className="px-4 py-3 capitalize text-zinc-700">
                              {n.status ?? "—"}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* 4. Leaderboard snapshot */}
          <section className="xl:col-span-2" aria-label="Leaderboard snapshot">
            <h2 className="mb-4 text-lg font-semibold text-zinc-900">
              Leaderboard snapshot
            </h2>
            <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
              <ul className="divide-y divide-zinc-100">
                {d.topLeaders.length === 0 ? (
                  <li className="px-4 py-8 text-center text-sm text-zinc-500">
                    No leaders yet.
                  </li>
                ) : (
                  d.topLeaders.map((L, idx) => {
                    const rank = idx + 1;
                    const xp = Number(L.xp ?? 0);
                    const lvl = levelFromXp(xp);
                    const streak = Number(L.streak_days ?? 0);
                    const zname =
                      getZoneNameFromRelation(L.zones) ?? "Unknown zone";
                    return (
                      <li
                        key={L.id}
                        className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-sm font-bold text-white">
                            {rank}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-zinc-900">
                              {L.name ?? "Leader"}
                            </div>
                            <div className="truncate text-xs text-zinc-500">
                              {zname}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                          <span className="text-sm font-bold tabular-nums text-blue-700">
                            {xp.toLocaleString()} XP
                          </span>
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${levelBadgeClass(
                              lvl,
                            )}`}
                          >
                            {lvl}
                          </span>
                          {streak > 0 && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-800 ring-1 ring-orange-200">
                              🔥 {streak}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          </section>
        </div>
      </div>

      <SurpriseAuditModal
        open={surpriseOpen}
        zones={state.zones}
        onClose={() => setSurpriseOpen(false)}
        onTriggered={(zoneName) => {
          setSurpriseMessage(`Surprise audit triggered for ${zoneName}!`);
        }}
      />
    </div>
  );
}
