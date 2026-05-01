"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import supabase from "@/lib/supabase";
import { getRoleHomeRoute } from "@/lib/auth";

type PendingInviteRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  org_id: string | null;
  plant_id: string | null;
  zone_id: string | null;
  accepted?: boolean | null;
};

export default function OnboardingPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<"loading" | "form" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (cancelled) return;

      if (!session?.user) {
        setPhase("error");
        setError(
          "No active session. Open this page from the magic link in your invite email, or sign in from the login page.",
        );
        return;
      }

      const uid = session.user.id;
      const userEmail = session.user.email ?? "";
      setUserId(uid);
      setEmail(userEmail);

      const { data: profile, error: profileError } = await supabase
        .from("user_profiles")
        .select("id, role")
        .eq("id", uid)
        .maybeSingle();

      if (profileError) {
        setPhase("error");
        setError(profileError.message);
        return;
      }

      if (profile) {
        router.replace(getRoleHomeRoute((profile as { role: string }).role));
        return;
      }

      const { data: inviteList, error: inviteError } = await supabase
        .from("pending_invites")
        .select(
          "id,email,full_name,role,org_id,plant_id,zone_id,accepted",
        )
        .eq("email", userEmail.toLowerCase())
        .order("created_at", { ascending: false })
        .limit(1);

      if (inviteError) {
        setPhase("error");
        setError(inviteError.message);
        return;
      }

      const invite = (inviteList?.[0] ?? null) as PendingInviteRow | null;
      if (invite?.full_name) {
        setFullName(invite.full_name);
      }

      setPhase("form");
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!userId || !email) {
      setError("Missing session. Please use your invite link again.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!fullName.trim()) {
      setError("Please enter your full name.");
      return;
    }

    setSubmitting(true);
    try {
      const { error: pwError } = await supabase.auth.updateUser({
        password,
      });
      if (pwError) throw new Error(pwError.message);

      const { data: inviteList, error: inviteLookupError } = await supabase
        .from("pending_invites")
        .select(
          "id,email,full_name,role,org_id,plant_id,zone_id,accepted",
        )
        .eq("email", email.toLowerCase())
        .order("created_at", { ascending: false })
        .limit(1);

      if (inviteLookupError) throw new Error(inviteLookupError.message);
      const invite = (inviteList?.[0] ?? null) as PendingInviteRow | null;
      if (!invite) {
        throw new Error(
          "No pending invite found for this email. Contact your administrator.",
        );
      }

      const role = invite.role as
        | "super_admin"
        | "admin"
        | "auditor"
        | "zone_leader"
        | "supervisor";

      const { error: insertProfileError } = await supabase
        .from("user_profiles")
        .insert({
          id: userId,
          full_name: fullName.trim(),
          role,
          org_id: invite.org_id,
          plant_id: invite.plant_id,
          is_active: true,
        });

      if (insertProfileError) throw new Error(insertProfileError.message);

      const isZoneLeader =
        String(invite.role).toLowerCase() === "zone_leader" && invite.zone_id;

      if (isZoneLeader) {
        const { error: statsErr } = await supabase
          .from("zone_leader_stats")
          .insert({
            user_id: userId,
            zone_id: invite.zone_id,
            org_id: invite.org_id,
            plant_id: invite.plant_id,
            xp: 0,
            level: 1,
          });
        if (statsErr) throw new Error(statsErr.message);

        const { error: zoneErr } = await supabase
          .from("zones")
          .update({ leader_id: userId })
          .eq("id", invite.zone_id);
        if (zoneErr) throw new Error(zoneErr.message);
      }

      const { error: pendingErr } = await supabase
        .from("pending_invites")
        .update({ accepted: true })
        .eq("id", invite.id);
      if (pendingErr) throw new Error(pendingErr.message);

      router.replace(getRoleHomeRoute(role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-100 to-zinc-200/90 px-4 py-10 text-zinc-950 sm:py-16">
      <div className="mx-auto w-full max-w-md">
        <div className="rounded-2xl border border-black/5 bg-white p-6 shadow-lg shadow-black/5 sm:p-8">
          {phase === "loading" ? (
            <div className="space-y-3">
              <div className="h-8 w-48 animate-pulse rounded-lg bg-zinc-200" />
              <div className="h-4 w-full animate-pulse rounded bg-zinc-100" />
              <div className="mt-6 h-40 animate-pulse rounded-2xl bg-zinc-100" />
            </div>
          ) : phase === "error" ? (
            <>
              <h1 className="text-xl font-semibold text-zinc-900">
                Can&apos;t continue onboarding
              </h1>
              <p className="mt-2 text-sm text-rose-700">{error}</p>
              <button
                type="button"
                onClick={() => router.replace("/login")}
                className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-zinc-900 px-5 text-sm font-semibold text-white hover:bg-zinc-800"
              >
                Go to sign in
              </button>
            </>
          ) : (
            <>
              <div className="text-center">
                <div className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                  5S Guardian
                </div>
                <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-900">
                  Welcome to 5S Guardian
                </h1>
                <p className="mt-2 text-sm text-zinc-600">
                  Set your password and finish your profile.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                {error && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
                    {error}
                  </div>
                )}

                <div>
                  <label className="text-sm font-semibold text-zinc-700">
                    Email
                  </label>
                  <input
                    readOnly
                    value={email}
                    className="mt-1 w-full min-h-12 cursor-not-allowed rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm font-semibold text-zinc-700"
                  />
                </div>

                <div>
                  <label className="text-sm font-semibold text-zinc-700">
                    Full name
                  </label>
                  <input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-blue-500"
                    placeholder="Your name"
                    autoComplete="name"
                    required
                  />
                </div>

                <div>
                  <label className="text-sm font-semibold text-zinc-700">
                    New password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-blue-500"
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </div>

                <div>
                  <label className="text-sm font-semibold text-zinc-700">
                    Confirm password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-blue-500"
                    placeholder="Repeat password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-blue-600 px-5 text-base font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:opacity-50"
                >
                  {submitting ? "Saving…" : "Set up my account"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
