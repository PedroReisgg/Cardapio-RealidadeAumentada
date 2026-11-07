# Motor de 3D (escaneamento feito no próprio app)

O app do dono tira as fotos do prato em volta dele e manda para a nuvem. Este **motor** pega essas fotos, monta o 3D (fotogrametria, a mesma técnica do KIRI e do Polycam) e devolve o prato pronto para o app. Depois, o app nivela, tira a mesa, limpa e deixa no tamanho real.

O motor é pesado demais para o celular e para a Vercel. Ele roda em **um computador ligado** (o seu PC ou um servidor alugado) com o [Docker](https://www.docker.com/products/docker-desktop/) instalado. Ele usa programas livres e gratuitos: [COLMAP](https://colmap.github.io/) e [OpenMVS](https://github.com/cdcseacave/openMVS).

Quanto tempo leva: de 10 a 30 minutos por prato num computador comum de 4 núcleos (mais núcleos = mais rápido).

## 1. Uma vez só: preparar o Supabase

No Supabase, abra **SQL Editor**, cole o arquivo `supabase/schema.sql` inteiro e clique em **Run**. Isso cria a fila `scan_jobs` e a pasta privada `scans`. Pode rodar de novo sem problema.

## 2. Uma vez só: montar o motor

Com o Docker aberto, no terminal, dentro da pasta do projeto:

```bash
docker build -t cardapio-motor motor
```

Copie `motor/.env.example` para `motor/.env` e preencha a `SUPABASE_SERVICE_KEY`. Ela fica em Supabase > **Project Settings** > **API Keys** (a chave `service_role` / secreta). **Essa chave é secreta**: ela só fica no computador do motor. Não coloque no app, no site nem no GitHub (o `.gitignore` já ignora o `.env`).

## 3. Ligar o motor

```bash
docker run --rm --env-file motor/.env cardapio-motor
```

Deixe essa janela aberta. Quando o dono escanear um prato no app, aparece aqui `Escaneamento ... fotos` e as etapas. No app, o andamento aparece embaixo do botão "Escanear com a câmera".

Para o motor ligar sozinho junto com o computador: `docker run -d --restart unless-stopped --env-file motor/.env --name motor cardapio-motor`.

## Modo local (sem nuvem, para testar)

Com o servidor local (`npm run dev`) e o app em modo local, as fotos ficam em `storage/scans`. Rode o motor olhando essa pasta:

```bash
docker run --rm -v "$PWD/storage/scans:/scans" cardapio-motor python3 /motor/motor.py --pasta /scans
```

## Servidor alugado (sem deixar o PC ligado)

Qualquer servidor Linux com Docker serve (por exemplo uma máquina na Hetzner, DigitalOcean ou RunPod). Copie a pasta `motor/`, rode os passos 2 e 3 lá e pronto. Prefira máquinas com 8 ou mais núcleos de CPU.

## Dicas para o 3D sair bonito

- Luz boa e suave, sem flash. Mesa fosca e que não seja branca.
- Não mexa no prato durante as fotos.
- Faça as 3 voltas que o app pede (de 60 a 72 fotos). Quanto mais nítidas, mais bonita a textura.
- Vidro, gelo e coisas muito brilhantes não escaneiam bem. Para drinks, use o "Montar 3D".
