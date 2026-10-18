# Mengaktifkan login, unggah jurnal, dan moderasi LightJurnal

Website LightJurnal berjalan di GitHub Pages (hosting statis). Autentikasi dan penyimpanan jurnal menggunakan Supabase agar kata sandi, peran admin, status moderasi, dan berkas PDF tidak hanya dipercayakan pada JavaScript/browser.

## 1. Buat project Supabase

1. Buat project di [Supabase](https://supabase.com/) dan tunggu sampai database siap.
2. Buka **Project Settings → API** (atau **Connect**) dan salin **Project URL** serta **anon/publishable key**.
3. Buka **SQL Editor**, jalankan seluruh isi file `supabase-setup.sql` dari repository ini.
4. Jika project LightJurnal sudah pernah disiapkan sebelum fitur profil dan komentar ditambahkan, jalankan juga seluruh isi file `supabase-social-profile-migration.sql` di SQL Editor. Migrasi ini menambahkan bio/foto profil, ruang obrolan LightJurnal, dan komentar per jurnal.
5. Buka `supabase-config.js`. Ganti `https://PROJECT_REF.supabase.co` dengan Project URL dan ganti `PASTE_SUPABASE_ANON_OR_PUBLISHABLE_KEY_HERE` dengan anon/publishable key.

   Anon/publishable key boleh digunakan di frontend karena semua akses data dilindungi Row Level Security (RLS). **Jangan pernah memasukkan service_role/secret key ke file website.**

## 2. Atur autentikasi

Di Supabase, buka **Authentication → URL Configuration**:
- **Site URL**: `https://lightjurnal.my.id`
- Tambahkan Redirect URL situs produksi dan alamat GitHub Pages jika kamu juga mengujinya di sana, misalnya `https://lightevil96-svg.github.io/lightjurnal-site/**`.

Pengaturan konfirmasi email ada di **Authentication → Providers → Email**. Jika konfirmasi email aktif, pengguna harus membuka email konfirmasi sebelum dapat masuk. Pastikan template dan redirect URL cocok dengan domain situs.

## 3. Jadikan akunmu admin pertama

1. Buka situs dan masuk ke halaman **Masuk admin** (`admin.html`), atau daftar terlebih dahulu lewat halaman akun (`login.html`) menggunakan alamat email admin yang kamu kuasai.
2. Jika konfirmasi email diwajibkan, konfirmasikan akun itu.
3. Di **Supabase → SQL Editor**, jalankan query berikut dengan mengganti alamat contoh dengan email akunmu sendiri:

```sql
update public.profiles p
set role = 'admin'
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('EMAIL_ADMIN_KAMU@example.com');
```

4. Pastikan satu baris diperbarui. Sekarang buka `https://lightjurnal.my.id/admin.html` lalu masuk menggunakan akun tersebut.

Pendaftaran biasa selalu membuat peran `user`. Perubahan peran hanya dilakukan melalui SQL Dashboard oleh pemilik project, bukan melalui formulir situs. Jangan membuat kolom role yang dapat diubah sendiri oleh pengguna.

## 4. Alur pemakaian

- Pengunjung dapat membaca PDF yang statusnya **Disetujui**.
- Pengunjung dapat membaca obrolan publik dan komentar pada jurnal yang disetujui; untuk menulis komentar, pengguna harus masuk dengan akun LightJurnal.
- Pengguna dapat mengubah nama tampilan, bio singkat, dan foto profil melalui bagian **Profil & tampilan akun** di dashboard. Foto profil publik, maksimum 2 MB, dalam format JPG/PNG/WebP.
- Pengguna mendaftar/masuk di `login.html`, kemudian mengunggah jurnal PDF di `dashboard.html`.
- Setiap unggahan otomatis berstatus **Menunggu** dan PDF disimpan di bucket privat.
- Admin masuk di `admin.html`, meninjau metadata dan PDF, lalu memilih **Setujui** atau **Tolak** dengan catatan.
- Jurnal yang disetujui muncul di halaman utama. Jurnal menunggu/tolak tidak masuk koleksi publik; pemilik masih dapat melihat status dan catatan penolakan.

## 5. Batas dan pemeriksaan keamanan

- PDF dibatasi 25 MB dan bucket hanya menerima `application/pdf`; validasi browser bukan pengganti aturan database/storage.
- RLS adalah lapisan kontrol akses utama. Jangan menonaktifkan RLS atau membuat bucket publik.
- File jurnal yang disetujui dibuka melalui signed URL sementara, bukan URL bucket publik. Foto profil berada di bucket publik terpisah karena avatar memang tampil bersama komentar.
- Komentar publik dapat dibaca siapa saja, tetapi penulisan dibatasi ke akun yang sudah masuk melalui kebijakan RLS dan identitas komentar diisi oleh trigger database.
- Halaman admin bukan rahasia karena URL-nya diketahui; kontrol sungguhan dilakukan di Supabase lewat autentikasi, peran database, dan RLS.
- Setelah mengganti konfigurasi, uji menggunakan akun pengguna biasa dan akun admin yang berbeda: pengguna biasa harus gagal mengakses dashboard admin dan jurnal tertunda tidak boleh terlihat di halaman publik.

Jika konfigurasi Supabase belum diisi, halaman tetap terbuka tetapi fungsi akun/unggah akan menampilkan petunjuk konfigurasi dan tidak menyimpan unggahan lokal sebagai jurnal publik.

## 7. Mengaktifkan Mabar Ludo

Fitur Ludo online menggunakan akun LightJurnal yang sama dan membutuhkan tabel serta fungsi database tambahan.

1. Buka **Supabase Dashboard → SQL Editor** pada project LightJurnal.
2. Buka file [`supabase-ludo-migration.sql`](supabase-ludo-migration.sql) di repository ini, salin seluruh isinya, lalu jalankan sekali di SQL Editor.
3. Tunggu sampai SQL selesai tanpa error. Di akhir migrasi, cache skema PostgREST diminta untuk dimuat ulang agar fungsi RPC Ludo segera dikenali. Jangan memasukkan `service_role` key ke file frontend.
4. Buka `https://lightjurnal.my.id/ludo.html`, masuk menggunakan akun LightJurnal, lalu buat room.
5. Untuk teman yang diundang, gunakan **Buat tautan undangan** dan kirim tautan itu secara pribadi. Tautan undangan berlaku 24 jam dan hanya dapat dipakai sekali.
6. Untuk pemain yang belum diundang, bagikan **kode room**. Kode hanya mengirim permintaan; pemain baru bisa masuk setelah pemilik menekan **Terima**.
7. Agar sinkronisasi real-time aktif, project Supabase harus mengizinkan Realtime. Migrasi akan menambahkan tabel permainan ke publication `supabase_realtime` jika publication tersebut tersedia.

**Jika muncul error `Could not find the function public.ludo_create_room(...) in the schema cache`:** pastikan migrasi selesai tanpa error. Jalankan ulang seluruh file `supabase-ludo-migration.sql` di SQL Editor, tunggu query selesai, lalu muat ulang `ludo.html`. Jangan hanya menjalankan potongan fungsi `ludo_create_room`, karena fitur ini juga membutuhkan tabel, kebijakan akses, dan fungsi RPC lain.

**Catatan aturan permainan:** status giliran, lemparan dadu, pemindahan pion, pemakanan pion, dan kemenangan divalidasi oleh fungsi database. Uji dua akun berbeda dan beberapa browser sebelum memakai game bersama teman. Permainan Ludo memiliki variasi aturan; implementasi awal LightJurnal memakai aturan dasar keluar rumah dengan angka 6, langkah finis harus pas, petak aman, giliran ekstra pada 6, dan penalti tiga kali 6 beruntun.
