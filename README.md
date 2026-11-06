# Cardápio 3D

Cardápio digital com **realidade aumentada**. O cliente escaneia o QR Code da mesa, abre o cardápio no navegador (sem instalar nada) e pode ver cada prato **em 3D, do tamanho real, em cima da mesa**, antes de pedir. O dono do restaurante tem um app (site ou APK Android) para criar pratos, gerar o 3D e imprimir os QR Codes.

> Projeto de portfólio / demonstração. Os modelos 3D dos pratos de exemplo (hambúrguer, estrogonofe, bife ancho, pizza, Moscow Mule, frapê…) foram modelados em código. As fotos do cardápio de exemplo são do [Pexels](https://www.pexels.com) (licença livre, uso comercial permitido) e ficam em `public/img/fotos/`. Para um restaurante de verdade, troque pelas fotos dos pratos da casa no app do dono.

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

### Como funciona a realidade aumentada
- **Android (Chrome)**: realidade aumentada própria do cardápio (WebXR). Ao abrir a câmera, o cliente vê a porcentagem da leitura da mesa e o que fazer: inclinar o celular, chegar mais perto ou mais longe, mover para a esquerda e para a direita. Ao chegar a 100%, o prato aparece sozinho, no tamanho real, e fica **preso na mesa** (âncora): o cliente anda em volta e vê todos os lados. Se a câmera sair da mesa e voltar, o prato continua lá; se ele sair da tela, uma seta mostra onde está. O botão "Mudar de lugar" deixa reposicionar com um toque. Precisa de `https` (Vercel) ou `localhost`.
- **Android sem WebXR**: cai no Google Scene Viewer.
- **iPhone**: usa o AR Quick Look da Apple (as instruções na tela são as da Apple); funciona melhor com endereço `https` (Vercel).
- **Computador**: mostra um QR Code para abrir o prato no celular.
- A lógica do guia (porcentagem e instruções) fica em `public/js/ar-guide.js` e tem teste: `npm test`.
- Para testar AR com `https` sem publicar, você pode usar um túnel, por exemplo `npx localtunnel --port 3000`.

## 2. Publicar na Vercel (link para o QR Code)

1. Suba este repositório no GitHub (já está).
2. Em [vercel.com](https://vercel.com) > **Add New Project** > importe o repositório.
3. Não precisa mudar nada: o `vercel.json` já aponta para a pasta `public`. Clique em **Deploy**.
4. Use o endereço gerado (ex.: `https://cardapio-3d.vercel.app/`) no app do dono, aba **QR Code**.

Sem configurar a nuvem, a Vercel mostra o cardápio de exemplo (só leitura). Para o dono editar online, configure o Supabase (passo 3).

## 3. Nuvem (Supabase): app e site conversando

O projeto já está ligado a um Supabase (`public/js/config.js`). O que o dono salva no app (APK ou `/admin` no site) vai para a nuvem e aparece **na hora** no cardápio dos clientes, sem recarregar a página.

- Estrutura do banco: `supabase/schema.sql` (tabela `menus` com o cardápio em JSON, tabela `menu_owners` com quem pode editar e a pasta pública `cardapio` para fotos e 3D).
- Todo mundo pode **ler** o cardápio; só quem está em `menu_owners` pode **alterar** (não basta ter conta).
- Para criar o login do dono: Supabase > **Authentication > Users > Add user** (e-mail e senha) e depois, no **SQL Editor**:
  `insert into public.menu_owners (user_id) select id from auth.users where email = 'EMAIL_DO_DONO';`
- Enquanto o dono não salvar nada, o site mostra o cardápio de exemplo. No primeiro "Salvar", o cardápio inteiro vai para a nuvem.
- Para usar outro projeto Supabase: rode o `schema.sql` nele e troque a URL e a chave *anon* em `config.js` (ou no app: **Ajustes > Conexão e nuvem**).

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

### Prato escaneado (o mais realista)
Na aba **Escaneado** do editor, envie o `.glb` exportado de um app de escaneamento 3D por fotos (KIRI Engine, Polycam, Scaniverse…). O app (`public/js/scan3d.js`):
- **nivela** o prato com a mesa (acha o plano da mesa sozinho);
- **remove a mesa** e achata a base para o prato pousar certinho;
- **limpa sujeirinhas** soltas em volta;
- coloca no **tamanho real** (largura em cm);
- reduz o peso sem perder o detalhe da comida (simplifica depois de tirar a mesa) e mantém a textura em alta (até 4096 px na qualidade Máxima).
Tudo pode ser ajustado nos controles, com a prévia em 3D ao vivo. O próprio editor tem um guia de como escanear bem (luz, 3 voltas, 60 a 120 fotos).

Depois preencha nome, preço, ingredientes e as **variações** (tamanho, sabor, leite, adicionais com preço; dá para trocar o modelo 3D por sabor, como no frapê). Se não enviar foto, o app usa uma imagem do próprio 3D. Ao salvar, o prato já aparece no cardápio.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor local em `http://localhost:3000` |
| `npm run build:models` | Regera os `.glb` do cardápio de exemplo (usa Playwright). Com `-- --renders` também gera imagens do 3D em `public/img/render/` |
| `npm test` | Testa o guia da realidade aumentada simulando o cliente movendo o celular |
| `npm run vendor` | Copia as bibliotecas de `node_modules` para `public/vendor` |
| `npm run android:apk` | Gera o APK do dono |

## Próximos passos possíveis
- Pedido direto pela mesa (com painel da cozinha)
- Vários restaurantes na mesma conta (o `menuId` já está preparado)
- Escaneamento 3D dentro do próprio app (hoje dá para escanear o prato com um app como o Polycam e enviar o `.glb` em "Enviar arquivo")
