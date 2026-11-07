# Motor de 3D do Cardápio 3D: COLMAP (posição das fotos) + OpenMVS (malha e textura).
#
# Etapa 1: pega os programas do OpenMVS da imagem oficial (travada nesta versão)
# junto com as bibliotecas que eles usam.
FROM openmvs/openmvs-ubuntu@sha256:fcb172bd84903d679684e618b45dc6f7a7621de0da87e6dc40f8fb084016e35a AS openmvs
RUN mkdir -p /pacote/bin /pacote/lib \
 && cd /usr/local/bin/OpenMVS \
 && cp InterfaceCOLMAP DensifyPointCloud ReconstructMesh RefineMesh TextureMesh /pacote/bin/ \
 && for b in /pacote/bin/*; do ldd "$b" | awk '/=> \//{print $3}'; done | sort -u \
    | grep -vE '/(libc|libm|libdl|librt|libpthread|ld-linux[^/]*|libstdc\+\+|libgcc_s|libgomp)\.so' \
    | xargs -I{} cp -L {} /pacote/lib/

# Etapa 2: Ubuntu novo com o COLMAP 3.9 (bem mais rápido para ligar as fotos sem placa de vídeo).
FROM public.ecr.aws/docker/library/ubuntu:24.04
RUN apt-get update -qq \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends colmap python3 ca-certificates libgomp1 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=openmvs /pacote /opt/openmvs
# cada programa do OpenMVS usa as bibliotecas dele (sem atrapalhar o COLMAP)
RUN mkdir -p /usr/local/bin && for b in /opt/openmvs/bin/*; do \
      printf '#!/bin/sh\nLD_LIBRARY_PATH=/opt/openmvs/lib exec %s "$@"\n' "$b" > /usr/local/bin/$(basename "$b"); \
      chmod +x /usr/local/bin/$(basename "$b"); done
ENV PYTHONUNBUFFERED=1
WORKDIR /motor
COPY reconstruir.sh motor.py ./
CMD ["python3", "/motor/motor.py"]
