# MT5 read-only bridge for TradeLog

This optional bridge exposes account equity/balance and open positions from a running MetaTrader 5 desktop terminal. It has a single read-only endpoint, `GET /snapshot`; it cannot submit or modify orders.

## Requirements

- Windows PC/VPS with MetaTrader 5 desktop installed and logged in to an investor/read-only account.
- Python 3.10+ on the same Windows machine.
- HTTPS reverse proxy to publish the endpoint safely.

## Install and run

1. Open MT5 desktop and sign in with the investor/read-only credentials. Do not put MT5 passwords into TradeLog or this repository.
2. Install dependencies in PowerShell:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r mt5-bridge-requirements.txt
   ```

3. Configure the bridge API key and website origin:

   ```powershell
   $env:MT5_BRIDGE_API_KEY = "REPLACE_WITH_A_LONG_RANDOM_SECRET"
   $env:MT5_BRIDGE_ALLOWED_ORIGIN = "https://lightjurnal.my.id"
   $env:MT5_BRIDGE_PORT = "8765"
   python mt5-bridge.py
   ```

4. Keep the service bound to localhost. Put an HTTPS reverse proxy in front of it and map a public URL such as `https://your-domain.example/api/mt5/snapshot` to `http://127.0.0.1:8765/snapshot`. Never expose the Flask development server directly to the public internet.
5. In TradeLog, open **MT5 Live**. Set the API URL to `https://your-domain.example/api/mt5` (without `/snapshot`) and enter the same bridge API key. The key is held in browser session storage only. The page refreshes the snapshot every 10 seconds while open.

## Security notes

- Use an investor/read-only MT5 login, never your master trading password.
- Use HTTPS, a strong random bridge key, firewall rules/IP allowlisting, and a maintained reverse proxy.
- Do not disable authentication or CORS to make a failed connection appear successful.
- This polling dashboard is not tick-by-tick streaming.
- The embedded TradingView chart is a separate market-data feed and may differ from your broker's MT5 quotes.

The website UI can display account information only after this bridge is deployed and configured. Adding the UI does not itself grant the static website access to MT5.
