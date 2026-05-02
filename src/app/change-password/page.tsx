"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import supabase from "@/lib/supabase";
import { getCurrentUser, getRoleHomeRoute } from "@/lib/auth";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const profile = await getCurrentUser();
      if (cancelled) return;
      if (!profile) {
        router.replace("/login");
        return;
      }
      if (!profile.force_password_change) {
        router.replace(getRoleHomeRoute(profile.role));
        return;
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const profile = await getCurrentUser();
      if (!profile) {
        router.replace("/login");
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const email = user?.email;
      if (!email) {
        throw new Error("No email on session.");
      }

      const { error: verifyErr } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (verifyErr) {
        throw new Error("Current password is incorrect.");
      }

      const { error: updateAuthErr } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateAuthErr) {
        throw new Error(updateAuthErr.message);
      }

      const { error: profileErr } = await supabase
        .from("user_profiles")
        .update({ force_password_change: false })
        .eq("id", profile.id);
      if (profileErr) {
        throw new Error(profileErr.message);
      }

      router.refresh();
      router.replace(getRoleHomeRoute(profile.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update password.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-zinc-100 to-zinc-200/80 px-4 py-10">
        <div className="mx-auto flex max-w-md justify-center py-20">
          <div className="h-10 w-48 animate-pulse rounded-xl bg-zinc-200" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-100 to-zinc-200/80 px-4 py-10 text-zinc-950 sm:py-16">
      <div className="mx-auto w-full max-w-md">
        <div className="rounded-2xl border border-black/5 bg-white p-6 shadow-lg shadow-black/5 sm:p-8">
          <h1 className="text-center text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl">
            Welcome! Please set your new password
          </h1>
          <p className="mt-2 text-center text-sm text-zinc-600">
            Your administrator shared a temporary password. Choose a new one to continue.
          </p>

          {error && (
            <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
              {error}
            </div>
          )}

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label className="text-sm font-semibold text-zinc-700">
                Current password
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-zinc-900"
                required
                autoComplete="current-password"
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-zinc-700">
                New password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-zinc-900"
                required
                minLength={8}
                autoComplete="new-password"
              />
              <p className="mt-1 text-xs text-zinc-500">At least 8 characters.</p>
            </div>
            <div>
              <label className="text-sm font-semibold text-zinc-700">
                Confirm new password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-zinc-900"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-zinc-900 px-5 text-base font-semibold text-white shadow-sm hover:bg-zinc-800 disabled:opacity-50 active:scale-[0.99]"
            >
              {submitting ? "Saving..." : "Set new password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
