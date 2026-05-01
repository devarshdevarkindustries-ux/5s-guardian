"use client";

import { useEffect, useMemo, useState } from "react";
import supabase from "@/lib/supabase";

type ZoneLeader = {
  id: string;
  name: string | null;
  zone_id: string | null;
  zones?: { name: string | null } | { name: string | null }[] | null;
};

type NcrRow = {
  id: string;
  zone_id: string | null;
  raised_by: string | null;
  title: string | null;
  severity: string | null;
  s_pillar: string | null;
  status: string | null;
  assigned_to: string | null;
  due_date: string | null;
  before_photo: string | null;
  after_photo: string | null;
  created_at: string | null;
};

type NcrLocal = NcrRow & {
  __localNotes?: string | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; leader: ZoneLeader; ncrs: NcrLocal[] };

type ColumnKey = "open" | "in_progress" | "closed";

const COLUMN_LABELS: Record<ColumnKey, string> = {
  open: "Open",
  in_progress: "In Progress",
  closed: "Closed",
};

function getZoneName(leader: ZoneLeader) {
  const zones = leader.zones;
  if (!zones) return null;
  if (Array.isArray(zones)) return zones[0]?.name ?? null;
  return zones.name ?? null;
}

function normalizeStatus(status: string | null): ColumnKey {
  const s = (status ?? "open").toLowerCase();
  if (s === "in progress" || s === "in_progress" || s === "progress")
    return "in_progress";
  if (s === "closed" || s === "done") return "closed";
  return "open";
}

function daysSince(iso: string | null) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  const now = Date.now();
  const days = Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
  return days;
}

function severityClass(sev: string | null) {
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

function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.currentTarget === e.target) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="text-lg font-semibold tracking-tight">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-12 items-center justify-center rounded-xl px-3 text-sm font-semibold text-zinc-600 hover:bg-zinc-50"
          >
            Close
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-sm font-semibold text-zinc-700">{children}</div>;
}

export default function NcrBoardPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [selected, setSelected] = useState<NcrLocal | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    title: "",
    severity: "Major",
    s_pillar: "Sort",
    notes: "",
  });

  async function refresh() {
    const { data: leader, error: leaderError } = await supabase
      .from("zone_leaders")
      .select("id,name,zone_id,zones(name)")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

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

    const { data: ncrs, error: ncrError } = await supabase
      .from("ncrs")
      .select(
        "id,zone_id,raised_by,title,severity,s_pillar,status,assigned_to,due_date,before_photo,after_photo,created_at",
      )
      .order("created_at", { ascending: false });

    if (ncrError) {
      setState({ status: "error", message: ncrError.message });
      return;
    }

    setState({ status: "ready", leader: leader as ZoneLeader, ncrs: (ncrs ?? []) as NcrLocal[] });
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns = useMemo(() => {
    if (state.status !== "ready") return null;
    const grouped: Record<ColumnKey, NcrLocal[]> = {
      open: [],
      in_progress: [],
      closed: [],
    };
    for (const n of state.ncrs) grouped[normalizeStatus(n.status)].push(n);
    return grouped;
  }, [state]);

  const zoneName =
    state.status === "ready" ? getZoneName(state.leader) : null;

  async function raiseNcr() {
    if (state.status !== "ready") return;
    if (!form.title.trim()) return;

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("ncrs")
        .insert({
          zone_id: state.leader.zone_id,
          raised_by: state.leader.id,
          title: form.title.trim(),
          severity: form.severity,
          s_pillar: form.s_pillar,
          status: "open",
        })
        .select(
          "id,zone_id,raised_by,title,severity,s_pillar,status,assigned_to,due_date,before_photo,after_photo,created_at",
        )
        .single();

      if (error) throw new Error(error.message);

      const inserted = { ...(data as NcrLocal), __localNotes: form.notes || null };
      setState((s) => {
        if (s.status !== "ready") return s;
        return { ...s, ncrs: [inserted, ...s.ncrs] };
      });

      setRaiseOpen(false);
      setForm({ title: "", severity: "Major", s_pillar: "Sort", notes: "" });
    } catch (e) {
      setState({
        status: "error",
        message: e instanceof Error ? e.message : "Failed to raise NCR.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(ncrId: string, status: ColumnKey) {
    const nextStatus = status === "in_progress" ? "in_progress" : status;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("ncrs")
        .update({ status: nextStatus })
        .eq("id", ncrId);
      if (error) throw new Error(error.message);

      setState((s) => {
        if (s.status !== "ready") return s;
        return {
          ...s,
          ncrs: s.ncrs.map((n) => (n.id === ncrId ? { ...n, status: nextStatus } : n)),
        };
      });
      setSelected((cur) => (cur && cur.id === ncrId ? { ...cur, status: nextStatus } : cur));
    } catch (e) {
      setState({
        status: "error",
        message: e instanceof Error ? e.message : "Failed to update NCR.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-100 px-4 py-6 text-zinc-950 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-2xl font-semibold tracking-tight">NCR Board</div>
            <div className="mt-1 text-sm text-zinc-600">
              {zoneName ? <>Zone: <span className="font-semibold">{zoneName}</span></> : "Track and close nonconformances."}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setRaiseOpen(true)}
            className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-blue-600 px-5 text-base font-semibold text-white shadow-sm transition hover:bg-blue-500 active:scale-[0.99]"
          >
            Raise New NCR
          </button>
        </div>

        {state.status === "loading" ? (
          <div className="mt-6 rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
            <div className="h-5 w-40 animate-pulse rounded bg-zinc-200" />
            <div className="mt-4 h-24 animate-pulse rounded-2xl bg-zinc-200" />
          </div>
        ) : state.status === "error" ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
            <div className="text-lg font-semibold text-rose-700">Error</div>
            <div className="mt-2 text-sm text-rose-700">{state.message}</div>
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-5 inline-flex min-h-12 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {(["open", "in_progress", "closed"] as ColumnKey[]).map((key) => {
              const list = columns?.[key] ?? [];
              return (
                <div
                  key={key}
                  className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm sm:p-5"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-zinc-700">
                      {COLUMN_LABELS[key]}
                    </div>
                    <div className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700">
                      {list.length}
                    </div>
                  </div>

                  <div className="mt-3 space-y-3">
                    {list.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-500">
                        No NCRs yet
                      </div>
                    ) : (
                      list.map((ncr) => {
                        const createdDays = daysSince(ncr.created_at);
                        return (
                          <button
                            key={ncr.id}
                            type="button"
                            onClick={() => setSelected(ncr)}
                            className="w-full rounded-2xl border border-zinc-200 bg-white p-4 text-left shadow-sm transition hover:bg-zinc-50 active:scale-[0.99]"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-base font-semibold text-zinc-900">
                                  {ncr.title ?? "Untitled NCR"}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                  <span
                                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${severityClass(
                                      ncr.severity,
                                    )}`}
                                  >
                                    {ncr.severity ?? "Minor"}
                                  </span>
                                  <span
                                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${pillarTagClass(
                                      ncr.s_pillar,
                                    )}`}
                                  >
                                    {ncr.s_pillar ?? "—"}
                                  </span>
                                </div>
                              </div>
                              <div className="text-xs font-semibold text-zinc-500">
                                {createdDays === null
                                  ? "—"
                                  : `${createdDays}d`}
                              </div>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal open={raiseOpen} title="Raise New NCR" onClose={() => setRaiseOpen(false)}>
        <div className="space-y-4">
          <div>
            <FieldLabel>Title</FieldLabel>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-blue-500"
              placeholder="e.g. Oil spill near press #2"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>Severity</FieldLabel>
              <select
                value={form.severity}
                onChange={(e) =>
                  setForm((f) => ({ ...f, severity: e.target.value }))
                }
                className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-blue-500"
              >
                <option>Minor</option>
                <option>Major</option>
                <option>Critical</option>
              </select>
            </div>

            <div>
              <FieldLabel>S Pillar</FieldLabel>
              <select
                value={form.s_pillar}
                onChange={(e) =>
                  setForm((f) => ({ ...f, s_pillar: e.target.value }))
                }
                className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-blue-500"
              >
                <option>Sort</option>
                <option>Set</option>
                <option>Shine</option>
                <option>Standardise</option>
                <option>Sustain</option>
                <option>Safety</option>
              </select>
            </div>
          </div>

          <div>
            <FieldLabel>Notes (optional)</FieldLabel>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="mt-1 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm outline-none focus:border-blue-500"
              rows={4}
              placeholder="Context, location, immediate containment action…"
            />
            <div className="mt-2 text-xs text-zinc-500">
              Notes aren&apos;t stored yet unless you add a `notes` column in the `ncrs` table.
            </div>
          </div>

          <button
            type="button"
            disabled={saving || !form.title.trim()}
            onClick={() => void raiseNcr()}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-blue-600 px-5 text-base font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:opacity-50 active:scale-[0.99]"
          >
            {saving ? "Saving…" : "Submit"}
          </button>
        </div>
      </Modal>

      <Modal open={selected != null} title="NCR Details" onClose={() => setSelected(null)}>
        {selected && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="text-lg font-semibold">{selected.title ?? "Untitled NCR"}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${severityClass(
                    selected.severity,
                  )}`}
                >
                  {selected.severity ?? "Minor"}
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${pillarTagClass(
                    selected.s_pillar,
                  )}`}
                >
                  {selected.s_pillar ?? "—"}
                </span>
                <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700">
                  {COLUMN_LABELS[normalizeStatus(selected.status)]}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold text-zinc-500">Created</div>
                  <div className="mt-0.5 font-semibold text-zinc-900">
                    {selected.created_at ? new Date(selected.created_at).toLocaleString() : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-zinc-500">Days open</div>
                  <div className="mt-0.5 font-semibold text-zinc-900">
                    {daysSince(selected.created_at) ?? "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-zinc-500">Due date</div>
                  <div className="mt-0.5 font-semibold text-zinc-900">
                    {selected.due_date ?? "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-zinc-500">Assigned to</div>
                  <div className="mt-0.5 font-semibold text-zinc-900">
                    {selected.assigned_to ?? "—"}
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <div className="text-xs font-semibold text-zinc-500">Notes</div>
                <div className="mt-1 rounded-xl bg-zinc-50 px-3 py-3 text-sm text-zinc-800">
                  {selected.__localNotes ?? "—"}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={saving || normalizeStatus(selected.status) !== "open"}
                onClick={() => void updateStatus(selected.id, "in_progress")}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-zinc-200 bg-white px-5 text-base font-semibold text-zinc-900 shadow-sm transition hover:bg-zinc-50 disabled:opacity-50"
              >
                Mark In Progress
              </button>
              <button
                type="button"
                disabled={saving || normalizeStatus(selected.status) === "closed"}
                onClick={() => void updateStatus(selected.id, "closed")}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-zinc-900 px-5 text-base font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-50"
              >
                Mark Closed
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

