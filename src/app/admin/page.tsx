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

type OrgPlant = {
  id: string;
  name: string | null;
  location: string | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "needs_plant";
      profile: {
        id: string;
        full_name: string | null;
        org_id: string;
        org_name: string | null;
      };
    }
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
      orgPlants: OrgPlant[];
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
  password: string;
  confirmPassword: string;
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
    password: "",
    confirmPassword: "",
    role: "auditor",
    zone_id: "",
  });
  const [showUserPassword, setShowUserPassword] = useState(false);
  const [userCreatedCredentials, setUserCreatedCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [savingUser, setSavingUser] = useState(false);

  const [banner, setBanner] = useState<string | null>(null);

  const [setupPlantName, setSetupPlantName] = useState("");
  const [setupPlantLocation, setSetupPlantLocation] = useState("");
  const [creatingFirstPlant, setCreatingFirstPlant] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  const [addPlantOpen, setAddPlantOpen] = useState(false);
  const [newPlantName, setNewPlantName] = useState("");
  const [newPlantLocation, setNewPlantLocation] = useState("");
  const [savingNewPlant, setSavingNewPlant] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await getCurrentUser();
      if (!user || user.role !== "admin") {
        router.replace("/unauthorized");
        return;
      }
      if (!user.org_id) {
        if (!cancelled) {
          setState({
            status: "error",
            message: "Your admin account is missing organisation assignment.",
          });
        }
        return;
      }

      if (!user.plant_id) {
        if (!cancelled) {
          setState({
            status: "needs_plant",
            profile: {
              id: user.id,
              full_name: user.full_name,
              org_id: user.org_id,
              org_name: user.org_name,
            },
          });
        }
        return;
      }

      const plantId = user.plant_id;
      const weekStart = startOfWeekLocal().toISOString();

      const [
        orgPlantsRes,
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
          .from("plants")
          .select("id,name,location")
          .eq("org_id", user.org_id)
          .order("name", { ascending: true }),
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
        orgPlantsRes.error ??
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
        orgPlants: (orgPlantsRes.data ?? []) as OrgPlant[],
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

    const zonesWithoutLeader = state.zones.filter((z) => !z.leader_id);

    return {
      leaderNameById,
      latestAuditByZone,
      zoneNameById,
      zoneByLeaderId,
      zoneLeaders,
      zonesWithoutLeader,
    };
  }, [state]);

  async function createFirstPlant(e: React.FormEvent) {
    e.preventDefault();
    if (state.status !== "needs_plant") return;
    if (!setupPlantName.trim()) return;

    setCreatingFirstPlant(true);
    setSetupError(null);
    try {
      const { data: plantRow, error: insertErr } = await supabase
        .from("plants")
        .insert({
          org_id: state.profile.org_id,
          name: setupPlantName.trim(),
          location: setupPlantLocation.trim() || null,
          is_active: true,
        })
        .select("id")
        .single();

      if (insertErr) throw new Error(insertErr.message);

      const { error: profileErr } = await supabase
        .from("user_profiles")
        .update({ plant_id: plantRow.id })
        .eq("id", state.profile.id);

      if (profileErr) throw new Error(profileErr.message);

      window.location.reload();
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "Failed to create plant.");
    } finally {
      setCreatingFirstPlant(false);
    }
  }

  async function switchPlant(nextPlantId: string) {
    if (state.status !== "ready") return;
    if (nextPlantId === state.profile.plant_id) return;

    const { error } = await supabase
      .from("user_profiles")
      .update({ plant_id: nextPlantId })
      .eq("id", state.profile.id);

    if (error) {
      setBanner(error.message);
      return;
    }

    window.location.reload();
  }

  async function submitAddPlant() {
    if (state.status !== "ready") return;
    if (!newPlantName.trim()) return;

    setSavingNewPlant(true);
    try {
      const { data: plantRow, error: insertErr } = await supabase
        .from("plants")
        .insert({
          org_id: state.profile.org_id,
          name: newPlantName.trim(),
          location: newPlantLocation.trim() || null,
          is_active: true,
        })
        .select("id")
        .single();

      if (insertErr) throw new Error(insertErr.message);

      const { error: profileErr } = await supabase
        .from("user_profiles")
        .update({ plant_id: plantRow.id })
        .eq("id", state.profile.id);

      if (profileErr) throw new Error(profileErr.message);

      setAddPlantOpen(false);
      setNewPlantName("");
      setNewPlantLocation("");
      window.location.reload();
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Failed to add plant.");
    } finally {
      setSavingNewPlant(false);
    }
  }

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

  function openAddUserModal() {
    setUserForm({
      full_name: "",
      email: "",
      password: "",
      confirmPassword: "",
      role: "auditor",
      zone_id: "",
    });
    setShowUserPassword(false);
    setUserCreatedCredentials(null);
    setUserAddOpen(true);
  }

  async function copyUserCredentials() {
    if (!userCreatedCredentials) return;
    const text = `Email: ${userCreatedCredentials.email}\nPassword: ${userCreatedCredentials.password}`;
    try {
      await navigator.clipboard.writeText(text);
      setBanner("Credentials copied to clipboard.");
    } catch {
      setBanner("Could not copy — copy manually from the card.");
    }
  }

  async function addUser() {
    if (state.status !== "ready") return;
    if (!userForm.email.trim()) return;
    if (!userForm.full_name.trim()) return;
    if (userForm.role === "zone_leader" && !userForm.zone_id) return;
    if (userForm.password.length < 8) {
      setBanner("Temporary password must be at least 8 characters.");
      return;
    }
    if (userForm.password !== userForm.confirmPassword) {
      setBanner("Passwords do not match.");
      return;
    }

    setSavingUser(true);
    try {
      const email = userForm.email.trim().toLowerCase();

      const res = await fetch("/api/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: userForm.password,
          fullName: userForm.full_name.trim(),
          role: userForm.role,
          orgId: state.profile.org_id,
          plantId: state.profile.plant_id,
          zoneId:
            userForm.role === "zone_leader" && userForm.zone_id
              ? userForm.zone_id
              : null,
        }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "Failed to create user");
      }

      setUserCreatedCredentials({ email, password: userForm.password });
      setBanner(`User created: ${email}`);
      setUserForm({
        full_name: "",
        email: "",
        password: "",
        confirmPassword: "",
        role: "auditor",
        zone_id: "",
      });

      const usersRes = await supabase
        .from("user_profiles")
        .select("id,full_name,role,org_id,plant_id,is_active,created_at")
        .eq("plant_id", state.profile.plant_id)
        .order("created_at", { ascending: false });
      const zonesRes = await supabase
        .from("zones")
        .select(
          "id,name,department,audit_frequency,leader_id,org_id,plant_id,created_at",
        )
        .eq("plant_id", state.profile.plant_id)
        .order("name", { ascending: true });

      if (usersRes.error) throw new Error(usersRes.error.message);
      if (zonesRes.error) throw new Error(zonesRes.error.message);

      setState((s) => {
        if (s.status !== "ready") return s;
        return {
          ...s,
          users: (usersRes.data ?? []) as UserProfileRow[],
          zones: (zonesRes.data ?? []) as ZoneRow[],
        };
      });
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

  if (state.status === "needs_plant") {
    const displayName = state.profile.full_name?.trim() || "there";
    return (
      <div className={shell}>
        <div className="mx-auto max-w-lg">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
              Welcome to 5S Guardian
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">
              Welcome {displayName}! Let&apos;s set up your first plant.
            </p>

            {setupError && (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {setupError}
              </div>
            )}

            <form onSubmit={createFirstPlant} className="mt-6 space-y-4">
              <div>
                <label className="text-sm font-semibold text-zinc-700">Plant name</label>
                <input
                  value={setupPlantName}
                  onChange={(e) => setSetupPlantName(e.target.value)}
                  className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-zinc-900"
                  placeholder="Mumbai Plant"
                  autoComplete="organization"
                  required
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-zinc-700">Location / city</label>
                <input
                  value={setupPlantLocation}
                  onChange={(e) => setSetupPlantLocation(e.target.value)}
                  className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-zinc-900"
                  placeholder="Mumbai"
                  autoComplete="address-level2"
                />
              </div>
              <button
                type="submit"
                disabled={creatingFirstPlant}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-zinc-900 px-5 text-base font-semibold text-white shadow-sm hover:bg-zinc-800 disabled:opacity-50 active:scale-[0.99]"
              >
                {creatingFirstPlant ? "Creating..." : "Create Plant"}
              </button>
            </form>

            <button
              type="button"
              onClick={() => void logout()}
              className="mt-6 w-full text-center text-sm font-semibold text-zinc-600 underline-offset-2 hover:text-zinc-900 hover:underline"
            >
              Log out
            </button>
          </div>
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
        <header className="flex flex-col gap-4 border-b border-zinc-200/80 pb-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              {state.orgPlants.length > 1 ? (
                <div className="mb-3 max-w-md">
                  <label
                    htmlFor="admin-plant-select"
                    className="text-xs font-semibold uppercase tracking-wide text-zinc-500"
                  >
                    Plant
                  </label>
                  <select
                    id="admin-plant-select"
                    value={state.profile.plant_id}
                    onChange={(e) => void switchPlant(e.target.value)}
                    className="mt-1 w-full min-h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-zinc-900"
                  >
                    {state.orgPlants.map((p) => (
                      <option key={p.id} value={p.id}>
                        {(p.name ?? "Plant") +
                          (p.location ? ` — ${p.location}` : "")}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
                {plantTitle} — Admin Dashboard
              </h1>
              <p className="mt-1 text-sm font-semibold text-zinc-600">{orgTitle}</p>
            </div>
            <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setNewPlantName("");
                  setNewPlantLocation("");
                  setAddPlantOpen(true);
                }}
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-sm font-semibold text-indigo-900 shadow-sm hover:bg-indigo-100 active:scale-[0.99]"
              >
                Add Another Plant
              </button>
              <button
                type="button"
                onClick={() => void logout()}
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50 active:scale-[0.99]"
              >
                Logout
              </button>
            </div>
          </div>
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
              onClick={openAddUserModal}
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

      <Modal
        open={addPlantOpen}
        title="Add another plant"
        onClose={() => {
          setAddPlantOpen(false);
          setNewPlantName("");
          setNewPlantLocation("");
        }}
      >
        <div className="space-y-4">
          <div>
            <label className="text-sm font-semibold text-zinc-700">Plant name</label>
            <input
              value={newPlantName}
              onChange={(e) => setNewPlantName(e.target.value)}
              className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-indigo-500"
              placeholder="Delhi Plant"
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-zinc-700">Location / city</label>
            <input
              value={newPlantLocation}
              onChange={(e) => setNewPlantLocation(e.target.value)}
              className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-indigo-500"
              placeholder="New Delhi"
            />
          </div>
          <button
            type="button"
            disabled={savingNewPlant}
            onClick={() => void submitAddPlant()}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-indigo-600 px-5 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
          >
            {savingNewPlant ? "Creating..." : "Create plant & switch"}
          </button>
          <p className="text-xs text-zinc-500">
            After creation, your dashboard will switch to this plant. Use the plant
            selector above to move between plants anytime.
          </p>
        </div>
      </Modal>

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
      <Modal
        open={userAddOpen}
        title="Add user"
        onClose={() => {
          setUserAddOpen(false);
          setUserCreatedCredentials(null);
          setUserForm({
            full_name: "",
            email: "",
            password: "",
            confirmPassword: "",
            role: "auditor",
            zone_id: "",
          });
          setShowUserPassword(false);
        }}
      >
        {userCreatedCredentials ? (
          <div className="space-y-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950 shadow-sm">
            <div className="font-semibold text-emerald-900">
              ✓ User created successfully!
            </div>
            <p className="text-sm leading-relaxed text-emerald-900/90">
              Share these credentials securely (via WhatsApp):
            </p>
            <div className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm">
              <div>
                📧 Email:{" "}
                <span className="font-mono font-semibold">
                  {userCreatedCredentials.email}
                </span>
              </div>
              <div className="mt-1">
                🔑 Password:{" "}
                <span className="font-mono font-semibold">
                  {userCreatedCredentials.password}
                </span>
              </div>
            </div>
            <p className="text-xs text-emerald-800">
              User must change password on first login.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => void copyUserCredentials()}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-600"
              >
                Copy credentials
              </button>
              <button
                type="button"
                onClick={() => {
                  setUserCreatedCredentials(null);
                  setUserForm({
                    full_name: "",
                    email: "",
                    password: "",
                    confirmPassword: "",
                    role: "auditor",
                    zone_id: "",
                  });
                }}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-emerald-300 bg-white px-4 text-sm font-semibold text-emerald-900 shadow-sm hover:bg-emerald-100/80"
              >
                Add another
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-semibold text-zinc-700">Full name</label>
              <input
                value={userForm.full_name}
                onChange={(e) => setUserForm((s) => ({ ...s, full_name: e.target.value }))}
                className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-indigo-500"
                placeholder="Alex Supervisor"
                autoComplete="name"
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
                autoComplete="email"
              />
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-semibold text-zinc-700">
                  Temporary password
                </label>
                <button
                  type="button"
                  className="text-xs font-semibold text-indigo-700 hover:underline"
                  onClick={() => setShowUserPassword((v) => !v)}
                >
                  {showUserPassword ? "Hide" : "Show"}
                </button>
              </div>
              <input
                type={showUserPassword ? "text" : "password"}
                value={userForm.password}
                onChange={(e) => setUserForm((s) => ({ ...s, password: e.target.value }))}
                className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-indigo-500"
                placeholder="Minimum 8 characters"
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-zinc-700">Confirm password</label>
              <input
                type={showUserPassword ? "text" : "password"}
                value={userForm.confirmPassword}
                onChange={(e) =>
                  setUserForm((s) => ({ ...s, confirmPassword: e.target.value }))
                }
                className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-indigo-500"
                placeholder="Repeat temporary password"
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="text-sm font-semibold text-zinc-700">Role</label>
                <select
                  value={userForm.role}
                  onChange={(e) =>
                    setUserForm((s) => ({
                      ...s,
                      role: e.target.value as AddUserForm["role"],
                      zone_id: "",
                    }))
                  }
                  className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-indigo-500"
                >
                  <option value="auditor">auditor</option>
                  <option value="zone_leader">zone_leader</option>
                  <option value="supervisor">supervisor</option>
                </select>
              </div>
              {userForm.role === "zone_leader" ? (
                <div className="sm:col-span-2">
                  <label className="text-sm font-semibold text-zinc-700">
                    Zone (unassigned only)
                  </label>
                  <select
                    value={userForm.zone_id}
                    onChange={(e) => setUserForm((s) => ({ ...s, zone_id: e.target.value }))}
                    className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-indigo-500"
                  >
                    <option value="">Select a zone</option>
                    {d.zonesWithoutLeader.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name ?? "Unnamed zone"}
                      </option>
                    ))}
                  </select>
                  {d.zonesWithoutLeader.length === 0 && (
                    <p className="mt-1 text-xs text-amber-700">
                      No zones without a leader. Add a zone or unassign a leader first.
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              disabled={savingUser}
              onClick={() => void addUser()}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-indigo-600 px-5 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
            >
              {savingUser ? "Creating..." : "Create user"}
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
