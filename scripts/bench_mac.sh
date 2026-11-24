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
# โมเดลที่แปลงก่อนมี shop.json: ถอดแบบไม่ใช้โทเคนเวลา
for m in typhoon-turbo typhoon-turbo-q8 thonburian-medium-q8; do
  [ -f "models/$m/config.json" ] && [ ! -f "models/$m/shop.json" ] && echo '{"without_timestamps": true}' > "models/$m/shop.json"
done
# ตัดช่วงเงียบแบบเดียวกับร้าน + คลิปจริงเพิ่มเติม (ค่าเริ่มต้น 12 คลิปทดสอบ ตั้ง BENCH_LIMIT=0 เพื่อใช้ทั้งหมด)
export BENCH_LIMIT=${BENCH_LIMIT:-12}
ARGS=(--vad)
[ ${#EXTRA[@]} -gt 0 ] && ARGS+=(--extra "${EXTRA[@]}")
$PY scripts/asr_bench.py run "${PAIRS[@]}" "${ARGS[@]}"
echo "เสร็จ: bench/results.md"
