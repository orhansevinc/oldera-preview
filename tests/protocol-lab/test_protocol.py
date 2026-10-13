from __future__ import annotations

import json
from pathlib import Path
import socket
import threading
import unittest
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "ws11_protocol"))

from ko1298 import FrameError, build_frame, decode_frame, parse_frames  # noqa: E402
from replay import replay_to_socket  # noqa: E402

FIXTURES = ROOT / "protocol-lab" / "fixtures"
SEQUENCE = ROOT / "protocol-lab" / "login_to_zone.sequence.json"


class ProtocolLabTests(unittest.TestCase):
    def fixture(self, name: str) -> bytes:
        return (FIXTURES / name).read_bytes()

    def decode(self, name: str, channel: str, direction: str):
        frames = parse_frames(self.fixture(name))
        self.assertEqual(len(frames), 1)
        return decode_frame(frames[0], channel=channel, direction=direction)

    def test_observed_serverlist_frame_is_exact(self):
        self.assertEqual(self.fixture("login_serverlist_request.bin").hex(), "aa550100f555aa")
        d = self.decode("login_serverlist_request.bin", "login", "C2S")
        self.assertEqual(d["name"], "LS_SERVERLIST")
        self.assertEqual(d["fields"], {"request": "server_list"})

    def test_frame_length_and_tail_are_strict(self):
        good = build_frame(b"\xf5")
        self.assertEqual(parse_frames(good)[0].payload, b"\xf5")
        with self.assertRaises(FrameError):
            parse_frames(good[:-1])
        bad_tail = good[:-2] + b"\x00\x00"
        with self.assertRaises(FrameError):
            parse_frames(bad_tail)

    def test_concatenated_frames(self):
        data = self.fixture("game_version_request.bin") + self.fixture("allchar_request.bin")
        frames = parse_frames(data)
        self.assertEqual([f.opcode for f in frames], [0x2B, 0x0C])
        self.assertEqual(frames[1].offset, len(frames[0].raw))

    def test_serverlist_response(self):
        d = self.decode("login_serverlist_response_demo.bin", "login", "S2C")
        self.assertEqual(d["fields"]["server_count"], 1)
        self.assertEqual(d["fields"]["servers"][0]["ip"], "127.0.0.1")
        self.assertEqual(d["fields"]["servers"][0]["name"], "OldKO-Lab")
        self.assertEqual(d["fields"]["servers"][0]["concurrent_users"], 7)

    def test_login_credentials(self):
        d = self.decode("login_account_request_demo.bin", "login", "C2S")
        self.assertEqual(d["fields"]["account"], "demo")
        self.assertEqual(d["fields"]["password"], "demo")

    def test_version_response_and_cryption_boundary(self):
        d = self.decode("game_version_response_1298_no_crypto.bin", "game", "S2C")
        self.assertEqual(d["fields"]["version"], 1298)
        self.assertEqual(d["fields"]["public_key"], 0)
        self.assertFalse(d["fields"]["cryption_enabled_after_response"])

    def test_nation_request_response(self):
        req = self.decode("nation_select_karus_request.bin", "game", "C2S")
        res = self.decode("nation_select_karus_response.bin", "game", "S2C")
        self.assertEqual(req["fields"]["nation"], 1)
        self.assertEqual(res["fields"]["nation"], 1)

    def test_empty_character_list_has_three_complete_slots(self):
        d = self.decode("allchar_response_empty.bin", "game", "S2C")
        chars = d["fields"]["characters"]
        self.assertEqual(len(chars), 3)
        self.assertEqual([c["id"] for c in chars], ["", "", ""])
        self.assertTrue(all(c["shoes"]["item_id"] == 0 for c in chars))

    def test_character_select_request(self):
        d = self.decode("character_select_request_demo.bin", "game", "C2S")
        self.assertEqual(d["fields"]["account"], "demo")
        self.assertEqual(d["fields"]["character"], "FixtureChar")
        self.assertEqual(d["fields"]["zone_init"], 1)
        self.assertEqual(d["fields"]["zone_current_wire"], 1)

    def test_character_select_success_zone_transform(self):
        d = self.decode("character_select_success_demo.bin", "game", "S2C")
        self.assertEqual(d["fields"]["result"], 1)
        self.assertEqual(d["fields"]["zone_wire"], 1)
        self.assertEqual(d["fields"]["zone_client_1298"], 10)
        self.assertEqual(d["fields"]["x"], 100.0)
        self.assertEqual(d["fields"]["z"], 100.0)
        self.assertEqual(d["fields"]["y"], 0.0)

    def test_unknown_body_stays_unknown_even_if_opcode_name_is_known(self):
        d = self.decode("unknown_game_fe.bin", "game", "S2C")
        self.assertEqual(d["name"], "WIZ_DEBUG_STRING_PACKET")
        self.assertEqual(d["fields"], "UNKNOWN")

    def test_encrypted_option_never_guesses_opcode(self):
        frame = parse_frames(self.fixture("game_login_request_demo.bin"))[0]
        d = decode_frame(frame, channel="game", direction="C2S", encrypted=True)
        self.assertIsNone(d["opcode"])
        self.assertEqual(d["fields"], "UNKNOWN_ENCRYPTED_BODY")

    def test_catalog_has_full_source_enum_and_unknown_policy(self):
        catalog = json.loads((ROOT / "protocol-lab" / "opcodes.json").read_text())
        self.assertEqual(len(catalog["login_opcodes"]), 7)
        self.assertGreaterEqual(len(catalog["game_opcodes"]), 120)
        fields = catalog["catalog_entry_fields"]
        rows = [dict(zip(fields, row)) for row in catalog["game_opcodes"]]
        move = next(x for x in rows if x["name"] == "WIZ_MOVE")
        self.assertEqual(move["value"], "0x06")
        self.assertNotIn("0x06", catalog["verified"]["game"])
        self.assertEqual(catalog["unknown_default"]["direction"], "UNKNOWN")
        self.assertEqual(catalog["unknown_default"]["payload_size"], "UNKNOWN")
        self.assertEqual(catalog["unknown_default"]["layout"], "UNKNOWN")
        collisions = [x for x in rows if x["value"] == "0x50"]
        self.assertEqual({x["name"] for x in collisions}, {"WIZ_MARKET_BBS", "WIZ_LOGIN_INFO"})

    def test_manifest_matches_all_binary_files(self):
        manifest = json.loads((FIXTURES / "manifest.json").read_text())
        listed = {x["file"] for x in manifest["fixtures"]}
        actual = {p.name for p in FIXTURES.glob("*.bin")}
        self.assertEqual(listed, actual)
        for entry in manifest["fixtures"]:
            data = self.fixture(entry["file"])
            self.assertEqual(data.hex(), entry["frame_hex"])
            self.assertEqual(len(data), entry["frame_bytes"])
            parse_frames(data)

    def test_replay_is_byte_exact_to_local_tcp_receiver(self):
        received = bytearray()
        ready = threading.Event()
        port_holder: list[int] = []

        def server():
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", 0))
                s.listen(1)
                port_holder.append(s.getsockname()[1])
                ready.set()
                conn, _ = s.accept()
                with conn:
                    while True:
                        chunk = conn.recv(65536)
                        if not chunk:
                            break
                        received.extend(chunk)

        thread = threading.Thread(target=server, daemon=True)
        thread.start()
        self.assertTrue(ready.wait(2))
        sent = replay_to_socket(SEQUENCE, "login", "127.0.0.1", port_holder[0])
        thread.join(2)
        self.assertFalse(thread.is_alive())
        self.assertEqual(bytes(received), b"".join(sent))
        self.assertEqual(
            sent,
            [
                self.fixture("login_serverlist_request.bin"),
                self.fixture("login_account_request_demo.bin"),
                self.fixture("login_news_request.bin"),
            ],
        )


if __name__ == "__main__":
    unittest.main()
