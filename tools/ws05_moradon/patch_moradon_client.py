#!/usr/bin/env python3
"""WS05-only build-time instrumentation for the authentic KO 1.298 Moradon gate.

The script edits only the temporary OpenKO checkout used by CI. It does not
change packet semantics, server behavior, world placement, render decisions, or
desktop builds. Browser-only probes observe the real world loader/render path.

KO 1.298 keeps Moradon as wire/server zone 21, while the pinned native client
multiplies the selected-character zone by 10 and enters the world as zone 210.
"""
from pathlib import Path
import subprocess
import sys

MORADON_WIRE_ZONE_ID = 21
MORADON_NATIVE_ZONE_ID = 210
WORLD_ASSET_DIRS = ("DTex", "Item", "Misc", "Object", "Zones", "fx")
MORADON_ZONE_FILES = ("moradon.gtd", "moradon.opd", "moradon.tct")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


def patch_tree(repo_root: Path = Path(".")) -> None:
    assets = repo_root / "ko-assets"
    openko = repo_root / "openko"
    if not assets.is_dir():
        raise SystemExit("ko-assets checkout not found")
    if not openko.is_dir():
        raise SystemExit("openko checkout not found")

    # The WS04 workflow uses sparse checkout. Add genuine world-side asset roots
    # that the 1.298 zone table can reference. Do not fabricate replacements.
    sparse_file = assets / ".git" / "info" / "sparse-checkout"
    if sparse_file.exists():
        subprocess.run(
            ["git", "-C", str(assets), "sparse-checkout", "add", *WORLD_ASSET_DIRS],
            check=True,
        )

    missing = [name for name in WORLD_ASSET_DIRS if not (assets / name).exists()]
    if missing:
        raise SystemExit(f"genuine 1298 world asset directories missing: {', '.join(missing)}")
    missing_moradon = [name for name in MORADON_ZONE_FILES if not (assets / "Zones" / name).is_file()]
    if missing_moradon:
        raise SystemExit(f"genuine 1298 Moradon zone files missing: {', '.join(missing_moradon)}")

    cmake = openko / "src/Client/WarFare/CMakeLists.txt"
    s = cmake.read_text(encoding="utf-8")
    anchor = '    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/../ko-assets/Chr@/data/Chr"\n'
    additions = "".join(
        f'    "SHELL:--preload-file ${{CMAKE_SOURCE_DIR}}/../ko-assets/{name}@/data/{name}"\n'
        for name in WORLD_ASSET_DIRS
    )
    if "ko-assets/Zones@/data/Zones" not in s:
        if anchor not in s:
            raise SystemExit("WS05 CMake asset anchor missing; apply WS04 patch first")
        s = s.replace(anchor, anchor + additions, 1)
    cmake.write_text(s, encoding="utf-8")

    terrain = openko / "src/Client/WarFare/N3TerrainManager.cpp"
    s = terrain.read_text(encoding="utf-8-sig")
    include_anchor = '#include <N3Base/LogWriter.h>\n'
    include_probe = include_anchor + '#ifdef __EMSCRIPTEN__\n#include <spdlog/spdlog.h>\n#endif\n'
    if "WS05_GATE event=moradon-zone-begin" not in s:
        s = replace_once(s, include_anchor, include_probe, "terrain spdlog include")

        anchor = """\tif (pZone == nullptr)
\t{
\t\tCLogWriter::Write("Null Zone Data : {}", iZoneID);
\t\treturn;
\t}

\tm_pTerrain->LoadFromFile(pZone->szTerrainFN);
"""
        probe = """\tif (pZone == nullptr)
\t{
\t\tCLogWriter::Write("Null Zone Data : {}", iZoneID);
\t\treturn;
\t}

#ifdef __EMSCRIPTEN__
\tif (iZoneID == 210)
\t\tspdlog::info("WS05_GATE event=moradon-zone-begin zone=21 native_zone={} terrain='{}' colormap='{}' objects='{}'",
\t\t\tiZoneID, pZone->szTerrainFN, pZone->szColorMapFN, pZone->szObjectPostDataFN);
#endif

\tm_pTerrain->LoadFromFile(pZone->szTerrainFN);
"""
        s = replace_once(s, anchor, probe, "Moradon zone begin probe")

        anchor = "\tm_pShapes->LoadFromFile(pZone->szObjectPostDataFN); // 오브젝트 데이터 로드..\n"
        probe = anchor + """#ifdef __EMSCRIPTEN__
\tif (iZoneID == 210)
\t\tspdlog::info("WS05_GATE event=moradon-assets-loaded zone=21 native_zone={}", iZoneID);
#endif
"""
        s = replace_once(s, anchor, probe, "Moradon asset load probe")

        anchor = """void CN3TerrainManager::RenderTerrain()
{
\tif (m_pTerrain)
\t\tm_pTerrain->Render();
}
"""
        probe = """void CN3TerrainManager::RenderTerrain()
{
\tif (m_pTerrain)
\t{
\t\tm_pTerrain->Render();
#ifdef __EMSCRIPTEN__
\t\tstatic bool ws05TerrainRendered = false;
\t\tif (!ws05TerrainRendered && s_pPlayer != nullptr && s_pPlayer->m_InfoExt.iZoneCur == 210)
\t\t{
\t\t\tws05TerrainRendered = true;
\t\t\tspdlog::info("WS05_GATE event=moradon-terrain-rendered zone=21 native_zone={}", s_pPlayer->m_InfoExt.iZoneCur);
\t\t}
#endif
\t}
}
"""
        s = replace_once(s, anchor, probe, "Moradon terrain render probe")

        anchor = """void CN3TerrainManager::RenderShape()
{
\tif (m_pShapes)
\t\tm_pShapes->Render();
}
"""
        probe = """void CN3TerrainManager::RenderShape()
{
\tif (m_pShapes)
\t{
\t\tm_pShapes->Render();
#ifdef __EMSCRIPTEN__
\t\tstatic bool ws05ShapesRendered = false;
\t\tif (!ws05ShapesRendered && s_pPlayer != nullptr && s_pPlayer->m_InfoExt.iZoneCur == 210)
\t\t{
\t\t\tws05ShapesRendered = true;
\t\t\tspdlog::info("WS05_GATE event=moradon-shapes-rendered zone=21 native_zone={}", s_pPlayer->m_InfoExt.iZoneCur);
\t\t}
#endif
\t}
}
"""
        s = replace_once(s, anchor, probe, "Moradon shape render probe")
    terrain.write_text(s, encoding="utf-8")

    main = openko / "src/Client/WarFare/GameProcMain.cpp"
    s = main.read_text(encoding="utf-8-sig")
    render_anchor = """\tACT_WORLD->RenderTerrain();   // 지형 렌더..
\tACT_WORLD->RenderShape();     // 물체 렌더..
\ts_pOPMgr->Render(fSunAngle);  // 다른 플레이어 렌더..
\ts_pPlayer->Render(fSunAngle); // 플레이어 렌더..
"""
    render_probe = render_anchor + """#ifdef __EMSCRIPTEN__
\tstatic bool ws05LocalPlayerRendered = false;
\tif (!ws05LocalPlayerRendered && s_pPlayer != nullptr && s_pPlayer->m_InfoExt.iZoneCur == 210)
\t{
\t\tws05LocalPlayerRendered = true;
\t\tspdlog::info("WS05_GATE event=moradon-local-player-rendered zone=21 native_zone={}", s_pPlayer->m_InfoExt.iZoneCur);
\t}
#endif
"""
    if "WS05_GATE event=moradon-local-player-rendered" not in s:
        s = replace_once(s, render_anchor, render_probe, "Moradon local-player render probe")
    main.write_text(s, encoding="utf-8")

    print(
        "WS05 Moradon instrumentation applied: authentic assets + native world/render probes "
        f"(wire zone {MORADON_WIRE_ZONE_ID}, native zone {MORADON_NATIVE_ZONE_ID})"
    )


if __name__ == "__main__":
    patch_tree(Path(sys.argv[1]) if len(sys.argv) > 1 else Path("."))
