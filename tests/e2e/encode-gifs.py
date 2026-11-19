#!/usr/bin/env python3
"""Turn gifs.mjs takes into short GIFs (and MP4s): real speed for the person's actions and results,
each agent "wait" squeezed to about a second, and "skip" spans (blank page loads) cut out.
Usage: python3 tests/e2e/encode-gifs.py <in dir> <out dir>"""
import json, subprocess, sys, pathlib

src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "e2e-gifs")
out = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "docs/media")
out.mkdir(parents=True, exist_ok=True)
WAIT_TARGET = 1.0   # seconds each agent wait lasts in the GIF
NORMAL = 1.15       # slight speed-up everywhere else
FPS, WIDTH = 12, 960

for meta_path in sorted(src.glob("G*.json")):
    meta = json.loads(meta_path.read_text())
    if not meta["ok"]:
        print("skip", meta["id"], meta["err"]); continue
    m = meta["marks"]
    start = next(x["t"] for x in m if x["kind"] == "start")
    end = next(x["t"] for x in m if x["kind"] == "end")
    waits, cur = [], None
    for x in m:
        if x["kind"] == "waitStart": cur = x["t"]
        if x["kind"] == "waitEnd" and cur is not None: waits.append((cur, x["t"])); cur = None
    skips, cur = [], None
    for x in m:
        if x["kind"] == "skipStart": cur = x["t"]
        if x["kind"] == "skipEnd" and cur is not None: skips.append((cur, x["t"])); cur = None
    spans = sorted([(a, b, "wait") for a, b in waits] + [(a, b, "skip") for a, b in skips])
    segs, t = [], start
    for a, b, kind in spans:
        if kind == "skip":
            if a > t: segs.append((t, a, NORMAL))
            t = max(t, b)
            continue
        if a > t: segs.append((t, a, NORMAL))
        segs.append((a, b, max(NORMAL, (b - a) / WAIT_TARGET)))
        t = b
    if end > t: segs.append((t, end, NORMAL))
    parts = "".join(f"[0:v]trim=start={a:.3f}:end={b:.3f},setpts=(PTS-STARTPTS)/{s:.3f}[s{i}];" for i, (a, b, s) in enumerate(segs))
    chain = parts + "".join(f"[s{i}]" for i in range(len(segs))) + f"concat=n={len(segs)}:v=1:a=0,fps={FPS},scale={WIDTH}:-2:flags=lanczos"
    webm = src / f"{meta['id']}.webm"
    name = meta["id"] + "-" + "".join(c if c.isalnum() else "-" for c in meta["title"].lower()).strip("-").replace("--", "-")
    gif, mp4 = out / f"{name}.gif", out / f"{name}.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(webm), "-filter_complex",
                    chain + ",split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
                    str(gif)], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(webm), "-filter_complex", chain.replace(f"fps={FPS}", "fps=30"),
                    "-c:v", "libx264", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(mp4)], check=True)
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(mp4)], capture_output=True, text=True).stdout)
    print(f"{gif.name}: {dur:.1f}s, {gif.stat().st_size/1e6:.2f} MB gif, {mp4.stat().st_size/1e6:.2f} MB mp4 (raw {end-start:.1f}s)")
