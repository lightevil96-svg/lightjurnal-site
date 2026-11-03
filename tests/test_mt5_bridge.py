import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace


os.environ["MT5_BRIDGE_API_KEY"] = "test-secret"
os.environ["MT5_BRIDGE_ALLOWED_ORIGIN"] = "https://lightjurnal.my.id"
os.environ["MT5_BRIDGE_PORT"] = "8765"

fake_mt5 = types.ModuleType("MetaTrader5")
fake_mt5.POSITION_TYPE_BUY = 0
fake_mt5.POSITION_TYPE_SELL = 1
fake_mt5.terminal_info = lambda: object()
fake_mt5.initialize = lambda: True
fake_mt5.last_error = lambda: (1, "mock terminal error")
fake_mt5.account_info = lambda: SimpleNamespace(
    login=123456,
    server="Demo-Server",
    currency="USD",
    balance=1000.0,
    equity=1005.0,
    profit=5.0,
    margin=20.0,
    margin_free=985.0,
    margin_level=5025.0,
    leverage=100,
)
fake_mt5.positions_get = lambda: [
    SimpleNamespace(
        ticket=77,
        symbol="EURUSD",
        type=0,
        volume=0.1,
        price_open=1.1,
        price_current=1.105,
        sl=1.09,
        tp=1.12,
        profit=5.0,
        swap=-0.2,
    )
]
sys.modules["MetaTrader5"] = fake_mt5

BRIDGE_PATH = Path(__file__).resolve().parents[1] / "mt5-bridge.py"
spec = importlib.util.spec_from_file_location("lightjurnal_mt5_bridge", BRIDGE_PATH)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class MT5BridgeApiTests(unittest.TestCase):
    def setUp(self):
        bridge.API_KEY = "test-secret"
        fake_mt5.terminal_info = lambda: object()
        fake_mt5.initialize = lambda: True
        fake_mt5.account_info = lambda: SimpleNamespace(
            login=123456,
            server="Demo-Server",
            currency="USD",
            balance=1000.0,
            equity=1005.0,
            profit=5.0,
            margin=20.0,
            margin_free=985.0,
            margin_level=5025.0,
            leverage=100,
        )
        fake_mt5.positions_get = lambda: [
            SimpleNamespace(
                ticket=77,
                symbol="EURUSD",
                type=0,
                volume=0.1,
                price_open=1.1,
                price_current=1.105,
                sl=1.09,
                tp=1.12,
                profit=5.0,
                swap=-0.2,
            )
        ]

    def setUpClient(self):
        return bridge.app.test_client()

    def test_snapshot_requires_bearer_token(self):
        response = self.setUpClient().get("/snapshot")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "unauthorized")

    def test_snapshot_returns_account_and_position_risk_fields(self):
        response = self.setUpClient().get(
            "/snapshot",
            headers={
                "Authorization": "Bearer test-secret",
                "Origin": "https://lightjurnal.my.id",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "https://lightjurnal.my.id")
        payload = response.get_json()
        self.assertTrue(payload["connected"])
        self.assertEqual(payload["account"]["login"], "123456")
        position = payload["positions"][0]
        self.assertEqual(position["ticket"], 77)
        self.assertEqual(position["sl"], 1.09)
        self.assertEqual(position["tp"], 1.12)
        self.assertEqual(position["swap"], -0.2)

    def test_preflight_allows_only_configured_origin(self):
        response = self.setUpClient().options(
            "/snapshot",
            headers={"Origin": "https://lightjurnal.my.id"},
        )
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "https://lightjurnal.my.id")
        self.assertIn("GET", response.headers.get("Access-Control-Allow-Methods", ""))

    def test_unapproved_origin_receives_no_cors_permission(self):
        response = self.setUpClient().get(
            "/snapshot",
            headers={
                "Authorization": "Bearer test-secret",
                "Origin": "https://unapproved.example",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.headers.get("Access-Control-Allow-Origin"))

    def test_missing_account_data_returns_service_unavailable(self):
        fake_mt5.account_info = lambda: None
        response = self.setUpClient().get(
            "/snapshot",
            headers={"Authorization": "Bearer test-secret"},
        )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"], "account_data_unavailable")

    def test_missing_positions_returns_service_unavailable(self):
        fake_mt5.positions_get = lambda: None
        response = self.setUpClient().get(
            "/snapshot",
            headers={"Authorization": "Bearer test-secret"},
        )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"], "account_data_unavailable")

    def test_bridge_without_api_key_returns_service_unavailable(self):
        bridge.API_KEY = ""
        response = self.setUpClient().get(
            "/snapshot",
            headers={"Authorization": "Bearer test-secret"},
        )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"], "bridge_not_configured")


if __name__ == "__main__":
    unittest.main()
