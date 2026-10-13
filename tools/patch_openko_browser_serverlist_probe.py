#!/usr/bin/env python3
from pathlib import Path

p = Path("openko/src/Client/WarFare/GameProcLogIn_1298.cpp")
s = p.read_text(encoding="utf-8")

old_head = '''void CGameProcLogIn_1298::MsgRecv_GameServerGroupList(Packet& pkt)
{
\tint iServerCount = pkt.read<uint8_t>(); // 서버 갯수
'''
new_head = '''void CGameProcLogIn_1298::MsgRecv_GameServerGroupList(Packet& pkt)
{
\tint iServerCount = pkt.read<uint8_t>(); // 서버 갯수
#ifdef __EMSCRIPTEN__
\tspdlog::info("browser server list received: count={}", iServerCount);
#endif
'''
if "browser server list received:" not in s:
    if old_head not in s:
        raise SystemExit("server-list parser head anchor changed")
    s = s.replace(old_head, new_head, 1)

old_entry = '''\t\tGSI.iConcurrentUserCount = pkt.read<int16_t>(); // 현재 동시 접속자수..

\t\tm_pUILogIn->ServerInfoAdd(GSI);                 // ServerList
'''
new_entry = '''\t\tGSI.iConcurrentUserCount = pkt.read<int16_t>(); // 현재 동시 접속자수..
#ifdef __EMSCRIPTEN__
\t\tspdlog::info("browser server list entry: name='{}' ip='{}' users={}",
\t\t\tGSI.szName, GSI.szIP, GSI.iConcurrentUserCount);
#endif

\t\tm_pUILogIn->ServerInfoAdd(GSI);                 // ServerList
'''
if "browser server list entry:" not in s:
    if old_entry not in s:
        raise SystemExit("server-list parser entry anchor changed")
    s = s.replace(old_entry, new_entry, 1)

p.write_text(s, encoding="utf-8")
print("Browser server-list parser logging added")
