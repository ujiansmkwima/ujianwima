import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function randomPassword() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Tidak terautentikasi" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (!callerProfile || callerProfile.role !== "admin") {
    return json({ error: "Hanya admin yang boleh mengelola akun" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action;

  try {
    if (action === "create_user") {
      const { nama, username, email, role, kelas, ruang } = body;
      if (!nama || !username || !email || !role) {
        return json({ error: "Data belum lengkap" }, 400);
      }
      if (!["siswa", "guru", "admin"].includes(role)) {
        return json({ error: "Role tidak valid" }, 400);
      }
      const password = body.password || randomPassword();
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nama, username, role, kelas: kelas ?? null, ruang: ruang ?? null },
      });
      if (createErr) return json({ error: createErr.message }, 400);

      // Ensure a profiles row exists for this user (in case there's no DB trigger for it)
      const { error: profileErr } = await admin.from("profiles").upsert({
        id: created.user.id,
        role,
        nama,
        username,
        email,
        kelas: kelas ?? null,
        ruang: ruang ?? null,
      });
      if (profileErr) return json({ error: profileErr.message }, 400);

      return json({ id: created.user.id, password });
    }

    if (action === "update_user") {
      const { id, nama, username, email, kelas, ruang } = body;
      if (!id) return json({ error: "id wajib diisi" }, 400);

      if (email) {
        const { error: emailErr } = await admin.auth.admin.updateUserById(id, {
          email,
          email_confirm: true,
        });
        if (emailErr) return json({ error: emailErr.message }, 400);
      }

      const patch: Record<string, unknown> = {};
      if (nama !== undefined) patch.nama = nama;
      if (username !== undefined) patch.username = username;
      if (email !== undefined) patch.email = email;
      if (kelas !== undefined) patch.kelas = kelas;
      if (ruang !== undefined) patch.ruang = ruang;

      if (Object.keys(patch).length > 0) {
        const { error: profErr } = await admin.from("profiles").update(patch).eq("id", id);
        if (profErr) return json({ error: profErr.message }, 400);
      }
      return json({ ok: true });
    }

    if (action === "delete_user") {
      const { id } = body;
      if (!id) return json({ error: "id wajib diisi" }, 400);
      const { error: delErr } = await admin.auth.admin.deleteUser(id);
      if (delErr) return json({ error: delErr.message }, 400);
      return json({ ok: true });
    }

    if (action === "reset_password") {
      const { id } = body;
      if (!id) return json({ error: "id wajib diisi" }, 400);
      const password = body.password || randomPassword();
      const { error: updErr } = await admin.auth.admin.updateUserById(id, { password });
      if (updErr) return json({ error: updErr.message }, 400);
      return json({ ok: true, password });
    }

    return json({ error: "Action tidak dikenal" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
