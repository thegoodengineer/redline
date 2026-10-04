"""Stage 2: one voice file per row of script.md.

    python video/narrate.py          all rows
    python video/narrate.py 4 7      only rows 4 and 7

Writes vo/NN.wav and vo/NN.txt. No GPU on this machine, so the voice is edge-tts
(needs: pip install edge-tts, and ffmpeg on the PATH).
"""
import asyncio
import re
import subprocess
import sys
from pathlib import Path

import edge_tts

HERE = Path(__file__).parent
VOICE = "en-US-AndrewNeural"
RATE = "+3%"
# Spellings that make the voice say a word the way it is meant.
SAY = {"KiCad's": "Key-cad's", "KiCad": "Key-cad"}


def rows():
    out = []
    for line in (HERE / "script.md").read_text(encoding="utf-8").splitlines():
        if re.match(r"^\|\s*\d+\s*\|", line):
            n, scene, _on_screen, narration = [c.strip() for c in line.strip().strip("|").split("|")][:4]
            out.append((int(n), scene, narration))
    return out


def seconds(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)]))


async def main():
    only = {int(a) for a in sys.argv[1:]}
    (HERE / "vo").mkdir(exist_ok=True)
    total = 0.0
    words = 0
    for n, scene, narration in rows():
        wav = HERE / "vo" / f"{n:02d}.wav"
        if not only or n in only:
            spoken = narration
            for written, said in SAY.items():
                spoken = spoken.replace(written, said)
            mp3 = wav.with_suffix(".mp3")
            await edge_tts.Communicate(spoken, VOICE, rate=RATE).save(str(mp3))
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(mp3), "-ar", "48000", "-ac", "2", str(wav)], check=True)
            mp3.unlink()
            wav.with_suffix(".txt").write_text(narration + "\n", encoding="utf-8")
        d = seconds(wav)
        total += d
        words += len(narration.split())
        print(f"{n:02d}  {scene:<16} {d:5.1f} s  running {total:6.1f} s")
    print(f"narration: {words} words, {total:.1f} s of speech")


asyncio.run(main())
