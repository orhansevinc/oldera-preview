#!/usr/bin/env python3
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"{label}: upstream/control patch anchor changed")
    return text.replace(old, new, 1)


# Re-enable the genuine 1298 login network path. The first rendering milestone
# bypassed it deliberately; now the browser uses CAPISocket again.
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
\tspdlog::info("browser login transport active: direct Emscripten WebSocket gateway");
#endif
\tif (iServer >= 0 && lstrlen(szIPs[iServer]) > 0)
\t{'''
if "browser login transport active: direct Emscripten WebSocket gateway" not in s:
    s = replace_once(s, old_begin, new_begin, "browser login bridge begin")
    s = replace_once(
        s,
        '''\t}\n#endif\n\n\t// 게임 계정으로 들어 왔으면..''',
        '''\t}\n\n\t// 게임 계정으로 들어 왔으면..''',
        "browser login bridge end",
    )
p.write_text(s, encoding="utf-8")

# Browser CAPISocket transport: do NOT use Asio's synchronous connect(). A
# browser WebSocket can only finish connecting asynchronously on the JS event
# loop, so blocking in asio::connect() prevents the OPEN event from happening.
# Keep the exact KO framing/cryption code, but transport those already-framed
# bytes through Emscripten's native WebSocket C API.
p = Path("openko/src/Client/WarFare/APISocket.h")
s = p.read_text(encoding="utf-8-sig")
if "m_BrowserWebSocket" not in s:
    s = replace_once(
        s,
        '#include <memory>\n',
        '''#ifdef __EMSCRIPTEN__
#include <emscripten/websocket.h>
#endif

#include <deque>
#include <memory>
''',
        "APISocket browser includes",
    )
    s = replace_once(
        s,
        '''\tBOOL m_bConnectionLost; // set when the transport detects a close/error

\tExpandableCircularBuffer m_CB;''',
        '''\tBOOL m_bConnectionLost; // set when the transport detects a close/error

#ifdef __EMSCRIPTEN__
\tEMSCRIPTEN_WEBSOCKET_T m_BrowserWebSocket = 0;
\tbool m_BrowserWebSocketOpen = false;
\tstd::deque<std::vector<char>> m_BrowserPendingFrames;

\tstatic EM_BOOL BrowserOnOpen(int eventType, const EmscriptenWebSocketOpenEvent* event, void* userData);
\tstatic EM_BOOL BrowserOnError(int eventType, const EmscriptenWebSocketErrorEvent* event, void* userData);
\tstatic EM_BOOL BrowserOnClose(int eventType, const EmscriptenWebSocketCloseEvent* event, void* userData);
\tstatic EM_BOOL BrowserOnMessage(int eventType, const EmscriptenWebSocketMessageEvent* event, void* userData);
\tvoid FlushBrowserPendingFrames();
#endif

\tExpandableCircularBuffer m_CB;''',
        "APISocket browser fields",
    )
p.write_text(s, encoding="utf-8")

p = Path("openko/src/Client/WarFare/APISocket.cpp")
s = p.read_text(encoding="utf-8")

if "BrowserOnOpen" not in s:
    # Disconnect: browser WebSocket owns transport there; native remains Asio.
    s = replace_once(
        s,
        '''void CAPISocket::Disconnect()
{
\tasio::error_code ec;
\tif (m_pTransport->Socket.is_open())
\t{
\t\tm_pTransport->Socket.shutdown(asio::ip::tcp::socket::shutdown_both, ec);
\t\tm_pTransport->Socket.close(ec);
\t}
''',
        '''void CAPISocket::Disconnect()
{
#ifdef __EMSCRIPTEN__
\tif (m_BrowserWebSocket > 0)
\t{
\t\temscripten_websocket_close(m_BrowserWebSocket, 1000, "client disconnect");
\t\temscripten_websocket_delete(m_BrowserWebSocket);
\t\tm_BrowserWebSocket = 0;
\t}
\tm_BrowserWebSocketOpen = false;
\tm_BrowserPendingFrames.clear();
#else
\tasio::error_code ec;
\tif (m_pTransport->Socket.is_open())
\t{
\t\tm_pTransport->Socket.shutdown(asio::ip::tcp::socket::shutdown_both, ec);
\t\tm_pTransport->Socket.close(ec);
\t}
#endif
''',
        "APISocket browser disconnect",
    )

    # Connect: browser creates WS asynchronously and returns success so the
    # existing login code can immediately enqueue LS_SERVERLIST.
    connect_anchor = '''int CAPISocket::Connect(HWND hWnd, const std::string& szIP, uint32_t dwPort)
{
\tif (szIP.empty() || dwPort == 0)
\t\treturn -1;

\tif (m_pTransport->Socket.is_open())
\t\tDisconnect();

\tasio::error_code ec;
'''
    connect_browser = '''int CAPISocket::Connect(HWND hWnd, const std::string& szIP, uint32_t dwPort)
{
\tif (szIP.empty() || dwPort == 0)
\t\treturn -1;

#ifdef __EMSCRIPTEN__
\tif (!emscripten_websocket_is_supported())
\t{
#ifdef _N3GAME
\t\tCLogWriter::Write("browser WebSocket API is not supported");
#endif
\t\treturn -1;
\t}

\tif (m_BrowserWebSocket > 0)
\t\tDisconnect();

\tconst std::string url = "ws://" + szIP + ":" + std::to_string(dwPort);
\tEmscriptenWebSocketCreateAttributes attr;
\temscripten_websocket_init_create_attributes(&attr);
\tattr.url = url.c_str();
\tattr.protocols = nullptr;
\tattr.createOnMainThread = EM_TRUE;

\tm_BrowserWebSocket = emscripten_websocket_new(&attr);
\tif (m_BrowserWebSocket <= 0)
\t{
#ifdef _N3GAME
\t\tCLogWriter::Write("browser WebSocket create failed: {}", static_cast<int>(m_BrowserWebSocket));
#endif
\t\tm_BrowserWebSocket = 0;
\t\treturn -1;
\t}

\temscripten_websocket_set_onopen_callback(m_BrowserWebSocket, this, &CAPISocket::BrowserOnOpen);
\temscripten_websocket_set_onerror_callback(m_BrowserWebSocket, this, &CAPISocket::BrowserOnError);
\temscripten_websocket_set_onclose_callback(m_BrowserWebSocket, this, &CAPISocket::BrowserOnClose);
\temscripten_websocket_set_onmessage_callback(m_BrowserWebSocket, this, &CAPISocket::BrowserOnMessage);

\tm_hWndTarget = hWnd;
\tm_szIP = szIP;
\tm_dwPort = dwPort;
\tm_bConnected = TRUE;
\tm_bConnectionLost = FALSE;
\tm_BrowserWebSocketOpen = false;
#ifdef _N3GAME
\tCLogWriter::Write("browser WebSocket connecting: {}", url);
#endif
\treturn 0;
#else
\tif (m_pTransport->Socket.is_open())
\t\tDisconnect();

\tasio::error_code ec;
'''
    s = replace_once(s, connect_anchor, connect_browser, "APISocket browser connect begin")
    s = replace_once(
        s,
        '''\tm_bConnectionLost = FALSE;

\treturn 0;
}

int CAPISocket::ReConnect()''',
        '''\tm_bConnectionLost = FALSE;

\treturn 0;
#endif
}

int CAPISocket::ReConnect()''',
        "APISocket browser connect end",
    )

    # Insert Emscripten callbacks before ReConnect(). Incoming binary bytes go
    # into the same circular buffer the original KO parser already consumes.
    callbacks = r'''#ifdef __EMSCRIPTEN__
EM_BOOL CAPISocket::BrowserOnOpen(int, const EmscriptenWebSocketOpenEvent*, void* userData)
{
	auto* self = static_cast<CAPISocket*>(userData);
	self->m_BrowserWebSocketOpen = true;
#ifdef _N3GAME
	CLogWriter::Write("browser WebSocket open");
#endif
	self->FlushBrowserPendingFrames();
	return EM_TRUE;
}

EM_BOOL CAPISocket::BrowserOnError(int, const EmscriptenWebSocketErrorEvent*, void* userData)
{
	auto* self = static_cast<CAPISocket*>(userData);
#ifdef _N3GAME
	CLogWriter::Write("browser WebSocket error");
#endif
	self->m_BrowserWebSocketOpen = false;
	self->m_bConnected = FALSE;
	self->m_bConnectionLost = TRUE;
	return EM_TRUE;
}

EM_BOOL CAPISocket::BrowserOnClose(int, const EmscriptenWebSocketCloseEvent* event, void* userData)
{
	auto* self = static_cast<CAPISocket*>(userData);
#ifdef _N3GAME
	CLogWriter::Write("browser WebSocket closed code={}", event ? event->code : 0);
#endif
	self->m_BrowserWebSocketOpen = false;
	self->m_bConnected = FALSE;
	self->m_bConnectionLost = TRUE;
	return EM_TRUE;
}

EM_BOOL CAPISocket::BrowserOnMessage(int, const EmscriptenWebSocketMessageEvent* event, void* userData)
{
	auto* self = static_cast<CAPISocket*>(userData);
	if (event == nullptr || event->isText || event->numBytes == 0)
		return EM_TRUE;

	self->m_CB.PutData(reinterpret_cast<const char*>(event->data), static_cast<int>(event->numBytes));
#ifdef _N3GAME
	CLogWriter::Write("browser WebSocket received {} KO bytes", event->numBytes);
#endif
	return EM_TRUE;
}

void CAPISocket::FlushBrowserPendingFrames()
{
	if (!m_BrowserWebSocketOpen || m_BrowserWebSocket <= 0)
		return;

	while (!m_BrowserPendingFrames.empty())
	{
		auto& frame = m_BrowserPendingFrames.front();
		const EMSCRIPTEN_RESULT rc = emscripten_websocket_send_binary(
			m_BrowserWebSocket, frame.data(), static_cast<uint32_t>(frame.size()));
		if (rc != EMSCRIPTEN_RESULT_SUCCESS)
		{
#ifdef _N3GAME
			CLogWriter::Write("browser WebSocket send failed rc={}", static_cast<int>(rc));
#endif
			m_bConnected = FALSE;
			m_bConnectionLost = TRUE;
			return;
		}
#ifdef _N3GAME
		CLogWriter::Write("browser WebSocket sent queued KO frame ({} bytes)", frame.size());
#endif
		m_BrowserPendingFrames.pop_front();
	}
}
#endif

'''
    s = replace_once(s, "int CAPISocket::ReConnect()\n{", callbacks + "int CAPISocket::ReConnect()\n{", "APISocket browser callbacks")

    # Browser receive is callback-driven; Poll() only parses bytes already
    # deposited by BrowserOnMessage(). Native path still drains Asio.
    s = replace_once(
        s,
        '''void CAPISocket::Receive()
{
\tif (FALSE == m_bConnected || !m_pTransport->Socket.is_open())
\t\treturn;
''',
        '''void CAPISocket::Receive()
{
#ifdef __EMSCRIPTEN__
\tif (FALSE == m_bConnected)
\t\treturn;
\tFlushBrowserPendingFrames();
\twhile (ReceiveProcess())
\t\t;
\treturn;
#else
\tif (FALSE == m_bConnected || !m_pTransport->Socket.is_open())
\t\treturn;
''',
        "APISocket browser receive begin",
    )
    s = replace_once(
        s,
        '''\twhile (ReceiveProcess())
\t\t;
}

BOOL CAPISocket::ReceiveProcess()''',
        '''\twhile (ReceiveProcess())
\t\t;
#endif
}

BOOL CAPISocket::ReceiveProcess()''',
        "APISocket browser receive end",
    )

    # Send framing/encryption stays untouched. Only the final transport write
    # differs: binary WebSocket frame in browser, Asio TCP write natively.
    s = replace_once(
        s,
        '''\tif (!m_bEnableSend)
\t\treturn; // 보내기 가능..?
\tif (FALSE == m_bConnected || !m_pTransport->Socket.is_open())
\t\treturn;
''',
        '''\tif (!m_bEnableSend)
\t\treturn; // 보내기 가능..?
#ifdef __EMSCRIPTEN__
\tif (FALSE == m_bConnected || m_BrowserWebSocket <= 0)
\t\treturn;
#else
\tif (FALSE == m_bConnected || !m_pTransport->Socket.is_open())
\t\treturn;
#endif
''',
        "APISocket browser send guard",
    )
    s = replace_once(
        s,
        '''\tsize_t nSent              = 0;
\twhile (nSent < nTotalSize)
\t{''',
        '''#ifdef __EMSCRIPTEN__
\tm_BrowserPendingFrames.emplace_back(m_SendBuf.begin(), m_SendBuf.begin() + static_cast<std::ptrdiff_t>(nTotalSize));
#ifdef _N3GAME
\tCLogWriter::Write("browser queued KO frame ({} bytes), wsOpen={}", nTotalSize, m_BrowserWebSocketOpen ? 1 : 0);
#endif
\tFlushBrowserPendingFrames();
#else
\tsize_t nSent              = 0;
\twhile (nSent < nTotalSize)
\t{''',
        "APISocket browser send transport begin",
    )
    s = replace_once(
        s,
        '''\t}

\tm_iSendByteCount += static_cast<int>(nTotalSize);
}''',
        '''\t}
#endif

\tm_iSendByteCount += static_cast<int>(nTotalSize);
}''',
        "APISocket browser send transport end",
    )

p.write_text(s, encoding="utf-8")

# Emscripten WebSocket C API implementation.
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

print("OldERA login bridge patch applied: direct Emscripten WebSocket CAPISocket transport")
