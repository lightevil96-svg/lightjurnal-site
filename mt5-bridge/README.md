# TradeLog MT5 read-only bridge

Bridge ini membuat snapshot akun MT5 dan posisi terbuka untuk halaman **MT5 Live**. Bridge hanya menyediakan endpoint GET; tidak ada endpoint trading/order.

## Yang dibutuhkan

- Windows PC/VPS (paket Python `MetaTrader5` membutuhkan terminal MetaTrader 5 yang kompatibel di Windows).
- MetaTrader 5 desktop sudah terpasang dan **sudah login ke akun investor/read-only** pada terminal tersebut.
- Python 3.10+ dan koneksi internet.
- HTTPS reverse proxy untuk akses dari website. Jangan membuka port Flask langsung ke internet.

## Jalankan lokal

1. Login ke akun investor di aplikasi MetaTrader 5 desktop. Jangan menaruh password MT5 di website atau file konfigurasi bridge.
2. Buka PowerShell di folder `mt5-bridge`, lalu buat virtual environment dan install dependency:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   ```

3. Buat API key acak panjang. Simpan sebagai environment variable, bukan di source code:

   ```powershell
   $env:MT5_BRIDGE_API_KEY = "GANTI_DENGAN_SECRET_ACAK_PANJANG"
   $env:MT5_BRIDGE_ALLOWED_ORIGIN = "https://lightjurnal.my.id"
   $env:MT5_BRIDGE_HOST = "127.0.0.1"
   $env:MT5_BRIDGE_PORT = "8765"
   python server.py
   ```

4. Letakkan reverse proxy HTTPS di depan service lokal, misalnya URL publik `https://domain-kamu.example/api/mt5/snapshot` diteruskan ke `http://127.0.0.1:8765/snapshot`. Batasi akses di firewall/proxy jika memungkinkan.
5. Di TradeLog, buka **MT5 Live**, isi URL API bridge sebagai `https://domain-kamu.example/api/mt5` (tanpa `/snapshot`) dan API key yang sama. API key disimpan hanya di session browser, bukan localStorage.

## Format endpoint

`GET /snapshot` dengan header `Authorization: Bearer <API_KEY>`.

Contoh response:

```json
{
  "connected": true,
  "timestamp": "2026-10-27T00:00:00+00:00",
  "account": {
    "login": "12345678",
    "server": "Broker-Demo",
    "currency": "USD",
    "balance": 1000.0,
    "equity": 1005.0,
    "profit": 5.0,
    "margin": 20.0,
    "freeMargin": 985.0,
    "marginLevel": 5025.0,
    "leverage": 100
  },
  "positions": [
    {
      "ticket": 123456,
      "symbol": "EURUSD",
      "type": "BUY",
      "volume": 0.01,
      "priceOpen": 1.08,
      "priceCurrent": 1.081,
      "profit": 1.0,
      "swap": 0.0
    }
  ]
}
```

Halaman web melakukan polling snapshot setiap 10 detik selama tab MT5 Live aktif. Itu bukan streaming tick-by-tick; frekuensi update bergantung pada terminal, broker, jaringan, dan interval polling.

## Keamanan penting

- Jangan gunakan password utama/master; gunakan kredensial investor/read-only.
- Jangan memasukkan password MT5 ke situs, GitHub, query URL, atau JavaScript.
- Gunakan HTTPS, API key acak yang kuat, firewall/IP allowlist, dan reverse proxy yang terawat.
- Jangan menonaktifkan autentikasi/CORS untuk membuat koneksi “berhasil”.
- Bridge ini tidak mengirim order dan tidak bisa menjamin bahwa chart TradingView sama dengan feed broker MT5.
