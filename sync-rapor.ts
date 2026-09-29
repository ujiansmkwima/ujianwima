// =========================================================
// EDGE FUNCTION: sync-rapor  (project Supabase UJIANWIMA)
// Menarik siswa + kelas, guru, dan penugasan mapel dari project
// Supabase RAPORWIMA, lalu membuat/memperbarui akun di ujianwima.
//
// Secret yang harus diset (Project Settings > Edge Functions > Secrets):
//   RAPOR_URL          = https://iejpwxmcqwecejsrezry.supabase.co
//   RAPOR_SERVICE_KEY  = service_role key project RAPORWIMA
//   SISWA_EMAIL_DOMAIN = (opsional) default: siswa.ujianwima.local
//
// Aksi (POST, hanya admin ujianwima):
//   { action: "plan" }                                  -> ringkasan tanpa menulis apa pun
//   { action: "apply", kind: "guru" }                   -> buat/perbarui guru
//   { action: "apply", kind: "mapel" }                  -> buat mapel (subjects) per guru
//   { action: "apply", kind: "siswa", offset, limit }   -> siswa, bertahap
// Tidak pernah menghapus data.
// =========================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RAPOR_URL = Deno.env.get("RAPOR_URL") ?? "";
const RAPOR_SERVICE_KEY = Deno.env.get("RAPOR_SERVICE_KEY") ?? "";
const SISWA_DOMAIN = Deno.env.get("SISWA_EMAIL_DOMAIN") ?? "siswa.ujianwima.local";

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
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

// deno-lint-ignore no-explicit-any
async function fetchAll(build: (from: number, to: number) => any) {
  const out: any[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await build(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return out;
}

const norm = (s: unknown) => String(s ?? "").trim();
const lower = (s: unknown) => norm(s).toLowerCase();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!RAPOR_URL || !RAPOR_SERVICE_KEY) {
    return json({ error: "Secret RAPOR_URL dan RAPOR_SERVICE_KEY belum diset di Edge Functions." }, 500);
  }

  // --- hanya admin ujianwima ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Tidak terautentikasi" }, 401);

  const ujian = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: caller } = await ujian.from("profiles").select("role").eq("id", userData.user.id).single();
  if (!caller || caller.role !== "admin") return json({ error: "Hanya admin yang boleh menyinkronkan data" }, 403);

  const body = await req.json().catch(() => ({}));
  const action = body.action;
  const kind = body.kind;

  try {
    const rapor = createClient(RAPOR_URL, RAPOR_SERVICE_KEY);

    // ---------- baca data rapor ----------
    let taQuery = rapor.from("tahun_ajaran").select("id,nama,semester");
    taQuery = body.tahun_ajaran_id ? taQuery.eq("id", body.tahun_ajaran_id) : taQuery.eq("is_aktif", true);
    const { data: taRows, error: taErr } = await taQuery.limit(1);
    if (taErr) return json({ error: "Rapor: " + taErr.message }, 400);
    const ta = taRows?.[0];
    if (!ta) return json({ error: "Tidak ada tahun ajaran aktif di rapor." }, 400);

    // deno-lint-ignore no-explicit-any
    const skRows: any[] = await fetchAll((f, t) =>
      rapor.from("siswa_kelas")
        .select("no_absen, siswa(nis,nisn,nama), kelas(nama)")
        .eq("tahun_ajaran_id", ta.id).order("id").range(f, t)
    );
    // deno-lint-ignore no-explicit-any
    const guruRows: any[] = await fetchAll((f, t) =>
      rapor.from("profiles").select("id,nama,email").eq("role", "guru").order("id").range(f, t)
    );
    // deno-lint-ignore no-explicit-any
    const pgRows: any[] = await fetchAll((f, t) =>
      rapor.from("penugasan_guru")
        .select("guru_id, mata_pelajaran(nama), kelas(nama)")
        .eq("tahun_ajaran_id", ta.id).order("id").range(f, t)
    );

    // email guru rapor: profiles.email, cadangan dari auth
    const guruRapor: { id: string; nama: string; email: string }[] = [];
    for (const g of guruRows) {
      let email = lower(g.email);
      if (!email) {
        const { data: au } = await rapor.auth.admin.getUserById(g.id);
        email = lower(au?.user?.email);
      }
      if (email) guruRapor.push({ id: g.id, nama: norm(g.nama), email });
    }
    const guruTanpaEmail = guruRows.length - guruRapor.length;

    // siswa rapor -> {username, nama, kelas}
    const siswaErrors: string[] = [];
    const siswaRapor: { username: string; email: string; nama: string; kelas: string }[] = [];
    const seen = new Set<string>();
    for (const r of skRows) {
      const s = r.siswa, k = r.kelas;
      const username = norm(s?.nisn) || norm(s?.nis);
      if (!s || !k) continue;
      if (!username) { siswaErrors.push(`${s.nama}: tanpa NISN/NIS, dilewati`); continue; }
      if (seen.has(username)) { siswaErrors.push(`${s.nama}: NISN/NIS ${username} ganda, dilewati`); continue; }
      seen.add(username);
      siswaRapor.push({ username, email: `${username}@${SISWA_DOMAIN}`, nama: norm(s.nama), kelas: norm(k.nama) });
    }

    // ---------- data ujianwima ----------
    // deno-lint-ignore no-explicit-any
    const profUjian: any[] = await fetchAll((f, t) =>
      ujian.from("profiles").select("id,role,nama,username,email,kelas").order("id").range(f, t)
    );
    const siswaByUsername = new Map(profUjian.filter((p) => p.role === "siswa").map((p) => [lower(p.username), p]));
    const guruByEmail = new Map(profUjian.filter((p) => p.role === "guru").map((p) => [lower(p.email), p]));
    const usernames = new Set(profUjian.map((p) => lower(p.username)));
    // deno-lint-ignore no-explicit-any
    const subjUjian: any[] = await fetchAll((f, t) =>
      ujian.from("subjects").select("id,nama,guru_id").order("id").range(f, t)
    );
    const subjKey = (guruId: string, nama: string) => `${guruId}::${lower(nama)}`;
    const subjSet = new Set(subjUjian.map((s) => subjKey(s.guru_id, s.nama)));

    // ---------- rencana ----------
    const siswaBaru = siswaRapor.filter((s) => !siswaByUsername.has(lower(s.username)));
    const siswaUbah = siswaRapor.filter((s) => {
      const p = siswaByUsername.get(lower(s.username));
      return p && (norm(p.nama) !== s.nama || norm(p.kelas) !== s.kelas);
    });
    const guruBaru = guruRapor.filter((g) => !guruByEmail.has(g.email));
    const guruUbah = guruRapor.filter((g) => {
      const p = guruByEmail.get(g.email);
      return p && norm(p.nama) !== g.nama;
    });

    // pasangan (guru email, mapel) unik dari penugasan
    const raporGuruById = new Map(guruRapor.map((g) => [g.id, g]));
    const pasangan = new Map<string, { email: string; mapel: string }>();
    let penugasanTanpaGuru = 0;
    for (const p of pgRows) {
      const g = raporGuruById.get(p.guru_id);
      const mapel = norm(p.mata_pelajaran?.nama);
      if (!g || !mapel) { penugasanTanpaGuru++; continue; }
      pasangan.set(`${g.email}::${lower(mapel)}`, { email: g.email, mapel });
    }
    const mapelBaru = [...pasangan.values()].filter((x) => {
      const gu = guruByEmail.get(x.email);
      return !gu || !subjSet.has(subjKey(gu.id, x.mapel));
    });

    if (action === "plan") {
      return json({
        tahun_ajaran: `${ta.nama} ${ta.semester}`,
        siswa: { total: siswaRapor.length, baru: siswaBaru.length, diperbarui: siswaUbah.length, dilewati: siswaErrors.length },
        guru: { total: guruRapor.length, baru: guruBaru.length, diperbarui: guruUbah.length, tanpa_email: guruTanpaEmail },
        mapel: { total: pasangan.size, baru: mapelBaru.length, penugasan_tanpa_guru: penugasanTanpaGuru },
        peringatan: siswaErrors.slice(0, 20),
      });
    }

    if (action !== "apply") return json({ error: "Action tidak dikenal" }, 400);

    const errors: string[] = [];
    const credentials: { nama: string; username: string; password: string }[] = [];
    let dibuat = 0, diperbarui = 0;

    async function buatUser(role: "siswa" | "guru", nama: string, username: string, email: string, kelas: string | null) {
      const password = randomPassword();
      const { data: created, error } = await ujian.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { nama, username, role, kelas, ruang: null },
      });
      if (error) { errors.push(`${nama} (${username}): ${error.message}`); return null; }
      const { error: pErr } = await ujian.from("profiles").upsert({
        id: created.user.id, role, nama, username, email, kelas, ruang: null,
      });
      if (pErr) { errors.push(`${nama} (${username}): ${pErr.message}`); return null; }
      credentials.push({ nama, username, password });
      return created.user.id as string;
    }

    // ----- GURU -----
    if (kind === "guru") {
      for (const g of guruBaru) {
        // username = bagian sebelum @, diberi angka bila sudah dipakai
        const base = g.email.split("@")[0].replace(/[^a-z0-9._-]/g, "") || "guru";
        let username = base, n = 2;
        while (usernames.has(username.toLowerCase())) username = `${base}${n++}`;
        usernames.add(username.toLowerCase());
        const id = await buatUser("guru", g.nama, username, g.email, null);
        if (id) dibuat++;
      }
      for (const g of guruUbah) {
        const p = guruByEmail.get(g.email);
        const { error } = await ujian.from("profiles").update({ nama: g.nama }).eq("id", p.id);
        if (error) errors.push(`${g.nama}: ${error.message}`); else diperbarui++;
      }
      return json({ kind, dibuat, diperbarui, errors, credentials });
    }

    // ----- MAPEL -----
    if (kind === "mapel") {
      const rows: { nama: string; guru_id: string }[] = [];
      for (const x of mapelBaru) {
        const gu = guruByEmail.get(x.email);
        if (!gu) { errors.push(`Mapel "${x.mapel}": guru ${x.email} belum ada di ujianwima (jalankan sinkron guru dulu)`); continue; }
        rows.push({ nama: x.mapel, guru_id: gu.id });
      }
      if (rows.length) {
        const { error } = await ujian.from("subjects").insert(rows);
        if (error) errors.push(error.message); else dibuat = rows.length;
      }
      return json({ kind, dibuat, diperbarui: 0, errors, credentials: [] });
    }

    // ----- SISWA (bertahap) -----
    if (kind === "siswa") {
      const offset = Math.max(0, Number(body.offset) || 0);
      const limit = Math.min(100, Math.max(1, Number(body.limit) || 50));
      // Potong dari daftar lengkap rapor (urutan stabil), bukan dari daftar "baru",
      // supaya offset tidak bergeser setelah akun dibuat.
      const semua = siswaRapor;
      const potongan = semua.slice(offset, offset + limit);
      for (const s of potongan) {
        const p = siswaByUsername.get(lower(s.username));
        if (!p) {
          const id = await buatUser("siswa", s.nama, s.username, s.email, s.kelas);
          if (id) dibuat++;
        } else if (norm(p.nama) !== s.nama || norm(p.kelas) !== s.kelas) {
          const { error } = await ujian.from("profiles").update({ nama: s.nama, kelas: s.kelas }).eq("id", p.id);
          if (error) errors.push(`${s.nama}: ${error.message}`); else diperbarui++;
        }
      }
      const next = offset + potongan.length;
      return json({ kind, dibuat, diperbarui, errors, credentials, total: semua.length, next, selesai: next >= semua.length });
    }

    return json({ error: "kind tidak dikenal" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
