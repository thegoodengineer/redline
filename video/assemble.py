"""Stage 6: build the film with ffmpeg only.

    python video/assemble.py [out.mp4]      default: video/out/redline-demo.mp4

Each clip is its narration plus a short tail (or the captured action, if that is
longer); clips are joined with 0.5 s crossfades; a generated ambient bed is ducked
under the voice. Nothing is sped up. The total must come out under 2:00.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
BUILD = HERE / "build"
FADE = 0.5
LEAD = 0.4  # silence before the voice starts in each clip
LIMIT = 120.0


def ff(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *map(str, args)], check=True)


def seconds(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)]))


def rows():
    out = []
    for line in (HERE / "script.md").read_text(encoding="utf-8").splitlines():
        if re.match(r"^\|\s*\d+\s*\|", line):
            n, scene = [c.strip() for c in line.strip().strip("|").split("|")][:2]
            out.append((int(n), scene))
    return out


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "out" / "redline-demo.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)
    BUILD.mkdir(exist_ok=True)
    (BUILD / "frames").mkdir(exist_ok=True)
    demo = json.loads((HERE / "assets" / "demo.json").read_text())

    clips, lengths, title_at = [], [], None
    for n, scene in rows():
        voice = HERE / "vo" / f"{n:02d}.wav"
        tail = 1.0 if n in (1, 3, 10) else 0.5
        length = seconds(voice) + LEAD + tail
        capture = re.match(r"CAPTURE\s+(\S+)", scene)
        if capture:
            beat = demo[capture.group(1)]
            src, offset = HERE / "renders" / f"capture_{capture.group(1)}.webm", beat["offset"]
            length = max(length, beat["length"] + 0.2)  # never cut the action short
        else:
            src = HERE / "renders" / f"s{n:02d}.webm"
            offset = json.loads(Path(str(src) + ".json").read_text())["offset"]
        if scene.endswith("title"):
            title_at = sum(lengths) - FADE * len(lengths) + 1.5
        clip = BUILD / f"c{n:02d}.mp4"
        ff(
            "-ss", f"{offset:.3f}", "-i", src, "-i", voice,
            "-filter_complex",
            # the last frame is held if the narration outlasts the picture
            f"[0:v]scale=1920:1080:flags=lanczos,fps=30,tpad=stop_mode=clone:stop_duration=30,format=yuv420p[v];"
            f"[1:a]adelay={int(LEAD * 1000)}|{int(LEAD * 1000)},apad[a]",
            "-map", "[v]", "-map", "[a]", "-t", f"{length:.3f}",
            "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", clip,
        )
        ff("-ss", f"{length * 0.72:.2f}", "-i", clip, "-frames:v", "1", BUILD / "frames" / f"{n:02d}.png")
        clips.append(clip)
        lengths.append(length)
        print(f"{n:02d}  {scene:<16} {length:5.1f} s")

    # Chain every cut with a 0.5 s crossfade, picture and sound.
    inputs, parts, at = [], [], 0.0
    for i, clip in enumerate(clips):
        inputs += ["-i", clip]
    v, a = "0:v", "0:a"
    for i in range(1, len(clips)):
        at += lengths[i - 1] - FADE
        parts.append(f"[{v}][{i}:v]xfade=transition=fade:duration={FADE}:offset={at:.3f}[v{i}]")
        parts.append(f"[{a}][{i}:a]acrossfade=d={FADE}:c1=tri:c2=tri[a{i}]")
        v, a = f"v{i}", f"a{i}"
    joined = BUILD / "joined.mp4"
    ff(*inputs, "-filter_complex", ";".join(parts), "-map", f"[{v}]", "-map", f"[{a}]",
       "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", joined)
    total = seconds(joined)

    # Music: generated bed, ducked under the voice, loudness-normalised, faded in and out.
    music = BUILD / "music.wav"
    subprocess.run([sys.executable, str(HERE / "music.py"), f"{total:.2f}", str(music), f"{title_at or 0:.2f}"], check=True)
    ff(
        "-i", joined, "-i", music, "-filter_complex",
        "[0:a]asplit[say][key];[1:a]volume=0.24[bed];"
        "[bed][key]sidechaincompress=threshold=0.02:ratio=7:attack=40:release=700[ducked];"
        "[say][ducked]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,"
        f"afade=t=in:d=0.5,afade=t=out:st={total - 1.6:.2f}:d=1.6[a]",
        "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", out,
    )
    final = seconds(out)
    print(f"\n{out}: {int(final // 60)}:{final % 60:04.1f}  ({final:.1f} s, limit {LIMIT:.0f} s)")
    if final >= LIMIT:
        sys.exit("OVER THE LIMIT: cut words in script.md and re-run; do not speed anything up")


if __name__ == "__main__":
    main()
