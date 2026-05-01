"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getCurrentUser, getRoleHomeRoute } from "@/lib/auth";

export default function UnauthorizedPage() {
  const [home, setHome] = useState("/login");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await getCurrentUser();
      if (cancelled) return;
      setHome(getRoleHomeRoute(user?.role));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-zinc-100 px-4 py-10 text-zinc-950">
      <div className="mx-auto w-full max-w-lg">
        <div className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm sm:p-8">
          <div className="text-xl font-semibold tracking-tight text-zinc-900">
            You don&apos;t have permission to view this page
          </div>
          <div className="mt-2 text-sm text-zinc-600">
            If you believe this is a mistake, contact your administrator.
          </div>

          <div className="mt-6">
            <Link
              href={home}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-zinc-900 px-5 text-base font-semibold text-white shadow-sm hover:bg-zinc-800 active:scale-[0.99]"
            >
              Go back
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

