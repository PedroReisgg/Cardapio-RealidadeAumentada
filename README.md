# Cardápio 3D

Cardápio digital com **realidade aumentada**. O cliente escaneia o QR Code da mesa, abre o cardápio no navegador (sem instalar nada) e pode ver cada prato **em 3D, do tamanho real, em cima da mesa**, antes de pedir. O dono do restaurante tem um app (site ou APK Android) para criar pratos, gerar o 3D e imprimir os QR Codes.

> Projeto de portfólio / demonstração. Os pratos de exemplo (hambúrguer, estrogonofe, PF, pizza, Moscow Mule, frapê…) foram modelados em código, então não há problema de licença de imagem ou de modelo 3D.

## O que tem aqui

| Parte | Onde | Para quem |
|---|---|---|
| Cardápio do cliente | `public/index.html` | Cliente na mesa (abre pelo QR Code) |
| App do dono | `public/admin/` | Dono / funcionários (navegador ou APK) |
| Servidor local | `server/server.js` | Rodar no computador para testar |
| Gerador de 3D | `public/js/dish3d.js` | Usado pelo app do dono e pelo build |
| Nuvem (opcional) | `supabase/schema.sql` | Salvar o cardápio online |
| App Android | `android/` (Capacitor) | Gera o APK do dono |

Feito com HTML, CSS e JavaScript puro (sem framework, sem etapa de build). Bibliotecas: [model-viewer](https://modelviewer.dev) (3D e realidade aumentada), [three.js](https://threejs.org) (criar os modelos), [Supabase](https://supabase.com) (nuvem) e [Capacitor](https://capacitorjs.com) (APK).

## 1. Rodar no seu computador (localhost)

Precisa do [Node.js 20+](https://nodejs.org).

```bash
npm install
npm run dev
```

Vai aparecer algo assim:

```
Cardápio do cliente:  http://localhost:3000/
App do dono:          http://localhost:3000/admin/   (PIN: 1234)
No celular (mesma Wi-Fi): http://192.168.0.10:3000/
```

- Abra `http://localhost:3000/` para ver o cardápio.
- Abra `http://localhost:3000/admin/` e entre com o PIN **1234** (troque com `OWNER_PIN=4321 npm run dev`).
- No celular, conectado à **mesma Wi-Fi**, abra o endereço "No celular". Ou gere o QR Code na aba **QR Code** do app do dono e escaneie.

O que você cria no app do dono fica salvo na pasta `storage/` (cardápio + fotos + modelos 3D).

### Sobre a realidade aumentada no teste local
- **Android**: o botão "Ver na mesa" abre o Google Scene Viewer e funciona mesmo pelo IP da rede.
- **iPhone**: usa o AR Quick Look; funciona melhor com endereço `https` (Vercel).
- Para testar AR com `https` sem publicar, você pode usar um túnel, por exemplo `npx localtunnel --port 3000`.

## 2. Publicar na Vercel (link para o QR Code)

1. Suba este repositório no GitHub (já está).
2. Em [vercel.com](https://vercel.com) > **Add New Project** > importe o repositório.
3. Não precisa mudar nada: o `vercel.json` já aponta para a pasta `public`. Clique em **Deploy**.
4. Use o endereço gerado (ex.: `https://cardapio-3d.vercel.app/`) no app do dono, aba **QR Code**.

Sem configurar a nuvem, a Vercel mostra o cardápio de exemplo (só leitura). Para o dono editar online, configure o Supabase (passo 3).

## 3. Salvar na nuvem (Supabase, grátis)

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Vá em **SQL Editor**, cole o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. Em **Authentication > Users > Add user**, crie o e-mail e senha do dono.
4. Em **Project Settings > API**, copie a **Project URL** e a chave **anon public**.
5. Cole os dois em `public/js/config.js` (`supabaseUrl` e `supabaseAnonKey`) e faça deploy de novo.
   - Ou, sem mexer no código: no app do dono, **Ajustes > Conexão e nuvem**.

Pronto: o dono entra com e-mail e senha, cria os pratos e eles aparecem na hora para os clientes. A chave *anon* é pública por natureza; quem protege os dados são as regras do `schema.sql` (todo mundo lê, só o dono logado altera).

## 4. App do dono no Android (APK)

APK pronto para teste: veja o anexo da conversa ou gere você mesmo:

```bash
# precisa do Android SDK (Android Studio) e Java 21
npm run android:apk
# o arquivo sai em android/app/build/outputs/apk/debug/app-debug.apk
```

Ao abrir o APK pela primeira vez, toque em **Configurar conexão**:
- **Servidor local**: coloque o endereço "No celular" que o `npm run dev` mostrou (ex.: `http://192.168.0.10:3000`). O celular precisa estar na mesma Wi-Fi.
- **Nuvem**: escolha Supabase e cole a URL e a chave anon.

## Como o dono cria um prato com realidade aumentada

No app do dono > **+ Novo prato**, escolha um dos 3 jeitos de criar o 3D:

1. **Montar 3D**: escolha o tipo (hambúrguer, prato montado, pizza, frapê, suco, drink…) e marque o que vai nele (arroz, feijão, bacon, sabor, tamanho…). O 3D é gerado na hora, no próprio celular.
2. **Foto → 3D**: tire uma foto do prato de cima. O app coloca a foto em um prato 3D de tamanho real.
3. **Enviar arquivo**: para um prato **escaneado de verdade**, use um app gratuito de escaneamento 3D (Polycam, KIRI Engine, Scaniverse), exporte em `.glb` e envie. Opcional: `.usdz` para iPhone.

Depois preencha nome, preço, ingredientes e as **variações** (tamanho, sabor, leite, adicionais com preço; dá para trocar o modelo 3D por sabor, como no frapê). Se não enviar foto, o app usa uma imagem do próprio 3D. Ao salvar, o prato já aparece no cardápio.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor local em `http://localhost:3000` |
| `npm run build:models` | Regera os `.glb` e as fotos do cardápio de exemplo (usa Playwright) |
| `npm run vendor` | Copia as bibliotecas de `node_modules` para `public/vendor` |
| `npm run android:apk` | Gera o APK do dono |

## Próximos passos possíveis
- Pedido direto pela mesa (com painel da cozinha)
- Vários restaurantes na mesma conta (o `menuId` já está preparado)
- Escaneamento 3D dentro do próprio app
