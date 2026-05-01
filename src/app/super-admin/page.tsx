"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import supabase from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";

type OrganisationRow = {
  id: string;
  name: string | null;
  slug: string | null;
  is_active: boolean | null;
  created_at: string | null;
};

type PlantRow = {
  id: string;
  name: string | null;
  location: string | null;
  org_id: string | null;
};

type UserProfileRow = {
  id: string;
  full_name: string | null;
  role: string | null;
  org_id: string | null;
  plant_id: string | null;
  is_active: boolean | null;
};

type PendingInviteRow = {
  id: string;
  email: string;
  full_name: string | null;
  org_id: string | null;
  role: string;
  slug: string | null;
  created_at: string | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      stats: { orgs: number; plants: number; users: number; audits: number };
      organisations: OrganisationRow[];
      plants: PlantRow[];
      users: UserProfileRow[];
    };

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function Toggle({
  on,
  onClick,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        "relative inline-flex h-8 w-14 items-center rounded-full transition",
        on ? "bg-emerald-500" : "bg-rose-500",
        disabled ? "opacity-50" : "hover:opacity-95",
      ].join(" ")}
      aria-pressed={on}
      aria-label={on ? "Active" : "Inactive"}
    >
      <span
        className={[
          "inline-block h-6 w-6 transform rounded-full bg-white shadow transition",
          on ? "translate-x-7" : "translate-x-1",
        ].join(" ")}
      />
    </button>
  );
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

export default function SuperAdminPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [creatingOrg, setCreatingOrg] = useState(false);

  const [createdOrg, setCreatedOrg] = useState<OrganisationRow | null>(null);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);

  const [banner, setBanner] = useState<string | null>(null);

  async function refreshAll() {
    const [orgsCount, plantsCount, usersCount, auditsCount, orgsRes, plantsRes, usersRes] =
      await Promise.all([
        supabase.from("organisations").select("id", { count: "exact", head: true }),
        supabase.from("plants").select("id", { count: "exact", head: true }),
        supabase.from("user_profiles").select("id", { count: "exact", head: true }),
        supabase.from("audit_sessions").select("id", { count: "exact", head: true }),
        supabase
          .from("organisations")
          .select("id,name,slug,is_active,created_at")
          .order("created_at", { ascending: true }),
        supabase
          .from("plants")
          .select("id,name,location,org_id")
          .order("name", { ascending: true }),
        supabase
          .from("user_profiles")
          .select("id,full_name,role,org_id,plant_id,is_active")
          .order("full_name", { ascending: true }),
      ]);

    const firstErr =
      orgsCount.error ??
      plantsCount.error ??
      usersCount.error ??
      auditsCount.error ??
      orgsRes.error ??
      plantsRes.error ??
      usersRes.error;
    if (firstErr) throw new Error(firstErr.message);

    setState({
      status: "ready",
      stats: {
        orgs: orgsCount.count ?? 0,
        plants: plantsCount.count ?? 0,
        users: usersCount.count ?? 0,
        audits: auditsCount.count ?? 0,
      },
      organisations: (orgsRes.data ?? []) as OrganisationRow[],
      plants: (plantsRes.data ?? []) as PlantRow[],
      users: (usersRes.data ?? []) as UserProfileRow[],
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await getCurrentUser();
      if (!user || user.role !== "super_admin") {
        router.replace("/unauthorized");
        return;
      }

      try {
        await refreshAll();
      } catch (e) {
        if (cancelled) return;
        setState({
          status: "error",
          message: e instanceof Error ? e.message : "Failed to load portal.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    const next = slugify(orgName);
    setOrgSlug((s) => (s ? s : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgName]);

  const aggregates = useMemo(() => {
    if (state.status !== "ready") return null;
    const plantCountByOrg = new Map<string, number>();
    for (const p of state.plants) {
      if (!p.org_id) continue;
      plantCountByOrg.set(p.org_id, (plantCountByOrg.get(p.org_id) ?? 0) + 1);
    }
    const userCountByOrg = new Map<string, number>();
    for (const u of state.users) {
      if (!u.org_id) continue;
      userCountByOrg.set(u.org_id, (userCountByOrg.get(u.org_id) ?? 0) + 1);
    }
    const plantsByOrg = new Map<string, PlantRow[]>();
    for (const p of state.plants) {
      if (!p.org_id) continue;
      const cur = plantsByOrg.get(p.org_id) ?? [];
      cur.push(p);
      plantsByOrg.set(p.org_id, cur);
    }
    return { plantCountByOrg, userCountByOrg, plantsByOrg };
  }, [state]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  async function toggleOrgActive(org: OrganisationRow) {
    if (state.status !== "ready") return;
    const next = !(org.is_active ?? true);
    setState((s) => {
      if (s.status !== "ready") return s;
      return {
        ...s,
        organisations: s.organisations.map((o) =>
          o.id === org.id ? { ...o, is_active: next } : o,
        ),
      };
    });
    const { error } = await supabase
      .from("organisations")
      .update({ is_active: next })
      .eq("id", org.id);
    if (error) {
      setBanner(error.message);
      setState((s) => {
        if (s.status !== "ready") return s;
        return {
          ...s,
          organisations: s.organisations.map((o) =>
            o.id === org.id ? { ...o, is_active: org.is_active } : o,
          ),
        };
      });
    }
  }

  async function createOrganisation() {
    if (!orgName.trim()) return;
    setCreatingOrg(true);
    try {
      const { data, error } = await supabase
        .from("organisations")
        .insert({ name: orgName.trim(), slug: orgSlug.trim(), is_active: true })
        .select("id,name,slug,is_active,created_at")
        .single();
      if (error) throw new Error(error.message);

      const inserted = data as OrganisationRow;
      setCreatedOrg(inserted);
      setBanner(`Organisation created: ${inserted.name ?? "Organisation"}`);
      await refreshAll();
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Failed to create organisation.");
    } finally {
      setCreatingOrg(false);
    }
  }

  async function sendAdminInvite() {
    if (!createdOrg) return;
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const email = inviteEmail.trim().toLowerCase();
      const fullName = inviteName.trim() || null;

      const { error: inviteErr } = await supabase.from("pending_invites").insert({
        email,
        full_name: fullName,
        role: "admin",
        org_id: createdOrg.id,
      });
      if (inviteErr) throw new Error(inviteErr.message);

      const { error: otpErr } = await supabase.auth.signInWithOtp({ email });
      if (otpErr) throw new Error(otpErr.message);

      const userId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      const { error: profileErr } = await supabase.from("user_profiles").insert({
        id: userId,
        full_name: fullName,
        role: "admin",
        org_id: createdOrg.id,
        is_active: true,
      });
      if (profileErr) throw new Error(profileErr.message);

      setBanner(`Invite sent to ${email}`);
      setInviteEmail("");
      setInviteName("");

      await refreshAll();
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Failed to invite admin user.");
    } finally {
      setInviting(false);
    }
  }

  const shell =
    "min-h-screen w-full bg-gradient-to-b from-zinc-100 to-zinc-200/80 px-4 py-6 text-zinc-950 sm:px-6 sm:py-10";

  if (state.status === "loading") {
    return (
      <div className={shell}>
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="h-10 w-80 animate-pulse rounded-lg bg-zinc-300/80" />
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
      <div className={shell}>
        <div className="mx-auto max-w-2xl rounded-2xl border border-rose-200 bg-white p-8 shadow-sm">
          <div className="text-xl font-semibold text-rose-800">
            Super admin portal unavailable
          </div>
          <div className="mt-2 text-sm text-rose-700">{state.message}</div>
        </div>
      </div>
    );
  }

  const a = aggregates!;

  return (
    <div className={shell}>
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="flex flex-col gap-4 border-b border-zinc-200/80 pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">
              System administration
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
              5S Guardian — Super Admin
            </h1>
            <p className="mt-1 max-w-xl text-sm text-zinc-600">
              Multi-tenant setup, onboarding, and control panel.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 active:scale-[0.99]"
            >
              Add New Organisation
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50 active:scale-[0.99]"
            >
              Logout
            </button>
          </div>
        </header>

        {banner && (
          <div
            className="flex items-start justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm"
            role="status"
          >
            <span className="font-medium">{banner}</span>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Stats row */}
        <section aria-label="Super admin stats">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-white/80 bg-white p-5 shadow-sm ring-1 ring-black/5">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Total organisations
              </div>
              <div className="mt-2 text-3xl font-bold tabular-nums text-zinc-900">
                {state.stats.orgs}
              </div>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white p-5 shadow-sm ring-1 ring-black/5">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Total plants
              </div>
              <div className="mt-2 text-3xl font-bold tabular-nums text-zinc-900">
                {state.stats.plants}
              </div>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white p-5 shadow-sm ring-1 ring-black/5">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Total users
              </div>
              <div className="mt-2 text-3xl font-bold tabular-nums text-zinc-900">
                {state.stats.users}
              </div>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white p-5 shadow-sm ring-1 ring-black/5">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Total audits
              </div>
              <div className="mt-2 text-3xl font-bold tabular-nums text-zinc-900">
                {state.stats.audits}
              </div>
            </div>
          </div>
        </section>

        {/* Organisations list */}
        <section aria-label="Organisations">
          <div className="mb-4 flex items-end justify-between gap-2">
            <h2 className="text-lg font-semibold text-zinc-900">
              Organisations
            </h2>
            <span className="text-xs text-zinc-500">Expand to manage plants</span>
          </div>

          {state.organisations.length === 0 ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-600">
              No organisations yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {state.organisations.map((org) => {
                const plants = a.plantsByOrg.get(org.id) ?? [];
                const plantCount = a.plantCountByOrg.get(org.id) ?? 0;
                const userCount = a.userCountByOrg.get(org.id) ?? 0;
                const expanded = expandedOrgId === org.id;
                const active = Boolean(org.is_active ?? true);

                return (
                  <div
                    key={org.id}
                    className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-base font-bold text-zinc-900">
                          {org.name ?? "Unnamed organisation"}
                        </div>
                        <div className="mt-0.5 text-sm text-zinc-600">
                          <span className="font-semibold text-zinc-800">
                            {plantCount}
                          </span>{" "}
                          plants •{" "}
                          <span className="font-semibold text-zinc-800">
                            {userCount}
                          </span>{" "}
                          users
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          Slug: <span className="font-mono">{org.slug ?? "—"}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 sm:justify-end">
                        <div className="flex items-center gap-2">
                          <span
                            className={[
                              "text-xs font-semibold",
                              active ? "text-emerald-700" : "text-rose-700",
                            ].join(" ")}
                          >
                            {active ? "Active" : "Inactive"}
                          </span>
                          <Toggle
                            on={active}
                            onClick={() => void toggleOrgActive(org)}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedOrgId((cur) => (cur === org.id ? null : org.id))
                          }
                          className="inline-flex min-h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50"
                        >
                          Manage
                        </button>
                      </div>
                    </div>

                    {expanded && (
                      <div className="mt-4 border-t border-zinc-100 pt-4">
                        <div className="text-sm font-semibold text-zinc-700">
                          Plants
                        </div>
                        {plants.length === 0 ? (
                          <div className="mt-2 text-sm text-zinc-500">
                            No plants for this organisation yet.
                          </div>
                        ) : (
                          <ul className="mt-2 space-y-2">
                            {plants.map((p) => (
                              <li
                                key={p.id}
                                className="flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-zinc-900">
                                    {p.name ?? "Unnamed plant"}
                                  </div>
                                  <div className="truncate text-xs text-zinc-500">
                                    {p.location ?? "Location not set"}
                                  </div>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <Modal
        open={addOpen}
        title="Add new organisation"
        onClose={() => {
          setAddOpen(false);
          setCreatedOrg(null);
          setOrgName("");
          setOrgSlug("");
          setInviteName("");
          setInviteEmail("");
        }}
      >
        {!createdOrg ? (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-semibold text-zinc-700">
                Organisation name
              </label>
              <input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-indigo-500"
                placeholder="Acme Manufacturing"
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-zinc-700">Slug</label>
              <input
                value={orgSlug}
                onChange={(e) => setOrgSlug(e.target.value)}
                className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-indigo-500"
                placeholder="acme-manufacturing"
              />
              <div className="mt-1 text-xs text-zinc-500">
                Used for URLs and internal references.
              </div>
            </div>
            <button
              type="button"
              disabled={creatingOrg}
              onClick={() => void createOrganisation()}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-indigo-600 px-5 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
            >
              {creatingOrg ? "Creating..." : "Create organisation"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <div className="font-semibold">Organisation created</div>
              <div className="mt-1">
                {createdOrg.name ?? "Organisation"} ({createdOrg.slug ?? "—"})
              </div>
            </div>

            <div>
              <div className="text-base font-semibold text-zinc-900">
                Create Admin User
              </div>
              <div className="mt-1 text-sm text-zinc-600">
                We can’t call the Supabase Admin API from the browser. Instead,
                this creates a record in <span className="font-mono">pending_invites</span>{" "}
                and sends a magic link.
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-semibold text-zinc-700">
                  Full name
                </label>
                <input
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-indigo-500"
                  placeholder="Plant Admin"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-zinc-700">
                  Email
                </label>
                <input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-indigo-500"
                  placeholder="admin@acme.com"
                  type="email"
                />
              </div>
            </div>

            <button
              type="button"
              disabled={inviting}
              onClick={() => void sendAdminInvite()}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-zinc-900 px-5 text-base font-semibold text-white shadow-sm hover:bg-zinc-800 disabled:opacity-50"
            >
              {inviting ? "Sending..." : `Send invite link to ${inviteEmail || "email"}`}
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}

