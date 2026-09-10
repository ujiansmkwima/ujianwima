# Integrasi Ujian Online ke Ujianwima

Ringkasan perubahan yang dibuat pada `guru.html` dan `siswa.html` agar ujianwima
"menggunakan" mesin Ujian Online (timer, navigasi soal, ragu-ragu, deteksi
pindah tab, anti-copy, penanda ukuran font, dsb.) secara langsung — tanpa iframe
terpisah, karena keduanya sudah berbagi Supabase yang sama.

## 1. Perubahan skema data (WAJIB dijalankan di Supabase SQL editor)

```sql
alter table exam_attempts add column if not exists ragu jsonb default '{}'::jsonb;
alter table exam_attempts add column if not exists penilaian jsonb default null;
```

`question_sets.soal` tidak perlu migrasi skema (kolom `jsonb` sudah fleksibel).
Soal lama (format PG lama tanpa field `type`) tetap terbaca — kode di kedua
halaman otomatis menganggapnya `type: "pg"`.

## 2. Empat jenis soal yang kini didukung

| Kode | Nama | Penilaian |
|---|---|---|
| `pg` | Pilihan ganda (1 jawaban benar) | Otomatis |
| `pgk` | Pilihan ganda kompleks (jawaban bisa >1) | Otomatis |
| `bs` | Benar/Salah atau Setuju/Tidak Setuju | Otomatis jika ada kunci, manual jika opini |
| `essay` | Uraian | Selalu manual |

Setiap soal juga punya `poin` (bobot nilai, default 10) dan `bacaan` (teks
kutipan/bacaan opsional yang tampil di atas soal).

## 3. Format Word untuk diunggah guru

Guru → Asesmen → Buat Soal → unggah `.docx`. Tag jenis soal ditulis di awal
teks soal: `[PG]`, `[PGK]`, `[BS]`, `[ESSAY]` (opsional — jika kosong, sistem
menebak PG/Esai). Kunci jawaban ditandai **bold** pada opsi yang benar, atau
baris `Kunci: B` / `Kunci: A, C, D`. Baris `Poin: 15` mengatur bobot, paragraf
`Bacaan: ...` sebelum nomor soal menyisipkan teks bacaan untuk soal berikutnya.

Klik tautan **"Unduh contoh format Word (.docx)"** di halaman Guru (tab Buat
Soal) untuk mengunduh contoh yang berisi kesembilan kombinasi di atas — file
yang sama juga disertakan di sini sebagai `contoh-format-soal.docx`.

## 4. Pengalaman mengerjakan ujian (siswa.html)

`#examView` sekarang memiliki:
- Timer + navigasi soal (grid, legenda Terjawab/Ragu/Kosong)
- Tombol "Ragu-ragu" per soal
- Kontrol ukuran font (5 level)
- Blok bacaan/kutipan di atas soal saat ada
- Area jawaban khusus per tipe (pilihan tunggal, checkbox ganda, dua tombol
  Benar/Salah, kotak esai)
- Modal konfirmasi kumpulkan (ringkasan Terjawab/Ragu/Kosong)
- Deteksi pindah tab/keluar (modal peringatan)
- Proteksi copy/paste & devtools selama ujian berlangsung

## 5. Penilaian & Rekap (guru.html)

Saat siswa mengumpulkan ujian, sistem menghitung otomatis untuk soal yang
punya kunci (pg/pgk/bs-berkunci) dan menandai soal esai/opini sebagai
"menunggu penilaian manual" (`penilaian.manualQids`). Guru → Rekap akan
menampilkan tombol **"Beri Nilai"** pada peserta yang punya soal manual;
klik untuk melihat jawaban siswa per soal dan memasukkan poin (0–poin
maksimal soal). Nilai akhir dihitung ulang otomatis dan disimpan.
