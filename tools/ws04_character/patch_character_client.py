#!/usr/bin/env python3
"""WS04-only build-time patches for the real OpenKO 1298 character flow.

This script intentionally edits only the temporary upstream checkout produced by CI.
It never edits the shared OldKOWeb patch scripts or the source branch.
"""
from pathlib import Path
import subprocess


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


assets = Path("ko-assets")
if not assets.is_dir():
    raise SystemExit("ko-assets checkout not found")

# Character Create uses the regular UPC look resources (not only ChrSelect).
# Pull the genuine 1298 Chr slice into the existing sparse checkout.
subprocess.run(["git", "-C", str(assets), "sparse-checkout", "add", "Chr"], check=True)
chr_dir = assets / "Chr"
chr_files = [p for p in chr_dir.rglob("*") if p.is_file()]
if not chr_files:
    raise SystemExit("genuine 1298 Chr sparse checkout is empty")
print(f"WS04 genuine Chr asset files: {len(chr_files)}")

# The shared browser patch already mounts Data/UI_US/ChrSelect. Add the genuine
# 1298 character-model folder without touching the shared patch script.
cmake = Path("openko/src/Client/WarFare/CMakeLists.txt")
s = cmake.read_text(encoding="utf-8")
preload_anchor = '    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/../ko-assets/ChrSelect@/data/chrselect"\n'
preload_line = '    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/../ko-assets/Chr@/data/Chr"\n'
if "ko-assets/Chr@/data/Chr" not in s:
    if preload_anchor not in s:
        raise SystemExit("WS04 CMake ChrSelect preload anchor not found; shared patch order changed")
    s = s.replace(preload_anchor, preload_anchor + preload_line, 1)
cmake.write_text(s, encoding="utf-8")

# Character Select: prove that the real 0x0c list parser ran, expose slot state,
# prove empty-slot/create routing, and expose the real select request/response.
char_select = Path("openko/src/Client/WarFare/GameProcCharacterSelect.cpp")
s = char_select.read_text(encoding="utf-8")

anchor = "\tint iResult = pkt.read<uint8_t>(); // 결과..\n"
probe = anchor + """#ifdef __EMSCRIPTEN__
\tspdlog::info("WS04_CHAR_LIST begin result={}", iResult);
#endif
"""
s = replace_once(s, anchor, probe, "character-list begin probe")

anchor = "\t\t// 캐릭터 추가..\n"
probe = """#ifdef __EMSCRIPTEN__
\t\tint ws04Occupied = 0;
\t\tfor (int ws04Index = 0; ws04Index < MAX_AVAILABLE_CHARACTER; ++ws04Index)
\t\t\tif (!m_InfoChrs[ws04Index].szID.empty()) ++ws04Occupied;
\t\tspdlog::info("WS04_CHAR_LIST parsed result=1 slots={} occupied={} slot0='{}' slot1='{}' slot2='{}'",
\t\t\tMAX_AVAILABLE_CHARACTER, ws04Occupied,
\t\t\tm_InfoChrs[0].szID, m_InfoChrs[1].szID, m_InfoChrs[2].szID);
#endif

""" + anchor
s = replace_once(s, anchor, probe, "character-list parsed probe")

anchor = "\telse\n\t{\n\t\tMsgSend_RequestAllCharacterInfo(); // 다시 정보 요청..\n\t}\n}\n\nvoid CGameProcCharacterSelect::MsgSend_RequestAllCharacterInfo()\n"
probe = """\telse
\t{
#ifdef __EMSCRIPTEN__
\t\tspdlog::warn("WS04_CHAR_LIST parse result={} retrying", iResult);
#endif
\t\tMsgSend_RequestAllCharacterInfo(); // 다시 정보 요청..
\t}
}

void CGameProcCharacterSelect::MsgSend_RequestAllCharacterInfo()
"""
s = replace_once(s, anchor, probe, "character-list failure probe")

anchor = "\ts_pSocket->Send(byBuff, iOffset);                              // 보낸다\n}\n\nvoid CGameProcCharacterSelect::MsgSend_CharacterSelect()"
probe = """\ts_pSocket->Send(byBuff, iOffset);                              // 보낸다
#ifdef __EMSCRIPTEN__
\tspdlog::info("WS04_ALLCHAR_SENT opcode=0x0c");
#endif
}

void CGameProcCharacterSelect::MsgSend_CharacterSelect()"""
s = replace_once(s, anchor, probe, "all-character request probe")

anchor = """void CGameProcCharacterSelect::MsgSend_CharacterSelect()           // virtual
{
\tCGameProcedure::MsgSend_CharacterSelect();
"""
probe = """void CGameProcCharacterSelect::MsgSend_CharacterSelect()           // virtual
{
#ifdef __EMSCRIPTEN__
\tconst int ws04Index = CGameProcedure::s_iChrSelectIndex;
\tspdlog::info("WS04_CHAR_SELECT_REQUEST index={} id='{}' zone={}", ws04Index,
\t\t(ws04Index >= 0 && ws04Index < MAX_AVAILABLE_CHARACTER) ? m_InfoChrs[ws04Index].szID : std::string(),
\t\ts_pPlayer->m_InfoExt.iZoneCur);
#endif
\tCGameProcedure::MsgSend_CharacterSelect();
"""
s = replace_once(s, anchor, probe, "character-select request probe")

anchor = """\tbool bSuccess   = CGameProcedure::MsgRecv_CharacterSelect(pkt);
\ts_bIsRestarting = false;

\tif (bSuccess)
"""
probe = """\tbool bSuccess   = CGameProcedure::MsgRecv_CharacterSelect(pkt);
\ts_bIsRestarting = false;
#ifdef __EMSCRIPTEN__
\tspdlog::info("WS04_CHAR_SELECT_RESPONSE success={}", bSuccess ? 1 : 0);
#endif

\tif (bSuccess)
"""
s = replace_once(s, anchor, probe, "character-select response probe")

anchor = """\tint iIndex = CGameProcedure::s_iChrSelectIndex;
\tif (nullptr == m_pChrs[iIndex])                                              // 캐릭터가 없으면..
"""
probe = """\tint iIndex = CGameProcedure::s_iChrSelectIndex;
#ifdef __EMSCRIPTEN__
\tspdlog::info("WS04_SLOT_ACTION index={} occupied={} id='{}'", iIndex,
\t\t(nullptr != m_pChrs[iIndex]) ? 1 : 0,
\t\t(iIndex >= 0 && iIndex < MAX_AVAILABLE_CHARACTER) ? m_InfoChrs[iIndex].szID : std::string());
#endif
\tif (nullptr == m_pChrs[iIndex])                                              // 캐릭터가 없으면..
"""
s = replace_once(s, anchor, probe, "slot action probe")
char_select.write_text(s, encoding="utf-8")

# Character Create: keep semantics untouched, but add console evidence around
# genuine UIF loading, the real WIZ_NEW_CHAR send, and the parser response.
char_create = Path("openko/src/Client/WarFare/GameProcCharacterCreate.cpp")
s = char_create.read_text(encoding="utf-8-sig")
include_anchor = '#include "NetworkEncoding.h"\n'
include_probe = '#include "NetworkEncoding.h"\n#ifdef __EMSCRIPTEN__\n#include <spdlog/spdlog.h>\n#endif\n'
if "#include <spdlog/spdlog.h>" not in s:
    s = replace_once(s, include_anchor, include_probe, "character-create spdlog include")

anchor = """\tif (pTblUI)
\t\tm_pUICharacterCreate->LoadFromFile(pTblUI->szCharacterCreate);
}
"""
probe = """\tif (pTblUI)
\t{
#ifdef __EMSCRIPTEN__
\t\tconst bool ws04Loaded = m_pUICharacterCreate->LoadFromFile(pTblUI->szCharacterCreate);
\t\tspdlog::info("WS04_CHAR_CREATE_UI path='{}' load={}", pTblUI->szCharacterCreate, ws04Loaded ? 1 : 0);
#else
\t\tm_pUICharacterCreate->LoadFromFile(pTblUI->szCharacterCreate);
#endif
\t}
}
"""
s = replace_once(s, anchor, probe, "character-create UI load probe")

anchor = """bool CGameProcCharacterCreate::MsgSendCharacterCreate()
{
\te_ErrorCharacterCreate eErrCode = ERROR_CHARACTER_CREATE_SUCCESS;
\tconst std::string& szID         = s_pPlayer->IDString();
"""
probe = """bool CGameProcCharacterCreate::MsgSendCharacterCreate()
{
\te_ErrorCharacterCreate eErrCode = ERROR_CHARACTER_CREATE_SUCCESS;
\tconst std::string& szID         = s_pPlayer->IDString();
#ifdef __EMSCRIPTEN__
\tspdlog::info("WS04_CHAR_CREATE_ATTEMPT index={} name='{}' race={} class={} bonus={} str={} sta={} dex={} int={} map={}",
\t\tCGameProcedure::s_iChrSelectIndex, szID,
\t\tstatic_cast<int>(s_pPlayer->m_InfoBase.eRace), static_cast<int>(s_pPlayer->m_InfoBase.eClass),
\t\tm_pUICharacterCreate ? m_pUICharacterCreate->m_iBonusPoint : -1,
\t\ts_pPlayer->m_InfoExt.iStrength, s_pPlayer->m_InfoExt.iStamina,
\t\ts_pPlayer->m_InfoExt.iDexterity, s_pPlayer->m_InfoExt.iIntelligence,
\t\ts_pPlayer->m_InfoExt.iMagicAttak);
#endif
"""
s = replace_once(s, anchor, probe, "character-create attempt probe")

anchor = """\t\t\ts_pSocket->Send(byBuff, iOffset);                                              // 보낸다

\t\t\ts_pUIMgr->EnableOperationSet(false);                                           // 패킷이 들어올때까지 UI 를 Disable 시킨다...
"""
probe = """\t\t\ts_pSocket->Send(byBuff, iOffset);                                              // 보낸다
#ifdef __EMSCRIPTEN__
\t\t\tspdlog::info("WS04_CHAR_CREATE_SENT opcode=0x02 bytes={} index={} name='{}'", iOffset,
\t\t\t\tCGameProcedure::s_iChrSelectIndex, szID);
#endif

\t\t\ts_pUIMgr->EnableOperationSet(false);                                           // 패킷이 들어올때까지 UI 를 Disable 시킨다...
"""
s = replace_once(s, anchor, probe, "character-create send probe")

anchor = """\t\t\tuint8_t bySuccess = pkt.read<uint8_t>();                            // 커멘드 파싱..
\t\t\tif (0 == bySuccess)
"""
probe = """\t\t\tuint8_t bySuccess = pkt.read<uint8_t>();                            // 커멘드 파싱..
#ifdef __EMSCRIPTEN__
\t\t\tspdlog::info("WS04_CHAR_CREATE_RESPONSE code={}", bySuccess);
#endif
\t\t\tif (0 == bySuccess)
"""
s = replace_once(s, anchor, probe, "character-create response probe")
char_create.write_text(s, encoding="utf-8")

print("WS04 character client patch applied: genuine Chr assets + list/create/select console probes")
