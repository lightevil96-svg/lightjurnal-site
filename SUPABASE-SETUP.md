# Mengaktifkan login, unggah jurnal, dan moderasi LightJurnal

Website LightJurnal berjalan di GitHub Pages (hosting statis). Autentikasi dan penyimpanan jurnal menggunakan Supabase agar kata sandi, peran admin, status moderasi, dan berkas PDF tidak hanya dipercayakan pada JavaScript/browser.

## 1. Buat project Supabase

1. Buat project di [Supabase](https://supabase.com/) dan tunggu sampai database siap.
2. Buka **Project Settings → API** (atau **Connect**) dan salin **Project URL** serta **anon/publishable key**.
3. Buka **SQL Editor**, jalankan seluruh isi file `supabase-setup.sql` dari repository ini.
4. Buka `supabase-config.js`. Ganti `https://PROJECT_REF.supabase.co` dengan Project URL dan ganti `PASTE_SUPABASE_ANON_OR_PUBLISHABLE_KEY_HERE` dengan anon/publishable key.

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
- Pengguna mendaftar/masuk di `login.html`, kemudian mengunggah jurnal PDF di `dashboard.html`.
- Setiap unggahan otomatis berstatus **Menunggu** dan PDF disimpan di bucket privat.
- Admin masuk di `admin.html`, meninjau metadata dan PDF, lalu memilih **Setujui** atau **Tolak** dengan catatan.
- Jurnal yang disetujui muncul di halaman utama. Jurnal menunggu/tolak tidak masuk koleksi publik; pemilik masih dapat melihat status dan catatan penolakan.

## 5. Batas dan pemeriksaan keamanan

- PDF dibatasi 25 MB dan bucket hanya menerima `application/pdf`; validasi browser bukan pengganti aturan database/storage.
- RLS adalah lapisan kontrol akses utama. Jangan menonaktifkan RLS atau membuat bucket publik.
- File yang disetujui dibuka melalui signed URL sementara, bukan URL bucket publik.
- Halaman admin bukan rahasia karena URL-nya diketahui; kontrol sungguhan dilakukan di Supabase lewat autentikasi, peran database, dan RLS.
- Setelah mengganti konfigurasi, uji menggunakan akun pengguna biasa dan akun admin yang berbeda: pengguna biasa harus gagal mengakses dashboard admin dan jurnal tertunda tidak boleh terlihat di halaman publik.

Jika konfigurasi Supabase belum diisi, halaman tetap terbuka tetapi fungsi akun/unggah akan menampilkan petunjuk konfigurasi dan tidak menyimpan unggahan lokal sebagai jurnal publik.
