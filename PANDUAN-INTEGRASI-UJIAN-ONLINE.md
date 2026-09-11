# Integrasi Ujian Online ke Ujianwima

Ringkasan perubahan yang dibuat pada `guru.html` dan `siswa.html` agar ujianwima
"menggunakan" mesin Ujian Online (timer, navigasi soal, ragu-ragu, deteksi
pindah tab, anti-copy, penanda ukuran font, dsb.) secara langsung — tanpa iframe
terpisah, karena keduanya sudah berbagi Supabase yang sama.

## 1. Perubahan skema data (WAJIB dijalankan di Supabase SQL editor)

```sql
alter table exam_attempts add column if not exists ragu jsonb default '{}'::jsonb;
alter table exam_attempts add column if not exists penilaian jsonb default null;
alter table schedules add column if not exists token text default null;
alter table exam_attempts add column if not exists percobaan_keluar integer default 0;
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

Setiap soal juga punya `poin` (bobot nilai, default 10), `bacaan` (teks
kutipan/bacaan opsional yang tampil di atas soal), `gambar` (gambar ilustrasi
soal/opsi, opsional) dan `tabel` (tabel data untuk dianalisis siswa,
opsional).

## 3. Format Word untuk diunggah guru

Guru → Asesmen → Buat Soal → unggah `.docx`. Tag jenis soal ditulis di awal
teks soal: `[PG]`, `[PGK]`, `[BS]`, `[ESSAY]` (opsional — jika kosong, sistem
menebak PG/Esai). Kunci jawaban ditandai **bold** pada opsi yang benar, atau
baris `Kunci: B` / `Kunci: A, C, D`. Baris `Poin: 15` mengatur bobot.

**Bacaan / teks referensi (bisa untuk beberapa soal sekaligus)**: paragraf
`Bacaan: ...` sebelum nomor soal menyisipkan teks bacaan/kutipan yang tampil
di atas soal — secara default hanya untuk **1 soal berikutnya**. Untuk
menempelkan bacaan yang sama ke beberapa soal berturut-turut (mis. "Soal
8-10 berdasarkan teks berikut"), tulis jumlah soalnya:
`Bacaan (untuk 3 soal): ...` — teks itu otomatis ikut tampil di 3 soal
berikutnya secara berurutan. Gambar atau tabel Word yang diletakkan tepat di
bawah paragraf Bacaan ikut menjadi referensi bersama untuk soal-soal
tersebut. Bacaan boleh terdiri dari beberapa paragraf berturut-turut (semua
digabung jadi satu teks). Untuk mengakhiri masa berlaku bacaan lebih awal,
sisipkan baris `[Selesai Bacaan]` sebelum soal berikutnya.

**Gambar**: sisipkan gambar langsung di Word (Sisipkan > Gambar) tepat di
paragraf/baris soal, atau di baris tepat di bawahnya — sistem otomatis
menempelkannya ke soal tersebut. Gambar pada baris tersendiri tepat setelah
sebuah opsi (`A.`/`B.`/dst) akan menempel ke opsi itu, bukan ke soal.
Disarankan ukuran gambar tidak terlalu besar (idealnya di bawah ~1 MB per
gambar) agar paket soal tidak terlalu berat disimpan.

**Tabel**: sisipkan tabel Word biasa di antara teks soal dan daftar pilihan
jawaban (baris pertama tabel otomatis dijadikan header jika selnya
menggunakan format Header/Heading tabel Word). Cocok untuk soal yang meminta
siswa membaca atau menganalisis data pada tabel sebelum menjawab.

Klik tautan **"Unduh contoh format Word (.docx)"** di halaman Guru (tab Buat
Soal) untuk mengunduh contoh yang berisi seluruh kombinasi di atas, ditambah
contoh bacaan bersama untuk 3 soal sekaligus, satu contoh soal bergambar, dan
satu contoh soal bertabel. Dokumen contoh ini juga memuat kotak petunjuk
format di bagian atas (termasuk petunjuk sintaks bacaan multi-soal) sehingga
tetap jelas dibaca manusia maupun oleh AI lain saat file ini diedit ulang.
File yang sama juga disertakan di sini sebagai `contoh-format-soal.docx`.

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

## 6. Daftar bernomor di dalam soal

Soal yang memuat sub-daftar bernomor di badan soalnya sendiri (mis.
"Perhatikan peristiwa berikut: 1. Gula larut dalam air 2. Kertas dibakar ...
Perubahan kimia ditunjukkan oleh...") kini didukung otomatis. Sistem hanya
menganggap sebuah baris sebagai *soal baru* jika nomornya berurutan (+1)
dari nomor soal sebelumnya; baris bernomor lain di tengah badan soal
otomatis dianggap bagian dari soal yang sedang berjalan, bukan soal baru.
Karena itu, penomoran soal utama di seluruh dokumen wajib berurutan tanpa
loncat/bolong agar deteksi ini akurat.

## 7. Token ujian (opsional)

Guru bisa mengisi kolom **Token** saat membuat/mengedit jadwal ujian (tab
Guru → Asesmen → Jadwal Soal). Bersifat opsional:

- Jika dikosongkan, siswa langsung bisa mulai ujian seperti biasa (tanpa
  diminta token).
- Jika diisi, siswa wajib memasukkan token yang cocok (tidak case-sensitive)
  lewat modal konfirmasi sebelum ujian dimulai. Token hanya ditanyakan sekali
  saat *memulai* ujian (attempt baru dibuat) — melanjutkan ujian yang sudah
  berjalan (`Lanjutkan Ujian`) tidak meminta token lagi.
- Guru bisa memakai tombol **Acak** di formulir jadwal untuk membuat token
  6 karakter acak, atau mengetik token sendiri.

Admin (tab Admin → Token) bisa melihat seluruh jadwal ujian beserta token
yang sudah dibuat guru, mengedit token yang sudah ada, atau mengisi token
untuk jadwal yang masih kosong — tanpa perlu masuk ke akun guru.

Field disimpan di `schedules.token` (nullable). Lihat migrasi skema di
bagian 1.

## 8. Deteksi keluar tab/aplikasi saat ujian

Saat siswa berpindah tab, meminimalkan jendela, atau membuka aplikasi lain
selagi status ujian `mengerjakan`, muncul modal peringatan dengan 3 pilihan:

- **Lanjutkan Ujian** — menutup modal, langsung kembali ke soal, tidak perlu
  konfirmasi tambahan (ini opsi paling aman jadi tidak digembok konfirmasi).
- **Submit Ujian** — membuka modal konfirmasi kumpulkan yang sudah ada
  (ringkasan Terjawab/Ragu/Kosong + tombol "Ya, Kumpulkan"), jadi tetap wajib
  konfirmasi sebelum benar-benar submit.
- **Keluar Tanpa Submit** — membuka modal konfirmasi terpisah ("Yakin keluar
  tanpa mengumpulkan?"). Jika dikonfirmasi, siswa kembali ke daftar ujian;
  status attempt tetap `mengerjakan` (belum dianggap selesai) dan jawaban
  yang sudah terisi tetap tersimpan otomatis, sehingga siswa bisa klik
  "Lanjutkan Ujian" lagi selama jadwal masih berlangsung.

Setiap kali modal peringatan ini muncul (setiap kali terdeteksi pindah
tab/aplikasi), sistem mencatat **percobaan keluar aplikasi** ke
`exam_attempts.percobaan_keluar` (increment, tersimpan langsung tanpa
menunggu submit). Guru → Monitoring Ujian menampilkan jumlah percobaan ini
per peserta (kolom "Percobaan Keluar", ditandai lencana merah jika lebih
dari 0) supaya kecurigaan pindah tab/aplikasi selama ujian bisa langsung
terlihat saat memantau ruang ujian.

