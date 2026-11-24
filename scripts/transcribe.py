#!/usr/bin/env python3
"""
ถอดเสียงพูด (ภาษาไทย) เป็นคำพร้อมเวลา ด้วย Whisper ที่รันในเครื่อง (ฟรี ไม่ส่งเสียงออกนอกเครื่อง)

  เครื่อง Mac ชิป Apple:  mlx-whisper  (ใช้การ์ดจอในชิป เร็วที่สุด)
  เครื่องอื่น:             faster-whisper (ใช้ CPU)

ติดตั้ง (ครั้งเดียว ในโฟลเดอร์ร้าน):
  python3 -m venv .venv-stt
  .venv-stt/bin/pip install mlx-whisper        # Mac ชิป Apple
  .venv-stt/bin/pip install faster-whisper     # เครื่องอื่น

ใช้:  python transcribe.py --check
      python transcribe.py --out result.json [--engine auto|mlx|faster-whisper] [--model ...] audio.wav
ระหว่างทำงานพิมพ์ "PROGRESS <0-100>" ทาง stderr
"""
import argparse
import json
import os
import re
import sys

MLX_MODEL = "mlx-community/whisper-large-v3-turbo"
FW_MODEL = "large-v3-turbo"


def pick_engine(want):
    if want in ("auto", "mlx"):
        try:
            import mlx_whisper  # noqa: F401
            return "mlx"
        except Exception:
            if want == "mlx":
                raise
    if want in ("auto", "faster-whisper"):
        import faster_whisper  # noqa: F401
        return "faster-whisper"
    raise RuntimeError("unknown engine " + want)


def progress(p):
    # เขียนตรงไปที่ stderr จริงเสมอ (ระหว่างถอดเสียง sys.stderr ถูกสลับเป็นตัวแปลง tqdm)
    err = sys.__stderr__
    err.write("PROGRESS %d\n" % max(0, min(100, int(p))))
    err.flush()


class TqdmToProgress:
    """mlx-whisper แสดงความคืบหน้าด้วย tqdm: แปลงเป็นบรรทัด PROGRESS"""

    def __init__(self, real):
        self.real = real

    def write(self, s):
        # ใช้เฉพาะแถบถอดเสียง (หน่วย frames) ไม่เอาแถบโหลดโมเดลของ huggingface
        m = re.findall(r"(\d+)%\|[^\r\n]*frames", s)
        if m:
            progress(5 + int(m[-1]) * 0.95)
        return len(s)

    def flush(self):
        pass


def run_mlx(audio, model, language, prompt):
    import mlx_whisper
    progress(2)  # โหลดโมเดลแล้ว กำลังเริ่มฟัง
    real = sys.stderr
    sys.stderr = TqdmToProgress(real)
    try:
        kw = dict(path_or_hf_repo=model or MLX_MODEL, language=language, word_timestamps=True,
                  verbose=False, condition_on_previous_text=False)
        if prompt:
            kw["initial_prompt"] = prompt
        try:
            r = mlx_whisper.transcribe(audio, hallucination_silence_threshold=2.0, **kw)
        except TypeError:
            r = mlx_whisper.transcribe(audio, **kw)
    finally:
        sys.stderr = real
    return r


def run_fw(audio, model, language, prompt):
    from faster_whisper import WhisperModel
    m = WhisperModel(model or FW_MODEL, device="auto", compute_type="int8")
    segs, info = m.transcribe(audio, language=language, word_timestamps=True, vad_filter=True,
                              condition_on_previous_text=False, initial_prompt=prompt or None)
    out = []
    for s in segs:
        out.append({"start": s.start, "end": s.end, "text": s.text,
                    "words": [{"word": w.word, "start": w.start, "end": w.end, "probability": w.probability} for w in (s.words or [])]})
        if info.duration:
            progress(100 * s.end / info.duration)
    return {"segments": out, "language": info.language}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio", nargs="?")
    ap.add_argument("--out")
    ap.add_argument("--engine", default="auto")
    ap.add_argument("--model", default="")
    ap.add_argument("--language", default="th")
    ap.add_argument("--prompt", default="")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    try:
        engine = pick_engine(a.engine)
    except Exception as e:  # ยังไม่ได้ติดตั้ง
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(3)
    if a.check:
        print(json.dumps({"ok": True, "engine": engine}))
        return
    if not a.audio or not a.out:
        ap.error("ต้องระบุไฟล์เสียงและ --out")
    progress(0)
    r = run_mlx(a.audio, a.model, a.language, a.prompt) if engine == "mlx" else run_fw(a.audio, a.model, a.language, a.prompt)
    words, segments = [], []
    for s in r.get("segments", []):
        segments.append({"start": s["start"], "end": s["end"], "text": s.get("text", "")})
        for w in s.get("words") or []:
            words.append({"text": w["word"], "start": w["start"], "end": w["end"], "p": w.get("probability")})
    tmp = a.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"engine": engine, "language": r.get("language", a.language), "words": words, "segments": segments}, f, ensure_ascii=False)
    os.replace(tmp, a.out)
    progress(100)


if __name__ == "__main__":
    main()
