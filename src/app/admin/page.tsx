"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import supabase from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";

type ZoneRow = {
  id: string;
  name: string | null;
  department: string | null;
  audit_frequency: string | null;
  leader_id: string | null;
  org_id: string | null;
  plant_id: string | null;
  created_at: string | null;
};

type UserProfileRow = {
  id: string;
  full_name: string | null;
  role: "super_admin" | "admin" | "auditor" | "zone_leader" | "supervisor" | string;
  org_id: string | null;
  plant_id: string | null;
  is_active: boolean | null;
  created_at: string | null;
};

type AuditSessionRow = {
  id: string | null;
  zone_id: string | null;
  plant_id: string | null;
  score: number | null;
  created_at: string | null;
  completed_at: string | null;
};

type NcrRow = {
  id: string;
  plant_id: string | null;
  zone_id: string | null;
  status: string | null;
  created_at: string | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      profile: {
        id: string;
        full_name: string | null;
        role: string;
        org_id: string;
        plant_id: string;
        org_name: string | null;
        plant_name: string | null;
      };
      stats: {
        zones: number;
        users: number;
        auditsThisWeek: number;
        openNcrs: number;
      };
      zones: ZoneRow[];
      users: UserProfileRow[];
      recentAudits: AuditSessionRow[];
      openNcrs: NcrRow[];
    };

type ZoneForm = {
  name: string;
  department: string;
  audit_frequency: "daily" | "weekly" | "fortnightly" | "monthly";
  leader_id: string | "";
};

type AddUserForm = {
  full_name: string;
  email: string;
  role: "auditor" | "zone_leader" | "supervisor";
  zone_id: string | "";
};

function startOfWeekLocal(d = new Date()) {
  const date = new Date(d);
  const day = date.getDay(); // 0..6 (Sun..Sat)
  const diff = (day + 6) % 7; // days since Monday
  date.setDate(date.getDate() - diff);
  date.setHours(0, 0, 0, 0);
  return date;
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

function freqBadge(freq: string | null) {
  const f = (freq ?? "daily").toLowerCase();
  if (f === "weekly") return "bg-blue-50 text-blue-700 ring-blue-200";
  if (f === "fortnightly") return "bg-purple-50 text-purple-700 ring-purple-200";
  if (f === "monthly") return "bg-amber-50 text-amber-800 ring-amber-200";
  return "bg-emerald-50 text-emerald-700 ring-emerald-200";
}

function scoreColor(score: number | null) {
  if (score == null || Number.isNaN(score)) return "text-zinc-400";
  if (score >= 80) return "text-emerald-600";
  if (score >= 60) return "text-amber-600";
  return "text-rose-600";
}

function roleBadgeClass(role: string) {
  switch (role) {
    case "admin":
      return "bg-purple-50 text-purple-700 ring-purple-200";
    case "auditor":
      return "bg-amber-50 text-amber-800 ring-amber-200";
    case "zone_leader":
      return "bg-teal-50 text-teal-700 ring-teal-200";
    case "supervisor":
      return "bg-rose-50 text-rose-700 ring-rose-200";
    default:
      return "bg-zinc-100 text-zinc-700 ring-zinc-200";
  }
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.currentTarget === e.target) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="text-lg font-semibold tracking-tight text-zinc-900">
            {title}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 items-center justify-center rounded-xl px-3 text-sm font-semibold text-zinc-600 hover:bg-zinc-50"
          >
            Close
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const [zoneAddOpen, setZoneAddOpen] = useState(false);
  const [zoneEditOpen, setZoneEditOpen] = useState(false);
  const [zoneEditing, setZoneEditing] = useState<ZoneRow | null>(null);
  const [zoneForm, setZoneForm] = useState<ZoneForm>({
    name: "",
    department: "",
    audit_frequency: "daily",
    leader_id: "",
  });
  const [savingZone, setSavingZone] = useState(false);

  const [userAddOpen, setUserAddOpen] = useState(false);
  const [userForm, setUserForm] = useState<AddUserForm>({
    full_name: "",
    email: "",
    role: "auditor",
    zone_id: "",
  });
  const [savingUser, setSavingUser] = useState(false);

  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await getCurrentUser();
      if (!user || user.role !== "admin") {
        router.replace("/unauthorized");
        return;
      }
      if (!user.org_id || !user.plant_id) {
        setState({
          status: "error",
          message: "Your admin account is missing org_id or plant_id.",
        });
        return;
      }

      const plantId = user.plant_id;
      const weekStart = startOfWeekLocal().toISOString();

      const [
        zonesCount,
        usersCount,
        auditsCount,
        ncrCount,
        zonesRes,
        usersRes,
        auditsRes,
        ncrsRes,
      ] = await Promise.all([
        supabase
          .from("zones")
          .select("id", { count: "exact", head: true })
          .eq("plant_id", plantId),
        supabase
          .from("user_profiles")
          .select("id", { count: "exact", head: true })
          .eq("plant_id", plantId),
        supabase
          .from("audit_sessions")
          .select("id", { count: "exact", head: true })
          .eq("plant_id", plantId)
          .gte("created_at", weekStart),
        supabase
          .from("ncrs")
          .select("id", { count: "exact", head: true })
          .eq("plant_id", plantId)
          .eq("status", "open"),
        supabase
          .from("zones")
          .select(
            "id,name,department,audit_frequency,leader_id,org_id,plant_id,created_at",
          )
          .eq("plant_id", plantId)
          .order("name", { ascending: true }),
        supabase
          .from("user_profiles")
          .select("id,full_name,role,org_id,plant_id,is_active,created_at")
          .eq("plant_id", plantId)
          .order("created_at", { ascending: false }),
        supabase
          .from("audit_sessions")
          .select("id,zone_id,plant_id,score,created_at,completed_at")
          .eq("plant_id", plantId)
          .order("completed_at", { ascending: false, nullsFirst: false })
          .limit(800),
        supabase
          .from("ncrs")
          .select("id,plant_id,zone_id,status,created_at")
          .eq("plant_id", plantId)
          .eq("status", "open")
          .order("created_at", { ascending: false }),
      ]);

      if (cancelled) return;

      const firstErr =
        zonesCount.error ??
        usersCount.error ??
        auditsCount.error ??
        ncrCount.error ??
        zonesRes.error ??
        usersRes.error ??
        auditsRes.error ??
        ncrsRes.error;

      if (firstErr) {
        setState({ status: "error", message: firstErr.message });
        return;
      }

      setState({
        status: "ready",
        profile: {
          id: user.id,
          full_name: user.full_name,
          role: user.role,
          org_id: user.org_id,
          plant_id: user.plant_id,
          org_name: user.org_name,
          plant_name: user.plant_name,
        },
        stats: {
          zones: zonesCount.count ?? 0,
          users: usersCount.count ?? 0,
          auditsThisWeek: auditsCount.count ?? 0,
          openNcrs: ncrCount.count ?? 0,
        },
        zones: (zonesRes.data ?? []) as ZoneRow[],
        users: (usersRes.data ?? []) as UserProfileRow[],
        recentAudits: (auditsRes.data ?? []) as AuditSessionRow[],
        openNcrs: (ncrsRes.data ?? []) as NcrRow[],
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const derived = useMemo(() => {
    if (state.status !== "ready") return null;

    const leaderNameById = new Map(
      state.users.map((u) => [u.id, u.full_name ?? "Unnamed"] as const),
    );

    const latestAuditByZone = new Map<
      string,
      { score: number | null; at: string | null }
    >();
    const sortedAudits = [...state.recentAudits].sort((a, b) => {
      const ta = Math.max(
        a.completed_at ? new Date(a.completed_at).getTime() : 0,
        a.created_at ? new Date(a.created_at).getTime() : 0,
      );
      const tb = Math.max(
        b.completed_at ? new Date(b.completed_at).getTime() : 0,
        b.created_at ? new Date(b.created_at).getTime() : 0,
      );
      return tb - ta;
    });
    for (const a of sortedAudits) {
      if (!a.zone_id) continue;
      if (latestAuditByZone.has(a.zone_id)) continue;
      latestAuditByZone.set(a.zone_id, {
        score: a.score ?? null,
        at: a.completed_at ?? a.created_at,
      });
    }

    const zoneNameById = new Map(
      state.zones.map((z) => [z.id, z.name ?? "Unnamed zone"] as const),
    );

    const zoneByLeaderId = new Map<string, ZoneRow>();
    for (const z of state.zones) {
      if (z.leader_id) zoneByLeaderId.set(z.leader_id, z);
    }

    const zoneLeaders = state.users
      .filter((u) => (u.role ?? "").toLowerCase() === "zone_leader")
      .map((u) => ({ id: u.id, name: u.full_name ?? "Zone leader" }));

    return {
      leaderNameById,
      latestAuditByZone,
      zoneNameById,
      zoneByLeaderId,
      zoneLeaders,
    };
  }, [state]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  async function toggleUserActive(userId: string, current: boolean) {
    if (state.status !== "ready") return;
    setState((s) => {
      if (s.status !== "ready") return s;
      return {
        ...s,
        users: s.users.map((u) =>
          u.id === userId ? { ...u, is_active: !current } : u,
        ),
      };
    });
    const { error } = await supabase
      .from("user_profiles")
      .update({ is_active: !current })
      .eq("id", userId);
    if (error) {
      setBanner(error.message);
    }
  }

  function openAddZone() {
    setZoneEditing(null);
    setZoneForm({ name: "", department: "", audit_frequency: "daily", leader_id: "" });
    setZoneAddOpen(true);
  }

  function openEditZone(z: ZoneRow) {
    setZoneEditing(z);
    setZoneForm({
      name: z.name ?? "",
      department: z.department ?? "",
      audit_frequency: ((z.audit_frequency ?? "daily").toLowerCase() as ZoneForm["audit_frequency"]) ?? "daily",
      leader_id: z.leader_id ?? "",
    });
    setZoneEditOpen(true);
  }

  async function saveZone(mode: "add" | "edit") {
    if (state.status !== "ready") return;
    if (!zoneForm.name.trim()) return;

    setSavingZone(true);
    try {
      if (mode === "add") {
        const insert = {
          name: zoneForm.name.trim(),
          department: zoneForm.department.trim() || null,
          audit_frequency: zoneForm.audit_frequency,
          leader_id: zoneForm.leader_id || null,
          org_id: state.profile.org_id,
          plant_id: state.profile.plant_id,
        };

        const { data, error } = await supabase
          .from("zones")
          .insert(insert)
          .select("id,name,department,audit_frequency,leader_id,org_id,plant_id,created_at")
          .single();
        if (error) throw new Error(error.message);

        setState((s) => {
          if (s.status !== "ready") return s;
          return { ...s, zones: [...s.zones, data as ZoneRow].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")), stats: { ...s.stats, zones: s.stats.zones + 1 } };
        });
        setZoneAddOpen(false);
        setBanner(`Zone added: ${insert.name}`);
      } else if (mode === "edit" && zoneEditing) {
        const update = {
          name: zoneForm.name.trim(),
          department: zoneForm.department.trim() || null,
          audit_frequency: zoneForm.audit_frequency,
          leader_id: zoneForm.leader_id || null,
        };
        const { error } = await supabase.from("zones").update(update).eq("id", zoneEditing.id);
        if (error) throw new Error(error.message);
        setState((s) => {
          if (s.status !== "ready") return s;
          return {
            ...s,
            zones: s.zones
              .map((z) => (z.id === zoneEditing.id ? { ...z, ...update } : z))
              .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
          };
        });
        setZoneEditOpen(false);
        setBanner(`Zone updated: ${update.name}`);
      }
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Failed to save zone.");
    } finally {
      setSavingZone(false);
    }
  }

  async function addUser() {
    if (state.status !== "ready") return;
    if (!userForm.email.trim()) return;
    if (!userForm.full_name.trim()) return;
    if (userForm.role === "zone_leader" && !userForm.zone_id) return;

    setSavingUser(true);
    try {
      const email = userForm.email.trim().toLowerCase();

      const invitePayload: Record<string, string | null> = {
        email,
        full_name: userForm.full_name.trim(),
        role: userForm.role,
        org_id: state.profile.org_id,
        plant_id: state.profile.plant_id,
      };
      if (userForm.role === "zone_leader" && userForm.zone_id) {
        invitePayload.zone_id = userForm.zone_id;
      }

      const { error: inviteErr } = await supabase.from("pending_invites").insert(invitePayload);
      if (inviteErr) throw new Error(inviteErr.message);

      console.log("Sending OTP to:", email);
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/onboarding`,
          shouldCreateUser: true,
        },
      });
      if (otpError) {
        console.error("OTP error:", otpError);
        setBanner(`Failed to send invite: ${otpError.message}`);
        return;
      }

      setBanner(`Invite sent to ${email}`);
      setUserAddOpen(false);
      setUserForm({ full_name: "", email: "", role: "auditor", zone_id: "" });
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Failed to add user.");
    } finally {
      setSavingUser(false);
    }
  }

  const shell =
    "min-h-screen w-full bg-gradient-to-b from-zinc-100 to-zinc-200/80 px-4 py-6 text-zinc-950 sm:px-6 sm:py-10";

  if (state.status === "loading") {
    return (
      <div className={shell}>
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="h-10 w-72 animate-pulse rounded-lg bg-zinc-300/80" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-white/80 shadow-sm" />
            ))}
          </div>
          <div className="h-64 animate-pulse rounded-2xl bg-white/60" />
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className={shell}>
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
  const plantTitle = state.profile.plant_name ?? "Plant";
  const orgTitle = state.profile.org_name ?? "Organisation";

  return (
    <div className={shell}>
      <div className="mx-auto max-w-7xl space-y-8">
        {/* SECTION 1 — Header */}
        <header className="flex flex-col gap-4 border-b border-zinc-200/80 pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
              {plantTitle} — Admin Dashboard
            </h1>
            <p className="mt-1 text-sm font-semibold text-zinc-600">{orgTitle}</p>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50 active:scale-[0.99]"
          >
            Logout
          </button>
        </header>

        {banner && (
          <div className="flex items-start justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm" role="status">
            <span className="font-medium">{banner}</span>
            <button type="button" onClick={() => setBanner(null)} className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50">
              Dismiss
            </button>
          </div>
        )}

        {/* SECTION 2 — Stats row */}
        <section aria-label="Stats">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-white/80 bg-white p-5 shadow-sm ring-1 ring-black/5">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Total zones</div>
              <div className="mt-2 text-3xl font-bold tabular-nums text-zinc-900">{state.stats.zones}</div>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white p-5 shadow-sm ring-1 ring-black/5">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Total users</div>
              <div className="mt-2 text-3xl font-bold tabular-nums text-zinc-900">{state.stats.users}</div>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white p-5 shadow-sm ring-1 ring-black/5">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Audits this week</div>
              <div className="mt-2 text-3xl font-bold tabular-nums text-blue-700">{state.stats.auditsThisWeek}</div>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white p-5 shadow-sm ring-1 ring-black/5">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Open NCRs</div>
              <div className="mt-2 text-3xl font-bold tabular-nums text-amber-700">{state.stats.openNcrs}</div>
            </div>
          </div>
        </section>

        {/* SECTION 3 — Zone Management */}
        <section aria-label="Zones">
          <div className="mb-4 flex items-end justify-between gap-2">
            <h2 className="text-lg font-semibold text-zinc-900">Zones</h2>
            <button
              type="button"
              onClick={openAddZone}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 active:scale-[0.99]"
            >
              Add Zone
            </button>
          </div>

          {state.zones.length === 0 ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-600">
              No zones yet. Add your first zone to get started.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {state.zones.map((z) => {
                const leaderName = z.leader_id ? d.leaderNameById.get(z.leader_id) : null;
                const latest = d.latestAuditByZone.get(z.id) ?? null;
                const lastAt = latest?.at ?? null;
                const dueIso = nextDueFromFrequency(lastAt, z.audit_frequency);
                return (
                  <div key={z.id} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-base font-bold text-zinc-900">{z.name ?? "Unnamed zone"}</div>
                        <div className="mt-0.5 text-sm text-zinc-600">{z.department ?? "No department"}</div>
                      </div>
                      <div className={`text-2xl font-bold tabular-nums ${scoreColor(latest?.score ?? null)}`}>
                        {latest?.score == null ? "—" : Math.round(Number(latest.score))}
                        {latest?.score != null && <span className="text-sm font-semibold text-zinc-400">/100</span>}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${freqBadge(z.audit_frequency)}`}>
                        {(z.audit_frequency ?? "daily").toLowerCase()}
                      </span>
                      <span className="inline-flex rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200">
                        Leader: {leaderName ?? "Unassigned"}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 border-t border-zinc-100 pt-4 text-xs">
                      <div>
                        <div className="font-semibold text-zinc-600">Last audit</div>
                        <div className="mt-0.5 font-medium text-zinc-900">{formatDate(lastAt)}</div>
                      </div>
                      <div>
                        <div className="font-semibold text-zinc-600">Next due</div>
                        <div className="mt-0.5 font-medium text-zinc-900">{formatDate(dueIso)}</div>
                      </div>
                    </div>

                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        onClick={() => openEditZone(z)}
                        className="inline-flex min-h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* SECTION 4 — User Management */}
        <section aria-label="Team">
          <div className="mb-4 flex items-end justify-between gap-2">
            <h2 className="text-lg font-semibold text-zinc-900">Team</h2>
            <button
              type="button"
              onClick={() => setUserAddOpen(true)}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 active:scale-[0.99]"
            >
              Add User
            </button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Zone</th>
                    <th className="px-4 py-3">Active</th>
                    <th className="px-4 py-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {state.users.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                        No users found for this plant.
                      </td>
                    </tr>
                  ) : (
                    state.users.map((u) => {
                      const role = (u.role ?? "unknown").toLowerCase();
                      const zone =
                        role === "zone_leader"
                          ? d.zoneByLeaderId.get(u.id)?.name ?? "—"
                          : "—";
                      const active = Boolean(u.is_active ?? true);
                      return (
                        <tr key={u.id} className="bg-white hover:bg-zinc-50/80">
                          <td className="px-4 py-3 font-semibold text-zinc-900">
                            {u.full_name ?? "Unnamed"}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${roleBadgeClass(role)}`}>
                              {role}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-zinc-700">{zone}</td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => void toggleUserActive(u.id, active)}
                              className={[
                                "inline-flex min-h-10 items-center justify-center rounded-xl px-3 text-xs font-semibold ring-1 transition",
                                active
                                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100"
                                  : "bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100",
                              ].join(" ")}
                            >
                              {active ? "Active" : "Inactive"}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-zinc-600">
                            {formatDate(u.created_at)}
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

        {/* SECTION 5 — Audit Schedule */}
        <section aria-label="Audit schedule">
          <div className="mb-4 flex items-end justify-between gap-2">
            <h2 className="text-lg font-semibold text-zinc-900">Audit Schedule</h2>
          </div>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-3">Zone</th>
                    <th className="px-4 py-3">Frequency</th>
                    <th className="px-4 py-3">Last Audit</th>
                    <th className="px-4 py-3">Next Due</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {state.zones.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                        No zones yet.
                      </td>
                    </tr>
                  ) : (
                    state.zones.map((z) => {
                      const latest = d.latestAuditByZone.get(z.id) ?? null;
                      const lastAt = latest?.at ?? null;
                      const nextDue = nextDueFromFrequency(lastAt, z.audit_frequency);
                      const nextDueTime = new Date(nextDue).getTime();
                      const status =
                        Number.isFinite(nextDueTime) && nextDueTime < Date.now()
                          ? "Overdue"
                          : "On track";
                      const statusClass =
                        status === "Overdue"
                          ? "bg-rose-50 text-rose-700 ring-rose-200"
                          : "bg-emerald-50 text-emerald-700 ring-emerald-200";

                      return (
                        <tr key={z.id} className="bg-white hover:bg-zinc-50/80">
                          <td className="px-4 py-3 font-semibold text-zinc-900">
                            {z.name ?? "Unnamed zone"}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${freqBadge(z.audit_frequency)}`}>
                              {(z.audit_frequency ?? "daily").toLowerCase()}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-zinc-700">{formatDate(lastAt)}</td>
                          <td className="px-4 py-3 text-zinc-700">{formatDate(nextDue)}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${statusClass}`}>
                              {status}
                            </span>
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
      </div>

      {/* Add Zone modal */}
      <Modal open={zoneAddOpen} title="Add zone" onClose={() => setZoneAddOpen(false)}>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-semibold text-zinc-700">Zone name</label>
            <input
              value={zoneForm.name}
              onChange={(e) => setZoneForm((s) => ({ ...s, name: e.target.value }))}
              className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-zinc-900"
              placeholder="Assembly Line A"
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-zinc-700">Department</label>
            <input
              value={zoneForm.department}
              onChange={(e) => setZoneForm((s) => ({ ...s, department: e.target.value }))}
              className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-zinc-900"
              placeholder="Assembly"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-semibold text-zinc-700">Audit frequency</label>
              <select
                value={zoneForm.audit_frequency}
                onChange={(e) => setZoneForm((s) => ({ ...s, audit_frequency: e.target.value as ZoneForm["audit_frequency"] }))}
                className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-zinc-900"
              >
                <option value="daily">daily</option>
                <option value="weekly">weekly</option>
                <option value="fortnightly">fortnightly</option>
                <option value="monthly">monthly</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-zinc-700">Assign leader</label>
              <select
                value={zoneForm.leader_id}
                onChange={(e) => setZoneForm((s) => ({ ...s, leader_id: e.target.value }))}
                className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-zinc-900"
              >
                <option value="">Unassigned</option>
                {d.zoneLeaders.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="button"
            disabled={savingZone}
            onClick={() => void saveZone("add")}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-zinc-900 px-5 text-base font-semibold text-white shadow-sm hover:bg-zinc-800 disabled:opacity-50"
          >
            {savingZone ? "Saving..." : "Add zone"}
          </button>
        </div>
      </Modal>

      {/* Edit Zone modal */}
      <Modal open={zoneEditOpen} title="Edit zone" onClose={() => setZoneEditOpen(false)}>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-semibold text-zinc-700">Zone name</label>
            <input
              value={zoneForm.name}
              onChange={(e) => setZoneForm((s) => ({ ...s, name: e.target.value }))}
              className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-zinc-900"
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-zinc-700">Department</label>
            <input
              value={zoneForm.department}
              onChange={(e) => setZoneForm((s) => ({ ...s, department: e.target.value }))}
              className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-zinc-900"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-semibold text-zinc-700">Audit frequency</label>
              <select
                value={zoneForm.audit_frequency}
                onChange={(e) => setZoneForm((s) => ({ ...s, audit_frequency: e.target.value as ZoneForm["audit_frequency"] }))}
                className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-zinc-900"
              >
                <option value="daily">daily</option>
                <option value="weekly">weekly</option>
                <option value="fortnightly">fortnightly</option>
                <option value="monthly">monthly</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-zinc-700">Assign leader</label>
              <select
                value={zoneForm.leader_id}
                onChange={(e) => setZoneForm((s) => ({ ...s, leader_id: e.target.value }))}
                className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-zinc-900"
              >
                <option value="">Unassigned</option>
                {d.zoneLeaders.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="button"
            disabled={savingZone}
            onClick={() => void saveZone("edit")}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-blue-600 px-5 text-base font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50"
          >
            {savingZone ? "Saving..." : "Save changes"}
          </button>
        </div>
      </Modal>

      {/* Add User modal */}
      <Modal open={userAddOpen} title="Add user" onClose={() => setUserAddOpen(false)}>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-semibold text-zinc-700">Full name</label>
            <input
              value={userForm.full_name}
              onChange={(e) => setUserForm((s) => ({ ...s, full_name: e.target.value }))}
              className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-indigo-500"
              placeholder="Alex Supervisor"
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-zinc-700">Email</label>
            <input
              type="email"
              value={userForm.email}
              onChange={(e) => setUserForm((s) => ({ ...s, email: e.target.value }))}
              className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-indigo-500"
              placeholder="name@company.com"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-semibold text-zinc-700">Role</label>
              <select
                value={userForm.role}
                onChange={(e) => setUserForm((s) => ({ ...s, role: e.target.value as AddUserForm["role"] }))}
                className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-indigo-500"
              >
                <option value="auditor">auditor</option>
                <option value="zone_leader">zone_leader</option>
                <option value="supervisor">supervisor</option>
              </select>
            </div>
            {userForm.role === "zone_leader" ? (
              <div>
                <label className="text-sm font-semibold text-zinc-700">Assign to zone</label>
                <select
                  value={userForm.zone_id}
                  onChange={(e) => setUserForm((s) => ({ ...s, zone_id: e.target.value }))}
                  className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-indigo-500"
                >
                  <option value="">Select a zone</option>
                  {state.zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name ?? "Unnamed zone"}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div />
            )}
          </div>

          <button
            type="button"
            disabled={savingUser}
            onClick={() => void addUser()}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-indigo-600 px-5 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
          >
            {savingUser ? "Sending..." : "Send invite"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
