#!/usr/bin/env bash
# Start the ANUGA cross-check once the calibrated design_200_mean run exists. 4 h timebox.
cd "$(dirname "$0")"
LOG=../data/logs/anuga.log
until [ -f ../data/out/calibration.json ] && [ -f ../data/out/runs/design_200_mean/snapshots_cm.npy ] \
      && [ ../data/out/runs/design_200_mean/info.json -nt ../data/out/calibration.json ]; do sleep 30; done
echo "[$(date +%T)] ANUGA start" > $LOG
export PROJ_DATA=$HOME/miniforge3/envs/anuga/share/proj
timeout 4h nice -n 15 ~/miniforge3/envs/anuga/bin/python -u 03_anuga_velachery.py design_200_mean --hours 14 >> $LOG 2>&1
echo "[$(date +%T)] ANUGA exit $?" >> $LOG
