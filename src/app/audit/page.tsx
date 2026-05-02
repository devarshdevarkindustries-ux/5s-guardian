"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import supabase from "@/lib/supabase";
import { getCurrentUser, getRoleHomeRoute } from "@/lib/auth";
import type { UserProfile } from "@/lib/auth";

type AuditTemplate = {
  id: string;
  name: string | null;
  items: unknown;
};

type AuditItem = {
  id: string;
  pillar: string;
  text: string;
};

type ZoneRow = {
  id: string;
  name: string | null;
  department: string | null;
  org_id: string | null;
  plant_id: string | null;
  audit_frequency: string | null;
};

type ResponseDraft = {
  item_id: string;
  score: 0 | 1 | 2 | 3 | 4;
  notes: string | null;
  photoFile: File | null;
};

type ScreenState =
  | { status: "loading" }
  | { status: "error"; message: string; homeHref: string }
  | {
      status: "select_zone";
      profile: UserProfile;
      zones: ZoneRow[];
    }
  | {
      status: "in_progress";
      profile: UserProfile;
      zone: ZoneRow;
      template: AuditTemplate;
      items: AuditItem[];
      index: number;
      answers: Record<string, ResponseDraft>;
      /** When set, complete this admin-assigned row instead of inserting. */
      existingSessionId: string | null;
      auditKind: "self" | "cross" | "surprise";
    }
  | {
      status: "submitting";
      profile: UserProfile;
      zone: ZoneRow;
      template: AuditTemplate;
      items: AuditItem[];
      answers: Record<string, ResponseDraft>;
      existingSessionId: string | null;
      auditKind: "self" | "cross" | "surprise";
    }
  | {
      status: "done";
      score: number;
      xpEarned: number;
      breakdown: Record<string, { earned: number; max: number }>;
      profile: UserProfile;
    };

const PILLAR_MAX: Record<string, number> = {
  Sort: 28,
  Set: 44,
  Shine: 44,
  Standardise: 44,
  Sustain: 36,
  Safety: 36,
};

const PILLAR_ORDER = [
  "Sort",
  "Set",
  "Shine",
  "Standardise",
  "Sustain",
  "Safety",
] as const;

function parseItems(items: unknown): AuditItem[] {
  if (Array.isArray(items)) {
    return items
      .map((raw) => {
        const r = raw as Record<string, unknown>;
        return {
          id: String(r.id ?? ""),
          pillar: String(r.pillar ?? ""),
          text: String(r.text ?? ""),
        };
      })
      .filter((i) => i.id && i.text);
  }
  if (typeof items === "string") {
    try {
      return parseItems(JSON.parse(items));
    } catch {
      return [];
    }
  }
  return [];
}

function pillarBadgeClass(pillar: string) {
  switch (pillar) {
    case "Sort":
      return "bg-blue-50 text-blue-800 ring-blue-300";
    case "Set":
      return "bg-emerald-50 text-emerald-900 ring-emerald-300";
    case "Shine":
      return "bg-yellow-50 text-yellow-900 ring-yellow-300";
    case "Standardise":
      return "bg-purple-50 text-purple-900 ring-purple-300";
    case "Sustain":
      return "bg-orange-50 text-orange-900 ring-orange-300";
    case "Safety":
      return "bg-red-50 text-red-800 ring-red-300";
    default:
      return "bg-zinc-100 text-zinc-700 ring-zinc-300";
  }
}

function scoreColor(score: number) {
  if (score >= 80) return "text-emerald-600";
  if (score >= 60) return "text-amber-500";
  return "text-rose-600";
}

function extFromMimeOrName(file: File) {
  const type = file.type.toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  const name = file.name.toLowerCase();
  if (name.endsWith(".png")) return "png";
  if (name.endsWith(".webp")) return "webp";
  if (name.endsWith(".gif")) return "gif";
  if (name.endsWith(".jpeg") || name.endsWith(".jpg")) return "jpg";
  return "jpg";
}

function addDays(isoOrDate: Date, days: number) {
  const d = new Date(isoOrDate);
  d.setDate(d.getDate() + days);
  return d;
}

function nextAuditDueFromToday(freq: string | null) {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const f = (freq ?? "daily").toLowerCase();
  const days =
    f === "weekly" ? 7 : f === "fortnightly" ? 14 : f === "monthly" ? 30 : 1;
  return addDays(base, days).toISOString();
}

export default function AuditPage() {
  const router = useRouter();
  const [state, setState] = useState<ScreenState>({ status: "loading" });
  const [photoOpenFor, setPhotoOpenFor] = useState<string | null>(null);
  const [photoPreviewUrlByItemId, setPhotoPreviewUrlByItemId] = useState<
    Record<string, string>
  >({});
  const [auditorZoneId, setAuditorZoneId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      Object.values(photoPreviewUrlByItemId).forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      });
    };
  }, [photoPreviewUrlByItemId]);

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
      if (role !== "zone_leader" && role !== "auditor") {
        router.replace(getRoleHomeRoute(profile.role));
        return;
      }

      if (role === "auditor") {
        if (!profile.plant_id) {
          setState({
            status: "error",
            message: "Your profile has no plant assigned. Contact an administrator.",
            homeHref: getRoleHomeRoute(profile.role),
          });
          return;
        }

        const { data: zones, error: zonesErr } = await supabase
          .from("zones")
          .select("id,name,department,org_id,plant_id,audit_frequency")
          .eq("plant_id", profile.plant_id)
          .order("name", { ascending: true });

        if (cancelled) return;

        if (zonesErr) {
          setState({
            status: "error",
            message: zonesErr.message,
            homeHref: getRoleHomeRoute(profile.role),
          });
          return;
        }

        const list = (zones ?? []) as ZoneRow[];
        if (list.length === 0) {
          setState({
            status: "error",
            message: "No zones found for your plant.",
            homeHref: getRoleHomeRoute(profile.role),
          });
          return;
        }

        const zoneFromUrl =
          typeof window !== "undefined"
            ? new URLSearchParams(window.location.search).get("zone")
            : null;
        const pick =
          zoneFromUrl && list.some((z) => z.id === zoneFromUrl)
            ? zoneFromUrl
            : (list[0]?.id ?? null);
        setAuditorZoneId(pick);
        setState({ status: "select_zone", profile, zones: list });
        return;
      }

      const { data: zone, error: zoneErr } = await supabase
        .from("zones")
        .select("id,name,department,org_id,plant_id,audit_frequency")
        .eq("leader_id", profile.id)
        .maybeSingle();

      if (cancelled) return;

      if (zoneErr) {
        setState({
          status: "error",
          message: zoneErr.message,
          homeHref: getRoleHomeRoute(profile.role),
        });
        return;
      }

      if (!zone) {
        setState({
          status: "error",
          message: "No zone found where you are assigned as leader.",
          homeHref: getRoleHomeRoute(profile.role),
        });
        return;
      }

      const { data: template, error: templateErr } = await supabase
        .from("audit_templates")
        .select("id,name,items")
        .eq("is_default", true)
        .maybeSingle();

      if (cancelled) return;

      if (templateErr) {
        setState({
          status: "error",
          message: templateErr.message,
          homeHref: getRoleHomeRoute(profile.role),
        });
        return;
      }

      if (!template) {
        setState({
          status: "error",
          message: "No default audit template (is_default = true).",
          homeHref: getRoleHomeRoute(profile.role),
        });
        return;
      }

      const items = parseItems((template as AuditTemplate).items);
      if (items.length === 0) {
        setState({
          status: "error",
          message:
            "Template has no items. Ensure items is a JSON array with id, pillar, text.",
          homeHref: getRoleHomeRoute(profile.role),
        });
        return;
      }

      setState({
        status: "in_progress",
        profile,
        zone: zone as ZoneRow,
        template: template as AuditTemplate,
        items,
        index: 0,
        answers: {},
        existingSessionId: null,
        auditKind: "self",
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function beginAuditorAudit(
    profile: UserProfile,
    zoneId: string,
    zones: ZoneRow[],
  ) {
    const { data: template, error: templateErr } = await supabase
      .from("audit_templates")
      .select("id,name,items")
      .eq("is_default", true)
      .maybeSingle();

    if (templateErr) {
      setState({
        status: "error",
        message: templateErr.message,
        homeHref: getRoleHomeRoute(profile.role),
      });
      return;
    }

    if (!template) {
      setState({
        status: "error",
        message: "No default audit template (is_default = true).",
        homeHref: getRoleHomeRoute(profile.role),
      });
      return;
    }

    const items = parseItems((template as AuditTemplate).items);
    if (items.length === 0) {
      setState({
        status: "error",
        message: "Template has no valid items.",
        homeHref: getRoleHomeRoute(profile.role),
      });
      return;
    }

    const zone = zones.find((z) => z.id === zoneId) ?? null;

    if (!zone) {
      setState({
        status: "error",
        message: "Selected zone not found.",
        homeHref: getRoleHomeRoute(profile.role),
      });
      return;
    }

    const urlParams =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : null;
    const typeParam = (urlParams?.get("type") ?? "").toLowerCase();
    const isSurpriseUrl = typeParam === "surprise";

    let existingSessionId: string | null = null;
    if (isSurpriseUrl) {
      const { data: pending } = await supabase
        .from("audit_sessions")
        .select("id")
        .eq("conducted_by", profile.id)
        .eq("zone_id", zoneId)
        .eq("audit_type", "surprise")
        .is("completed_at", null)
        .maybeSingle();
      existingSessionId =
        (pending as { id?: string } | null)?.id ?? null;
    }

    const auditKind: "cross" | "surprise" = isSurpriseUrl
      ? "surprise"
      : "cross";

    setState({
      status: "in_progress",
      profile,
      zone,
      template: template as AuditTemplate,
      items,
      index: 0,
      answers: {},
      existingSessionId,
      auditKind,
    });
  }

  const view = useMemo(() => {
    if (state.status !== "in_progress") return null;
    const item = state.items[state.index];
    const existing = item ? state.answers[item.id] : undefined;
    return { item, existing };
  }, [state]);

  async function runSubmit(
    profile: UserProfile,
    zone: ZoneRow,
    template: AuditTemplate,
    items: AuditItem[],
    answers: Record<string, ResponseDraft>,
    opts: {
      existingSessionId: string | null;
      auditKind: "self" | "cross" | "surprise";
    },
  ) {
    const total = items.length;
    const sumScores = items.reduce((acc, item) => {
      const a = answers[item.id];
      return acc + Number(a?.score ?? 0);
    }, 0);

    const score =
      total === 0 ? 0 : (sumScores / (Math.max(1, total) * 4)) * 100;
    const xpEarned = score >= 80 ? 80 : 50;
    const role = String(profile.role ?? "").toLowerCase();

    let auditTypeDb: string;
    if (opts.auditKind === "surprise") auditTypeDb = "surprise";
    else if (role === "auditor") auditTypeDb = "cross";
    else auditTypeDb = "self";

    const orgId = zone.org_id ?? profile.org_id;
    const plantId = zone.plant_id ?? profile.plant_id;

    if (!orgId || !plantId) {
      throw new Error("Missing org_id or plant_id for this audit.");
    }

    const completedAt = new Date().toISOString();

    let sessionId: string;

    if (opts.existingSessionId) {
      const upd = await supabase
        .from("audit_sessions")
        .update({
          template_id: template.id,
          audit_type: "surprise",
          score,
          xp_earned: xpEarned,
          completed_at: completedAt,
        })
        .eq("id", opts.existingSessionId)
        .select("id")
        .single();

      if (upd.error || !upd.data) {
        throw new Error(
          upd.error?.message ?? "Could not update surprise audit session.",
        );
      }
      sessionId = (upd.data as { id: string }).id;
    } else {
      const sessionPayload: Record<string, unknown> = {
        zone_id: zone.id,
        conducted_by: profile.id,
        template_id: template.id,
        org_id: orgId,
        plant_id: plantId,
        audit_type: auditTypeDb,
        score,
        xp_earned: xpEarned,
        completed_at: completedAt,
      };

      const ins1 = await supabase
        .from("audit_sessions")
        .insert(sessionPayload)
        .select("id")
        .single();

      if (ins1.error || !ins1.data) {
        const ins2 = await supabase
          .from("audit_sessions")
          .insert({
            zone_id: zone.id,
            conducted_by: profile.id,
            template_id: template.id,
            org_id: orgId,
            plant_id: plantId,
            type: auditTypeDb,
            audit_type: auditTypeDb,
            score,
            xp_earned: xpEarned,
            completed_at: completedAt,
          })
          .select("id")
          .single();
        if (ins2.error || !ins2.data) {
          throw new Error(
            ins1.error?.message ??
              ins2.error?.message ??
              "Could not create audit session",
          );
        }
        sessionId = (ins2.data as { id: string }).id;
      } else {
        sessionId = (ins1.data as { id: string }).id;
      }
    }

    const photoUrlByItemId = new Map<string, string>();

    for (const item of items) {
      const a = answers[item.id];
      const file = a?.photoFile ?? null;
      if (!file) continue;

      const ext = extFromMimeOrName(file);
      const path = `${orgId}/${plantId}/${zone.id}/${sessionId}/${item.id}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("audit-photos")
        .upload(path, file, { upsert: true });

      if (uploadError) throw new Error(uploadError.message);

      const { data: pub } = supabase.storage
        .from("audit-photos")
        .getPublicUrl(path);
      if (pub?.publicUrl) photoUrlByItemId.set(item.id, pub.publicUrl);
    }

    const rows = items.map((item) => {
      const a = answers[item.id];
      return {
        session_id: sessionId,
        item_id: item.id,
        score: Number(a?.score ?? 0),
        photo_url: photoUrlByItemId.get(item.id) ?? null,
        notes: a?.notes ?? null,
      };
    });

    const { error: responsesError } = await supabase
      .from("audit_responses")
      .insert(rows);

    if (responsesError) throw new Error(responsesError.message);

    const breakdown: Record<string, { earned: number; max: number }> = {};
    for (const p of PILLAR_ORDER) {
      breakdown[p] = { earned: 0, max: PILLAR_MAX[p] };
    }
    for (const item of items) {
      const pillar = item.pillar;
      if (
        !PILLAR_ORDER.includes(pillar as (typeof PILLAR_ORDER)[number])
      ) {
        continue;
      }
      const a = answers[item.id];
      breakdown[pillar].earned += Number(a?.score ?? 0);
    }

    const todayIso = new Date().toISOString();
    const nextDue = nextAuditDueFromToday(zone.audit_frequency);

    const { error: zoneUpdErr } = await supabase
      .from("zones")
      .update({
        last_audit_date: todayIso,
        next_audit_due: nextDue,
      })
      .eq("id", zone.id);

    if (zoneUpdErr) {
      throw new Error(zoneUpdErr.message);
    }

    if (role === "zone_leader") {
      const { data: statsRow } = await supabase
        .from("zone_leader_stats")
        .select("id,xp,streak_days")
        .eq("user_id", profile.id)
        .maybeSingle();

      const prevXp = Number((statsRow as { xp?: number } | null)?.xp ?? 0);
      const prevStreak = Number(
        (statsRow as { streak_days?: number } | null)?.streak_days ?? 0,
      );

      const statsUpdate = {
        xp: prevXp + xpEarned,
        streak_days: prevStreak + 1,
        last_audit_date: todayIso.split("T")[0],
      };

      if (statsRow) {
        const { error: stErr } = await supabase
          .from("zone_leader_stats")
          .update(statsUpdate)
          .eq("user_id", profile.id);
        if (stErr) throw new Error(stErr.message);
      } else {
        const { error: insErr } = await supabase
          .from("zone_leader_stats")
          .insert({
            user_id: profile.id,
            zone_id: zone.id,
            org_id: orgId,
            plant_id: plantId,
            xp: xpEarned,
            level: 1,
            streak_days: 1,
            last_audit_date: statsUpdate.last_audit_date,
          });
        if (insErr) throw new Error(insErr.message);
      }
    }

    return { score, xpEarned, breakdown };
  }

  const pageShell =
    "min-h-full w-full bg-zinc-100 px-4 py-6 pb-28 text-zinc-950 sm:px-6 sm:py-8";
  const cardShell =
    "mx-auto w-full max-w-md rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:max-w-2xl sm:p-8";

  if (state.status === "loading") {
    return (
      <div className={pageShell}>
        <div className={cardShell}>
          <div className="h-6 w-52 animate-pulse rounded bg-zinc-200" />
          <div className="mt-4 h-4 w-72 animate-pulse rounded bg-zinc-200" />
          <div className="mt-8 h-40 animate-pulse rounded-2xl bg-zinc-200" />
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className={pageShell}>
        <div className={cardShell}>
          <div className="text-lg font-semibold text-rose-700">
            Couldn&apos;t start audit
          </div>
          <div className="mt-2 text-sm text-rose-700">{state.message}</div>
          <div className="mt-6">
            <Link
              href={state.homeHref}
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white"
            >
              Go home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === "select_zone") {
    return (
      <div className={pageShell}>
        <div className={cardShell}>
          <h1 className="text-xl font-bold text-zinc-900">Choose zone to audit</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Select a zone in your plant, then start the audit.
          </p>

          <label className="mt-6 block text-sm font-semibold text-zinc-700">
            Zone
          </label>
          <select
            value={auditorZoneId ?? ""}
            onChange={(e) => setAuditorZoneId(e.target.value || null)}
            className="mt-2 min-h-[48px] w-full rounded-xl border border-zinc-200 bg-white px-3 text-base font-semibold text-zinc-900 shadow-sm outline-none focus:border-blue-500"
          >
            {state.zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name ?? "Unnamed zone"}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={!auditorZoneId}
            onClick={() => {
              if (!auditorZoneId) return;
              void beginAuditorAudit(state.profile, auditorZoneId, state.zones);
            }}
            className="mt-6 min-h-[48px] w-full rounded-2xl bg-blue-600 px-5 text-base font-bold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50"
          >
            Start audit
          </button>
        </div>
      </div>
    );
  }

  if (state.status === "done") {
    const home = getRoleHomeRoute(state.profile.role);
    return (
      <div className={pageShell}>
        <div className={cardShell}>
          <div className="text-sm font-semibold text-zinc-500">Results</div>
          <div className="mt-2 text-5xl font-semibold tracking-tight">
            <span className={scoreColor(state.score)}>
              {Math.round(state.score)}
            </span>
            <span className="text-zinc-400">/100</span>
          </div>

          <div className="mt-4 rounded-2xl bg-blue-50 px-4 py-4 ring-1 ring-blue-100">
            <div className="text-sm font-semibold text-blue-800">XP earned</div>
            <div className="mt-1 text-2xl font-bold text-blue-900">
              +{state.xpEarned}
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="text-sm font-semibold text-zinc-800">
              Per-pillar breakdown
            </div>
            <table className="mt-3 w-full text-sm">
              <tbody className="divide-y divide-zinc-100">
                {PILLAR_ORDER.map((pillar) => {
                  const row = state.breakdown[pillar];
                  const earned = row?.earned ?? 0;
                  const max = PILLAR_MAX[pillar] ?? row?.max ?? 0;
                  return (
                    <tr key={pillar}>
                      <td className="py-2.5 font-semibold text-zinc-800">
                        {pillar}
                      </td>
                      <td className="py-2.5 text-right font-semibold tabular-nums text-zinc-900">
                        {earned}/{max}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Link
            href={home}
            className="mt-8 flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-zinc-900 px-5 text-base font-bold text-white"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (state.status === "submitting") {
    return (
      <div className={pageShell}>
        <div className={cardShell}>
          <div className="text-lg font-semibold">Submitting…</div>
          <div className="mt-2 text-sm text-zinc-600">
            Saving your audit, responses, and uploads.
          </div>
          <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-zinc-200">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-blue-600" />
          </div>
        </div>
      </div>
    );
  }

  if (state.status !== "in_progress") {
    return null;
  }

  const leader = state.profile;
  const template = state.template;
  const items = state.items;
  const index = state.index;
  const item = view?.item;
  const existing = view?.existing;
  const zone = state.zone;

  if (!item) {
    return (
      <div className={pageShell}>
        <div className={cardShell}>
          <div className="text-lg font-semibold text-zinc-900">
            Question unavailable
          </div>
          <Link
            href={getRoleHomeRoute(leader.role)}
            className="mt-6 inline-flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-zinc-900 px-5 text-base font-bold text-white"
          >
            Go home
          </Link>
        </div>
      </div>
    );
  }

  const total = items.length;
  const current = index + 1;
  const progress = Math.min(1, Math.max(0, current / total));
  const zoneName = zone.name ?? "Zone";

  const handlePrevious = () => {
    if (index === 0) return;
    setState((s) => {
      if (s.status !== "in_progress") return s;
      return { ...s, index: s.index - 1 };
    });
  };

  const recordAnswer = (scoreValue: 0 | 1 | 2 | 3 | 4) => {
    const prev = state.answers[item.id];
    const nextAnswers: Record<string, ResponseDraft> = {
      ...state.answers,
      [item.id]: {
        item_id: item.id,
        score: scoreValue,
        notes: null,
        photoFile: prev?.photoFile ?? null,
      },
    };

    const nextIndex = index + 1;

    if (nextIndex >= items.length) {
      const snap = state;
      if (snap.status !== "in_progress") return;
      const submitOpts = {
        existingSessionId: snap.existingSessionId,
        auditKind: snap.auditKind,
      };

      setState({
        status: "submitting",
        profile: leader,
        zone,
        template,
        items,
        answers: nextAnswers,
        existingSessionId: snap.existingSessionId,
        auditKind: snap.auditKind,
      });

      void (async () => {
        try {
          const result = await runSubmit(
            leader,
            zone,
            template,
            items,
            nextAnswers,
            submitOpts,
          );
          setState({
            status: "done",
            score: result.score,
            xpEarned: result.xpEarned,
            breakdown: result.breakdown,
            profile: leader,
          });
        } catch (e) {
          setState({
            status: "error",
            message: e instanceof Error ? e.message : "Submission failed.",
            homeHref: getRoleHomeRoute(leader.role),
          });
        }
      })();
      return;
    }

    setState({
      ...state,
      answers: nextAnswers,
      index: nextIndex,
    });
  };

  return (
    <div className={pageShell}>
      <div className={cardShell}>
        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold text-zinc-500">
            {template.name ?? "Audit"} • {zoneName}
          </div>
          <div className="text-lg font-bold text-zinc-900">
            Question {current} of {total}
          </div>
          <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-zinc-200">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-200"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </div>

        <div className="mt-8">
          <div
            className={`inline-flex items-center rounded-full px-3 py-1.5 text-sm font-semibold ring-2 ${pillarBadgeClass(item.pillar)}`}
          >
            {item.pillar}
          </div>

          <div className="mt-5 text-[20px] font-semibold leading-snug tracking-tight sm:text-2xl">
            {item.text}
          </div>

          <div className="mt-8">
            <div className="grid grid-cols-5 gap-2">
              {([0, 1, 2, 3, 4] as const).map((n) => {
                const selected = existing?.score === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => recordAnswer(n)}
                    className={[
                      "flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border-2 text-lg font-bold shadow-sm transition active:scale-[0.98]",
                      selected
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50",
                    ].join(" ")}
                    aria-pressed={selected}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              0–4 scale • Tap a score to continue
            </p>
          </div>

          <div className="mt-6">
            <button
              type="button"
              onClick={() =>
                setPhotoOpenFor((cur) => (cur === item.id ? null : item.id))
              }
              className="inline-flex min-h-[48px] items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 text-sm font-semibold text-zinc-900"
            >
              <span aria-hidden>📷</span>
              Add Photo
            </button>

            {photoOpenFor === item.id && (
              <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="block w-full text-sm file:mr-4 file:min-h-[44px] file:rounded-xl file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    setPhotoPreviewUrlByItemId((cur) => {
                      const prevUrl = cur[item.id];
                      if (prevUrl) {
                        try {
                          URL.revokeObjectURL(prevUrl);
                        } catch {
                          // ignore
                        }
                      }
                      if (!file) {
                        const { [item.id]: _, ...rest } = cur;
                        return rest;
                      }
                      return { ...cur, [item.id]: URL.createObjectURL(file) };
                    });
                    setState((s) => {
                      if (s.status !== "in_progress") return s;
                      const pr = s.answers[item.id];
                      return {
                        ...s,
                        answers: {
                          ...s.answers,
                          [item.id]: {
                            item_id: item.id,
                            score: pr?.score ?? 0,
                            notes: pr?.notes ?? null,
                            photoFile: file,
                          },
                        },
                      };
                    });
                  }}
                />

                {existing?.photoFile && photoPreviewUrlByItemId[item.id] ? (
                  <div className="mt-3 flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt=""
                      src={photoPreviewUrlByItemId[item.id]}
                      className="h-16 w-16 rounded-xl object-cover ring-1 ring-black/10"
                    />
                    <span className="truncate text-sm font-medium text-zinc-700">
                      {existing.photoFile.name}
                    </span>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="mt-8 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handlePrevious}
              disabled={index === 0}
              className="min-h-[48px] rounded-xl border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-900 shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
