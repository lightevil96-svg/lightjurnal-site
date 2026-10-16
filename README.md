# LightJurnal

Website jurnal dan arsip tugas kuliah untuk **lightjurnal.my.id**. Dibangun dengan HTML, CSS, dan JavaScript murni agar ringan, responsif, dan dapat dipublikasikan melalui GitHub Pages.

## Fitur
- Pencarian judul, ringkasan, kategori, penulis, dan tag
- Filter kategori dan pengurutan koleksi
- Mode gelap/terang yang disimpan di browser
- Tata letak responsif untuk ponsel dan desktop
- Halaman ruang kerja untuk menyiapkan metadata dan mengekspor JSON/Markdown
- Domain khusus melalui file \`CNAME\`

## Penting: cara kerja admin dan komentar
Repository ini memakai hosting statis. Halaman \`admin.html\` **bukan CMS yang aman dengan login**; draf disimpan di browser/perangkat yang sedang digunakan dan tidak otomatis tampil pada pengunjung lain. Jangan menyimpan rahasia di halaman tersebut. Untuk menerbitkan karya, unggah PDF ke folder \`documents/\` di repository, lalu tambahkan metadata karya ke array \`DEMO_ARTICLES\` di \`script.js\` dan commit perubahan. Contoh karya di halaman utama adalah konten contoh untuk pratinjau; ganti/hapus sebelum situs digunakan sebagai arsip resmi.

Komentar pembaca menggunakan Utterances, yang menyimpan diskusi sebagai GitHub Issues. Pastikan fitur Issues aktif di Settings repository; pembaca harus masuk dengan akun GitHub dan komentar bersifat publik. Jika ruang komentar menampilkan pesan konfigurasi, periksa apakah Issues diaktifkan dan repository dapat diakses oleh Utterances.

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

## Menambah karya
Tambahkan objek ke array \`DEMO_ARTICLES\` di \`script.js\`, dengan struktur:

\`\`\`js
{
  id: "jurnal-001",
  title: "Judul jurnal atau tugas",
  category: "Pendidikan",
  date: "2026-10-16",
  author: "Nama penulis",
  description: "Ringkasan singkat isi karya.",
  tags: ["metodologi", "kuliah"],
  type: "Jurnal",
  file: "documents/nama-berkas.pdf",
  url: "",
  featured: "Judul pendek"
}
\`\`\`

Kategori yang tersedia: \`Pendidikan\`, \`Teknologi\`, \`Sosial\`, \`Kesehatan\`, dan \`Lainnya\`. Unggah hanya berkas yang boleh dipublikasikan dan tidak berisi data pribadi.

## Berkas
- \`index.html\` — halaman utama
- \`style.css\` — desain responsif dan tema
- \`script.js\` — data contoh, pencarian, filter, dan mode tema
- \`admin.html\`, \`admin.js\` — alat bantu metadata lokal
- \`CNAME\` — domain kustom