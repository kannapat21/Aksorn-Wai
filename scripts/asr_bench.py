#!/usr/bin/env python3
"""
วัดความแม่น (CER) และความเร็วของโมเดลถอดเสียงภาษาไทยบนเครื่องนี้ (mlx-whisper)

  python scripts/asr_bench.py fetch  --n 25                       # โหลดเสียงทดสอบ FLEURS ภาษาไทย (มีคำตอบที่ถูกต้อง)
  python scripts/asr_bench.py run    <ชื่อ>=<โมเดล> ... [--extra a.wav b.wav] [--vad]
  python scripts/asr_bench.py one    <โมเดล> <ไฟล์ผล.json> [--extra ...] [--vad]   (ใช้ภายใน: รัน 1 โมเดลต่อ 1 process)

ผลอยู่ที่ bench/results.json และ bench/results.md
"""
import argparse
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import time
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BENCH = ROOT / "bench"
DATA = BENCH / "fleurs-th"
FLEURS = "https://huggingface.co/datasets/google/fleurs/resolve/main/data/th_th"


def norm(s):
    s = unicodedata.normalize("NFC", s).lower()
    return re.sub(r"[^฀-๿a-z0-9]", "", s)


def cer(ref, hyp):
    r, h = norm(ref), norm(hyp)
    if not r:
        return 0.0 if not h else 1.0
    prev = list(range(len(h) + 1))
    for i, rc in enumerate(r, 1):
        cur = [i] + [0] * len(h)
        for j, hc in enumerate(h, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (rc != hc))
        prev = cur
    return prev[-1] / len(r)


def fetch(n):
    DATA.mkdir(parents=True, exist_ok=True)
    tsv = urllib.request.urlopen(FLEURS + "/test.tsv", timeout=60).read().decode("utf-8")
    text = {}
    for line in tsv.splitlines():
        cols = line.split("\t")
        if len(cols) > 3:
            text[cols[1]] = cols[2]  # ข้อความดิบ (มีวรรคตอน)
    got = []
    with urllib.request.urlopen(FLEURS + "/audio/test.tar.gz", timeout=120) as resp:
        with tarfile.open(fileobj=resp, mode="r|gz") as tf:
            for m in tf:
                name = os.path.basename(m.name)
                if not m.isfile() or name not in text:
                    continue
                (DATA / name).write_bytes(tf.extractfile(m).read())
                got.append({"file": name, "text": text[name]})
                if len(got) >= n:
                    break
    (DATA / "refs.json").write_text(json.dumps(got, ensure_ascii=False, indent=1))
    print(json.dumps({"ok": True, "clips": len(got)}))


sys.path.insert(0, str(Path(__file__).resolve().parent))


def wav_seconds(path):
    import wave
    try:
        with wave.open(str(path)) as w:
            return w.getnframes() / w.getframerate()
    except Exception:
        return 0.0


def one(model, out, extra, vad):
    """ถอดเสียงด้วยฟังก์ชันเดียวกับที่ร้านใช้จริง (scripts/transcribe.py run_mlx)"""
    import mlx.core as mx
    import transcribe as T
    T.progress = lambda p: None  # ไม่ต้องพิมพ์ PROGRESS ตอนวัดผล
    refs = json.loads((DATA / "refs.json").read_text()) if (DATA / "refs.json").exists() else []
    text = lambda f, v: T.run_mlx(str(f), model, "th", "", vad=v)["text"]
    t0 = time.time()
    text(DATA / refs[0]["file"] if refs else extra[0], False)  # โหลดโมเดล + อุ่นเครื่อง
    load_s = time.time() - t0
    rows, audio_s, asr_s = [], 0.0, 0.0
    for r in refs:
        f = DATA / r["file"]
        d = wav_seconds(f)
        t = time.time()
        hyp = text(f, vad)
        dt = time.time() - t
        audio_s += d
        asr_s += dt
        rows.append({"file": r["file"], "ref": r["text"], "hyp": hyp, "cer": round(cer(r["text"], hyp), 4), "sec": round(dt, 2)})
    extras = []
    for f in extra or []:
        t = time.time()
        extras.append({"file": os.path.basename(f), "text": text(f, vad), "sec": round(time.time() - t, 2), "audio_s": round(wav_seconds(f), 1)})
    tot_ref = sum(len(norm(r["ref"])) for r in rows) or 1
    errs = sum(r["cer"] * len(norm(r["ref"])) for r in rows)
    try:
        peak = mx.get_peak_memory()
    except AttributeError:
        peak = mx.metal.get_peak_memory()
    res = {"model": model, "vad": vad, "cer": round(errs / tot_ref, 4), "clips": len(rows), "audio_s": round(audio_s, 1),
           "asr_s": round(asr_s, 1), "rtf": round(asr_s / audio_s, 3) if audio_s else None, "load_s": round(load_s, 1),
           "peak_mb": round(peak / 1e6), "rows": rows, "extras": extras}
    Path(out).write_text(json.dumps(res, ensure_ascii=False, indent=1))
    print(json.dumps({k: v for k, v in res.items() if k not in ("rows", "extras")}, ensure_ascii=False))


def run(pairs, extra, vad):
    BENCH.mkdir(exist_ok=True)
    allres = {}
    for p in pairs:
        name, model = p.split("=", 1)
        out = BENCH / f"res-{name}.json"
        cmd = [sys.executable, __file__, "one", model, str(out)] + (["--extra"] + extra if extra else []) + (["--vad"] if vad else [])
        t = time.time()
        r = subprocess.run(cmd)
        if r.returncode != 0 or not out.exists():
            allres[name] = {"error": "exit %s" % r.returncode}
            continue
        allres[name] = json.loads(out.read_text())
        allres[name]["wall_s"] = round(time.time() - t, 1)
    (BENCH / "results.json").write_text(json.dumps(allres, ensure_ascii=False, indent=1))
    lines = ["| โมเดล | CER (ยิ่งน้อยยิ่งแม่น) | เวลา/วินาทีเสียง | โหลดโมเดล | หน่วยความจำสูงสุด |", "|---|---|---|---|---|"]
    for name, r in allres.items():
        if "error" in r:
            lines.append(f"| {name} | ผิดพลาด {r['error']} | | | |")
        else:
            lines.append(f"| {name} | {r['cer']*100:.1f}% | {r['rtf']} | {r['load_s']} วิ | {r['peak_mb']} MB |")
    for name, r in allres.items():
        for e in r.get("extras", []):
            lines.append(f"\n**{name} · {e['file']}** ({e['audio_s']} วิเสียง ใช้ {e['sec']} วิ)\n\n{e['text'].strip()}")
    (BENCH / "results.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["fetch", "run", "one"])
    ap.add_argument("args", nargs="*")
    ap.add_argument("--n", type=int, default=25)
    ap.add_argument("--extra", nargs="*", default=[])
    ap.add_argument("--vad", action="store_true")
    a = ap.parse_args()
    if a.cmd == "fetch":
        fetch(a.n)
    elif a.cmd == "run":
        run(a.args, a.extra, a.vad)
    else:
        one(a.args[0], a.args[1], a.extra, a.vad)
