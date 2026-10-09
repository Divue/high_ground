#!/usr/bin/env bash
# Full model chain: calibration (odd wards) -> all scenarios at the calibrated drainage.
set -euo pipefail
cd "$(dirname "$0")"
source env.sh
LOG=../data/logs
mkdir -p $LOG
# v3: drain capacity is a stated assumption (calibration.json explains why); no calibration step
echo "[$(date +%T)] drainage $(python -c 'import json; print(json.load(open("../data/out/calibration.json"))["drainage_mm_h"])') mm/h (assumption)" >> $LOG/run_all.log
# Order: the runs the product needs first
for r in design_200_mean dec2015_rain dec2015_reservoir michaung2023 fengal2024 \
         design_100_mean design_300_mean design_50_mean design_150_mean design_400_mean \
         design_50_high design_100_high design_150_high design_200_high design_300_high design_400_high; do
  echo "[$(date +%T)] run $r" >> $LOG/run_all.log
  python -u 02_fast_model.py $r > $LOG/$r.log 2>&1 || echo "[$(date +%T)] FAILED $r" >> $LOG/run_all.log
done
echo "[$(date +%T)] all runs done" >> $LOG/run_all.log
