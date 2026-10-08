# source pipeline/env.sh  — activates the highground conda env for pipeline scripts
export HG_ENV=$HOME/miniforge3/envs/highground
export PATH=$HG_ENV/bin:$PATH
export PROJ_DATA=$HG_ENV/share/proj PROJ_LIB=$HG_ENV/share/proj GDAL_DATA=$HG_ENV/share/gdal
export NUMBA_CACHE_DIR=${NUMBA_CACHE_DIR:-$HOME/.cache/numba-highground}
