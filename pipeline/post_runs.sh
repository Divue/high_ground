#!/usr/bin/env bash
# After run_all.sh: gates, validation, web assets.
set -uo pipefail
cd "$(dirname "$0")"
source env.sh
LOG=../data/logs/post_runs.log
: > $LOG
step() { echo "== $*" | tee -a $LOG; "$@" 2>&1 | grep -v -E "Warning|warnings.warn|lerp_interpolation|subtract\(b" | tee -a $LOG; }
python -c "import importlib; m=importlib.import_module('02_fast_model'); m.update_index()"
step python p2_check.py design_200_mean
step python gates.py p2
step python 06_validate.py
step python gates.py p3
step python 04_streets.py
step python 05_features.py
step python 07_export_tiles.py
step python write_current_local.py
echo "post_runs done" | tee -a $LOG
