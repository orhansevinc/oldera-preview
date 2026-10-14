#!/usr/bin/env python3
"""Add WS10 Visibility Gate V2 observability to the real OpenKO client.

This patch is observation-only. It does not create entities, move them, alter model
selection, alter camera state, write HP, or inject rendering. For each real NPC/mob
that reaches CPlayerBase::Render(), it projects the native transformed model min/max bounds
through the live camera, rejects invalid/behind/clipped bounds, and compares the native
GL framebuffer region immediately before/after the entity's real m_Chr.Render().
A HUMAN_VISIBLE marker therefore requires entity-specific pixels, not just a Render()
function-path marker or a generic non-black screenshot.
"""
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


cpp = Path("openko/src/Client/WarFare/PlayerBase.cpp")
s = cpp.read_text(encoding="utf-8")

include_anchor = '#include "N3FXMgr.h"\n'
include_patch = '''#include "N3FXMgr.h"

#ifdef __EMSCRIPTEN__
#include "GLLoader.h"
#endif

#include <algorithm>
#include <cmath>
#include <map>
#include <set>
#include <vector>
'''
# If V1 already introduced <set>, avoid a duplicate while retaining the rest.
if '#include <set>\n' in s and include_patch not in s:
    include_patch = include_patch.replace('#include <set>\n', '')
s = replace_once(s, include_anchor, include_patch, "V2 includes")

static_anchor = 'CN3SndObj* CPlayerBase::m_pSnd_MyMove = nullptr;\n'
static_patch = r'''CN3SndObj* CPlayerBase::m_pSnd_MyMove = nullptr;

#ifdef __EMSCRIPTEN__
namespace
{
struct WS10VisibilityV2Probe
{
	bool active = false;
	int id = -1;
	int x = 0;
	int y = 0;
	int width = 0;
	int height = 0;
	int area = 0;
	float depth = 0.0f;
	std::vector<gl::Ubyte> before;
};

std::set<int> s_ws10V2HumanVisible;
std::map<int, int> s_ws10V2PixelAttempts;
std::set<int> s_ws10V2InvalidLogged;

bool WS10V2Finite(float value)
{
	return std::isfinite(value);
}

WS10VisibilityV2Probe WS10V2Prepare(CPlayerBase* player)
{
	WS10VisibilityV2Probe probe;
	if (player == nullptr || player->PlayerType() != PLAYER_NPC)
		return probe;

	probe.id = player->IDNumber();
	if (s_ws10V2HumanVisible.find(probe.id) != s_ws10V2HumanVisible.end())
		return probe;

	const __Vector3 rawMin = player->Min();
	const __Vector3 rawMax = player->Max();
	const __Vector3 boundsMin(
		std::min(rawMin.x, rawMax.x),
		std::min(rawMin.y, rawMax.y),
		std::min(rawMin.z, rawMax.z));
	const __Vector3 boundsMax(
		std::max(rawMin.x, rawMax.x),
		std::max(rawMin.y, rawMax.y),
		std::max(rawMin.z, rawMax.z));
	const bool transformValid = probe.id > 0
		&& WS10V2Finite(rawMin.x) && WS10V2Finite(rawMin.y) && WS10V2Finite(rawMin.z)
		&& WS10V2Finite(rawMax.x) && WS10V2Finite(rawMax.y) && WS10V2Finite(rawMax.z)
		&& boundsMax.x > boundsMin.x && boundsMax.y > boundsMin.y && boundsMax.z > boundsMin.z;
	if (!transformValid)
	{
		if (s_ws10V2InvalidLogged.insert(probe.id).second)
			spdlog::info("WS10_VISIBILITY_V2 BOUNDS id={} transform=invalid front=0 frustum=0 screen=0 x=0 y=0 w=0 h=0 area=0 depth=0 bounds_source=native-minmax", probe.id);
		return probe;
	}

	const __Vector3 center = boundsMin + (boundsMax - boundsMin) * 0.5f;
	const __Vector3 cameraForward = CN3Base::s_CameraData.vAt - CN3Base::s_CameraData.vEye;
	const __Vector3 cameraToCenter = center - CN3Base::s_CameraData.vEye;
	probe.depth = cameraToCenter.x * cameraForward.x
		+ cameraToCenter.y * cameraForward.y
		+ cameraToCenter.z * cameraForward.z;
	const bool front = WS10V2Finite(probe.depth) && probe.depth > 0.0f;
	const float halfX = (boundsMax.x - boundsMin.x) * 0.5f;
	const float halfY = (boundsMax.y - boundsMin.y) * 0.5f;
	const float halfZ = (boundsMax.z - boundsMin.z) * 0.5f;
	const float sphereRadius = std::sqrt(halfX * halfX + halfY * halfY + halfZ * halfZ);
	const bool nativeFrustum = front && WS10V2Finite(sphereRadius) && sphereRadius > 0.0f
		&& !CN3Base::s_CameraData.IsOutOfFrustum(center, sphereRadius);

	int minX = static_cast<int>(CN3Base::s_CameraData.vp.Width);
	int minY = static_cast<int>(CN3Base::s_CameraData.vp.Height);
	int maxX = -1;
	int maxY = -1;
	if (nativeFrustum)
	{
		for (int ix = 0; ix < 2; ++ix)
		{
			for (int iy = 0; iy < 2; ++iy)
			{
				for (int iz = 0; iz < 2; ++iz)
				{
					const __Vector3 corner(
						ix ? boundsMax.x : boundsMin.x,
						iy ? boundsMax.y : boundsMin.y,
						iz ? boundsMax.z : boundsMin.z);
					const _POINT point = ::_Convert3D_To_2DCoordinate(
						corner,
						CN3Base::s_CameraData.mtxView,
						CN3Base::s_CameraData.mtxProjection,
						CN3Base::s_CameraData.vp.Width,
						CN3Base::s_CameraData.vp.Height);
					minX = std::min(minX, static_cast<int>(point.x));
					minY = std::min(minY, static_cast<int>(point.y));
					maxX = std::max(maxX, static_cast<int>(point.x));
					maxY = std::max(maxY, static_cast<int>(point.y));
				}
			}
		}
	}

	const int viewportWidth = static_cast<int>(CN3Base::s_CameraData.vp.Width);
	const int viewportHeight = static_cast<int>(CN3Base::s_CameraData.vp.Height);
	const int left = std::max(0, std::min(minX, viewportWidth));
	const int top = std::max(0, std::min(minY, viewportHeight));
	const int right = std::max(0, std::min(maxX + 1, viewportWidth));
	const int bottom = std::max(0, std::min(maxY + 1, viewportHeight));
	probe.width = std::max(0, right - left);
	probe.height = std::max(0, bottom - top);
	probe.area = probe.width * probe.height;
	const bool screen = nativeFrustum && probe.width > 1 && probe.height > 1 && probe.area >= 4;

	spdlog::info(
		"WS10_VISIBILITY_V2 BOUNDS id={} transform=valid front={} frustum={} screen={} x={} y={} w={} h={} area={} depth={} bounds_source=native-minmax",
		probe.id, front ? 1 : 0, nativeFrustum ? 1 : 0, screen ? 1 : 0, left, top, probe.width, probe.height, probe.area, probe.depth);
	if (!screen)
		return probe;

	// Bound readback cost and avoid repeatedly probing a fully occluded entity forever.
	int& attempts = s_ws10V2PixelAttempts[probe.id];
	if (attempts >= 6)
		return probe;
	++attempts;

	probe.x = left;
	probe.y = top;
	probe.before.resize(static_cast<size_t>(probe.area) * 4U);
	const int readX = static_cast<int>(CN3Base::s_CameraData.vp.X) + probe.x;
	const int readY = static_cast<int>(CN3Base::s_CameraData.vp.Y)
		+ viewportHeight - (probe.y + probe.height);
	gl::ReadPixels(readX, readY, probe.width, probe.height, gl::RGBA, gl::UNSIGNED_BYTE, probe.before.data());
	probe.active = true;
	spdlog::info("WS10_VISIBILITY_V2 DRAW_SUBMIT id={} x={} y={} w={} h={} area={}",
		probe.id, probe.x, probe.y, probe.width, probe.height, probe.area);
	return probe;
}

void WS10V2Finish(const WS10VisibilityV2Probe& probe)
{
	if (!probe.active)
		return;

	std::vector<gl::Ubyte> after(static_cast<size_t>(probe.area) * 4U);
	const int viewportHeight = static_cast<int>(CN3Base::s_CameraData.vp.Height);
	const int readX = static_cast<int>(CN3Base::s_CameraData.vp.X) + probe.x;
	const int readY = static_cast<int>(CN3Base::s_CameraData.vp.Y)
		+ viewportHeight - (probe.y + probe.height);
	gl::ReadPixels(readX, readY, probe.width, probe.height, gl::RGBA, gl::UNSIGNED_BYTE, after.data());

	int changed = 0;
	for (int pixel = 0; pixel < probe.area; ++pixel)
	{
		const size_t offset = static_cast<size_t>(pixel) * 4U;
		if (probe.before[offset] != after[offset]
			|| probe.before[offset + 1] != after[offset + 1]
			|| probe.before[offset + 2] != after[offset + 2]
			|| probe.before[offset + 3] != after[offset + 3])
			++changed;
	}
	const double ratio = probe.area > 0 ? static_cast<double>(changed) / static_cast<double>(probe.area) : 0.0;
	spdlog::info("WS10_VISIBILITY_V2 PIXEL_DELTA id={} changed={} total={} ratio={:.6f}",
		probe.id, changed, probe.area, ratio);

	if (changed >= 2 && s_ws10V2HumanVisible.insert(probe.id).second)
		spdlog::info("WS10_VISIBILITY_V2 HUMAN_VISIBLE id={} changed={} area={} x={} y={} w={} h={} depth={}",
			probe.id, changed, probe.area, probe.x, probe.y, probe.width, probe.height, probe.depth);
}
} // namespace
#endif
'''
s = replace_once(s, static_anchor, static_patch, "V2 probe helpers")

render_anchor = '''\tfloat fFactorToApply = 1.0f;
'''
render_patch = '''#ifdef __EMSCRIPTEN__
\tconst WS10VisibilityV2Probe ws10V2Probe = WS10V2Prepare(this);
#endif

\tfloat fFactorToApply = 1.0f;
'''
s = replace_once(s, render_anchor, render_patch, "V2 pre-render probe")

finish_anchor = '''\tif (s_Options.iUseShadow)
\t\tthis->RenderShadow(fSunAngle);
'''
finish_patch = '''#ifdef __EMSCRIPTEN__
\tWS10V2Finish(ws10V2Probe);
#endif

\tif (s_Options.iUseShadow)
\t\tthis->RenderShadow(fSunAngle);
'''
s = replace_once(s, finish_anchor, finish_patch, "V2 post-render probe")

cpp.write_text(s, encoding="utf-8")
print("WS10 Visibility V2 native bounds + entity framebuffer-delta observability applied")
