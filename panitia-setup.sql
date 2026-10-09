-- =====================================================================
-- Setup peran PANITIA — jalankan di Supabase → SQL Editor
-- Jalankan BAGIAN 1 dulu, klik Run, lalu BAGIAN 2 (terpisah).
-- Aman dijalankan ulang.
-- =====================================================================

-- ---------------------------------------------------------------------
-- BAGIAN 1 — izinkan nilai role 'panitia' di tabel profiles
-- (menangani dua kemungkinan: kolom bertipe enum, atau text + CHECK)
-- ---------------------------------------------------------------------
do $$
declare
  v_type text;
  v_udt  text;
  c record;
begin
  select data_type, udt_name into v_type, v_udt
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles' and column_name = 'role';

  if v_type = 'USER-DEFINED' then
    execute format('alter type %I add value if not exists %L', v_udt, 'panitia');
  else
    for c in
      select conname from pg_constraint
      where conrelid = 'public.profiles'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%role%'
    loop
      execute format('alter table public.profiles drop constraint %I', c.conname);
    end loop;
    alter table public.profiles
      add constraint profiles_role_check
      check (role in ('siswa','guru','panitia','admin'));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- BAGIAN 2 — izin BACA (read-only) untuk panitia
-- Panitia tidak diberi izin tulis/ubah/hapus apa pun.
-- ---------------------------------------------------------------------
drop policy if exists "panitia_select_profiles" on profiles;
create policy "panitia_select_profiles" on profiles
  for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'panitia'));

drop policy if exists "panitia_select_subjects" on subjects;
create policy "panitia_select_subjects" on subjects
  for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'panitia'));

drop policy if exists "panitia_select_question_sets" on question_sets;
create policy "panitia_select_question_sets" on question_sets
  for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'panitia'));

drop policy if exists "panitia_select_schedules" on schedules;
create policy "panitia_select_schedules" on schedules
  for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'panitia'));

drop policy if exists "panitia_select_rooms" on rooms;
create policy "panitia_select_rooms" on rooms
  for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'panitia'));

drop policy if exists "panitia_select_supervisors" on supervisors;
create policy "panitia_select_supervisors" on supervisors
  for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'panitia'));

-- ---------------------------------------------------------------------
-- BAGIAN 3 — izin TULIS untuk panitia (menu Pembagian Ruang,
-- Guru Pengawas, dan Penjadwalan). Jalankan setelah BAGIAN 2.
-- ---------------------------------------------------------------------
drop policy if exists "panitia_write_rooms" on rooms;
create policy "panitia_write_rooms" on rooms
  for all to authenticated
  using (public.is_panitia()) with check (public.is_panitia());

drop policy if exists "panitia_write_supervisors" on supervisors;
create policy "panitia_write_supervisors" on supervisors
  for all to authenticated
  using (public.is_panitia()) with check (public.is_panitia());

drop policy if exists "panitia_write_schedules" on schedules;
create policy "panitia_write_schedules" on schedules
  for all to authenticated
  using (public.is_panitia()) with check (public.is_panitia());

-- Panitia boleh mengubah profil SISWA (untuk membagi ruang), tapi hanya kolom "ruang".
drop policy if exists "panitia_update_siswa_ruang" on profiles;
create policy "panitia_update_siswa_ruang" on profiles
  for update to authenticated
  using (public.is_panitia() and role::text = 'siswa')
  with check (public.is_panitia() and role::text = 'siswa');

create or replace function public.panitia_only_ruang()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_panitia() and (to_jsonb(new) - 'ruang') is distinct from (to_jsonb(old) - 'ruang') then
    raise exception 'Panitia hanya boleh mengubah kolom ruang';
  end if;
  return new;
end $$;

drop trigger if exists trg_panitia_only_ruang on profiles;
create trigger trg_panitia_only_ruang
  before update on profiles
  for each row execute function public.panitia_only_ruang();


-- ---------------------------------------------------------------------
-- BAGIAN 4 — tabel ALOKASI WAKTU (menu Alokasi Waktu panitia).
-- Menyimpan jam ke → waktu mulai & berakhir per hari.
-- Semua pengguna login boleh membaca; hanya panitia yang boleh menulis.
-- Jalankan setelah BAGIAN 3. Aman dijalankan ulang.
-- ---------------------------------------------------------------------
create table if not exists public.time_slots (
  id         uuid primary key default gen_random_uuid(),
  hari       text not null check (hari in ('Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu')),
  jam_ke     integer not null check (jam_ke > 0),
  mulai      time not null,
  selesai    time not null,
  created_at timestamptz not null default now(),
  unique (hari, jam_ke),
  check (selesai > mulai)
);

alter table public.time_slots enable row level security;

drop policy if exists "time_slots_select" on public.time_slots;
create policy "time_slots_select" on public.time_slots
  for select to authenticated using (true);

drop policy if exists "panitia_write_time_slots" on public.time_slots;
create policy "panitia_write_time_slots" on public.time_slots
  for all to authenticated
  using (public.is_panitia()) with check (public.is_panitia());


-- ---------------------------------------------------------------------
-- BAGIAN 5 — tabel JADWAL TULIS (menu Jadwal Tulis panitia).
-- Jadwal ujian tulis yang diterbitkan panitia (hasil unggah Excel) sebagai
-- INFORMASI untuk siswa — terpisah dari tabel schedules (penjadwalan soal).
-- Waktu mulai/selesai tidak disimpan di sini: diambil dari time_slots
-- (Alokasi Waktu) berdasarkan hari dari tanggal dan jam ke.
-- Semua pengguna login boleh membaca; hanya panitia yang boleh menulis.
-- Jalankan setelah BAGIAN 4. Aman dijalankan ulang.
-- ---------------------------------------------------------------------
create table if not exists public.jadwal_tulis (
  id           uuid primary key default gen_random_uuid(),
  tanggal      date not null,
  mapel        text not null,
  tingkat      text[] not null default '{}',   -- kosong = semua tingkat
  kelas        text[] not null default '{}',
  semua_kelas  boolean not null default false,
  jam_ke       integer[] not null default '{}',
  semua_jam    boolean not null default false,
  created_at   timestamptz not null default now(),
  check (semua_kelas or cardinality(kelas) > 0),
  check (semua_jam or cardinality(jam_ke) > 0)
);

-- Untuk yang sudah menjalankan BAGIAN 5 sebelumnya: tambahkan kolom tingkat.
alter table public.jadwal_tulis add column if not exists tingkat text[] not null default '{}';

create index if not exists jadwal_tulis_tanggal_idx on public.jadwal_tulis (tanggal);

alter table public.jadwal_tulis enable row level security;

drop policy if exists "jadwal_tulis_select" on public.jadwal_tulis;
create policy "jadwal_tulis_select" on public.jadwal_tulis
  for select to authenticated using (true);

drop policy if exists "panitia_write_jadwal_tulis" on public.jadwal_tulis;
create policy "panitia_write_jadwal_tulis" on public.jadwal_tulis
  for all to authenticated
  using (public.is_panitia()) with check (public.is_panitia());
