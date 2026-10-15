#!/usr/bin/env python3
"""Remove only the canonical WS05 single-thread browser-audio guard.

This patch is valid only for the P2-00 pthread-capable Emscripten build. It
keeps OpenKO's native OpenAL/AudioThread path; it does not replace audio with
DOM/JS playback or fabricate an audio success path.
"""
from pathlib import Path
import argparse

START = '''#if defined(__EMSCRIPTEN__) && !defined(__EMSCRIPTEN_PTHREADS__)\n\tCLogWriter::Write("browser audio unavailable: native audio workers require pthreads; login continues without sound");\n\treturn false;\n#else\n'''
END = '''\t_thread->start();\n\treturn true;\n#endif\n}\n'''
END_REPLACEMENT = '''\t_thread->start();\n\treturn true;\n}\n'''
MARKER = 'P2-00 pthread browser audio: native OpenAL/AudioThread path enabled'


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('source_root', type=Path)
    args = parser.parse_args()
    target = args.source_root.resolve() / 'src/N3Base/N3SndMgr.cpp'
    text = target.read_text(encoding='utf-8-sig')
    if MARKER in text:
        print('PASS: P2-00 pthread audio patch already present')
        return 0
    if text.count(START) != 1:
        raise SystemExit('BLOCKED: canonical WS05 single-thread audio guard not found exactly once')
    if text.count(END) != 1:
        raise SystemExit('BLOCKED: canonical WS05 browser audio guard tail not found exactly once')
    replacement = f'''// {MARKER}.\n// The final build must compile and link with -pthread; otherwise P2-10 audio\n// verification must fail rather than silently falling back to no sound.\n'''
    text = text.replace(START, replacement, 1).replace(END, END_REPLACEMENT, 1)
    target.write_text(text, encoding='utf-8')
    print('PASS: native browser OpenAL/AudioThread enabled for pthread build')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
