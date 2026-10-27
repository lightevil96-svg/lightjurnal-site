# TradeLog — Trading Journal

TradeLog adalah jurnal trading pribadi berbasis HTML, CSS, dan JavaScript murni. Tidak memerlukan proses build atau dependensi eksternal; cocok untuk GitHub Pages dan domain khusus.

## Fitur

- Dashboard ringkasan P/L bersih, win rate, jumlah trade, profit factor, dan kurva ekuitas.
- Catat, edit, hapus, cari, dan filter riwayat trade.
- Dukung posisi Long/Short, beberapa kelas aset, strategi, entry/exit, stop-loss, ukuran posisi, pengali kontrak, biaya, risiko, dan hasil bersih manual.
- Analisis performa bulanan dan berdasarkan strategi.
- Expectancy (rata-rata P/L per trade), rata-rata profit/loss, dan maximum drawdown dari puncak saldo.
- Performa berdasarkan hari dalam minggu dengan penanda sampel kecil agar pola dari sedikit trade tidak dianggap kesimpulan.
- Kalkulator risiko untuk memperkirakan nominal risiko dan ukuran posisi.
- Checklist disiplin pada setiap trade: validitas setup, stop-loss, batas risiko, pemeriksaan berita, dan kondisi emosi.
- Pengingat batas risiko harian: batas rugi persentase dan jumlah trade per hari, ditampilkan di dashboard dan kalkulator risiko.
- Ekspor CSV serta backup/restore JSON.
- Tampilan responsif untuk desktop dan ponsel.
- Data tersimpan di localStorage browser.

## Cara menggunakan

1. Buka website yang dipublikasikan melalui GitHub Pages.
2. Masuk ke Pengaturan & Cadangan, pilih mata uang akun dan saldo awal.
3. Pilih Catat Trade untuk memasukkan transaksi.
4. Untuk perhitungan otomatis P/L, masukkan harga entry dan exit, arah posisi, ukuran posisi, pengali kontrak yang sesuai instrumen, serta biaya. Trade tanpa harga exit atau hasil manual dianggap masih terbuka.
5. Jika laporan broker sudah menyediakan angka hasil bersih, isi Hasil bersih manual; angka tersebut akan dipakai sebagai P/L bersih untuk trade itu.
6. Buat backup JSON secara berkala dan simpan di tempat aman.

## Catatan penting

- Data jurnal disimpan pada browser dan perangkat yang sedang digunakan, bukan disinkronkan ke akun atau server. Menghapus data situs/browser dapat menghapus jurnal; ekspor backup secara berkala.
- P/L otomatis dihitung sebagai (exit - entry) × ukuran × pengali kontrak × arah - biaya. Untuk posisi Short arah dibalik. Sesuaikan pengali kontrak dengan spesifikasi instrumen dan mata uang akun; hasil otomatis tidak menggantikan rekonsiliasi dengan laporan broker.
- Expectancy adalah rata-rata P/L bersih per trade tertutup pada jurnal. Maximum drawdown mengukur penurunan saldo terbesar dari puncak ekuitas historis berdasarkan tanggal trade yang dicatat; keduanya bersifat deskriptif, bukan prediksi. Analisis hari menggunakan tanggal trade, bukan jam entry atau zona waktu broker. Pola dengan sampel kecil jangan diperlakukan sebagai keunggulan yang terbukti.
- Risiko otomatis dihitung dari |entry - stop-loss| × ukuran × pengali kontrak, kecuali nominal risiko diisi manual. Perhitungan ini merupakan estimasi dan belum memperhitungkan slippage, funding, konversi mata uang, atau aturan margin broker.
- Pengingat risiko harian menghitung P/L trade tertutup yang tanggalnya sama dengan tanggal lokal perangkat dan menghitung jumlah trade yang dicatat untuk tanggal itu. Saldo awal hari adalah estimasi dari saldo awal jurnal ditambah P/L tertutup pada tanggal sebelumnya. Data tanggal tidak mewakili urutan intraday broker, posisi terbuka/floating P/L tidak masuk hitungan kerugian harian, dan peringatan tidak memblokir order MT5.
- Checklist adalah catatan mandiri per trade, bukan validasi otomatis terhadap pasar atau jaminan bahwa aturan benar-benar dipatuhi. Data checklist lama yang belum ada akan tampil tidak dicentang.
- Aplikasi ini merupakan alat pencatatan dan edukasi, bukan rekomendasi transaksi atau nasihat keuangan.
- File CNAME dipertahankan untuk domain lightjurnal.my.id. Pastikan konfigurasi GitHub Pages/DNS di akun pemilik tetap sesuai setelah perubahan situs.
