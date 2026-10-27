import hmac
import os
from datetime import datetime, timezone

from flask import Flask, jsonify, make_response, request
import MetaTrader5 as mt5

app = Flask(__name__)
API_KEY = os.environ.get("MT5_BRIDGE_API_KEY", "")
ALLOWED_ORIGIN = os.environ.get("MT5_BRIDGE_ALLOWED_ORIGIN", "https://lightjurnal.my.id")


@app.after_request
def security_headers(response):
    origin = request.headers.get("Origin", "")
    if origin and origin == ALLOWED_ORIGIN:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.route("/snapshot", methods=["GET", "OPTIONS"])
def snapshot():
    if request.method == "OPTIONS":
        return make_response("", 204)
    if not API_KEY:
        return jsonify({"error": "bridge_not_configured"}), 503
    auth = request.headers.get("Authorization", "")
    supplied = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    if not supplied or not hmac.compare_digest(supplied, API_KEY):
        return jsonify({"error": "unauthorized"}), 401
    try:
        if not mt5.terminal_info() and not mt5.initialize():
            return jsonify({"error": "terminal_unavailable", "detail": str(mt5.last_error())}), 503
        account = mt5.account_info()
        positions_raw = mt5.positions_get()
        if account is None or positions_raw is None:
            return jsonify({"error": "account_data_unavailable", "detail": str(mt5.last_error())}), 503
        positions = []
        for item in positions_raw:
            positions.append({
                "ticket": int(item.ticket),
                "symbol": str(item.symbol),
                "type": "BUY" if item.type == mt5.POSITION_TYPE_BUY else "SELL",
                "volume": float(item.volume),
                "priceOpen": float(item.price_open),
                "priceCurrent": float(item.price_current),
                "profit": float(item.profit),
                "swap": float(item.swap),
            })
        return jsonify({
            "connected": True,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "account": {
                "login": str(account.login),
                "server": str(account.server),
                "currency": str(account.currency),
                "balance": float(account.balance),
                "equity": float(account.equity),
                "profit": float(account.profit),
                "margin": float(account.margin),
                "freeMargin": float(account.margin_free),
                "marginLevel": float(account.margin_level) if account.margin_level is not None else None,
                "leverage": int(account.leverage),
            },
            "positions": positions,
        })
    except Exception:
        app.logger.exception("Snapshot request failed")
        return jsonify({"error": "snapshot_failed"}), 503


if __name__ == "__main__":
    if not API_KEY:
        raise SystemExit("Set MT5_BRIDGE_API_KEY before starting.")
    app.run(host="127.0.0.1", port=int(os.environ.get("MT5_BRIDGE_PORT", "8765")), debug=False)
