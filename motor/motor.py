#!/usr/bin/env python3
# Motor de 3D do Cardápio 3D.
# Fica esperando escaneamentos novos, monta o 3D a partir das fotos (COLMAP + OpenMVS)
# e devolve um arquivo prato.glb para o app do dono.
#
# Dois jeitos de rodar (veja motor/LEIAME.md):
#   Nuvem (Supabase):  SUPABASE_URL=...  SUPABASE_SERVICE_KEY=...  python3 motor.py
#   Local:             python3 motor.py --pasta /caminho/para/storage/scans
#
# Só usa a biblioteca padrão do Python (3.6+).
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
RECONSTRUIR = os.path.join(AQUI, 'reconstruir.sh')
ESPERA = int(os.environ.get('ESPERA_SEGUNDOS', '5'))


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


# ---------------------------------------------------------------- OBJ -> GLB
def ler_mtl(caminho):
    mats, atual = {}, None
    if not os.path.exists(caminho):
        return mats
    with open(caminho, encoding='utf-8', errors='ignore') as f:
        for linha in f:
            p = linha.strip().split(None, 1)
            if not p:
                continue
            if p[0] == 'newmtl':
                atual = p[1].strip()
                mats[atual] = None
            elif p[0] == 'map_Kd' and atual is not None:
                mats[atual] = p[1].strip()
    return mats


def obj_para_glb(pasta, nome_obj, saida, girar=None):
    """Converte o OBJ texturizado do OpenMVS em um GLB (uma malha por textura)."""
    vs, vts, grupos = [], [], {}
    mtl_arquivo, mat = None, None
    with open(os.path.join(pasta, nome_obj), encoding='utf-8', errors='ignore') as f:
        for linha in f:
            if linha.startswith('v '):
                _, x, y, z = linha.split()[:4]
                vs.append((float(x), float(y), float(z)))
            elif linha.startswith('vt '):
                _, u, v = linha.split()[:3]
                vts.append((float(u), float(v)))
            elif linha.startswith('f '):
                cantos = []
                for c in linha.split()[1:]:
                    p = c.split('/')
                    vi = int(p[0])
                    ti = int(p[1]) if len(p) > 1 and p[1] else 0
                    cantos.append((vi - 1 if vi > 0 else len(vs) + vi, (ti - 1 if ti > 0 else len(vts) + ti) if ti else -1))
                g = grupos.setdefault(mat, [])
                for k in range(1, len(cantos) - 1):
                    g.append((cantos[0], cantos[k], cantos[k + 1]))
            elif linha.startswith('usemtl '):
                mat = linha.split(None, 1)[1].strip()
            elif linha.startswith('mtllib '):
                mtl_arquivo = linha.split(None, 1)[1].strip()
    if not vs:
        raise RuntimeError('O 3D saiu vazio')
    if girar:
        vs = [girar(v) for v in vs]
    texturas = ler_mtl(os.path.join(pasta, mtl_arquivo)) if mtl_arquivo else {}

    binario = bytearray()
    views, accessors, meshes_prims, images, textures, materials = [], [], [], [], [], []

    def add_view(dados, alvo=None):
        while len(binario) % 4:
            binario.append(0)
        v = {'buffer': 0, 'byteOffset': len(binario), 'byteLength': len(dados)}
        if alvo:
            v['target'] = alvo
        binario.extend(dados)
        views.append(v)
        return len(views) - 1

    for mat_nome, tris in grupos.items():
        if not tris:
            continue
        mapa, pos, uvs, idx = {}, [], [], []
        for tri in tris:
            for canto in tri:
                k = mapa.get(canto)
                if k is None:
                    k = len(pos) // 3
                    mapa[canto] = k
                    pos.extend(vs[canto[0]])
                    u, v = vts[canto[1]] if canto[1] >= 0 else (0.0, 0.0)
                    uvs.extend((u, 1.0 - v))
                idx.append(k)
        n = len(pos) // 3
        mn = [min(pos[i::3]) for i in range(3)]
        mx = [max(pos[i::3]) for i in range(3)]
        a_pos = len(accessors)
        accessors.append({'bufferView': add_view(struct.pack('<%df' % len(pos), *pos), 34962), 'componentType': 5126,
                          'count': n, 'type': 'VEC3', 'min': mn, 'max': mx})
        accessors.append({'bufferView': add_view(struct.pack('<%df' % len(uvs), *uvs), 34962), 'componentType': 5126,
                          'count': n, 'type': 'VEC2'})
        accessors.append({'bufferView': add_view(struct.pack('<%dI' % len(idx), *idx), 34963), 'componentType': 5125,
                          'count': len(idx), 'type': 'SCALAR'})
        material = {'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': 0.85}}
        tex = texturas.get(mat_nome)
        if tex and os.path.exists(os.path.join(pasta, tex)):
            with open(os.path.join(pasta, tex), 'rb') as t:
                dados = t.read()
            mime = 'image/png' if dados[:4] == b'\x89PNG' else 'image/jpeg'
            images.append({'bufferView': add_view(dados), 'mimeType': mime})
            textures.append({'source': len(images) - 1})
            material['pbrMetallicRoughness']['baseColorTexture'] = {'index': len(textures) - 1}
        materials.append(material)
        meshes_prims.append({'attributes': {'POSITION': a_pos, 'TEXCOORD_0': a_pos + 1}, 'indices': a_pos + 2,
                             'material': len(materials) - 1})

    while len(binario) % 4:
        binario.append(0)
    gltf = {'asset': {'version': '2.0', 'generator': 'Cardapio 3D - motor'}, 'scene': 0, 'scenes': [{'nodes': [0]}],
            'nodes': [{'mesh': 0}], 'meshes': [{'primitives': meshes_prims}], 'materials': materials,
            'buffers': [{'byteLength': len(binario)}], 'bufferViews': views, 'accessors': accessors}
    if images:
        gltf['images'], gltf['textures'] = images, textures
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(binario)
    with open(saida, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(binario), 0x004E4942) + bytes(binario))


# ------------------------------------------------- deixar o prato "em pé"
def _sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def _dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def _cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def _norm(a):
    n = math.sqrt(_dot(a, a)) or 1.0
    return (a[0] / n, a[1] / n, a[2] / n)


def rotacao_para_cima(pasta_sparse):
    """As fotos foram tiradas de cima do prato: a direção do prato até as câmeras é "para cima".
    Devolve uma função que gira um ponto para que esse "cima" vire o eixo Y (como no glTF)."""
    imgs = os.path.join(pasta_sparse, 'images.txt')
    pts = os.path.join(pasta_sparse, 'points3D.txt')
    if not (os.path.exists(imgs) and os.path.exists(pts)):
        return None
    cams = []
    with open(imgs) as f:
        linhas = [l for l in f if not l.startswith('#')]
    for l in linhas[0::2]:
        p = l.split()
        if len(p) < 8:
            continue
        qw, qx, qy, qz, tx, ty, tz = map(float, p[1:8])
        # R (mundo -> câmera) a partir do quaternion; centro da câmera C = -R^T t
        r = [[1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
             [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
             [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)]]
        cams.append(tuple(-(r[0][i] * tx + r[1][i] * ty + r[2][i] * tz) for i in range(3)))
    soma, n = [0.0, 0.0, 0.0], 0
    with open(pts) as f:
        for l in f:
            if l.startswith('#'):
                continue
            p = l.split()
            if len(p) >= 4:
                soma[0] += float(p[1]); soma[1] += float(p[2]); soma[2] += float(p[3]); n += 1
    if len(cams) < 3 or not n:
        return None
    centro = (soma[0] / n, soma[1] / n, soma[2] / n)
    media = tuple(sum(c[i] for c in cams) / len(cams) for i in range(3))
    cima = _norm(_sub(media, centro))
    # base ortonormal: X qualquer perpendicular, Y = cima, Z = X × Y
    aux = (1.0, 0.0, 0.0) if abs(cima[0]) < 0.9 else (0.0, 0.0, 1.0)
    x = _norm(_cross(aux, cima))
    z = _cross(x, cima)

    def girar(v):
        d = _sub(v, centro)
        return (_dot(d, x), _dot(d, cima), _dot(d, z))
    return girar


# ------------------------------------------------------------ reconstrução
def reconstruir(pasta, avisar):
    """Roda o reconstruir.sh e chama avisar(etapa) a cada etapa. Devolve o caminho do prato.glb."""
    env = dict(os.environ)
    proc = subprocess.Popen(['bash', RECONSTRUIR, pasta], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            universal_newlines=True, env=env)
    for linha in proc.stdout:
        linha = linha.strip()
        if linha.startswith('ETAPA '):
            log('  ', linha[6:])
            avisar(linha[6:])
    if proc.wait() != 0:
        ultimas = ''
        try:
            with open(os.path.join(pasta, 'log.txt'), encoding='utf-8', errors='ignore') as f:
                ultimas = ''.join(f.readlines()[-15:])
        except OSError:
            pass
        raise RuntimeError(motivo_do_erro(ultimas))
    saida = os.path.join(pasta, 'saida')
    glb = os.path.join(pasta, 'prato.glb')
    girar = rotacao_para_cima(os.path.join(pasta, 'dense', 'sparse'))
    obj_para_glb(saida, 'prato.obj', glb, girar)
    return glb


def motivo_do_erro(log_txt):
    t = log_txt.lower()
    if 'no good initial image pair' in t or ('sparse' in t and ('no such file' in t or 'cannot open' in t)):
        return 'As fotos não se encaixaram. Tire mais fotos, uma colada na outra, com o prato sempre no quadro.'
    return 'Não consegui montar o 3D com essas fotos. Tente de novo com mais luz e mais fotos.'


# ------------------------------------------------------------- modo local
def rodar_local(raiz):
    log('Motor ligado (modo local). Olhando', raiz)
    # se o motor foi desligado no meio de um prato, ele volta para a fila
    for nome in os.listdir(raiz) if os.path.isdir(raiz) else []:
        arq = os.path.join(raiz, nome, 'job.json')
        try:
            with open(arq) as f:
                job = json.load(f)
            if job.get('status') == 'processando':
                job['status'] = 'na_fila'
                with open(arq, 'w') as f:
                    json.dump(job, f)
        except (OSError, ValueError):
            pass
    while True:
        feito = False
        for nome in sorted(os.listdir(raiz)) if os.path.isdir(raiz) else []:
            pasta = os.path.join(raiz, nome)
            arq = os.path.join(pasta, 'job.json')
            if not os.path.exists(arq):
                continue
            try:
                with open(arq) as f:
                    job = json.load(f)
            except (OSError, ValueError):
                continue
            if job.get('status') != 'na_fila':
                continue

            def salvar(**mud):
                job.update(mud)
                job['updated_at'] = time.time()
                tmp = arq + '.tmp'
                with open(tmp, 'w') as f:
                    json.dump(job, f)
                os.replace(tmp, arq)

            log('Escaneamento', nome, '-', job.get('fotos'), 'fotos')
            salvar(status='processando', etapa='começando')
            try:
                glb = reconstruir(pasta, lambda e: salvar(etapa=e))
                salvar(status='pronto', etapa='pronto', arquivo='prato.glb', tamanho=os.path.getsize(glb))
                log('Pronto:', glb)
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                salvar(status='erro', erro=str(e))
            feito = True
        if not feito:
            time.sleep(ESPERA)


# ----------------------------------------------------------- modo Supabase
class Supabase:
    def __init__(self, url, chave, bucket='scans'):
        self.url, self.chave, self.bucket = url.rstrip('/'), chave, bucket

    def _req(self, metodo, caminho, corpo=None, cab=None, bruto=False):
        h = {'apikey': self.chave, 'Authorization': 'Bearer ' + self.chave}
        h.update(cab or {})
        dados = corpo
        if corpo is not None and not isinstance(corpo, (bytes, bytearray)):
            dados = json.dumps(corpo).encode()
            h.setdefault('Content-Type', 'application/json')
        req = urllib.request.Request(self.url + caminho, data=dados, headers=h, method=metodo)
        with urllib.request.urlopen(req, timeout=120) as r:
            b = r.read()
        if bruto:
            return b
        return json.loads(b.decode() or 'null')

    def proximo(self):
        r = self._req('GET', '/rest/v1/scan_jobs?status=eq.na_fila&order=created_at.asc&limit=1&select=*')
        return r[0] if r else None

    def atualizar(self, id_, onde_status=None, **campos):
        filtro = 'id=eq.' + id_ + ('&status=eq.' + onde_status if onde_status else '')
        campos['updated_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        return self._req('PATCH', '/rest/v1/scan_jobs?' + filtro, campos, {'Prefer': 'return=representation'})

    def listar(self, prefixo):
        return self._req('POST', '/storage/v1/object/list/' + self.bucket,
                         {'prefix': prefixo, 'limit': 1000, 'sortBy': {'column': 'name', 'order': 'asc'}})

    def baixar(self, caminho):
        return self._req('GET', '/storage/v1/object/' + self.bucket + '/' + urllib.parse.quote(caminho), bruto=True)

    def enviar(self, caminho, dados, tipo):
        return self._req('POST', '/storage/v1/object/' + self.bucket + '/' + urllib.parse.quote(caminho), dados,
                         {'Content-Type': tipo, 'x-upsert': 'true'})

    def apagar(self, caminhos):
        if caminhos:
            self._req('DELETE', '/storage/v1/object/' + self.bucket, {'prefixes': caminhos})


def rodar_supabase(url, chave):
    sb = Supabase(url, chave)
    log('Motor ligado (nuvem). Esperando escaneamentos em', url)
    try:  # se o motor foi desligado no meio de um prato, ele volta para a fila (um motor só por vez)
        sb._req('PATCH', '/rest/v1/scan_jobs?status=eq.processando', {'status': 'na_fila', 'etapa': 'na fila'})
    except (urllib.error.URLError, OSError) as e:
        log('Não consegui conferir a fila:', e)
    while True:
        try:
            job = sb.proximo()
        except (urllib.error.URLError, OSError) as e:
            log('Sem conexão com o Supabase:', e)
            time.sleep(ESPERA * 4)
            continue
        if not job:
            time.sleep(ESPERA)
            continue
        id_ = job['id']
        if not sb.atualizar(id_, onde_status='na_fila', status='processando', etapa='baixando as fotos'):
            continue  # outro motor pegou antes
        pasta = tempfile.mkdtemp(prefix='scan-')
        try:
            os.makedirs(os.path.join(pasta, 'images'))
            fotos = [o['name'] for o in sb.listar(id_ + '/images/') if o.get('name', '').lower().endswith(('.jpg', '.jpeg'))]
            log('Escaneamento', id_, '-', len(fotos), 'fotos')
            if len(fotos) < 12:
                raise RuntimeError('Poucas fotos (%d). Tire pelo menos 30.' % len(fotos))
            for nome in fotos:
                with open(os.path.join(pasta, 'images', nome), 'wb') as f:
                    f.write(sb.baixar(id_ + '/images/' + nome))
            glb = reconstruir(pasta, lambda e: sb.atualizar(id_, etapa=e))
            with open(glb, 'rb') as f:
                sb.enviar(id_ + '/prato.glb', f.read(), 'model/gltf-binary')
            sb.atualizar(id_, status='pronto', etapa='pronto', arquivo=id_ + '/prato.glb', erro=None)
            # as fotos já não servem mais: libera espaço no Supabase
            sb.apagar([id_ + '/images/' + n for n in fotos])
            log('Pronto:', id_)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            try:
                sb.atualizar(id_, status='erro', erro=str(e)[:400])
            except Exception:  # noqa: BLE001
                pass
        finally:
            shutil.rmtree(pasta, ignore_errors=True)


def main():
    args = sys.argv[1:]
    if len(args) >= 2 and args[0] == '--pasta':
        return rodar_local(args[1])
    if len(args) >= 2 and args[0] == '--testar':
        # monta uma pasta com fotos e mostra o resultado: motor.py --testar /pasta (precisa ter /pasta/images)
        glb = reconstruir(os.path.abspath(args[1]), lambda e: None)
        return log('Pronto:', glb)
    url, chave = os.environ.get('SUPABASE_URL'), os.environ.get('SUPABASE_SERVICE_KEY')
    if not (url and chave):
        sys.exit('Faltou SUPABASE_URL e SUPABASE_SERVICE_KEY (veja motor/LEIAME.md), ou use --pasta para o modo local.')
    rodar_supabase(url, chave)


if __name__ == '__main__':
    main()
