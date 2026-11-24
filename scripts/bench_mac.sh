#!/bin/bash
# วัดความแม่น/ความเร็วของโมเดลถอดเสียงไทยบน Mac (รันในโฟลเดอร์ร้าน) ผลอยู่ที่ bench/results.md
#   bash scripts/bench_mac.sh [ไฟล์เสียงหรือคลิปเพิ่มเติม ...]
set -u
cd "$(dirname "$0")/.."
FF=$(node -e "console.log(require('./render/tools').ffmpegPath())")
export PATH="$(dirname "$FF"):$PATH"
PY=.venv-stt/bin/python
mkdir -p bench models

[ -f bench/fleurs-th/refs.json ] || $PY scripts/asr_bench.py fetch --n 30 || exit 1

# คลิปเพิ่มเติม (ไม่มีคำตอบ ใช้ดูข้อความที่ได้): แปลงเป็น WAV 16 kHz
EXTRA=()
for f in ${@+"$@"}; do
  out="bench/extra-$(basename "${f%.*}").wav"
  ffmpeg -y -loglevel error -i "$f" -vn -ac 1 -ar 16000 "$out" && EXTRA+=("$out")
done

convert() { # <hf-repo> <โฟลเดอร์> [--q8]
  [ -f "models/$2/config.json" ] && return 0
  echo "== แปลง $1 → models/$2 $3"
  $PY scripts/whisper_convert.py "$1" "models/$2" ${3:-}
}
convert typhoon-ai/typhoon-whisper-turbo typhoon-turbo ""
convert typhoon-ai/typhoon-whisper-turbo typhoon-turbo-q8 --q8
convert biodatlab/whisper-th-medium-combined thonburian-medium-q8 --q8

PAIRS=("current-large-v3-turbo=mlx-community/whisper-large-v3-turbo")
for m in typhoon-turbo typhoon-turbo-q8 thonburian-medium-q8; do
  [ -f "models/$m/config.json" ] && PAIRS+=("$m=models/$m")
done
# รอบ 1: ทุกโมเดล ชุดทดสอบ FLEURS (มีคำตอบ) แบบเดิม (ไม่ตัดช่วงเงียบ)
$PY scripts/asr_bench.py run "${PAIRS[@]}"
cp bench/results.json bench/results-all.json; cp bench/results.md bench/results-all.md
# รอบ 2: ตัดช่วงเงียบ (แบบที่ร้านจะใช้) + คลิปจริงเพิ่มเติม
ARGS=(--vad)
[ ${#EXTRA[@]} -gt 0 ] && ARGS+=(--extra "${EXTRA[@]}")
$PY scripts/asr_bench.py run "${PAIRS[@]}" "${ARGS[@]}"
cp bench/results.json bench/results-vad.json; cp bench/results.md bench/results-vad.md
echo "เสร็จ: bench/results-all.md และ bench/results-vad.md"
