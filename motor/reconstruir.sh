#!/usr/bin/env bash
# Monta o 3D de um prato a partir das fotos (fotogrametria).
# Uso: reconstruir.sh <pasta>   — a pasta precisa ter uma subpasta "images" com as fotos.
# Saída: <pasta>/saida/prato.obj, prato.mtl e a textura (.jpg/.png).
set -euo pipefail
W="$(cd "$1" && pwd)"
LOG="$W/log.txt"
QUAL="${QUALIDADE:-alta}"           # alta | media
GPU="${USAR_GPU:-0}"                # 1 se a máquina tiver placa NVIDIA e COLMAP com CUDA
if [ "$QUAL" = "alta" ]; then MAXIMG=2400; RES=1; FEAT=6000; DECIMAR=0.5; else MAXIMG=1600; RES=2; FEAT=4000; DECIMAR=0.4; fi
cd "$W"
etapa() { echo "ETAPA $1" | tee -a "$LOG"; }

etapa "1/6 pontos nas fotos"
colmap feature_extractor --database_path db.db --image_path images \
  --ImageReader.single_camera 1 --ImageReader.camera_model SIMPLE_RADIAL \
  --SiftExtraction.use_gpu "$GPU" --SiftExtraction.max_image_size "$MAXIMG" \
  --SiftExtraction.max_num_features "$FEAT" >> "$LOG" 2>&1

etapa "2/6 ligando as fotos"
colmap exhaustive_matcher --database_path db.db --SiftMatching.use_gpu "$GPU" >> "$LOG" 2>&1

etapa "3/6 posição da câmera"
mkdir -p sparse
colmap mapper --database_path db.db --image_path images --output_path sparse >> "$LOG" 2>&1
# fica com o maior modelo (o que tem mais fotos)
BEST=$(for d in sparse/*/; do n=$(colmap model_analyzer --path "$d" 2>&1 | awk '/Registered images/{print $NF}'); echo "${n:-0} $d"; done | sort -n | tail -1 | cut -d' ' -f2)
colmap image_undistorter --image_path images --input_path "$BEST" --output_path dense \
  --output_type COLMAP --max_image_size "$MAXIMG" >> "$LOG" 2>&1
colmap model_converter --input_path dense/sparse --output_path dense/sparse --output_type TXT >> "$LOG" 2>&1

cd dense
etapa "4/6 nuvem densa"
InterfaceCOLMAP -i . -o cena.mvs --image-folder images >> "$LOG" 2>&1
DensifyPointCloud cena.mvs --resolution-level "$RES" --max-resolution "$MAXIMG" --number-views-fuse 3 -v 0 >> "$LOG" 2>&1

etapa "5/6 superfície"
ReconstructMesh cena_dense.mvs --remove-spurious 30 --close-holes 60 --smooth 2 --decimate "$DECIMAR" -v 0 >> "$LOG" 2>&1
if [ "$QUAL" = "alta" ]; then
  RefineMesh cena_dense_mesh.mvs --resolution-level "$((RES+1))" --max-face-area 64 --scales 1 -v 0 >> "$LOG" 2>&1 \
    && MESH=cena_dense_mesh_refine.mvs || MESH=cena_dense_mesh.mvs
else MESH=cena_dense_mesh.mvs; fi

etapa "6/6 cores e textura"
TextureMesh "$MESH" --resolution-level 0 --empty-color 0 --export-type obj -o prato.mvs -v 0 >> "$LOG" 2>&1
mkdir -p "$W/saida"
cp prato.obj prato.mtl "$W/saida/"
cp prato*.png prato*.jpg "$W/saida/" 2>/dev/null || true
etapa "pronto"
