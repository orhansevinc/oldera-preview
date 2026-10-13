#!/usr/bin/env python3
"""Re-enable OpenKO's native login socket path for the Emscripten build.

patch_openko_browser.py intentionally deferred networking while the WebGL2
renderer was being stabilised.  At this milestone we keep the original KO
CAPISocket/packet code and let Emscripten translate its POSIX TCP socket into
a WebSocket.  A WebSocket->TCP bridge (websockify in CI, OldERA gateway in
production) supplies the browser-compatible transport.
"""

from pathlib import Path

p = Path("openko/src/Client/WarFare/GameProcLogIn_1298.cpp")
s = p.read_text(encoding="utf-8-sig")

begin = '''#ifdef __EMSCRIPTEN__
\t(void) iServer;
\tm_pUILogIn->FocusToID();
\tspdlog::info("browser login scene ready; network deferred to WebSocket gateway");
#else
\tif (iServer >= 0 && lstrlen(szIPs[iServer]) > 0)
\t{'''
replacement = '''\tif (iServer >= 0 && lstrlen(szIPs[iServer]) > 0)
\t{'''

if begin not in s:
    raise SystemExit("browser deferred-network block not found; upstream/patcher changed")
s = s.replace(begin, replacement, 1)

end = '''\telse
\t{
\t\tMessageBoxPost("No server list", "LogIn Server fail", MB_OK, BEHAVIOR_EXIT); // 끝낸다.
\t}
#endif

\t// 게임 계정으로 들어 왔으면..'''
end_replacement = '''\telse
\t{
\t\tMessageBoxPost("No server list", "LogIn Server fail", MB_OK, BEHAVIOR_EXIT); // 끝낸다.
\t}

\t// 게임 계정으로 들어 왔으면..'''
if end not in s:
    raise SystemExit("browser deferred-network closing block not found")
s = s.replace(end, end_replacement, 1)

# Add an unambiguous browser milestone after the real CAPISocket connect has
# succeeded and immediately before the genuine LS_SERVERLIST packet is sent.
needle = '''\t\telse
\t\t{
\t\t\tm_pUILogIn->FocusToID(); // Focus on the ID input box..

\t\t\t// 게임 서버 리스트 요청..'''
insert = '''\t\telse
\t\t{
\t\t\tm_pUILogIn->FocusToID(); // Focus on the ID input box..
#ifdef __EMSCRIPTEN__
\t\t\tspdlog::info("browser login transport connected; requesting genuine LS_SERVERLIST");
#endif

\t\t\t// 게임 서버 리스트 요청..'''
if needle not in s:
    raise SystemExit("successful login-server connect anchor not found")
s = s.replace(needle, insert, 1)

p.write_text(s, encoding="utf-8")
print("OldERA browser network enabled: native CAPISocket -> Emscripten WebSocket bridge")
