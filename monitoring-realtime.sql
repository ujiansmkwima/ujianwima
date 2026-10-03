-- =====================================================================
-- Monitoring realtime — jalankan di Supabase → SQL Editor (aman diulang)
-- =====================================================================

-- 1) Aktifkan Realtime untuk tabel exam_attempts
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'exam_attempts'
  ) then
    alter publication supabase_realtime add table public.exam_attempts;
  end if;
end $$;

-- 2) Pastikan guru/admin/panitia boleh MEMBACA semua exam_attempts
--    (tanpa ini monitoring kosong dan event realtime tidak sampai ke guru)
create or replace function public.is_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('guru','admin','panitia')
  );
$$;

alter table public.exam_attempts enable row level security;

drop policy if exists "staff_select_exam_attempts" on public.exam_attempts;
create policy "staff_select_exam_attempts" on public.exam_attempts
  for select to authenticated
  using (public.is_staff());
