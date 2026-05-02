"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import supabase from "@/lib/supabase";
import { getCurrentUser, getRoleHomeRoute } from "@/lib/auth";

type ZoneRow = {
  id: string;
  name: string | null;
  department: string | null;
  audit_frequency: string | null;
  plant_id: string | null;
};

type StatsRow = {
  xp: number | null;
  level: number | null;
  streak_days: number | null;
  plant_id: string | null;
};

type LatestAudit = {
  score: number | null;
  created_at: string | null;
  completed_at: string | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "no_zone"; displayName: string | null }
  | {
      status: "ready";
      displayName: string | null;
      zone: ZoneRow;
      stats: StatsRow;
      latestAudit: LatestAudit | null;
      openNcrs: number;
      auditsThisWeek: number;
      plantRank: number;
    };

function startOfWeekLocal(d = new Date()) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day + 6) % 7;
  date.setDate(date.getDate() - diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function addDays(d: Date, days: number) {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

function nextDueFromFrequency(lastIso: string | null, freq: string | null) {
  const base = lastIso ? new Date(lastIso) : new Date();
  const f = (freq ?? "daily").toLowerCase();
  const days =
    f === "weekly" ? 7 : f === "fortnightly" ? 14 : f === "monthly" ? 30 : 1;
  return addDays(base, days).toISOString();
}

function getGreeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function getLevelName(xp: number): string {
  if (xp < 300) return "Rookie";
  if (xp < 800) return "Trainee";
  if (xp < 2000) return "Keeper";
  if (xp < 5000) return "Champion";
  return "Sensei";
}

function getTierProgress(xp: number) {
  if (xp < 300) {
    return { name: "Rookie" as const, min: 0, next: 300 };
  }
  if (xp < 800) {
    return { name: "Trainee" as const, min: 300, next: 800 };
  }
  if (xp < 2000) {
    return { name: "Keeper" as const, min: 800, next: 2000 };
  }
  if (xp < 5000) {
    return { name: "Champion" as const, min: 2000, next: 5000 };
  }
  return { name: "Sensei" as const, min: 5000, next: null as number | null };
}

function formatShortDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

function dueTone(nextDueIso: string): "overdue" | "today" | "upcoming" {
  const due = startOfDay(new Date(nextDueIso));
  const today = startOfDay(new Date());
  if (due < today) return "overdue";
  if (due === today) return "today";
  return "upcoming";
}

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

export default function DashboardPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const profile = await getCurrentUser();
      if (cancelled) return;

      if (!profile) {
        router.replace("/login");
        return;
      }

      const role = String(profile.role ?? "").toLowerCase();
      if (role !== "zone_leader" && role !== "supervisor") {
        router.replace(getRoleHomeRoute(profile.role));
        return;
      }

      const { data: zone, error: zoneErr } = await supabase
        .from("zones")
        .select("id,name,department,audit_frequency,plant_id")
        .eq("leader_id", profile.id)
        .maybeSingle();

      if (cancelled) return;

      if (zoneErr) {
        setState({ status: "error", message: zoneErr.message });
        return;
      }

      if (!zone) {
        setState({
          status: "no_zone",
          displayName: profile.full_name,
        });
        return;
      }

      const weekStart = startOfWeekLocal().toISOString();
      const xpDefault = 0;

      const [statsRes, latestAuditRes, ncrsRes, auditsWeekRes] =
        await Promise.all([
          supabase
            .from("zone_leader_stats")
            .select("xp,level,streak_days,plant_id")
            .eq("user_id", profile.id)
            .maybeSingle(),
          supabase
            .from("audit_sessions")
            .select("score,created_at,completed_at")
            .eq("zone_id", zone.id)
            .order("completed_at", { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("ncrs")
            .select("id", { count: "exact", head: true })
            .eq("zone_id", zone.id)
            .eq("status", "open"),
          supabase
            .from("audit_sessions")
            .select("id", { count: "exact", head: true })
            .eq("conducted_by", profile.id)
            .gte("created_at", weekStart),
        ]);

      if (cancelled) return;

      let statsRow: StatsRow = {
        xp: xpDefault,
        level: null,
        streak_days: null,
        plant_id: zone.plant_id,
      };

      if (!statsRes.error && statsRes.data) {
        const s = statsRes.data as StatsRow;
        statsRow = {
          xp: Number(s.xp ?? 0),
          level: s.level,
          streak_days: s.streak_days,
          plant_id: s.plant_id ?? zone.plant_id,
        };
      }

      const currentXp = statsRow.xp ?? 0;

      let higherXpCount = 0;
      if (zone.plant_id) {
        const { count, error: rankErr } = await supabase
          .from("zone_leader_stats")
          .select("id", { count: "exact", head: true })
          .eq("plant_id", zone.plant_id)
          .gt("xp", currentXp);

        if (!rankErr) higherXpCount = count ?? 0;
      }

      let auditsThisWeek = 0;
      if (!auditsWeekRes.error) {
        auditsThisWeek = auditsWeekRes.count ?? 0;
      } else {
        const fallback = await supabase
          .from("audit_sessions")
          .select("id", { count: "exact", head: true })
          .eq("zone_id", zone.id)
          .gte("created_at", weekStart);
        if (!fallback.error) auditsThisWeek = fallback.count ?? 0;
      }

      const latestAudit = latestAuditRes.error
        ? null
        : (latestAuditRes.data as LatestAudit | null);

      setState({
        status: "ready",
        displayName: profile.full_name,
        zone: zone as ZoneRow,
        stats: statsRow,
        latestAudit,
        openNcrs: ncrsRes.error ? 0 : ncrsRes.count ?? 0,
        auditsThisWeek,
        plantRank: higherXpCount + 1,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const readyView = useMemo(() => {
    if (state.status !== "ready") return null;

    const xp = Number(state.stats.xp ?? 0);
    const tier = getTierProgress(xp);
    const pctWithinTier =
      tier.next != null
        ? Math.min(
            100,
            Math.max(0, ((xp - tier.min) / (tier.next - tier.min)) * 100),
          )
        : 100;
    const xpToNext =
      tier.next != null ? Math.max(0, tier.next - xp) : 0;

    const lastAt =
      state.latestAudit?.completed_at ?? state.latestAudit?.created_at ?? null;
    const nextDueIso = nextDueFromFrequency(lastAt, state.zone.audit_frequency);
    const tone = dueTone(nextDueIso);
    const dueLabelClass =
      tone === "overdue"
        ? "text-red-600"
        : tone === "today"
          ? "text-amber-600"
          : "text-emerald-700";

    const todayEnd = startOfDay(new Date());
    const nextDueDay = startOfDay(new Date(nextDueIso));
    const hasNoAudits = !state.latestAudit;
    const canStartAudit =
      hasNoAudits || nextDueDay <= todayEnd;

    const score = state.latestAudit?.score;
    const scoreNum =
      score != null && !Number.isNaN(Number(score))
        ? Math.round(Number(score))
        : null;
    const ringPct =
      scoreNum != null ? Math.min(100, Math.max(0, scoreNum)) : 0;
    const ringOffset = RING_C - (RING_C * ringPct) / 100;

    const ringColor =
      scoreNum == null
        ? "text-zinc-300"
        : scoreNum >= 80
          ? "text-emerald-500"
          : scoreNum >= 60
            ? "text-amber-500"
            : "text-rose-500";

    return {
      xp,
      tier,
      pctWithinTier,
      xpToNext,
      nextDueIso,
      dueLabelClass,
      hasNoAudits,
      canStartAudit,
      scoreNum,
      ringOffset,
      ringColor,
    };
  }, [state]);

  const shell =
    "min-h-full w-full bg-zinc-100 px-4 pb-28 pt-6 text-zinc-950 sm:px-6 sm:pb-32 sm:pt-8";

  if (state.status === "loading") {
    return (
      <div className={shell}>
        <div className="mx-auto max-w-lg space-y-4">
          <div className="h-36 animate-pulse rounded-2xl bg-zinc-200/80" />
          <div className="h-48 animate-pulse rounded-2xl bg-zinc-200/80" />
          <div className="h-32 animate-pulse rounded-2xl bg-zinc-200/80" />
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className={shell}>
        <div className="mx-auto max-w-md rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-rose-800">{state.message}</p>
        </div>
      </div>
    );
  }

  if (state.status === "no_zone") {
    return (
      <div className={shell}>
        <div className="mx-auto max-w-md rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-sm">
          <p className="text-base font-semibold text-zinc-900">No zone assigned</p>
          <p className="mt-2 text-sm text-zinc-600">
            Ask your organisation admin to assign you as a zone leader for a zone.
          </p>
        </div>
      </div>
    );
  }

  if (state.status !== "ready" || !readyView) {
    return null;
  }

  const v = readyView;
  const displayName = state.displayName?.trim() || "there";
  const streak = Number(state.stats.streak_days ?? 0);

  return (
    <div className={shell}>
      <div className="mx-auto flex max-w-lg flex-col gap-5 sm:max-w-2xl">
        {/* SECTION 1 — Greeting */}
        <section className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm ring-1 ring-black/5 sm:p-6">
          <div className="absolute right-4 top-4 flex items-center gap-1 rounded-full bg-orange-50 px-3 py-1.5 text-sm font-bold text-orange-800 ring-1 ring-orange-200">
            <span aria-hidden>🔥</span>
            <span>{streak}</span>
            <span className="font-semibold text-orange-700">day streak</span>
          </div>

          <p className="pr-24 text-lg font-semibold text-zinc-900 sm:text-xl">
            {getGreeting()}, {displayName}
          </p>
          <div className="mt-3 space-y-1">
            <p className="text-xl font-bold text-zinc-900">
              {state.zone.name ?? "Your zone"}
            </p>
            <p className="text-sm font-medium text-zinc-600">
              {state.zone.department ?? "—"}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <span
              className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${freqBadgeClass(state.zone.audit_frequency)}`}
            >
              {(state.zone.audit_frequency ?? "daily").toLowerCase()}
            </span>
          </div>

          <div className="mt-4 border-t border-zinc-100 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Next audit due
            </p>
            <p className={`mt-1 text-base font-bold ${v.dueLabelClass}`}>
              {formatShortDate(v.nextDueIso)}
            </p>
          </div>
        </section>

        {/* SECTION 2 — Zone health */}
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm ring-1 ring-black/5 sm:p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Zone health score
          </h2>
          {v.scoreNum == null ? (
            <p className="mt-6 text-center text-sm font-medium text-zinc-500">
              No audits yet
            </p>
          ) : (
            <div className="mt-4 flex flex-col items-center">
              <div className="relative h-[140px] w-[140px]">
                <svg
                  viewBox="0 0 120 120"
                  className="h-full w-full -rotate-90"
                  aria-hidden
                >
                  <circle
                    cx="60"
                    cy="60"
                    r={RING_R}
                    fill="none"
                    className="text-zinc-100"
                    stroke="currentColor"
                    strokeWidth="10"
                  />
                  <circle
                    cx="60"
                    cy="60"
                    r={RING_R}
                    fill="none"
                    className={v.ringColor}
                    stroke="currentColor"
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={RING_C}
                    strokeDashoffset={v.ringOffset}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-3xl font-bold tabular-nums text-zinc-900">
                    {v.scoreNum}
                  </span>
                  <span className="text-xs font-semibold text-zinc-500">/ 100</span>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* SECTION 3 — XP */}
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm ring-1 ring-black/5 sm:p-6">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              XP &amp; level
            </h2>
            <span className="text-lg font-bold text-indigo-700 tabular-nums">
              {v.xp} XP
            </span>
          </div>
          <p className="mt-2 text-lg font-bold text-zinc-900">
            {getLevelName(v.xp)}
          </p>

          {v.tier.next != null ? (
            <>
              <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full bg-indigo-600 transition-[width]"
                  style={{ width: `${v.pctWithinTier}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-zinc-600">
                <span className="font-semibold text-zinc-800">{v.xpToNext}</span>{" "}
                XP to next level
              </p>
            </>
          ) : (
            <p className="mt-4 text-sm font-semibold text-emerald-700">
              Max level reached — Sensei
            </p>
          )}
        </section>

        {/* SECTION 4 — Stats */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Open NCRs
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-amber-700">
              {state.openNcrs}
            </div>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Audits this week
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-blue-700">
              {state.auditsThisWeek}
            </div>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Plant rank
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-zinc-900">
              #{state.plantRank}
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">by XP</div>
          </div>
        </section>

        {/* SECTION 5 — Audit CTA */}
        <section className="pb-4">
          {v.canStartAudit ? (
            <Link
              href="/audit"
              className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-blue-600 px-6 text-base font-bold text-white shadow-md ring-1 ring-blue-700/20 hover:bg-blue-500 active:scale-[0.99]"
            >
              Start Today&apos;s Audit
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="min-h-14 w-full cursor-not-allowed rounded-2xl border border-zinc-200 bg-zinc-100 px-6 text-center text-base font-semibold text-zinc-500"
            >
              Next audit due: {formatShortDate(v.nextDueIso)}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

function freqBadgeClass(freq: string | null) {
  const f = (freq ?? "daily").toLowerCase();
  if (f === "weekly") return "bg-blue-50 text-blue-800 ring-blue-200";
  if (f === "fortnightly") return "bg-purple-50 text-purple-800 ring-purple-200";
  if (f === "monthly") return "bg-amber-50 text-amber-900 ring-amber-200";
  return "bg-emerald-50 text-emerald-800 ring-emerald-200";
}
