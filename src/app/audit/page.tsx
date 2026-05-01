"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import supabase from "@/lib/supabase";

type ZoneLeader = {
  id: string;
  name: string | null;
  zone_id: string | null;
  zones?: { name: string | null } | { name: string | null }[] | null;
};

type AuditTemplate = {
  id: string;
  name: string | null;
  items: unknown;
};

type AuditItem = {
  id: string;
  pillar:
    | "Sort"
    | "Set"
    | "Shine"
    | "Standardise"
    | "Sustain"
    | "Safety"
    | string;
  text: string;
};

type ResponseDraft = {
  item_id: string;
  score: 0 | 1 | 2 | 3 | 4;
  notes: string | null;
  photoFile: File | null;
};

type ScreenState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "in_progress";
      leader: ZoneLeader;
      template: AuditTemplate;
      items: AuditItem[];
      index: number;
      answers: Record<string, ResponseDraft>;
    }
  | {
      status: "submitting";
      leader: ZoneLeader;
      template: AuditTemplate;
      items: AuditItem[];
      answers: Record<string, ResponseDraft>;
    }
  | {
      status: "done";
      score: number;
      xpEarned: number;
      photosUploaded: number;
      breakdown: Record<string, { earned: number; max: number }>;
    };

function getZoneName(leader: ZoneLeader) {
  const zones = leader.zones;
  if (!zones) return null;
  if (Array.isArray(zones)) return zones[0]?.name ?? null;
  return zones.name ?? null;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

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

function pillarPillClass(pillar: string) {
  switch (pillar) {
    case "Sort":
      return "bg-blue-50 text-blue-700 ring-blue-200";
    case "Set":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "Shine":
      return "bg-yellow-50 text-yellow-800 ring-yellow-200";
    case "Standardise":
      return "bg-purple-50 text-purple-700 ring-purple-200";
    case "Sustain":
      return "bg-orange-50 text-orange-700 ring-orange-200";
    case "Safety":
      return "bg-rose-50 text-rose-700 ring-rose-200";
    default:
      return "bg-zinc-100 text-zinc-700 ring-zinc-200";
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

export default function AuditPage() {
  const [state, setState] = useState<ScreenState>({ status: "loading" });
  const [photoOpenFor, setPhotoOpenFor] = useState<string | null>(null);
  const [photoPreviewUrlByItemId, setPhotoPreviewUrlByItemId] = useState<
    Record<string, string>
  >({});

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
      const { data: leader, error: leaderError } = await supabase
        .from("zone_leaders")
        .select("id,name,zone_id,zones(name)")
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

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

      const { data: template, error: templateError } = await supabase
        .from("audit_templates")
        .select("id,name,items")
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      if (templateError) {
        setState({ status: "error", message: templateError.message });
        return;
      }

      if (!template) {
        setState({
          status: "error",
          message: "No audit template found. Seed the database, then refresh.",
        });
        return;
      }

      const items = parseItems((template as AuditTemplate).items);
      if (items.length === 0) {
        setState({
          status: "error",
          message:
            "Audit template has no valid items. Ensure `items` is a JSON array with {id,pillar,text}.",
        });
        return;
      }

      setState({
        status: "in_progress",
        leader: leader as ZoneLeader,
        template: template as AuditTemplate,
        items,
        index: 0,
        answers: {},
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const view = useMemo(() => {
    if (state.status !== "in_progress") return null;
    const item = state.items[state.index];
    const existing = item ? state.answers[item.id] : undefined;
    return { item, existing };
  }, [state]);

  async function submitAudit(
    leader: ZoneLeader,
    items: AuditItem[],
    answers: Record<string, ResponseDraft>,
  ) {
    const total = items.length;
    const sumScores = items.reduce((acc, item) => {
      const a = answers[item.id];
      return acc + Number(a?.score ?? 0);
    }, 0);

    const score =
      total === 0 ? 0 : (sumScores / (Math.max(1, total) * 4)) * 100;
    const xpEarned = 50;

    const { data: session, error: sessionError } = await supabase
      .from("audit_sessions")
      .insert({
        zone_id: leader.zone_id,
        leader_id: leader.id,
        type: "self",
        score,
        completed_at: new Date().toISOString(),
        xp_earned: xpEarned,
      })
      .select("id")
      .single();

    if (sessionError) throw new Error(sessionError.message);

    const sessionId = (session as { id: string }).id;

    const uploadTargets = items
      .map((item) => {
        const a = answers[item.id];
        const file = a?.photoFile ?? null;
        if (!file) return null;
        const ext = extFromMimeOrName(file);
        const path = `audit-photos/${leader.id}/${sessionId}/${item.id}.${ext}`;
        return { itemId: item.id, file, path };
      })
      .filter(Boolean) as { itemId: string; file: File; path: string }[];

    const photoUrlByItemId = new Map<string, string>();
    for (const t of uploadTargets) {
      const { error: uploadError } = await supabase.storage
        .from("audit-photos")
        .upload(t.path, t.file, { upsert: true });
      if (uploadError) throw new Error(uploadError.message);

      const { data } = supabase.storage.from("audit-photos").getPublicUrl(t.path);
      if (data?.publicUrl) photoUrlByItemId.set(t.itemId, data.publicUrl);
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

    const breakdown = items.reduce(
      (acc, item) => {
        const pillar = item.pillar || "Unknown";
        const a = answers[item.id];
        const earned = Number(a?.score ?? 0);
        const max = 4;

        acc[pillar] = acc[pillar] ?? { earned: 0, max: 0 };
        acc[pillar].earned += earned;
        acc[pillar].max += max;
        return acc;
      },
      {} as Record<string, { earned: number; max: number }>,
    );

    return { score, xpEarned, breakdown, photosUploaded: uploadTargets.length };
  }

  const pageShell =
    "min-h-screen w-full bg-zinc-100 px-4 py-6 text-zinc-950 sm:px-6 sm:py-10";
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
              href="/dashboard"
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === "done") {
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

          <div className="mt-4 rounded-2xl bg-blue-50 px-4 py-4">
            <div className="text-sm font-semibold text-blue-700">XP Earned</div>
            <div className="mt-1 text-2xl font-semibold text-blue-900">
              +{state.xpEarned}
            </div>
          </div>

          <div className="mt-3 text-sm font-semibold text-zinc-700">
            {state.photosUploaded} photos uploaded
          </div>

          <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="text-sm font-semibold text-zinc-700">
              Per-pillar breakdown
            </div>
            <div className="mt-3 space-y-2 text-sm">
              {[
                ["Sort", 28],
                ["Set", 44],
                ["Shine", 44],
                ["Standardise", 44],
                ["Sustain", 36],
                ["Safety", 36],
              ].map(([pillar, max]) => (
                <div
                  key={pillar}
                  className="flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2"
                >
                  <div className="font-semibold text-zinc-800">{pillar}</div>
                  <div className="font-semibold text-zinc-900">
                    {(state.breakdown[pillar]?.earned ?? 0)}/{max}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Link
            href="/dashboard"
            className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-zinc-900 px-5 text-base font-semibold text-white"
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
            Saving your audit session and responses.
          </div>
          <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-zinc-200">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-blue-600" />
          </div>
        </div>
      </div>
    );
  }

  // in progress
  const leader = state.leader;
  const template = state.template;
  const items = state.items;
  const index = state.index;
  const item = view?.item;
  const existing = view?.existing;

  const total = items.length;
  const current = index + 1;
  const progress = clamp(current / total, 0, 1);
  const zoneName = getZoneName(leader) ?? "Unknown zone";

  const showEvidence =
    false;

  const handlePrevious = () => {
    if (index === 0) return;
    setState((s) => {
      if (s.status !== "in_progress") return s;
      return {
        ...s,
        index: s.index - 1,
      };
    });
  };

  const recordAnswer = (scoreValue: 0 | 1 | 2 | 3 | 4) => {
    if (!item) return;

    setState((s) => {
      if (s.status !== "in_progress") return s;
      if (!item) return s;

      const prev = s.answers[item.id];
      const nextAnswers: Record<string, ResponseDraft> = {
        ...s.answers,
        [item.id]: {
          item_id: item.id,
          score: scoreValue,
          notes: null,
          photoFile: prev?.photoFile ?? null,
        },
      };

      const nextIndex = s.index + 1;
      if (nextIndex >= s.items.length) {
        const submitting: ScreenState = {
          status: "submitting",
          leader: s.leader,
          template: s.template,
          items: s.items,
          answers: nextAnswers,
        };
        void (async () => {
          try {
            const { score, xpEarned, breakdown, photosUploaded } =
              await submitAudit(
              s.leader,
              s.items,
              nextAnswers,
            );
            setState({
              status: "done",
              score,
              xpEarned,
              breakdown,
              photosUploaded,
            });
          } catch (e) {
            setState({
              status: "error",
              message: e instanceof Error ? e.message : "Submission failed.",
            });
          }
        })();
        return submitting;
      }

      return {
        ...s,
        answers: nextAnswers,
        index: nextIndex,
      };
    });
  };

  return (
    <div className={pageShell}>
      <div className={cardShell}>
        <div className="flex flex-col gap-1">
          <div className="text-sm font-semibold text-zinc-500">
            {template.name ?? "Audit"} • {zoneName}
          </div>
          <div className="text-lg font-semibold">
            Question {current} of {total}
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-200">
            <div
              className="h-full rounded-full bg-blue-600 transition-all"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </div>

        <div className="mt-6">
          <div
            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ring-1 ${pillarPillClass(item.pillar)}`}
          >
            {item.pillar}
          </div>

          <div className="mt-4 text-[20px] font-semibold leading-7 tracking-tight sm:text-2xl">
            {item.text}
          </div>

          <div className="mt-6">
            <div className="text-sm font-semibold text-zinc-600">
              Score (0–4)
            </div>
            <div className="mt-3 grid grid-cols-5 gap-2">
              {([0, 1, 2, 3, 4] as const).map((n) => {
                const selected = existing?.score === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => recordAnswer(n)}
                    className={[
                      "min-h-12 w-full rounded-2xl border text-base font-semibold shadow-sm transition active:scale-[0.99]",
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
            <div className="mt-3 text-xs text-zinc-500">
              0 = No Compliance • 1 = Very Little • 2 = Some • 3 = Significant •
              4 = Total Compliance
            </div>
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={() =>
                setPhotoOpenFor((cur) => (cur === item.id ? null : item.id))
              }
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm transition hover:bg-zinc-50"
            >
              <span aria-hidden>📷</span>
              Add Photo (optional)
            </button>

            {photoOpenFor === item.id && (
              <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="block w-full text-sm file:mr-4 file:rounded-xl file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
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
                      const prev = s.answers[item.id];
                      return {
                        ...s,
                        answers: {
                          ...s.answers,
                          [item.id]: {
                            item_id: item.id,
                            score: prev?.score ?? 0,
                            notes: prev?.notes ?? null,
                            photoFile: file,
                          },
                        },
                      };
                    });
                  }}
                />

                {existing?.photoFile ? (
                  <div className="mt-3 flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt="Selected evidence"
                      src={photoPreviewUrlByItemId[item.id]}
                      className="h-14 w-14 rounded-xl object-cover ring-1 ring-black/5"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-zinc-900">
                        {existing.photoFile.name}
                      </div>
                      <div className="text-xs text-zinc-500">Ready to upload</div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-zinc-500">
                    Choose an image to attach to this question.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={handlePrevious}
              disabled={index === 0}
              className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>

            <div className="text-xs text-zinc-500">
              Tap a score to continue
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


