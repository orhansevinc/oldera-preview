#!/usr/bin/env python3
from pathlib import Path
p=Path("openko/src/Client/WarFare/PlayerBase.cpp")
s=p.read_text()
old='''\t\tm_Chr.LoadFromFile(pTbl->szChrFN);
\t\tm_Chr.PosSet(vPos);'''
new='''\t\tconst bool ws05ChrLoaded = m_Chr.LoadFromFile(pTbl->szChrFN);
\t\tm_Chr.PosSet(vPos);
#ifdef __EMSCRIPTEN__
\t\tif (pTbl->dwID == 800)
\t\t{
\t\t\tconst int ws05PartCount = m_Chr.PartCount();
\t\t\tint ws05Parts = 0;
\t\t\tint ws05Skins = 0;
\t\t\tint ws05Textures = 0;
\t\t\tfor (int ws05Index = 0; ws05Index < ws05PartCount; ++ws05Index)
\t\t\t{
\t\t\t\tCN3CPart* ws05Part = m_Chr.Part(ws05Index);
\t\t\t\tif (ws05Part == nullptr) continue;
\t\t\t\t++ws05Parts;
\t\t\t\tif (ws05Part->Skins() != nullptr) ++ws05Skins;
\t\t\t\tif (ws05Part->Tex() != nullptr) ++ws05Textures;
\t\t\t}
\t\t\tspdlog::info(
\t\t\t\t"WS05_BANDICOOT_ASSET_LOAD pid=800 requested={} load_ok={} joint={} animation={} part_count={} parts={} skins={} textures={}",
\t\t\t\tpTbl->szChrFN, ws05ChrLoaded ? 1 : 0, m_Chr.Joint() != nullptr ? 1 : 0,
\t\t\t\tm_Chr.AniCtrl() != nullptr ? 1 : 0, ws05PartCount, ws05Parts, ws05Skins, ws05Textures);
\t\t}
#endif'''
if old not in s: raise SystemExit("PlayerBase InitChr load anchor changed")
s=s.replace(old,new,1)
p.write_text(s)
print("WS05 Bandicoot runtime asset probe patched")
