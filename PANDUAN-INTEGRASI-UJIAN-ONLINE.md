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
alter table schedules add column if not exists tanggal_selesai date default null;
alter table schedules add column if not exists jam_selesai time default null;

-- Tabel ruang ujian (untuk menu "Pembagian Ruang" di Admin).
-- profiles.ruang tetap kolom text seperti sebelumnya; tabel ini hanya
-- menyimpan daftar nama ruang yang boleh dipilih dan tidak diikat dengan
-- foreign key ke profiles, supaya kompatibel dengan data ruang lama.
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  nama text not null unique,
  created_at timestamptz not null default now()
);

alter table rooms enable row level security;

-- Sesuaikan dengan pola RLS tabel lain di project ini (mis. subjects/supervisors):
-- hanya admin yang boleh insert/update/delete, semua role yang login boleh select.
-- (Postgres tidak punya "create policy if not exists", jadi drop dulu baru create.)
drop policy if exists "rooms_select_authenticated" on rooms;
create policy "rooms_select_authenticated" on rooms
  for select using (auth.role() = 'authenticated');

drop policy if exists "rooms_all_admin" on rooms;
create policy "rooms_all_admin" on rooms
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  ) with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  );
```

### Pengaturan "Jadwal selesai"

`schedules.tanggal_selesai` + `schedules.jam_selesai` (keduanya opsional) adalah
batas akhir jendela ujian. Kalau diisi, siswa tetap bisa mulai/melanjutkan
ujian sampai batas ini walaupun waktu sejak jam mulai + durasi sudah lewat.
Durasi pengerjaan tiap siswa tetap dihitung dari `durasi_menit` sejak siswa
itu sendiri mulai mengerjakan (`exam_attempts.mulai`), dibatasi oleh
`tanggal_selesai`/`jam_selesai` — mana yang lebih dulu tercapai. Kalau kedua
kolom ini dikosongkan, perilaku lama tetap berlaku: jendela ujian ditutup
tepat pada jam mulai + durasi.

`question_sets.soal` tidak perlu migrasi skema (kolom `jsonb` sudah fleksibel).
Soal lama (format PG lama tanpa field `type`) tetap terbaca — kode di kedua
halaman otomatis menganggapnya `type: "pg"`.

## 1a. Skema baru: Pembagian Ruang (Admin)

Sebelumnya ruang ujian diisi manual per siswa saat mendaftarkan akun. Sekarang:

- Form "Tambah pengguna" di tab **Pengguna** tidak lagi meminta ruang ujian.
- Tab baru **Pembagian Ruang** menggantikannya:
  1. Admin membuat daftar ruang (mis. "Ruang 12") di kartu "Daftar ruang".
  2. Admin memilih kelas pada kartu "Tetapkan peserta ke ruang" — daftar
     peserta kelas tersebut muncul sebagai daftar centang.
  3. Peserta dicentang satu per satu, atau dengan **klik + tahan Shift**
     pada centang lain untuk memilih rentang berurutan (mis. centang siswa
     No. 1, tahan Shift, lalu klik centang siswa No. 15 → siswa No. 1–15
     ikut tercentang), lalu pilih ruang tujuan dan klik "Tetapkan ke ruang
     terpilih".
- Nilai yang tersimpan tetap di kolom `profiles.ruang` (text) seperti
  sebelumnya, sehingga halaman Guru (monitoring per ruang) dan Guru
  Pengawas tidak perlu diubah.
- Import massal siswa via Excel: kolom "Ruang Ujian" kini opsional (boleh
  dikosongkan/dihapus dari file); kalau diisi tetap dipakai sebagai nilai
  awal, tapi cara utama sekarang lewat tab Pembagian Ruang.

### Guru pengawas kini mengacu ke daftar ruang

Tab **Guru pengawas** (Admin) tidak lagi memakai kolom teks bebas untuk
ruang. Field "Ruang ujian yang diawasi" sekarang berupa dropdown berisi:

- **Semua ruang** — guru bisa memantau semua ruang ujian yang ada (nilai
  `supervisors.ruang` disimpan `null`).
- Salah satu ruang spesifik dari daftar yang dibuat di tab **Pembagian
  Ruang** (mis. "Ruang 12").

Admin bisa menambahkan beberapa baris pengawasan untuk guru yang sama kalau
ingin ia mengawas beberapa ruang tertentu (tanpa memilih "Semua ruang").

Di sisi guru (`guru.html`), `mySupervisorRooms()` memperluas penugasan
"Semua ruang" menjadi daftar seluruh ruang yang ada saat itu (diambil dari
tabel `rooms`), sehingga menu Monitoring otomatis mengikuti ruang terbaru
tanpa admin perlu mengedit ulang data pengawas setiap kali ruang berubah.

Import massal guru pengawas: kolom "Ruang Ujian" boleh dikosongkan atau
diisi "Semua Ruang" (berarti semua ruang); kalau diisi nama ruang spesifik,
nama itu harus sudah ada di tab Pembagian Ruang, kalau belum baris tersebut
akan ditolak dengan pesan error.

## 2. Enam jenis soal yang kini didukung

| Kode | Nama | Penilaian |
|---|---|---|
| `pg` | Pilihan ganda (1 jawaban benar) | Otomatis |
| `pgk` | Pilihan ganda kompleks (jawaban bisa >1) | Otomatis |
| `bs` | Benar/Salah atau Setuju/Tidak Setuju | Otomatis jika ada kunci, manual jika opini |
| `bsg` | Pernyataan ganda — beberapa pernyataan, tiap pernyataan dijawab dengan radio button ke salah satu dari **2 kategori** (mis. Benar/Salah per pernyataan) | Otomatis jika semua pernyataan berkunci, manual jika ada yang tanpa kunci |
| `rb` | Radio Button (klasifikasi) — sama seperti `bsg`, tapi kategorinya bisa **2-4 kolom** (mis. Before/After, Material/Tool), ditulis lewat baris `KOLOM: A | B | C` lalu tiap pernyataan `teks = NamaKolom` | Otomatis jika semua pernyataan berkunci, manual jika ada yang tanpa kunci |
| `essay` | Uraian | Selalu manual |

Setiap soal juga punya `poin` (bobot nilai, default 10), `bacaan` (teks
kutipan/bacaan opsional yang tampil di atas soal), `gambar` (gambar ilustrasi
soal/opsi, opsional) dan `tabel` (tabel data untuk dianalisis siswa,
opsional).

## 3. Format Word untuk diunggah guru

Guru → Asesmen → Buat Soal → unggah `.docx`. Tag jenis soal ditulis di awal
teks soal: `[PG]`, `[PGK]`, `[BS]`, `[BSG]`, `[RB]`, `[ESSAY]` (opsional —
jika kosong, sistem menebak PG/Esai). Kunci jawaban ditandai **bold** pada
opsi yang benar, atau baris `Kunci: B` / `Kunci: A, C, D`. Baris `Poin: 15`
mengatur bobot.

Untuk `[BSG]`: tulis baris `Kategori: NamaA | NamaB` (persis 2 kategori)
setelah teks soal, lalu tiap pernyataan satu baris (boleh bernomor atau
tidak) dengan format `teks pernyataan | Kunci: A` (A = kategori pertama,
B = kategori kedua). Kosongkan bagian `| Kunci: ...` pada pernyataan yang
sifatnya opini agar seluruh soal dinilai manual.

Untuk `[RB]`: tulis baris `KOLOM: NamaKolom1 | NamaKolom2` (boleh sampai 4
kolom, dipisah `|`) setelah teks soal, lalu tiap pernyataan satu baris
(boleh bernomor atau tidak) dengan format `teks pernyataan = NamaKolom`
(nama kolom harus PERSIS sama ejaannya dengan yang ditulis di baris KOLOM).
Contoh:

```
14. [RB] Classify each action below based on when it happens in the process.
KOLOM: Before Gluing the Fabric | After Gluing the Fabric
Measuring and cutting the fabric = Before Gluing the Fabric
Smoothing out bubbles and wrinkles on the fabric = After Gluing the Fabric
Adding handles to the box = After Gluing the Fabric
Poin: 10
```

Jika nama kolom pada suatu pernyataan tidak cocok dengan baris KOLOM,
pernyataan tersebut dianggap tanpa kunci dan seluruh soal dinilai manual.


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


## 9. Hapus massal dengan centang (Admin)

Tab **Guru**, **Mata Pelajaran**, dan **Guru Pengawas** kini punya kolom
centang seperti tab Pengguna: centang per baris, centang header untuk memilih
semua baris yang sedang tampil (mengikuti pencarian), lalu klik **Hapus
terpilih** pada bar yang muncul di atas tabel.

- **Guru**: memanggil `manage-users` (`delete_user`) satu per satu, sehingga
  akun login ikut terhapus. Dialog konfirmasi menampilkan berapa mata pelajaran
  dan tugas pengawasan yang ikut terhapus. Jika sebagian gagal, yang gagal
  tetap tercentang dan alasannya ditampilkan.
- **Mata pelajaran** dan **Guru pengawas**: satu kali `delete ... in('id', ids)`
  ke Supabase. Hanya baris yang benar-benar terhapus yang dibuang dari daftar;
  jika ada yang tidak terhapus (mis. ditolak RLS) muncul peringatan.
- Tidak ada perubahan skema SQL maupun edge function.
