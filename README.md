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

Halaman `musik.html` menggunakan YouTube Data API v3 melalui **Supabase Edge Function** agar API key Google tidak ditanam di JavaScript yang dikirim ke pengunjung. Pemutaran memakai YouTube IFrame Player API resmi. Mode awal berfokus pada musik dengan pemutar ringkas yang tetap terlihat; tombol **Tonton video besar** memperluas video saat pengguna ingin menontonnya.

### Mengaktifkan pencarian dengan API key yang aman

Pencarian memakai Supabase Edge Function. Google API key tidak lagi disimpan di file frontend.

1. Pastikan **YouTube Data API v3** aktif di Google Cloud. Pada API restrictions, batasi key ke YouTube Data API v3.
2. Di GitHub, buka **Settings → Secrets and variables → Actions → New repository secret**. Tambahkan:
   - `YOUTUBE_API_KEY`: API key Google yang akan digunakan server.
   - `SUPABASE_ACCESS_TOKEN`: access token Supabase milik project owner.
3. Workflow `.github/workflows/deploy-youtube-search.yml` akan mengirim key ke secret Supabase lalu deploy function. Setelah secrets disimpan, buka tab **Actions**, pilih workflow **Deploy YouTube Search Proxy**, lalu tekan **Run workflow**.
4. Pastikan `supabase-config.js` memuat project URL dan public/publishable key Supabase yang benar.
5. Buka `https://lightjurnal.my.id/musik.html` dan coba pencarian. Jika workflow gagal, buka detail run untuk melihat langkah yang gagal—jangan tempel nilai secret ke issue atau chat.

**Penting:** API key Google sebelumnya pernah tersimpan pada file frontend, sehingga nilai yang sama mungkin masih dapat ditemukan di commit lama. Menghapusnya dari file terbaru tidak menghapus riwayat Git. Pembatasan API membantu mengurangi risiko, tetapi cara paling aman setelah paparan publik adalah membuat API key baru, membatasi key tersebut ke YouTube Data API v3, lalu menyimpannya hanya sebagai secret `YOUTUBE_API_KEY`. Jangan pernah menaruhnya di JavaScript/HTML atau mengirim nilainya ke chat. Function menerapkan allowlist origin, validasi kueri, cache dan pembatasan laju dasar; pemantauan kuota tetap diperlukan.

### Batasan pemutaran

- Pencarian memakai YouTube Data API; pemutaran dilakukan oleh pemutar YouTube resmi tertanam. LightJurnal tidak mengekstrak atau mengunduh audio.
- Mode ringkas tetap menampilkan pemutar YouTube berukuran ringkas; tombol **Tonton video besar** memperluas tampilannya.
- Sebagian video tidak bisa diputar tertanam karena pengaturan pemilik, pembatasan wilayah, atau kebijakan YouTube.
- Browser/WebView dapat membatasi autoplay. Navigasi penuh ke halaman lain dan mode latar belakang tidak menjamin pemutaran berlanjut.
- Antrean, riwayat, dan volume disimpan secara lokal pada perangkat/browser.

Dokumentasi resmi:
- [YouTube Data API search.list](https://developers.google.com/youtube/v3/docs/search/list)
- [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference)
- [Supabase Edge Functions secrets](https://supabase.com/docs/guides/functions/secrets)
- [Supabase Edge Functions deploy](https://supabase.com/docs/guides/functions/deploy)

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
