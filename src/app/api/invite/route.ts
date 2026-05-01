import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

type InviteBody = {
  email?: string;
  fullName?: string | null;
  role?: string;
  orgId?: string | null;
  plantId?: string | null;
  zoneId?: string | null;
};

export async function POST(request: Request) {
  let body: InviteBody;
  try {
    body = (await request.json()) as InviteBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json(
      { success: false, error: "email is required" },
      { status: 400 },
    );
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!serviceKey || !appUrl || !supabaseUrl) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Server misconfigured: SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_APP_URL missing",
      },
      { status: 500 },
    );
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    supabaseUrl,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("role, org_id, plant_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return NextResponse.json(
      { success: false, error: "Forbidden" },
      { status: 403 },
    );
  }

  const callerRole = String(profile.role ?? "").toLowerCase();
  if (callerRole !== "super_admin" && callerRole !== "admin") {
    return NextResponse.json(
      { success: false, error: "Forbidden" },
      { status: 403 },
    );
  }

  const role = body.role?.trim() ?? "";
  const orgId = body.orgId ?? null;
  const plantId = body.plantId ?? null;
  const zoneId = body.zoneId ?? null;
  const fullName = body.fullName?.trim() ?? null;

  if (callerRole === "admin") {
    if (orgId !== profile.org_id || plantId !== profile.plant_id) {
      return NextResponse.json(
        { success: false, error: "org/plant mismatch" },
        { status: 403 },
      );
    }
  }

  const adminSupabase = createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const redirectTo = `${appUrl.replace(/\/$/, "")}/onboarding`;

  const { error: inviteError } =
    await adminSupabase.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name: fullName,
        role,
        org_id: orgId,
        plant_id: plantId,
        zone_id: zoneId,
      },
      redirectTo,
    });

  if (inviteError) {
    return NextResponse.json(
      { success: false, error: inviteError.message },
      { status: 400 },
    );
  }

  const { error: pendingError } = await adminSupabase
    .from("pending_invites")
    .insert({
      email,
      full_name: fullName,
      role,
      org_id: orgId,
      plant_id: plantId,
      zone_id: zoneId,
    });

  if (pendingError) {
    return NextResponse.json(
      {
        success: false,
        error: `Invite sent but pending_invites insert failed: ${pendingError.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
