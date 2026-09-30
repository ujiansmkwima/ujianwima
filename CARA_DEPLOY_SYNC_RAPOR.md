# Sinkron Rapor → Ujianwima

## File
- `sync-rapor.ts` → edge function baru di project **ujianwima** (nama function: `sync-rapor`)
- `admin.html` → ganti file lama (tambahan: tab "Sinkron Rapor")

## Deploy
1. Supabase ujianwima → Edge Functions → buat function `sync-rapor`, tempel isi `sync-rapor.ts`, deploy.
2. Edge Functions → Secrets, tambahkan:
   - `RAPOR_URL` = `https://iejpwxmcqwecejsrezry.supabase.co`
   - `RAPOR_SERVICE_KEY` = service_role key project **rapor** (Project Settings → API di project rapor). Jangan ditaruh di file HTML.
   - `SISWA_EMAIL_DOMAIN` (opsional, default `siswa.ujianwima.local`)
3. Upload `admin.html` yang baru, login admin → tab **Sinkron Rapor**.

## Aturan pencocokan
- Siswa: **username = NIS** (wajib; siswa tanpa NIS dilewati dan muncul di peringatan, tidak ada cadangan NISN). Email otomatis `<NIS>@siswa.ujianwima.local`. Kelas = nama kelas di rapor pada tahun ajaran aktif. Akun lama yang username-nya NISN otomatis dimigrasikan ke NIS.
- Guru: dicocokkan lewat email (`profiles.email` rapor, cadangan dari akun login rapor). Username = bagian sebelum `@`.
- Mata pelajaran: pasangan unik (guru, nama mapel) dari `penugasan_guru`; kelas yang diampu tidak disimpan.
- Kata sandi awal akun baru: **siswa = `siswa123`**, **guru = `guruku123`** (semua sama).
- Akun yang sudah ada tidak diubah kata sandinya, kecuali kotak "Setel ulang kata sandi akun yang sudah ada" dicentang di tab Sinkron Rapor.
- Ganti default lewat konstanta `DEFAULT_PASSWORD_SISWA` / `DEFAULT_PASSWORD_GURU` di `sync-rapor.ts`.
- Tidak ada data yang dihapus. Aman dijalankan ulang.

---

# Peran Panitia

Akun panitia dibuat admin (tab **Panitia** di `admin.html`), lalu login lewat tab **Panitia** di `index.html`. Panitia diarahkan ke `panitia.html` (hanya lihat: jadwal, token, ruang & peserta).

## Deploy
1. Supabase → SQL Editor: jalankan `panitia-setup.sql` — **Bagian 1** dulu, lalu **Bagian 2** (dijalankan terpisah).
2. Edge Functions → deploy ulang `manage-users` (isi dari `manage-users.ts`; `admin-user.ts` identik).
3. Upload `index.html`, `admin.html`, `panitia.html` yang baru.
