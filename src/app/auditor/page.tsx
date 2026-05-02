"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import supabase from "@/lib/supabase";
import { getCurrentUser, getRoleHomeRoute } from "@/lib/auth";
import type { UserProfile } from "@/lib/auth";

type ZoneOption = {
  id: string;
  name: string | null;
  plant_id: string | null;
};

type ZoneWithAudit = ZoneOption & {
  lastAuditAt: string | null;
  healthScore: number | null;
};

type NcrLite = {
  id: string;
  title: string | null;
  status: string | null;
  severity: string | null;
  zone_id: string | null;
};

type ResolvedNcr = NcrLite & {
  before_photo: string | null;
  after_photo: string | null;
  resolution_notes: string | null;
  org_id: string | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      profile: UserProfile;
      auditsCount: number;
      ncrsRaised: number;
      openNcrsRaised: number;
      zones: ZoneWithAudit[];
      myNcrs: NcrLite[];
      resolvedPlant: ResolvedNcr[];
    };

function statusBadge(s: string | null) {
  const x = (s ?? "").toLowerCase();
  if (x === "open") return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  if (x === "in_progress") return "bg-blue-50 text-blue-800 ring-blue-200";
  if (x === "resolved") return "bg-amber-50 text-amber-900 ring-amber-200";
  if (x === "closed") return "bg-zinc-100 text-zinc-700 ring-zinc-200";
  if (x === "escalated") return "bg-rose-50 text-rose-800 ring-rose-200";
  return "bg-zinc-100 text-zinc-700 ring-zinc-200";
}

function formatDate(iso: string | null) {
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

async function awardZoneLeaderXp(
  zoneId: string | null,
  amount: number,
  plantId: string | null,
  orgId: string | null,
) {
  if (!zoneId || !plantId || !orgId) return;
  const { data: zone } = await supabase
    .from("zones")
    .select("leader_id")
    .eq("id", zoneId)
    .maybeSingle();
  const leaderId = (zone as { leader_id?: string | null } | null)?.leader_id;
  if (!leaderId) return;

  const { data: stats } = await supabase
    .from("zone_leader_stats")
    .select("xp")
    .eq("user_id", leaderId)
    .maybeSingle();

  const prev = Number((stats as { xp?: number } | null)?.xp ?? 0);

  if (stats) {
    await supabase
      .from("zone_leader_stats")
      .update({ xp: prev + amount })
      .eq("user_id", leaderId);
  } else {
    await supabase.from("zone_leader_stats").insert({
      user_id: leaderId,
      zone_id: zoneId,
      org_id: orgId,
      plant_id: plantId,
      xp: amount,
      level: 1,
      streak_days: 0,
    });
  }
}

export default function AuditorDashboardPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selectedZone, setSelectedZone] = useState<string>("");
  const [verifyNcr, setVerifyNcr] = useState<ResolvedNcr | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const profile = await getCurrentUser();
    if (!profile) {
      router.replace("/login");
      return;
    }
    if (String(profile.role).toLowerCase() !== "auditor") {
      router.replace(getRoleHomeRoute(profile.role));
      return;
    }
    if (!profile.plant_id) {
      setState({
        status: "error",
        message: "No plant assigned to your profile.",
      });
      return;
    }

    const plantId = profile.plant_id;
    const userId = profile.id;

    const [
      auditsRes,
      raisedRes,
      openRes,
      zonesRes,
      myNcrsRes,
      resolvedRes,
    ] = await Promise.all([
      supabase
        .from("audit_sessions")
        .select("id", { count: "exact", head: true })
        .eq("conducted_by", userId),
      supabase
        .from("ncrs")
        .select("id", { count: "exact", head: true })
        .eq("raised_by", userId),
      supabase
        .from("ncrs")
        .select("id", { count: "exact", head: true })
        .eq("raised_by", userId)
        .eq("status", "open"),
      supabase
        .from("zones")
        .select("id,name,plant_id")
        .eq("plant_id", plantId)
        .order("name", { ascending: true }),
      supabase
        .from("ncrs")
        .select("id,title,status,severity,zone_id")
        .eq("raised_by", userId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("ncrs")
        .select(
          "id,title,status,severity,zone_id,before_photo,after_photo,resolution_notes,plant_id,org_id",
        )
        .eq("plant_id", plantId)
        .eq("status", "resolved")
        .order("resolved_at", { ascending: false, nullsFirst: false })
        .limit(30),
    ]);

    const firstErr =
      auditsRes.error ??
      raisedRes.error ??
      openRes.error ??
      zonesRes.error ??
      myNcrsRes.error ??
      resolvedRes.error;

    if (firstErr) {
      setState({ status: "error", message: firstErr.message });
      return;
    }

    const zoneList = (zonesRes.data ?? []) as ZoneOption[];
    const zoneIds = zoneList.map((z) => z.id);

    let latestByZone = new Map<
      string,
      { score: number | null; at: string | null }
    >();

    if (zoneIds.length > 0) {
      const { data: sessions } = await supabase
        .from("audit_sessions")
        .select("zone_id,score,completed_at,created_at")
        .in("zone_id", zoneIds)
        .order("completed_at", { ascending: false, nullsFirst: false });

      for (const row of sessions ?? []) {
        const zid = (row as { zone_id: string | null }).zone_id;
        if (!zid || latestByZone.has(zid)) continue;
        const completed = (row as { completed_at?: string | null }).completed_at;
        const created = (row as { created_at?: string | null }).created_at;
        latestByZone.set(zid, {
          score: (row as { score: number | null }).score ?? null,
          at: completed ?? created ?? null,
        });
      }
    }

    const zones: ZoneWithAudit[] = zoneList.map((z) => {
      const la = latestByZone.get(z.id);
      return {
        ...z,
        lastAuditAt: la?.at ?? null,
        healthScore:
          la?.score != null && !Number.isNaN(Number(la.score))
            ? Math.round(Number(la.score))
            : null,
      };
    });

    setState({
      status: "ready",
      profile,
      auditsCount: auditsRes.count ?? 0,
      ncrsRaised: raisedRes.count ?? 0,
      openNcrsRaised: openRes.count ?? 0,
      zones,
      myNcrs: (myNcrsRes.data ?? []) as NcrLite[],
      resolvedPlant: (resolvedRes.data ?? []) as ResolvedNcr[],
    });

    setSelectedZone((cur) => {
      if (cur && zones.some((z) => z.id === cur)) return cur;
      const q =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("zone")
          : null;
      if (q && zones.some((z) => z.id === q)) return q;
      return zones[0]?.id ?? "";
    });
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleVerifyClose(ncr: ResolvedNcr) {
    if (state.status !== "ready") return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("ncrs")
        .update({
          status: "closed",
          verified_by: state.profile.id,
          verified_at: now,
          closed_at: now,
        })
        .eq("id", ncr.id);
      if (error) throw new Error(error.message);

      await awardZoneLeaderXp(
        ncr.zone_id,
        40,
        state.profile.plant_id,
        ncr.org_id ?? state.profile.org_id,
      );

      setVerifyNcr(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleReject() {
    if (!verifyNcr || !rejectNote.trim() || state.status !== "ready") return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("ncrs")
        .update({
          status: "in_progress",
          rejection_note: rejectNote.trim(),
        })
        .eq("id", verifyNcr.id);
      if (error) throw new Error(error.message);
      setRejectOpen(false);
      setRejectNote("");
      setVerifyNcr(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  const shell =
    "min-h-full w-full bg-zinc-100 px-4 pb-28 pt-6 text-zinc-950 sm:px-6 sm:pb-32 sm:pt-8";

  if (state.status === "loading") {
    return (
      <div className={shell}>
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="h-10 w-64 animate-pulse rounded-xl bg-zinc-200" />
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-zinc-200" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className={shell}>
        <div className="mx-auto max-w-md rounded-2xl border border-rose-200 bg-white p-6 text-center">
          <p className="text-rose-800">{state.message}</p>
        </div>
      </div>
    );
  }

  const { profile, zones, myNcrs, resolvedPlant } = state;
  const auditHref =
    selectedZone && zones.some((z) => z.id === selectedZone)
      ? `/audit?zone=${selectedZone}`
      : "/audit";

  return (
    <div className={shell}>
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="border-b border-zinc-200 pb-4">
          <h1 className="text-2xl font-bold text-zinc-900">Auditor Dashboard</h1>
          <p className="mt-1 text-sm font-semibold text-zinc-600">
            {profile.full_name ?? "Auditor"}
          </p>
        </header>

        <section aria-label="Stats">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/80 bg-white p-4 shadow-sm ring-1 ring-black/5">
              <div className="text-xs font-semibold uppercase text-zinc-500">
                Audits conducted
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-blue-700">
                {state.auditsCount}
              </div>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white p-4 shadow-sm ring-1 ring-black/5">
              <div className="text-xs font-semibold uppercase text-zinc-500">
                NCRs raised
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-zinc-900">
                {state.ncrsRaised}
              </div>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white p-4 shadow-sm ring-1 ring-black/5">
              <div className="text-xs font-semibold uppercase text-zinc-500">
                Open NCRs (yours)
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">
                {state.openNcrsRaised}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="text-lg font-bold text-zinc-900">Cross-audit</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Select a zone to audit &mdash; last audit date and latest health
            score shown.
          </p>

          <label className="mt-4 block text-sm font-semibold text-zinc-700">
            Select a zone to audit
          </label>
          <select
            value={selectedZone}
            onChange={(e) => setSelectedZone(e.target.value)}
            className="mt-2 min-h-12 w-full rounded-xl border border-zinc-200 px-3 text-sm font-semibold text-zinc-900"
          >
            {zones.length === 0 ? (
              <option value="">No zones</option>
            ) : (
              zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name ?? "Zone"} — Last: {formatDate(z.lastAuditAt)} | Score:{" "}
                  {z.healthScore != null ? `${z.healthScore}/100` : "—"}
                </option>
              ))
            )}
          </select>

          <Link
            href={auditHref}
            className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-blue-500"
          >
            Start Cross-Audit
          </Link>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-bold text-zinc-900">Your NCRs</h2>
            <Link
              href="/ncr-board"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-500"
            >
              Raise New NCR
            </Link>
          </div>

          <div className="mt-4 space-y-2">
            {myNcrs.length === 0 ? (
              <p className="text-sm text-zinc-500">No NCRs raised yet.</p>
            ) : (
              myNcrs.map((n) => (
                <div
                  key={n.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-100 bg-zinc-50/80 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-zinc-900">
                      {n.title ?? "Untitled"}
                    </div>
                    <div className="text-xs text-zinc-500">{n.id.slice(0, 8)}…</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${statusBadge(n.status)}`}
                    >
                      {n.status ?? "—"}
                    </span>
                    <Link
                      href="/ncr-board"
                      className="text-xs font-semibold text-blue-600 hover:underline"
                    >
                      Board
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="text-lg font-bold text-zinc-900">
            Awaiting verification
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            Resolved NCRs in your plant need auditor sign-off.
          </p>

          <div className="mt-4 space-y-2">
            {resolvedPlant.length === 0 ? (
              <p className="text-sm text-zinc-500">None right now.</p>
            ) : (
              resolvedPlant.map((n) => (
                <div
                  key={n.id}
                  className="flex flex-col gap-2 rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 font-semibold text-zinc-900">
                    {n.title ?? "NCR"}
                  </div>
                  <button
                    type="button"
                    onClick={() => setVerifyNcr(n)}
                    className="min-h-11 shrink-0 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-500"
                  >
                    Verify &amp; Close
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {verifyNcr ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.currentTarget === e.target && !rejectOpen) setVerifyNcr(null);
          }}
        >
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-4 shadow-xl sm:p-6">
            {!rejectOpen ? (
              <>
                <h3 className="text-lg font-bold text-zinc-900">
                  Verify closure
                </h3>
                <p className="mt-1 text-sm text-zinc-600">{verifyNcr.title}</p>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold uppercase text-zinc-500">
                      Before
                    </div>
                    {verifyNcr.before_photo ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={verifyNcr.before_photo}
                        alt="Before"
                        className="mt-1 max-h-48 w-full rounded-xl object-contain ring-1 ring-zinc-200"
                      />
                    ) : (
                      <p className="text-sm text-zinc-400">No image</p>
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase text-zinc-500">
                      After
                    </div>
                    {verifyNcr.after_photo ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={verifyNcr.after_photo}
                        alt="After"
                        className="mt-1 max-h-48 w-full rounded-xl object-contain ring-1 ring-zinc-200"
                      />
                    ) : (
                      <p className="text-sm text-zinc-400">No image</p>
                    )}
                  </div>
                </div>

                {verifyNcr.resolution_notes ? (
                  <div className="mt-4 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-800">
                    <span className="font-semibold text-zinc-600">
                      Resolution:{" "}
                    </span>
                    {verifyNcr.resolution_notes}
                  </div>
                ) : null}

                <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleVerifyClose(verifyNcr)}
                    className="min-h-12 flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    Approve &amp; Close
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setRejectOpen(true)}
                    className="min-h-12 flex-1 rounded-xl bg-rose-600 py-3 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-bold text-zinc-900">
                  Reject verification
                </h3>
                <textarea
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  rows={4}
                  placeholder="Reason for rejection"
                  className="mt-3 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                />
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setRejectOpen(false)}
                    className="min-h-12 flex-1 rounded-xl border border-zinc-200 py-2 text-sm font-semibold"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleReject()}
                    className="min-h-12 flex-1 rounded-xl bg-rose-600 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >
                    Confirm reject
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
