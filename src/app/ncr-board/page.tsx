"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import supabase from "@/lib/supabase";
import { getCurrentUser, getRoleHomeRoute } from "@/lib/auth";
import type { UserProfile } from "@/lib/auth";

type ZoneOption = {
  id: string;
  name: string | null;
  org_id: string | null;
  plant_id: string | null;
};

type NcrRecord = {
  id: string;
  plant_id: string | null;
  org_id: string | null;
  zone_id: string | null;
  raised_by: string | null;
  assigned_to: string | null;
  verified_by: string | null;
  acknowledged_by: string | null;
  title: string | null;
  severity: string | null;
  s_pillar: string | null;
  status: string | null;
  notes: string | null;
  due_date: string | null;
  before_photo: string | null;
  after_photo: string | null;
  resolution_notes: string | null;
  rejection_note: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  verified_at: string | null;
  closed_at: string | null;
  escalated_at: string | null;
  created_at: string | null;
};

type NcrEnriched = NcrRecord & {
  zone_name: string | null;
  raised_by_name: string | null;
  assigned_to_name: string | null;
  verified_by_name: string | null;
  acknowledged_by_name: string | null;
};

type KanbanStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "closed"
  | "escalated";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      profile: UserProfile;
      ncrs: NcrEnriched[];
      zones: ZoneOption[];
    };

const COLUMNS: { key: KanbanStatus; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In Progress" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
  { key: "escalated", label: "Escalated" },
];

function normalizeKanbanStatus(raw: string | null): KanbanStatus {
  const s = (raw ?? "open").toLowerCase().replace(/\s+/g, "_");
  if (
    s === "open" ||
    s === "in_progress" ||
    s === "resolved" ||
    s === "closed" ||
    s === "escalated"
  ) {
    return s;
  }
  if (s === "inprogress") return "in_progress";
  return "open";
}

function daysOpen(iso: string | null) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Math.max(0, Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24)));
}

function severityBadge(sev: string | null) {
  const s = (sev ?? "").toLowerCase();
  if (s === "critical")
    return "bg-red-100 text-red-900 ring-red-400";
  if (s === "major")
    return "bg-amber-100 text-amber-900 ring-amber-400";
  return "bg-emerald-100 text-emerald-900 ring-emerald-400";
}

function pillarClass(pillar: string | null) {
  const p = (pillar ?? "").toLowerCase();
  if (p === "sort") return "bg-blue-50 text-blue-800 ring-blue-200";
  if (p === "set") return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  if (p === "shine") return "bg-yellow-50 text-yellow-900 ring-yellow-200";
  if (p === "standardise" || p === "standardize")
    return "bg-purple-50 text-purple-900 ring-purple-200";
  if (p === "sustain") return "bg-orange-50 text-orange-900 ring-orange-200";
  if (p === "safety") return "bg-red-50 text-red-800 ring-red-200";
  return "bg-zinc-100 text-zinc-700 ring-zinc-200";
}

function formatTs(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "—";
  }
}

function extFromFile(file: File) {
  const t = file.type.toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
  const n = file.name.toLowerCase();
  if (n.endsWith(".png")) return "png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "jpg";
  return "jpg";
}

function Modal({
  open,
  title,
  children,
  wide,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.currentTarget === e.target) onClose();
      }}
    >
      <div
        className={[
          "max-h-[92vh] w-full overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl sm:p-6",
          wide ? "max-w-3xl" : "max-w-lg",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="text-lg font-bold tracking-tight text-zinc-900">
            {title}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 shrink-0 rounded-xl px-3 text-sm font-semibold text-zinc-600 hover:bg-zinc-100"
          >
            Close
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

async function fetchNcrsEnriched(plantId: string): Promise<NcrEnriched[]> {
  const { data: rows, error } = await supabase
    .from("ncrs")
    .select("*")
    .eq("plant_id", plantId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  const list = (rows ?? []) as NcrRecord[];

  const ids = new Set<string>();
  for (const n of list) {
    if (n.raised_by) ids.add(n.raised_by);
    if (n.assigned_to) ids.add(n.assigned_to);
    if (n.verified_by) ids.add(n.verified_by);
    if (n.acknowledged_by) ids.add(n.acknowledged_by);
  }
  const idArr = [...ids];
  let nameById = new Map<string, string | null>();
  if (idArr.length > 0) {
    const { data: profiles, error: pErr } = await supabase
      .from("user_profiles")
      .select("id,full_name")
      .in("id", idArr);
    if (pErr) throw new Error(pErr.message);
    nameById = new Map(
      (profiles ?? []).map((p: { id: string; full_name: string | null }) => [
        p.id,
        p.full_name,
      ]),
    );
  }

  const zoneIds = [...new Set(list.map((n) => n.zone_id).filter(Boolean))] as string[];
  let zoneNameById = new Map<string, string | null>();
  if (zoneIds.length > 0) {
    const { data: zs, error: zErr } = await supabase
      .from("zones")
      .select("id,name")
      .in("id", zoneIds);
    if (zErr) throw new Error(zErr.message);
    zoneNameById = new Map(
      (zs ?? []).map((z: { id: string; name: string | null }) => [z.id, z.name]),
    );
  }

  return list.map((n) => ({
    ...n,
    zone_name: n.zone_id ? zoneNameById.get(n.zone_id) ?? null : null,
    raised_by_name: n.raised_by ? nameById.get(n.raised_by) ?? null : null,
    assigned_to_name: n.assigned_to ? nameById.get(n.assigned_to) ?? null : null,
    verified_by_name: n.verified_by ? nameById.get(n.verified_by) ?? null : null,
    acknowledged_by_name: n.acknowledged_by
      ? nameById.get(n.acknowledged_by) ?? null
      : null,
  }));
}

export default function NcrBoardPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selected, setSelected] = useState<NcrEnriched | null>(null);

  const [raiseOpen, setRaiseOpen] = useState(false);
  const [raiseSaving, setRaiseSaving] = useState(false);
  const [raiseForm, setRaiseForm] = useState({
    zone_id: "",
    title: "",
    severity: "Minor",
    s_pillar: "Sort",
    notes: "",
    due_date: "",
    file: null as File | null,
  });

  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveSaving, setResolveSaving] = useState(false);
  const [resolveAfterFile, setResolveAfterFile] = useState<File | null>(null);
  const [resolveNotes, setResolveNotes] = useState("");
  const [resolvePreview, setResolvePreview] = useState<string | null>(null);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [actionSaving, setActionSaving] = useState(false);

  const refresh = useCallback(async () => {
    const profile = await getCurrentUser();
    if (!profile) {
      router.replace("/login");
      return;
    }

    if (!profile.plant_id) {
      setState({
        status: "error",
        message: "No plant assigned to your profile. Contact an administrator.",
      });
      return;
    }

    const plantId = profile.plant_id;

    const [zonesRes, ncrs] = await Promise.all([
      supabase
        .from("zones")
        .select("id,name,org_id,plant_id")
        .eq("plant_id", plantId)
        .order("name", { ascending: true }),
      fetchNcrsEnriched(plantId),
    ]);

    if (zonesRes.error) {
      setState({ status: "error", message: zonesRes.error.message });
      return;
    }

    setState({
      status: "ready",
      profile,
      ncrs,
      zones: (zonesRes.data ?? []) as ZoneOption[],
    });
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const role = state.status === "ready" ? String(state.profile.role).toLowerCase() : "";
  const canRaise = role === "admin" || role === "auditor";
  const canVerify = role === "admin" || role === "auditor";
  const canAckResolve = role === "zone_leader" || role === "supervisor";
  const canEscalate = role === "admin";

  const grouped = useMemo(() => {
    if (state.status !== "ready") return null;
    const g: Record<KanbanStatus, NcrEnriched[]> = {
      open: [],
      in_progress: [],
      resolved: [],
      closed: [],
      escalated: [],
    };
    for (const n of state.ncrs) {
      g[normalizeKanbanStatus(n.status)].push(n);
    }
    return g;
  }, [state]);

  async function awardZoneLeaderXp(
    zoneId: string | null,
    amount: number,
    plantId: string | null,
    orgId: string | null,
  ) {
    if (!zoneId) return;
    const { data: zone } = await supabase
      .from("zones")
      .select("leader_id")
      .eq("id", zoneId)
      .maybeSingle();
    const leaderId = (zone as { leader_id?: string | null } | null)?.leader_id;
    if (!leaderId || !plantId || !orgId) return;

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

  async function handleAcknowledge(ncr: NcrEnriched) {
    if (state.status !== "ready") return;
    setActionSaving(true);
    try {
      const { error } = await supabase
        .from("ncrs")
        .update({
          status: "in_progress",
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: state.profile.id,
        })
        .eq("id", ncr.id);
      if (error) throw new Error(error.message);
      setSelected(null);
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    } finally {
      setActionSaving(false);
    }
  }

  function openResolve(ncr: NcrEnriched) {
    setSelected(ncr);
    setResolveNotes("");
    setResolveAfterFile(null);
    if (resolvePreview) {
      URL.revokeObjectURL(resolvePreview);
      setResolvePreview(null);
    }
    setResolveOpen(true);
  }

  async function submitResolve(ncr: NcrEnriched) {
    if (!resolveAfterFile || !resolveNotes.trim()) {
      alert("After photo and resolution notes are required.");
      return;
    }
    if (state.status !== "ready") return;

    const zone = state.zones.find((z) => z.id === ncr.zone_id);
    const orgId = ncr.org_id ?? zone?.org_id ?? state.profile.org_id;
    const plantId = ncr.plant_id ?? state.profile.plant_id;
    if (!orgId || !ncr.zone_id) {
      alert("Missing org or zone for upload.");
      return;
    }

    setResolveSaving(true);
    try {
      const ext = extFromFile(resolveAfterFile);
      const path = `ncr/${orgId}/${ncr.zone_id}/after-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("audit-photos")
        .upload(path, resolveAfterFile, { upsert: true });
      if (upErr) throw new Error(upErr.message);

      const { data: pub } = supabase.storage.from("audit-photos").getPublicUrl(path);
      const afterUrl = pub?.publicUrl ?? null;

      const { error } = await supabase
        .from("ncrs")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
          resolution_notes: resolveNotes.trim(),
          after_photo: afterUrl,
        })
        .eq("id", ncr.id);

      if (error) throw new Error(error.message);

      setResolveOpen(false);
      setSelected(null);
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to resolve");
    } finally {
      setResolveSaving(false);
    }
  }

  async function handleVerifyClose(ncr: NcrEnriched) {
    if (state.status !== "ready") return;
    setActionSaving(true);
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
        ncr.plant_id ?? state.profile.plant_id,
        ncr.org_id ?? state.profile.org_id,
      );

      setSelected(null);
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Verify failed");
    } finally {
      setActionSaving(false);
    }
  }

  async function handleReject(ncr: NcrEnriched) {
    if (!rejectNote.trim()) {
      alert("Enter a rejection note.");
      return;
    }
    setActionSaving(true);
    try {
      const { error } = await supabase
        .from("ncrs")
        .update({
          status: "in_progress",
          rejection_note: rejectNote.trim(),
        })
        .eq("id", ncr.id);
      if (error) throw new Error(error.message);
      setRejectOpen(false);
      setRejectNote("");
      setSelected(null);
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Reject failed");
    } finally {
      setActionSaving(false);
    }
  }

  async function handleEscalate(ncr: NcrEnriched) {
    setActionSaving(true);
    try {
      const { error } = await supabase
        .from("ncrs")
        .update({
          status: "escalated",
          escalated_at: new Date().toISOString(),
        })
        .eq("id", ncr.id);
      if (error) throw new Error(error.message);
      setSelected(null);
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Escalate failed");
    } finally {
      setActionSaving(false);
    }
  }

  async function submitRaise() {
    if (state.status !== "ready") return;
    if (!raiseForm.zone_id || !raiseForm.title.trim() || !raiseForm.file) {
      alert("Zone, title, and before photo are required.");
      return;
    }

    const zone = state.zones.find((z) => z.id === raiseForm.zone_id);
    const orgId = zone?.org_id ?? state.profile.org_id;
    const plantId = state.profile.plant_id;
    if (!orgId || !plantId) {
      alert("Missing organisation or plant.");
      return;
    }

    setRaiseSaving(true);
    try {
      const ext = extFromFile(raiseForm.file);
      const path = `ncr/${orgId}/${raiseForm.zone_id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("audit-photos")
        .upload(path, raiseForm.file, { upsert: true });
      if (upErr) throw new Error(upErr.message);

      const { data: pub } = supabase.storage.from("audit-photos").getPublicUrl(path);
      const beforeUrl = pub?.publicUrl ?? null;

      const due =
        raiseForm.due_date.trim() ||
        null;

      const { error: insErr } = await supabase.from("ncrs").insert({
        plant_id: plantId,
        org_id: orgId,
        zone_id: raiseForm.zone_id,
        title: raiseForm.title.trim(),
        severity: raiseForm.severity,
        s_pillar: raiseForm.s_pillar,
        notes: raiseForm.notes.trim() || null,
        due_date: due,
        before_photo: beforeUrl,
        status: "open",
        raised_by: state.profile.id,
      });

      if (insErr) throw new Error(insErr.message);

      setRaiseOpen(false);
      setRaiseForm({
        zone_id: state.zones[0]?.id ?? "",
        title: "",
        severity: "Minor",
        s_pillar: "Sort",
        notes: "",
        due_date: "",
        file: null,
      });
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not raise NCR");
    } finally {
      setRaiseSaving(false);
    }
  }

  function timelineEntries(n: NcrEnriched): { label: string; at: string | null }[] {
    const rows: { label: string; at: string | null }[] = [
      { label: "Created", at: n.created_at },
    ];
    if (n.acknowledged_at)
      rows.push({
        label: `Acknowledged${n.acknowledged_by_name ? ` (${n.acknowledged_by_name})` : ""}`,
        at: n.acknowledged_at,
      });
    if (n.escalated_at)
      rows.push({ label: "Escalated", at: n.escalated_at });
    if (n.resolved_at)
      rows.push({ label: "Marked resolved", at: n.resolved_at });
    if (n.rejection_note)
      rows.push({
        label: `Returned with feedback`,
        at: n.verified_at ?? n.resolved_at,
      });
    if (n.verified_at)
      rows.push({
        label: `Verified${n.verified_by_name ? ` (${n.verified_by_name})` : ""}`,
        at: n.verified_at,
      });
    if (n.closed_at) rows.push({ label: "Closed", at: n.closed_at });
    return rows.filter((r) => r.at);
  }

  const shell =
    "min-h-full w-full bg-zinc-100 px-3 pb-28 pt-4 text-zinc-950 sm:px-5 sm:pb-32 sm:pt-6";

  if (state.status === "loading") {
    return (
      <div className={shell}>
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="h-10 w-56 animate-pulse rounded-xl bg-zinc-200" />
          <div className="h-40 animate-pulse rounded-2xl bg-zinc-200/80" />
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className={shell}>
        <div className="mx-auto max-w-md rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm">
          <p className="font-semibold text-rose-800">{state.message}</p>
          <Link
            href="/dashboard"
            className="mt-4 inline-flex min-h-12 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white"
          >
            Home
          </Link>
        </div>
      </div>
    );
  }

  const { profile, zones } = state;

  return (
    <div className={shell}>
      <div className="mx-auto max-w-[1600px]">
        <header className="mb-4 flex flex-col gap-3 border-b border-zinc-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
              NCR board
            </h1>
            <p className="text-sm text-zinc-600">
              {profile.plant_name ?? "Your plant"} — all non-conformances
            </p>
          </div>
          {canRaise ? (
            <button
              type="button"
              onClick={() => {
                setRaiseForm((f) => ({
                  ...f,
                  zone_id: zones[0]?.id ?? "",
                }));
                setRaiseOpen(true);
              }}
              className="min-h-12 w-full rounded-xl bg-indigo-600 px-5 text-sm font-bold text-white shadow-sm hover:bg-indigo-500 sm:w-auto"
            >
              Raise NCR
            </button>
          ) : null}
        </header>

        <div className="-mx-3 flex gap-3 overflow-x-auto pb-2 pt-1 sm:mx-0 sm:flex-wrap sm:overflow-visible">
          {COLUMNS.map((col) => (
            <div
              key={col.key}
              className="flex w-[min(85vw,320px)] shrink-0 flex-col rounded-2xl border border-zinc-200 bg-zinc-50/80 sm:min-w-[280px] sm:flex-1"
            >
              <div className="border-b border-zinc-200 bg-white px-3 py-2.5 text-sm font-bold text-zinc-800">
                {col.label}
                <span className="ml-2 font-semibold text-zinc-400 tabular-nums">
                  ({grouped?.[col.key]?.length ?? 0})
                </span>
              </div>
              <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-2 sm:max-h-[calc(100vh-220px)]">
                {(grouped?.[col.key] ?? []).map((ncr) => (
                  <button
                    key={ncr.id}
                    type="button"
                    onClick={() => setSelected(ncr)}
                    className="min-h-[120px] rounded-xl border border-zinc-200 bg-white p-3 text-left shadow-sm ring-1 ring-black/5 transition hover:border-zinc-300"
                  >
                    <div className="font-semibold leading-snug text-zinc-900">
                      {ncr.title ?? "Untitled"}
                    </div>
                    <div className="mt-1 text-xs font-medium text-zinc-500">
                      {ncr.zone_name ?? "Zone"}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${severityBadge(ncr.severity)}`}
                      >
                        {ncr.severity ?? "—"}
                      </span>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${pillarClass(ncr.s_pillar)}`}
                      >
                        {ncr.s_pillar ?? "—"}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-zinc-500">
                      {daysOpen(ncr.created_at)} days open · Raised by{" "}
                      {ncr.raised_by_name ?? "—"}
                    </div>
                    {ncr.before_photo ? (
                      <div className="mt-2 overflow-hidden rounded-lg ring-1 ring-zinc-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={ncr.before_photo}
                          alt=""
                          className="h-16 w-full object-cover"
                        />
                      </div>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail modal */}
      <Modal
        open={Boolean(selected) && !resolveOpen && !rejectOpen}
        wide
        title={selected?.title ?? "NCR"}
        onClose={() => setSelected(null)}
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <span
                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${severityBadge(selected.severity)}`}
              >
                {selected.severity ?? "—"}
              </span>
              <span
                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${pillarClass(selected.s_pillar)}`}
              >
                {selected.s_pillar}
              </span>
              <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200">
                {normalizeKanbanStatus(selected.status)}
              </span>
            </div>

            <div className="grid gap-2 text-sm">
              <div>
                <span className="font-semibold text-zinc-600">Zone:</span>{" "}
                {selected.zone_name ?? "—"}
              </div>
              <div>
                <span className="font-semibold text-zinc-600">Days open:</span>{" "}
                {daysOpen(selected.created_at)}
              </div>
              <div>
                <span className="font-semibold text-zinc-600">Raised by:</span>{" "}
                {selected.raised_by_name ?? "—"}
              </div>
              {selected.due_date ? (
                <div>
                  <span className="font-semibold text-zinc-600">Due:</span>{" "}
                  {selected.due_date}
                </div>
              ) : null}
              {selected.notes ? (
                <div className="rounded-xl bg-zinc-50 p-3 text-zinc-800">
                  <div className="text-xs font-semibold uppercase text-zinc-500">
                    Notes
                  </div>
                  <div className="mt-1 whitespace-pre-wrap">{selected.notes}</div>
                </div>
              ) : null}
            </div>

            {selected.before_photo ? (
              <div>
                <div className="text-xs font-semibold uppercase text-zinc-500">
                  Before
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selected.before_photo}
                  alt="Before"
                  className="mt-1 max-h-96 w-full rounded-xl object-contain ring-1 ring-zinc-200"
                />
              </div>
            ) : null}

            {selected.after_photo ? (
              <div>
                <div className="text-xs font-semibold uppercase text-zinc-500">
                  After
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selected.after_photo}
                  alt="After"
                  className="mt-1 max-h-96 w-full rounded-xl object-contain ring-1 ring-zinc-200"
                />
              </div>
            ) : null}

            {selected.resolution_notes ? (
              <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-950 ring-1 ring-emerald-100">
                <div className="text-xs font-semibold uppercase">Resolution</div>
                <p className="mt-1 whitespace-pre-wrap">{selected.resolution_notes}</p>
              </div>
            ) : null}

            {selected.rejection_note ? (
              <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-900 ring-1 ring-rose-100">
                <div className="text-xs font-semibold uppercase">Rejection note</div>
                <p className="mt-1 whitespace-pre-wrap">{selected.rejection_note}</p>
              </div>
            ) : null}

            <div>
              <div className="text-xs font-semibold uppercase text-zinc-500">
                Timeline
              </div>
              <ul className="mt-2 space-y-2 border-l-2 border-zinc-200 pl-3">
                {timelineEntries(selected).map((ev, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-semibold text-zinc-800">{ev.label}</span>
                    <span className="text-zinc-500"> — {formatTs(ev.at)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-2 border-t border-zinc-100 pt-4 sm:flex-row sm:flex-wrap">
              {canAckResolve &&
              normalizeKanbanStatus(selected.status) === "open" ? (
                <button
                  type="button"
                  disabled={actionSaving}
                  onClick={() => void handleAcknowledge(selected)}
                  className="min-h-12 flex-1 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  Acknowledge
                </button>
              ) : null}

              {canAckResolve &&
              normalizeKanbanStatus(selected.status) === "in_progress" ? (
                <button
                  type="button"
                  disabled={actionSaving}
                  onClick={() => openResolve(selected)}
                  className="min-h-12 flex-1 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  Mark as Resolved
                </button>
              ) : null}

              {canVerify &&
              normalizeKanbanStatus(selected.status) === "resolved" ? (
                <>
                  <button
                    type="button"
                    disabled={actionSaving}
                    onClick={() => void handleVerifyClose(selected)}
                    className="min-h-12 flex-1 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    Verify &amp; Close
                  </button>
                  <button
                    type="button"
                    disabled={actionSaving}
                    onClick={() => {
                      setRejectOpen(true);
                    }}
                    className="min-h-12 flex-1 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </>
              ) : null}

              {canEscalate &&
              (normalizeKanbanStatus(selected.status) === "open" ||
                normalizeKanbanStatus(selected.status) === "in_progress") ? (
                <button
                  type="button"
                  disabled={actionSaving}
                  onClick={() => void handleEscalate(selected)}
                  className="min-h-12 flex-1 rounded-xl border-2 border-amber-400 bg-amber-50 px-4 text-sm font-bold text-amber-950 hover:bg-amber-100 disabled:opacity-50"
                >
                  Escalate
                </button>
              ) : null}
            </div>

            <Link
              href={getRoleHomeRoute(profile.role)}
              className="mt-2 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-zinc-200 bg-white text-sm font-semibold text-zinc-900"
            >
              Back to home
            </Link>
          </div>
        ) : null}
      </Modal>

      {/* Resolve sub-flow */}
      <Modal
        open={resolveOpen && !!selected}
        title="Mark as resolved"
        onClose={() => {
          setResolveOpen(false);
          if (resolvePreview) URL.revokeObjectURL(resolvePreview);
          setResolvePreview(null);
        }}
      >
        {selected ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-600">
              Upload an after photo and enter resolution notes (required).
            </p>
            <input
              type="file"
              accept="image/*"
              className="block w-full text-sm file:min-h-12 file:rounded-xl file:border-0 file:bg-zinc-900 file:px-4 file:font-semibold file:text-white"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setResolveAfterFile(f);
                setResolvePreview((prev) => {
                  if (prev) URL.revokeObjectURL(prev);
                  return f ? URL.createObjectURL(f) : null;
                });
              }}
            />
            {resolvePreview ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={resolvePreview}
                alt="Preview"
                className="max-h-48 w-full rounded-xl object-contain ring-1 ring-zinc-200"
              />
            ) : null}
            <textarea
              value={resolveNotes}
              onChange={(e) => setResolveNotes(e.target.value)}
              placeholder="Resolution notes"
              rows={4}
              className="min-h-[120px] w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={resolveSaving}
              onClick={() => void submitResolve(selected)}
              className="min-h-12 w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {resolveSaving ? "Saving…" : "Submit resolution"}
            </button>
          </div>
        ) : null}
      </Modal>

      {/* Reject */}
      <Modal
        open={rejectOpen && !!selected}
        title="Reject verification"
        onClose={() => setRejectOpen(false)}
      >
        <textarea
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
          placeholder="Rejection note (required)"
          rows={4}
          className="min-h-[120px] w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={actionSaving || !selected}
          onClick={() => selected && void handleReject(selected)}
          className="mt-4 min-h-12 w-full rounded-xl bg-rose-600 py-3 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-50"
        >
          Confirm reject
        </button>
      </Modal>

      {/* Raise NCR */}
      <Modal
        open={raiseOpen}
        title="Raise NCR"
        wide
        onClose={() => !raiseSaving && setRaiseOpen(false)}
      >
        <div className="grid gap-4">
          <div>
            <label className="text-sm font-semibold text-zinc-700">Zone</label>
            <select
              value={raiseForm.zone_id}
              onChange={(e) =>
                setRaiseForm((s) => ({ ...s, zone_id: e.target.value }))
              }
              className="mt-1 min-h-12 w-full rounded-xl border border-zinc-200 px-3 text-sm font-semibold"
            >
              <option value="">Select zone</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name ?? z.id}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-semibold text-zinc-700">Title</label>
            <input
              value={raiseForm.title}
              onChange={(e) =>
                setRaiseForm((s) => ({ ...s, title: e.target.value }))
              }
              className="mt-1 min-h-12 w-full rounded-xl border border-zinc-200 px-3 text-sm"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-semibold text-zinc-700">
                Severity
              </label>
              <select
                value={raiseForm.severity}
                onChange={(e) =>
                  setRaiseForm((s) => ({ ...s, severity: e.target.value }))
                }
                className="mt-1 min-h-12 w-full rounded-xl border border-zinc-200 px-3 text-sm font-semibold"
              >
                <option value="Minor">Minor</option>
                <option value="Major">Major</option>
                <option value="Critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-zinc-700">
                S pillar
              </label>
              <select
                value={raiseForm.s_pillar}
                onChange={(e) =>
                  setRaiseForm((s) => ({ ...s, s_pillar: e.target.value }))
                }
                className="mt-1 min-h-12 w-full rounded-xl border border-zinc-200 px-3 text-sm font-semibold"
              >
                {[
                  "Sort",
                  "Set",
                  "Shine",
                  "Standardise",
                  "Sustain",
                  "Safety",
                ].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-sm font-semibold text-zinc-700">Notes</label>
            <textarea
              value={raiseForm.notes}
              onChange={(e) =>
                setRaiseForm((s) => ({ ...s, notes: e.target.value }))
              }
              rows={3}
              className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-zinc-700">
              Due date
            </label>
            <input
              type="date"
              value={raiseForm.due_date}
              onChange={(e) =>
                setRaiseForm((s) => ({ ...s, due_date: e.target.value }))
              }
              className="mt-1 min-h-12 w-full rounded-xl border border-zinc-200 px-3 text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-zinc-700">
              Before photo (required)
            </label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="mt-1 block w-full text-sm file:min-h-12 file:rounded-xl file:border-0 file:bg-zinc-900 file:px-4 file:font-semibold file:text-white"
              onChange={(e) =>
                setRaiseForm((s) => ({
                  ...s,
                  file: e.target.files?.[0] ?? null,
                }))
              }
            />
          </div>
          <button
            type="button"
            disabled={raiseSaving}
            onClick={() => void submitRaise()}
            className="min-h-12 w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {raiseSaving ? "Submitting…" : "Submit NCR"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
