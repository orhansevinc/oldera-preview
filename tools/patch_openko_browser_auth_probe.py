#!/usr/bin/env python3
from pathlib import Path

p = Path("openko/src/Client/WarFare/GameProcLogIn_1298.cpp")
s = p.read_text(encoding="utf-8")

old = '''void CGameProcLogIn_1298::MsgRecv_AccountLogIn(int iCmd, Packet& pkt)
{
\t// Recv - b1 (0: Failure, 1: Success, 2: ID Not Found, 3: Incorrect Password,
\t// 4: Server Under Maintenance)
\tint iResult = pkt.read<uint8_t>();
'''
new = '''void CGameProcLogIn_1298::MsgRecv_AccountLogIn(int iCmd, Packet& pkt)
{
\t// Recv - b1 (0: Failure, 1: Success, 2: ID Not Found, 3: Incorrect Password,
\t// 4: Server Under Maintenance)
\tint iResult = pkt.read<uint8_t>();
#ifdef __EMSCRIPTEN__
\tspdlog::info("browser login response: cmd=0x{:02x} result={}", iCmd, iResult);
#endif
'''
if "browser login response:" not in s:
    if old not in s:
        raise SystemExit("account-login parser anchor changed")
    s = s.replace(old, new, 1)

p.write_text(s, encoding="utf-8")
print("Browser login auth parser logging added")
