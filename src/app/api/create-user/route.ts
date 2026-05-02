import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

type Body = {
  email?: string;
  password?: string;
  fullName?: string | null;
  role?: string;
  orgId?: string | null;
  plantId?: string | null;
  zoneId?: string | null;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  const fullName = body.fullName?.trim() ?? "";
  const role = body.role?.trim() ?? "";
  const orgId = body.orgId ?? null;
  const plantId = body.plantId ?? null;
  const zoneId = body.zoneId ?? null;

  if (!email || !password || password.length < 8) {
    return NextResponse.json(
      {
        success: false,
        error: "email and password (min 8 characters) are required",
      },
      { status: 400 },
    );
  }
  if (!fullName || !role) {
    return NextResponse.json(
      { success: false, error: "fullName and role are required" },
      { status: 400 },
    );
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!serviceKey || !supabaseUrl) {
    return NextResponse.json(
      {
        success: false,
        error: "Server misconfigured: SUPABASE_SERVICE_ROLE_KEY or URL missing",
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

  const { data: callerProfile, error: callerProfileError } = await supabase
    .from("user_profiles")
    .select("role, org_id, plant_id")
    .eq("id", user.id)
    .maybeSingle();

  if (callerProfileError || !callerProfile) {
    return NextResponse.json(
      { success: false, error: "Forbidden" },
      { status: 403 },
    );
  }

  const callerRole = String(callerProfile.role ?? "").toLowerCase();
  if (callerRole !== "super_admin" && callerRole !== "admin") {
    return NextResponse.json(
      { success: false, error: "Forbidden" },
      { status: 403 },
    );
  }

  if (callerRole === "admin") {
    if (orgId !== callerProfile.org_id) {
      return NextResponse.json(
        { success: false, error: "org mismatch" },
        { status: 403 },
      );
    }
    if (!callerProfile.plant_id) {
      return NextResponse.json(
        {
          success: false,
          error: "Complete plant setup before creating users",
        },
        { status: 403 },
      );
    }
    if (!plantId) {
      return NextResponse.json(
        { success: false, error: "plantId is required" },
        { status: 400 },
      );
    }
  }

  const adminSupabase = createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  if (callerRole === "admin" && plantId) {
    const { data: plantForOrg, error: plantLookupErr } = await adminSupabase
      .from("plants")
      .select("org_id")
      .eq("id", plantId)
      .maybeSingle();
    if (plantLookupErr || !plantForOrg) {
      return NextResponse.json(
        { success: false, error: "Plant not found" },
        { status: 400 },
      );
    }
    if (plantForOrg.org_id !== callerProfile.org_id) {
      return NextResponse.json(
        {
          success: false,
          error: "Plant does not belong to your organisation",
        },
        { status: 403 },
      );
    }
  }

  const roleLower = role.toLowerCase();
  if (roleLower === "zone_leader") {
    if (!zoneId || !plantId || !orgId) {
      return NextResponse.json(
        {
          success: false,
          error: "zone_leader requires zoneId, plantId, and orgId",
        },
        { status: 400 },
      );
    }
    const { data: zoneRow, error: zoneErr } = await adminSupabase
      .from("zones")
      .select("id, leader_id, plant_id, org_id")
      .eq("id", zoneId)
      .maybeSingle();
    if (zoneErr || !zoneRow) {
      return NextResponse.json(
        { success: false, error: "Zone not found" },
        { status: 400 },
      );
    }
    if (zoneRow.leader_id) {
      return NextResponse.json(
        { success: false, error: "Zone already has a leader assigned" },
        { status: 400 },
      );
    }
    if (zoneRow.plant_id !== plantId || zoneRow.org_id !== orgId) {
      return NextResponse.json(
        { success: false, error: "Zone does not match org/plant" },
        { status: 403 },
      );
    }
  }

  const { data: created, error: createError } =
    await adminSupabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

  if (createError || !created.user) {
    return NextResponse.json(
      { success: false, error: createError?.message ?? "Failed to create user" },
      { status: 400 },
    );
  }

  const newUser = created.user;

  const { error: profileInsertError } = await adminSupabase
    .from("user_profiles")
    .insert({
      id: newUser.id,
      full_name: fullName,
      role,
      org_id: orgId,
      plant_id: plantId,
      is_active: true,
      force_password_change: true,
    });

  if (profileInsertError) {
    return NextResponse.json(
      {
        success: false,
        error: `Auth user created but profile failed: ${profileInsertError.message}`,
      },
      { status: 500 },
    );
  }

  const isZoneLeader = roleLower === "zone_leader" && zoneId && plantId && orgId;

  if (isZoneLeader) {
    const { error: statsErr } = await adminSupabase
      .from("zone_leader_stats")
      .insert({
        user_id: newUser.id,
        zone_id: zoneId,
        org_id: orgId,
        plant_id: plantId,
        xp: 0,
        level: 1,
        streak_days: 0,
      });
    if (statsErr) {
      return NextResponse.json(
        {
          success: false,
          error: `User created but zone_leader_stats failed: ${statsErr.message}`,
        },
        { status: 500 },
      );
    }

    const { error: zoneErr } = await adminSupabase
      .from("zones")
      .update({ leader_id: newUser.id })
      .eq("id", zoneId);
    if (zoneErr) {
      return NextResponse.json(
        {
          success: false,
          error: `User created but zone update failed: ${zoneErr.message}`,
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ success: true, userId: newUser.id });
}
