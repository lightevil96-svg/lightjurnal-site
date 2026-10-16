# LightJurnal

Website jurnal dan arsip tugas kuliah untuk **lightjurnal.my.id**. Dibangun dengan HTML, CSS, dan JavaScript murni agar ringan, responsif, dan dapat dipublikasikan melalui GitHub Pages.

## Fitur
- Pencarian judul, ringkasan, kategori, penulis, dan tag
- Filter kategori dan pengurutan koleksi
- Mode gelap/terang yang disimpan di browser
- Tata letak responsif untuk ponsel dan desktop
- Halaman ruang kerja untuk menyiapkan metadata dan mengekspor JSON/Markdown
- Domain khusus melalui file \`CNAME\`

## Login, unggah jurnal, dan moderasi

Login pengguna, penyimpanan PDF privat, status peninjauan, serta panel admin sekarang disiapkan dengan Supabase. GitHub Pages hanya menyajikan antarmuka; kontrol akses berada pada Supabase Auth, Row Level Security (RLS), dan Storage policies.

Ikuti **[SUPABASE-SETUP.md](SUPABASE-SETUP.md)** untuk membuat project, menjalankan `supabase-setup.sql`, mengisi URL serta anon/publishable key pada `supabase-config.js`, dan menetapkan akun admin pertama. Jangan pernah menaruh service_role/secret key di frontend.

Alur karya:
- Pengguna mendaftar/masuk melalui `login.html`, lalu mengirim PDF dari `dashboard.html`.
- Setiap kiriman berstatus `pending`; dokumen tetap di bucket privat sampai disetujui admin.
- Admin masuk melalui `admin.html` untuk menyetujui, menolak dengan catatan, menarik publikasi, atau menghapus kiriman.
- Halaman utama hanya memuat jurnal berstatus `approved`.


## Ruang Musik YouTube

Halaman `musik.html` menambahkan pencarian video musik melalui YouTube Data API v3 dan pemutaran melalui YouTube IFrame Player API. Fitur ini terpisah dari logika autentikasi, jurnal, komentar, dan moderasi Supabase.

### Mengaktifkan pencarian

1. Buka [Google Cloud Console](https://console.cloud.google.com/).
2. Pilih atau buat project, lalu aktifkan **YouTube Data API v3**.
3. Buat API key di **APIs & Services → Credentials**.
4. Pada pembatasan API key, pilih **Restrict key → YouTube Data API v3**.
5. Pada **Application restrictions**, gunakan **Websites / HTTP referrers** dan izinkan domain yang dipakai, minimal `https://lightjurnal.my.id/*`. Tambahkan domain `www` hanya jika memang dipakai. Untuk pengujian lokal, tambahkan origin lokal yang tepat lalu hapus setelah selesai.
6. Buka `youtube-config.js` dan ganti `YOUR_YOUTUBE_DATA_API_KEY` dengan API key tersebut.
7. Simpan perubahan, tunggu GitHub Pages memperbarui situs, lalu buka **Musik** di navigasi.

**Keamanan:** GitHub Pages adalah hosting statis, sehingga API key yang dipakai di browser dapat dilihat pengunjung. Karena itu, jangan memakai secret key atau kredensial server di file ini. Batasi key berdasarkan HTTP referrer dan API yang diizinkan, pantau penggunaan kuota, dan rotasi key jika bocor. Jika membutuhkan kredensial yang tidak terekspos, gunakan backend/proxy yang dikelola dengan aman—bukan secret yang ditanam di JavaScript.

### Batasan pemutaran

- Pencarian dan metadata menggunakan YouTube Data API; pemutaran menggunakan pemutar YouTube resmi tertanam. Akses akun Google tidak diperlukan.
- Hasil pencarian tidak menjamin video bisa diputar: pemilik dapat menonaktifkan embedding, atau video dapat dibatasi wilayah/akses.
- Browser dan WebView dapat membatasi autoplay. Pengguna harus memulai playback melalui interaksi yang sesuai.
- Antrean, riwayat, dan volume disimpan secara lokal pada perangkat/browser.
- Situs ini menggunakan beberapa halaman HTML. Navigasi penuh ke halaman lain akan menghentikan instance pemutar halaman musik; antrean dan riwayat tetap tersimpan, tetapi playback lintas halaman tidak dijanjikan.
- Integrasi web biasa tidak menjamin pemutaran ketika layar mati atau aplikasi berjalan di latar belakang.
- Pencarian memakai kuota YouTube Data API. Permintaan tambahan untuk halaman berikutnya juga memakai kuota; debounce dan cache sesi digunakan untuk mengurangi permintaan yang tidak diperlukan.

Dokumentasi resmi:
- [YouTube Data API search.list](https://developers.google.com/youtube/v3/docs/search/list)
- [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference)
- [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies)

## Publikasi melalui GitHub Pages
1. Buka **Settings → Pages** pada repository ini.
2. Pada **Build and deployment**, pilih **Deploy from a branch**, branch \`main\`, folder \`/(root)\`, lalu **Save**.
3. Di bagian **Custom domain**, masukkan \`lightjurnal.my.id\` dan simpan. File \`CNAME\` di root juga sudah berisi domain tersebut.
4. Pada pengelola DNS domain, atur record apex sesuai dokumentasi GitHub Pages. Jika belum ada konfigurasi yang cocok, gunakan empat record A berikut dengan host/name \`@\`:
   - \`185.199.108.153\`
   - \`185.199.109.153\`
   - \`185.199.110.153\`
   - \`185.199.111.153\`
5. Opsional tetapi disarankan: buat record CNAME host \`www\` menuju \`lightevil96-svg.github.io\` (tanpa nama repository).
6. Tunggu propagasi DNS, lalu aktifkan **Enforce HTTPS** di Settings → Pages ketika opsi tersedia.

DNS dan pengaturan Pages harus dikonfigurasi di akun/domain masing-masing; commit file saja tidak otomatis membuat situs online.

## Konfigurasi dan batas unggahan

PDF dibatasi 25 MB. Pengaturan produksi tidak aktif sampai project Supabase dibuat, SQL diterapkan, dan `supabase-config.js` diisi. Tanpa backend terkonfigurasi, formulir tidak menyimpan unggahan sebagai jurnal publik. Koleksi publik hanya menampilkan karya yang sudah disetujui admin.

## Berkas

- `index.html` — koleksi jurnal publik
- `login.html`, `auth.js` — pendaftaran dan login pengguna
- `dashboard.html`, `dashboard.js` — unggah PDF dan pelacakan status
- `admin.html`, `admin.js` — login admin dan antrean moderasi
- `style.css`, `portal.css` — tampilan responsif
- `supabase-config.js` — konfigurasi publik frontend
- `supabase-setup.sql` — tabel, RLS, bucket, dan policies
- `SUPABASE-SETUP.md` — petunjuk konfigurasi backend
- `CNAME` — domain khusus
