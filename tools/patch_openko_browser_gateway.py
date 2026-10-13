#!/usr/bin/env python3
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"{label}: upstream/control patch anchor changed")
    return text.replace(old, new, 1)


# The first browser milestone intentionally bypassed networking so the real
# 1298 login scene could be rendered without a login server. Re-enable the
# original CAPISocket path in Emscripten. Emscripten maps POSIX TCP sockets to
# binary WebSockets; gateway/oldera-gateway.mjs terminates that WebSocket and
# forwards the exact bytes to the KO TCP login server.
p = Path("openko/src/Client/WarFare/GameProcLogIn_1298.cpp")
s = p.read_text(encoding="utf-8")
old_begin = '''#ifdef __EMSCRIPTEN__
\t(void) iServer;
\tm_pUILogIn->FocusToID();
\tspdlog::info("browser login scene ready; network deferred to WebSocket gateway");
#else
\tif (iServer >= 0 && lstrlen(szIPs[iServer]) > 0)
\t{'''
new_begin = '''#ifdef __EMSCRIPTEN__
\tspdlog::info("browser login transport active: KO socket -> WebSocket gateway");
#endif
\tif (iServer >= 0 && lstrlen(szIPs[iServer]) > 0)
\t{'''
if "browser login transport active: KO socket -> WebSocket gateway" not in s:
    s = replace_once(s, old_begin, new_begin, "browser login bridge begin")
    s = replace_once(
        s,
        '''\t}\n#endif\n\n\t// 게임 계정으로 들어 왔으면..''',
        '''\t}\n\n\t// 게임 계정으로 들어 왔으면..''',
        "browser login bridge end",
    )
p.write_text(s, encoding="utf-8")

# Emscripten's POSIX TCP emulation creates the underlying WebSocket
# asynchronously. OpenKO sends LS_SERVERLIST immediately after Connect(); if
# the WebSocket is still CONNECTING, send() reports EAGAIN. Native OpenKO can
# wait for writability, but doing that on the browser main thread prevents the
# WebSocket open event itself from running. Queue only the unsent framed bytes
# in browser builds and flush them from Poll() on later game ticks.
p = Path("openko/src/Client/WarFare/APISocket.h")
s = p.read_text(encoding="utf-8-sig")
if "m_BrowserPendingSends" not in s:
    s = replace_once(s, "#include <memory>\n", "#include <deque>\n#include <memory>\n", "APISocket deque include")
    s = replace_once(
        s,
        "\tBOOL m_bConnectionLost; // set when the transport detects a close/error\n\n\tExpandableCircularBuffer m_CB;",
        '''\tBOOL m_bConnectionLost; // set when the transport detects a close/error

#ifdef __EMSCRIPTEN__
\tstd::deque<std::vector<char>> m_BrowserPendingSends;
\tsize_t m_BrowserPendingSendOffset = 0;
\tvoid FlushBrowserPendingSends();
#endif

\tExpandableCircularBuffer m_CB;''',
        "APISocket browser pending queue",
    )
p.write_text(s, encoding="utf-8")

p = Path("openko/src/Client/WarFare/APISocket.cpp")
s = p.read_text(encoding="utf-8")
if "FlushBrowserPendingSends" not in s:
    s = replace_once(
        s,
        '''\tm_bConnected      = FALSE;
\tm_bConnectionLost = FALSE;
\tm_bEnableSend     = TRUE; // 보내기 가능..?

#ifdef _CRYPTION''',
        '''\tm_bConnected      = FALSE;
\tm_bConnectionLost = FALSE;
\tm_bEnableSend     = TRUE; // 보내기 가능..?
#ifdef __EMSCRIPTEN__
\tm_BrowserPendingSends.clear();
\tm_BrowserPendingSendOffset = 0;
#endif

#ifdef _CRYPTION''',
        "APISocket disconnect pending reset",
    )

    poll_old = '''BOOL CAPISocket::Poll()
{
\tif (m_bConnected)
\t\tReceive();'''
    poll_new = '''BOOL CAPISocket::Poll()
{
#ifdef __EMSCRIPTEN__
\tif (m_bConnected)
\t\tFlushBrowserPendingSends();
#endif
\tif (m_bConnected)
\t\tReceive();'''
    s = replace_once(s, poll_old, poll_new, "APISocket browser flush poll")

    receive_anchor = '''void CAPISocket::Receive()
{'''
    flush_impl = '''#ifdef __EMSCRIPTEN__
void CAPISocket::FlushBrowserPendingSends()
{
\twhile (m_bConnected && m_pTransport->Socket.is_open() && !m_BrowserPendingSends.empty())
\t{
\t\tauto& pending = m_BrowserPendingSends.front();
\t\tif (m_BrowserPendingSendOffset >= pending.size())
\t\t{
\t\t\tm_BrowserPendingSends.pop_front();
\t\t\tm_BrowserPendingSendOffset = 0;
\t\t\tcontinue;
\t\t}

\t\tasio::error_code ec;
\t\tconst size_t written = m_pTransport->Socket.write_some(
\t\t\tasio::buffer(pending.data() + m_BrowserPendingSendOffset,
\t\t\t\tpending.size() - m_BrowserPendingSendOffset), ec);
\t\tm_BrowserPendingSendOffset += written;

\t\tif (ec == asio::error::would_block || ec == asio::error::try_again)
\t\t\treturn;

\t\tif (ec)
\t\t{
#ifdef _N3GAME
\t\t\tCLogWriter::Write("browser socket queued send error! : {}", ec.message());
#endif
\t\t\tm_bConnected      = FALSE;
\t\t\tm_bConnectionLost = TRUE;
\t\t\treturn;
\t\t}

\t\tif (m_BrowserPendingSendOffset >= pending.size())
\t\t{
#ifdef _N3GAME
\t\t\tCLogWriter::Write("browser socket flushed queued KO frame ({} bytes)", pending.size());
#endif
\t\t\tm_BrowserPendingSends.pop_front();
\t\t\tm_BrowserPendingSendOffset = 0;
\t\t}
\t}
}
#endif

void CAPISocket::Receive()
{'''
    s = replace_once(s, receive_anchor, flush_impl, "APISocket browser flush implementation")

    would_block_old = '''\t\tif (ec == asio::error::would_block || ec == asio::error::try_again)
\t\t{
\t\t\t// Outgoing packets are small; wait for writability and continue.
\t\t\tasio::error_code waitError;
\t\t\tm_pTransport->Socket.wait(asio::ip::tcp::socket::wait_write, waitError);
\t\t\tcontinue;
\t\t}'''
    would_block_new = '''\t\tif (ec == asio::error::would_block || ec == asio::error::try_again)
\t\t{
#ifdef __EMSCRIPTEN__
\t\t\t// The browser cannot synchronously wait for a WebSocket OPEN event.
\t\t\t// Preserve the exact remaining KO frame and retry it from Poll().
\t\t\tm_BrowserPendingSends.emplace_back(
\t\t\t\tm_SendBuf.begin() + static_cast<std::ptrdiff_t>(nSent),
\t\t\t\tm_SendBuf.begin() + static_cast<std::ptrdiff_t>(nTotalSize));
#ifdef _N3GAME
\t\t\tCLogWriter::Write("browser socket queued KO frame remainder ({} bytes)", nTotalSize - nSent);
#endif
\t\t\tbreak;
#else
\t\t\t// Native transports can synchronously wait for writability.
\t\t\tasio::error_code waitError;
\t\t\tm_pTransport->Socket.wait(asio::ip::tcp::socket::wait_write, waitError);
\t\t\tcontinue;
#endif
\t\t}'''
    s = replace_once(s, would_block_old, would_block_new, "APISocket browser EAGAIN queue")
p.write_text(s, encoding="utf-8")

# Link Emscripten's WebSocket support explicitly. The browser cannot open raw
# TCP; its POSIX socket shim turns connect(127.0.0.1:15100) into a binary
# WebSocket. In production the public gateway endpoint will replace the local
# address without changing KO packet framing or game procedures.
p = Path("openko/src/Client/WarFare/CMakeLists.txt")
s = p.read_text()
if '"-lwebsocket.js"' not in s:
    s = replace_once(
        s,
        '    "-sMIN_WEBGL_VERSION=2"\n',
        '    "-lwebsocket.js"\n    "-sMIN_WEBGL_VERSION=2"\n',
        "Emscripten websocket linker option",
    )
p.write_text(s)

print("OldERA login bridge patch applied: CAPISocket -> WebSocket gateway + browser send queue")
