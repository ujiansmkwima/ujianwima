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
- Siswa: username = NISN (jika kosong, NIS). Email otomatis `<username>@siswa.ujianwima.local`. Kelas = nama kelas di rapor pada tahun ajaran aktif.
- Guru: dicocokkan lewat email (`profiles.email` rapor, cadangan dari akun login rapor). Username = bagian sebelum `@`.
- Mata pelajaran: pasangan unik (guru, nama mapel) dari `penugasan_guru`; kelas yang diampu tidak disimpan.
- Akun baru diberi kata sandi acak; unduh file kredensial setelah sinkronisasi selesai.
- Tidak ada data yang dihapus. Aman dijalankan ulang.
