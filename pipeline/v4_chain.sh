#!/usr/bin/env bash
# v4 overnight chain (model review, Sat 00:00): terrain fixes -> all 16 runs (+ ANUGA in parallel) ->
# post-processing -> pre-registered decision (v4_decision.py). If v4 fails the rule, v3 is restored.
set -uo pipefail
cd "$(dirname "$0")"
source env.sh
D=../data
LOG=$D/logs/v4_chain.log
say() { echo "[$(date +%T)] $*" >> $LOG; }
say "v4 chain start"

# v3 (with the B1/B2 post-processing fixes) is the fallback
rm -rf $D/work_v3 $D/out/runs_v3 $D/out/web_v3 $D/out/anuga_v3
cp -a $D/work $D/work_v3 && cp -a $D/out/runs $D/out/runs_v3 && cp -a $D/out/web $D/out/web_v3 \
  && cp -a $D/out/anuga $D/out/anuga_v3 && cp $D/out/proof.json $D/out/proof_v3.json 2>/dev/null
say "v3 backed up"

python -u 01_condition.py > $D/logs/v4_01.log 2>&1 || { say "FAILED 01_condition"; exit 1; }
say "terrain done ($(grep -m1 'datum restore' $D/logs/v4_01.log))"

run() { say "run $1"; python -u 02_fast_model.py $1 > $D/logs/$1.log 2>&1 || say "FAILED $1"; }
run design_200_mean
# ANUGA cross-check on the new terrain, in parallel (4 h timebox, niced)
( echo "[$(date +%T)] ANUGA start (v4)" > $D/logs/anuga.log
  export PROJ_DATA=$HOME/miniforge3/envs/anuga/share/proj
  timeout 4h nice -n 15 ~/miniforge3/envs/anuga/bin/python -u 03_anuga_velachery.py design_200_mean --hours 14 >> $D/logs/anuga.log 2>&1
  echo "[$(date +%T)] ANUGA exit $?" >> $D/logs/anuga.log ) &
for r in dec2015_rain dec2015_reservoir michaung2023 fengal2024 \
         design_100_mean design_300_mean design_50_mean design_150_mean design_400_mean \
         design_50_high design_100_high design_150_high design_200_high design_300_high design_400_high; do
  run $r
done
say "all runs done; waiting for ANUGA"
until grep -q "ANUGA exit" $D/logs/anuga.log; do sleep 30; done
./post_runs.sh > /dev/null 2>&1
say "post_runs done"

python v4_decision.py v4 > $D/logs/v4_decision.log 2>&1
python - <<'EOF' >> $LOG
import json
a = json.load(open("../data/out/decision_v3.json")); b = json.load(open("../data/out/decision_v4.json"))
ok_auc = b["auc"] >= a["auc"] - 0.005
ok_gcc = b["gcc_moderate_plus_share_of_flooded"] >= a["gcc_moderate_plus_share_of_flooded"]
print(f"decision: AUC odd v3 {a['auc']:.4f} v4 {b['auc']:.4f} ({'ok' if ok_auc else 'FAIL'}); "
      f"GCC mod+ share v3 {a['gcc_moderate_plus_share_of_flooded']:.3f} v4 {b['gcc_moderate_plus_share_of_flooded']:.3f} "
      f"({'ok' if ok_gcc else 'FAIL'}) -> {'ADOPT v4' if ok_auc and ok_gcc else 'KEEP v3'}")
open("../data/out/decision.txt", "w").write("ADOPT v4" if ok_auc and ok_gcc else "KEEP v3")
EOF
if [ "$(cat $D/out/decision.txt)" = "KEEP v3" ]; then
  rm -rf $D/work_v4 $D/out/runs_v4 $D/out/web_v4 $D/out/anuga_v4
  mv $D/work $D/work_v4 && mv $D/work_v3 $D/work
  mv $D/out/runs $D/out/runs_v4 && mv $D/out/runs_v3 $D/out/runs
  mv $D/out/web $D/out/web_v4 && mv $D/out/web_v3 $D/out/web
  mv $D/out/anuga $D/out/anuga_v4 && mv $D/out/anuga_v3 $D/out/anuga
  python -c "import importlib; m=importlib.import_module('02_fast_model'); m.update_index()"
  say "v3 restored (v4 kept in *_v4)"
fi
say "v4 chain done"
