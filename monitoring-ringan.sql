-- =====================================================================
-- Monitoring ringan untuk 300 peserta (Supabase FREE tier)
-- Jalankan di Supabase -> SQL Editor. Aman dijalankan ulang.
-- Tidak memakai Realtime sama sekali (batas free: 200 koneksi, 100 pesan/dtk).
-- =====================================================================

-- 0) Jika sebelumnya sudah menjalankan monitoring-realtime.sql, cabut dari Realtime
do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname='supabase_realtime' and schemaname='public' and tablename='exam_attempts') then
    alter publication supabase_realtime drop table public.exam_attempts;
  end if;
end $$;

-- 1) Kolom pendukung
alter table public.exam_attempts add column if not exists last_seen timestamptz;
alter table public.exam_attempts add column if not exists answered_count int not null default 0;
alter table public.exam_attempts add column if not exists updated_at timestamptz not null default now();
create index if not exists exam_attempts_updated_at_idx on public.exam_attempts (updated_at);

-- 2) Trigger: setiap perubahan (simpan jawaban, keluar tab, selesai) otomatis
--    memperbarui updated_at, last_seen, dan jumlah soal terjawab.
create or replace function public.exam_attempts_touch()
returns trigger language plpgsql as $$
declare
  j jsonb;
  n int;
begin
  new.updated_at := now();
  if new.status::text = 'mengerjakan' then
    new.last_seen := now();
  end if;

  j := to_jsonb(new.jawaban);
  if tg_op = 'INSERT' or j is distinct from to_jsonb(old.jawaban) then
    if j is not null and jsonb_typeof(j) = 'object' then
      select count(*) into n
      from jsonb_each(j) e
      where e.value not in ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb);
      new.answered_count := coalesce(n, 0);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_exam_attempts_touch on public.exam_attempts;
create trigger trg_exam_attempts_touch
  before insert or update on public.exam_attempts
  for each row execute function public.exam_attempts_touch();

-- 3) Cek peran staf (guru/admin/panitia)
create or replace function public.is_staff()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role::text in ('guru','admin','panitia'));
$$;

-- 4) Heartbeat siswa (sangat ringan; hanya mengubah attempt miliknya sendiri)
create or replace function public.exam_heartbeat(p_attempt uuid)
returns void language sql security definer set search_path = public as $$
  update public.exam_attempts
     set last_seen = now()
   where id = p_attempt and user_id = auth.uid() and status::text = 'mengerjakan';
$$;
revoke all on function public.exam_heartbeat(uuid) from public;
grant execute on function public.exam_heartbeat(uuid) to authenticated;

-- 5) Monitoring DELTA untuk guru: hanya baris yang berubah sejak p_since, kolom ringan saja
create or replace function public.monitoring_delta(p_since timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  result jsonb;
begin
  if not public.is_staff() then
    raise exception 'tidak diizinkan';
  end if;

  select jsonb_build_object(
    'now', now(),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id,
        'schedule_id', a.schedule_id,
        'user_id', a.user_id,
        'status', a.status,
        'mulai', a.mulai,
        'selesai', a.selesai,
        'percobaan_keluar', coalesce(a.percobaan_keluar, 0),
        'answered_count', a.answered_count,
        'seen_ago', case when a.last_seen is null then null
                         else extract(epoch from (now() - a.last_seen))::int end
    )), '[]'::jsonb))
  into result
  from public.exam_attempts a
  where (p_since is not null and a.updated_at >= p_since)
     or (p_since is null and (a.status::text = 'mengerjakan'
                              or a.updated_at > now() - interval '36 hours'));
  return result;
end $$;
revoke all on function public.monitoring_delta(timestamptz) from public;
grant execute on function public.monitoring_delta(timestamptz) to authenticated;
