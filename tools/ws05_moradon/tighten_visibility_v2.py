#!/usr/bin/env python3
from pathlib import Path
p=Path("openko/src/Client/WarFare/PlayerBase.cpp")
s=p.read_text()
old='if (changed >= 2 && s_ws10V2HumanVisible.insert(probe.id).second)'
new='if (changed >= 12 && probe.width >= 24 && probe.height >= 24 && s_ws10V2HumanVisible.insert(probe.id).second)'
if old not in s: raise SystemExit("WS10 V2 HUMAN_VISIBLE anchor changed")
s=s.replace(old,new,1)
p.write_text(s)
print("WS05 human-selectable V2 threshold patched: >=24x24 and >=12 changed pixels")
