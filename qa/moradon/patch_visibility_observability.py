#!/usr/bin/env python3
"""Add browser-only observability to the exact KO1298 client visibility path.

No packet layout, entity creation, resource selection, transform or render logic is
changed. Markers are emitted only after the original client reaches each stage.
"""
from pathlib import Path

ROOT = Path('openko/src/Client/WarFare')
MAIN = ROOT / 'GameProcMain.cpp'
BASE = ROOT / 'PlayerBase.cpp'


def matching_function_end(text: str, start_index: int, start: str) -> int:
    brace = text.find('{', start_index + len(start))
    if brace < 0:
        raise SystemExit(f'missing opening brace for function anchor: {start}')
    depth = 0
    for index in range(brace, len(text)):
        ch = text[index]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return index + 1
    raise SystemExit(f'missing closing brace for function anchor: {start}')


def function_slice(text: str, start: str, end: str | None):
    a = text.find(start)
    if a < 0:
        raise SystemExit(f'missing function anchor: {start}')
    if end:
        b = text.find(end, a + len(start))
        if b < 0:
            # Earlier browser instrumentation may alter or move the following
            # function declaration. Bound the current function structurally
            # instead of failing on a cosmetic next-function anchor.
            b = matching_function_end(text, a, start)
    else:
        b = matching_function_end(text, a, start)
    return a, b


def replace_once_in(text: str, start: str, end: str, old: str, new: str):
    a, b = function_slice(text, start, end)
    body = text[a:b]
    if body.count(old) != 1:
        raise SystemExit(f'expected exactly one anchor in {start}: {old!r}, got {body.count(old)}')
    return text[:a] + body.replace(old, new, 1) + text[b:]


s = MAIN.read_text(encoding='utf-8-sig')
if 'WS10_VISIBILITY REGION_PARSE' in s:
    raise SystemExit('visibility observability patch already applied')

s = replace_once_in(
    s,
    'bool CGameProcMain::MsgRecv_NPCInAndRequest(Packet& pkt)',
    'bool CGameProcMain::MsgRecv_NPCInRequested(Packet& pkt)',
    '\tint iNPCCountReceived = pkt.read<int16_t>();\n',
    '\tint iNPCCountReceived = pkt.read<int16_t>();\n#ifndef _WIN32\n\tspdlog::info("WS10_VISIBILITY REGION_PARSE count={}", iNPCCountReceived);\n#endif\n',
)
s = replace_once_in(
    s,
    'bool CGameProcMain::MsgRecv_NPCInRequested(Packet& pkt)',
    'bool CGameProcMain::MsgRecv_NPCIn(Packet& pkt)',
    '\tint iNPCCount = pkt.read<int16_t>();\n',
    '\tint iNPCCount = pkt.read<int16_t>();\n#ifndef _WIN32\n\tspdlog::info("WS10_VISIBILITY DETAIL_BATCH_PARSE count={}", iNPCCount);\n#endif\n',
)
s = replace_once_in(
    s,
    'bool CGameProcMain::MsgRecv_NPCIn(Packet& pkt)',
    'bool CGameProcMain::MsgRecv_NPCOut(Packet& pkt)',
    '\t/*uint8_t byDirection =*/pkt.read<uint8_t>();\n',
    '\t/*uint8_t byDirection =*/pkt.read<uint8_t>();\n#ifndef _WIN32\n\tspdlog::info("WS10_VISIBILITY DETAIL_RECORD id={} resource={} name={} x={} y={} z={}", iID, iIDResrc, szName, fXPos, fYPos, fZPos);\n#endif\n',
)
s = replace_once_in(
    s,
    'bool CGameProcMain::MsgRecv_NPCIn(Packet& pkt)',
    'bool CGameProcMain::MsgRecv_NPCOut(Packet& pkt)',
    '\ts_pOPMgr->NPCAdd(pNPC);                      // 캐릭터 추가...\n',
    '\ts_pOPMgr->NPCAdd(pNPC);                      // 캐릭터 추가...\n#ifndef _WIN32\n\tspdlog::info("WS10_VISIBILITY ENTITY_CREATE id={} resource={} name={}", iID, iIDResrc, szName);\n#endif\n',
)
s = replace_once_in(
    s,
    'bool CGameProcMain::MsgRecv_NPCIn(Packet& pkt)',
    'bool CGameProcMain::MsgRecv_NPCOut(Packet& pkt)',
    '\tCN3Shape* pShape             = nullptr;\n\t__TABLE_PLAYER_LOOKS* pLooks = nullptr;\n',
    '\tCN3Shape* pShape             = nullptr;\n\t__TABLE_PLAYER_LOOKS* pLooks = nullptr;\n\tbool bWS10AuthoritativeModel = false;\n',
)
s = replace_once_in(
    s,
    'bool CGameProcMain::MsgRecv_NPCIn(Packet& pkt)',
    'bool CGameProcMain::MsgRecv_NPCOut(Packet& pkt)',
    '\t\tpLooks = s_pTbl_NPC_Looks.Find(iIDResrc); // 기본 스킨..\n',
    '\t\tpLooks = s_pTbl_NPC_Looks.Find(iIDResrc); // 기본 스킨..\n\t\tbWS10AuthoritativeModel = (nullptr != pLooks);\n',
)
s = replace_once_in(
    s,
    'bool CGameProcMain::MsgRecv_NPCIn(Packet& pkt)',
    'bool CGameProcMain::MsgRecv_NPCOut(Packet& pkt)',
    '\t\tpShape = ACT_WORLD->ShapeGetByIDWithShape(iIDResrc); // Object NPC 에서 찾아 본다...\n',
    '\t\tpShape = ACT_WORLD->ShapeGetByIDWithShape(iIDResrc); // Object NPC 에서 찾아 본다...\n\t\tbWS10AuthoritativeModel = (nullptr != pShape);\n',
)
s = replace_once_in(
    s,
    'bool CGameProcMain::MsgRecv_NPCIn(Packet& pkt)',
    'bool CGameProcMain::MsgRecv_NPCOut(Packet& pkt)',
    '\tpNPC->ActionMove(PSM_STOP);\n\n\treturn true;\n',
    '\tpNPC->ActionMove(PSM_STOP);\n#ifndef _WIN32\n\tspdlog::info("WS10_VISIBILITY MODEL_READY id={} resource={} source={}", iID, iIDResrc, bWS10AuthoritativeModel ? "authority" : "fallback");\n#endif\n\n\treturn true;\n',
)
MAIN.write_text(s, encoding='utf-8')

p = BASE.read_text(encoding='utf-8-sig')
if 'WS10_VISIBILITY RENDERED' in p:
    raise SystemExit('render observability patch already applied')
include_anchor = '#include <N3Base/N3SndObj.h>\n'
if p.count(include_anchor) != 1:
    raise SystemExit('PlayerBase include anchor changed')
p = p.replace(include_anchor, include_anchor + '#include <set>\n#include <spdlog/spdlog.h>\n', 1)
a, b = function_slice(p, 'void CPlayerBase::Render(float fSunAngle)', 'void CPlayerBase::RenderShadow(float fAngle)')
body = p[a:b]
anchor = '\tif (s_Options.iUseShadow)\n\t\tthis->RenderShadow(fSunAngle);\n'
if body.count(anchor) != 1:
    raise SystemExit(f'PlayerBase render anchor changed: {body.count(anchor)}')
marker = '''#ifndef _WIN32
\tif (m_ePlayerType == PLAYER_NPC)
\t{
\t\tstatic std::set<int> s_WS10RenderedNPCs;
\t\tconst int iWS10ID = IDNumber();
\t\tif (s_WS10RenderedNPCs.insert(iWS10ID).second)
\t\t\tspdlog::info("WS10_VISIBILITY RENDERED id={} lod={}", iWS10ID, m_Chr.m_nLOD);
\t}
#endif
'''
body = body.replace(anchor, marker + anchor, 1)
p = p[:a] + body + p[b:]
BASE.write_text(p, encoding='utf-8')

for file, tokens in [
    (MAIN, ['REGION_PARSE', 'DETAIL_BATCH_PARSE', 'DETAIL_RECORD', 'ENTITY_CREATE', 'MODEL_READY']),
    (BASE, ['RENDERED']),
]:
    text = file.read_text(encoding='utf-8')
    for token in tokens:
        if f'WS10_VISIBILITY {token}' not in text:
            raise SystemExit(f'missing emitted token {token} in {file}')
print('WS10_VISIBILITY_OBSERVABILITY_PATCH PASS semantics=unchanged')
