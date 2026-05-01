"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { getCurrentUser, getRoleHomeRoute } from "@/lib/auth";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) throw new Error(signInError.message);

      const profile = await getCurrentUser();
      const home = profile
        ? getRoleHomeRoute(profile.role)
        : "/onboarding";
      router.refresh();
      router.push(home);
      setTimeout(() => {
        window.location.replace(home);
      }, 300);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log("Sign in failed:", err);
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-100 px-4 py-10 text-zinc-950">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="text-3xl font-semibold tracking-tight">5S Guardian</div>
          <div className="mt-1 text-sm text-zinc-600">
            Sign in to manage audits, NCRs, and leaderboards.
          </div>
        </div>

        <div className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
          {error && (
            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
              {error}
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-semibold text-zinc-700">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-blue-500"
                placeholder="you@company.com"
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-zinc-700">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full min-h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm outline-none focus:border-blue-500"
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-blue-600 px-5 text-base font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:opacity-50 active:scale-[0.99]"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

