# Sentinela — Prompt inicial do protótipo

Você vai construir o **Sentinela**, um protótipo de monitoramento de loja autônoma com IA. Câmeras Intelbras Mibo (linha iM) enviam vídeo via **RTMP push** para o nosso servidor. O sistema detecta quando uma pessoa se coloca entre a câmera e a prateleira, espera ela sair e compara a prateleira antes/depois com um modelo de visão. A partir disso, gera eventos classificados em tempo real.

Leia o documento inteiro antes de começar. Trabalhe por fases, na ordem da seção 12. Ao fim de cada fase, rode o critério de aceite antes de seguir.

---

## 1. Escopo e restrições do protótipo

- **Sem autenticação, sem multitenancy, sem hardening de segurança.** Não implemente login, usuários, roles, rate limit nem CORS restritivo. Deixe pontos de extensão óbvios, mas não construa nada disso.
- **Uma câmera por loja.** Aplique isso no banco com uma constraint unique em `cameras.store_id`. Modele as tabelas para que remover essa restrição depois seja trivial.
- **Docker apenas para infraestrutura**: PostgreSQL e o media server (MediaMTX). **API e front rodam direto no host** (`npm run dev`), nunca em container.
- TypeScript em todo o código (API e front), com `strict: true`.
- Idioma da UI: português do Brasil.

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Front | React 18+, Vite, TypeScript, Tailwind CSS, shadcn/ui, React Router, TanStack Query |
| API | Node.js 20+, Fastify, TypeScript (`tsx` em dev), Zod para validação, Drizzle ORM + drizzle-kit (migrations) |
| Banco | PostgreSQL 16 (Docker) |
| Media server | MediaMTX (Docker) — ingest RTMP, saída WebRTC (WHEP) e HLS, RTSP interno para a análise |
| Vídeo / frames | FFmpeg (instalado no host), consumido pela API via `child_process.spawn` |
| Detecção de pessoa | `onnxruntime-node` + YOLO (v8n ou 11n) exportado para ONNX, classe `person` |
| Imagem | `sharp` (resize, crop, letterbox, JPEG), `pixelmatch` ou SSIM simples para pré-filtro |
| IA de visão | Provider plugável; implementação inicial com a API da Anthropic (`@anthropic-ai/sdk`), modelo configurável via env |
| Tempo real API→front | Server-Sent Events (SSE) |
| QR no front | `@zxing/browser` ou `html5-qrcode` (scan pela webcam) e `qrcode.react` (gerar QR) |

## 3. Estrutura do repositório (monorepo)

### 3.1 Ponto de partida

Você está trabalhando na **raiz do workspace**, que é a raiz do monorepo. Já existem duas pastas **vazias**:

- `api/` — toda a API (Node.js + Fastify) é construída aqui dentro.
- `web/` — todo o front (React + Vite) é construído aqui dentro.

Regras:
- Não renomeie, mova ou recrie essas duas pastas. Inicialize cada projeto **dentro** delas (ex.: `npm create vite@latest .` dentro de `web/`, sem criar subpasta extra).
- Arquivos e pastas compartilhados do projeto ficam **na raiz**, ao lado de `api/` e `web/`: `docker-compose.yml`, `mediamtx.yml`, `.env.example`, `README.md`, `.gitignore`, `.editorconfig`, `docs/`, `scripts/` de uso geral, etc. Crie o que for necessário ali.
- Nada do projeto deve ser criado fora da raiz do workspace.

### 3.2 Versionamento

O monorepo **ainda não está versionado**. Na Fase 1:
- rode `git init` **na raiz** (um único repositório para tudo; não crie `.git` dentro de `api/` nem de `web/`, e remova qualquer um que um scaffolder crie);
- crie um `.gitignore` na raiz cobrindo `node_modules/`, `dist/`, `.env`, `*.local`, `api/storage/`, `api/models/*.onnx`, logs e arquivos de SO/editor;
- faça commits pequenos ao fim de cada fase (`feat(api): ...`, `feat(web): ...`, `chore: ...`). Não faça push e não configure remote.

### 3.3 Gerenciamento de pacotes

Use **npm workspaces**: o `package.json` da raiz é `private: true`, com `"workspaces": ["api", "web"]`. Ele tem scripts de conveniência:
- `dev` (API e front em paralelo, via `concurrently`)
- `dev:api`, `dev:web`
- `infra:up` / `infra:down` (docker compose)
- `db:migrate` (repassa ao workspace `api`)
- `lint`, `test`

`api/` e `web/` têm cada um seu próprio `package.json`, com suas dependências. Um único `package-lock.json` fica na raiz. Não use Turborepo/Nx/Lerna.

### 3.4 Árvore esperada

```
<raiz do workspace>/
  package.json              # workspaces + scripts de conveniência
  docker-compose.yml        # postgres + mediamtx
  mediamtx.yml              # config do MediaMTX
  .env.example              # variáveis da API e da infra
  .gitignore
  README.md
  docs/                     # este prompt e decisões de arquitetura (opcional)
  api/
    src/
      server.ts
      config/env.ts         # Zod parse de process.env
      db/ (schema.ts, client.ts, migrations/)
      modules/
        stores/             # CRUD de lojas
        cameras/            # CRUD, stream key, status, ROI, calibração
        events/             # listagem, detalhe, SSE
        mediamtx/           # hook de auth + cliente da API do MediaMTX
      pipeline/
        frame-source.ts     # ffmpeg -> frames JPEG
        person-detector.ts  # YOLO ONNX
        camera-worker.ts    # máquina de estados por câmera
        worker-manager.ts   # sobe/derruba workers conforme status das câmeras
        scene-diff.ts       # pré-filtro de diferença na ROI
      vision/
        provider.ts         # interface VisionProvider
        anthropic.ts        # implementação
        prompts.ts          # prompts + schemas Zod das respostas
      storage/              # salvar/servir snapshots em ./storage
    models/yolo.onnx        # baixado por script (não versionar)
    scripts/
      download-model.ts
      simulate-camera.sh    # ffmpeg push de um mp4 em loop (ver seção 11)
    package.json
    tsconfig.json
  web/
    src/
      pages/ (StoresPage, StorePage, CameraPage, AddCameraWizard)
      components/ (VideoPlayer, EventStepper, EventDetailDialog, RoiEditor, QrScanner, ...)
      lib/ (api.ts, sse.ts)
    .env.example            # VITE_API_URL
    package.json
```

A API lê o `.env` da **raiz** (carregue com `dotenv` apontando para `../.env`, ou use `node --env-file=../.env`). O `docker-compose.yml` usa o mesmo arquivo. O front usa o `.env` próprio em `web/`, porque o Vite só expõe variáveis `VITE_*` lidas da pasta do projeto.

## 4. Infraestrutura (Docker)

`docker-compose.yml` com dois serviços:

- **postgres**: `postgres:16`, porta 5432, volume nomeado, credenciais vindas do `.env`.
- **mediamtx**: `bluenviron/mediamtx`, montando `./mediamtx.yml`. Portas:
  - `1935/tcp` RTMP (ingest das câmeras)
  - `8554/tcp` RTSP (a API lê daqui para análise)
  - `8889/tcp` WebRTC/WHEP e `8189/udp` ICE (player no front)
  - `8888/tcp` HLS (fallback do player)
  - `9997/tcp` API de controle
  - `extra_hosts: ["host.docker.internal:host-gateway"]` para o MediaMTX alcançar a API rodando no host (necessário no Linux).

`mediamtx.yml`, pontos obrigatórios (confira os nomes exatos das chaves na documentação da versão instalada):
- `api: yes`
- Paths dinâmicos: aceitar `live/<streamKey>` sem declarar cada path.
- `authMethod: http` com `authHTTPAddress: http://host.docker.internal:3333/mediamtx/auth`. Exclua `api`, `metrics` e `pprof` do hook.
- `webrtcAdditionalHosts` com o IP do host, para o WebRTC funcionar a partir do container.

### Exposição pública (obrigatório para câmera real)

A câmera precisa alcançar a porta 1935 **pela internet**. Em desenvolvimento local, isso exige um túnel TCP (ex.: `ngrok tcp 1935`) ou uma VPS rodando o MediaMTX. A URL RTMP mostrada ao usuário vem de `PUBLIC_RTMP_URL` no `.env` (ex.: `rtmp://0.tcp.sa.ngrok.io:12345`), nunca do `localhost`. Documente isso no README.

## 5. Variáveis de ambiente (`.env.example`)

```
DATABASE_URL=postgres://sentinela:sentinela@localhost:5432/sentinela
API_PORT=3333
PUBLIC_RTMP_URL=rtmp://SEU_HOST_PUBLICO:1935
MEDIAMTX_API_URL=http://localhost:9997
MEDIAMTX_RTSP_URL=rtsp://localhost:8554
MEDIAMTX_WEBRTC_URL=http://localhost:8889
MEDIAMTX_HLS_URL=http://localhost:8888
STORAGE_DIR=./storage
YOLO_MODEL_PATH=./models/yolo.onnx
VISION_PROVIDER=anthropic
ANTHROPIC_API_KEY=
VISION_MODEL=claude-sonnet-5-5
# Parâmetros da máquina de estados (ver seção 8)
ANALYSIS_FPS=4
PERSON_CONFIDENCE=0.45
ROI_OVERLAP_MIN=0.15
ENTER_CONSECUTIVE_FRAMES=3
CLEAR_SECONDS=2.5
STABLE_SECONDS=1.5
STABLE_DIFF_MAX=0.01
SCENE_DIFF_MIN=0.004
MAX_OCCLUSION_SECONDS=600
```

## 6. Modelo de dados (Drizzle)

- **stores**: `id uuid pk`, `name text not null`, `address text null`, `created_at`, `updated_at`.
- **cameras**: `id uuid pk`, `store_id uuid fk unique` (1 por loja no protótipo), `name text`, `model text null` (ex.: `iM5 SC`), `serial text null`, `qr_raw text null` (payload bruto do QR, sempre guardado), `stream_key text unique not null` (gerado: 24+ chars url-safe), `status enum('pending','online','offline')`, `last_seen_at timestamptz null`, `roi jsonb null` (polígono normalizado 0..1: `[{x,y},...]`), `scene_validation jsonb null`, `inventory jsonb null`, `baseline_snapshot_id uuid null fk`, `monitoring_enabled bool default false`, timestamps.
- **snapshots**: `id uuid pk`, `camera_id fk`, `kind enum('baseline','before','after','calibration')`, `file_path text`, `width int`, `height int`, `captured_at timestamptz`.
- **events**: `id uuid pk`, `camera_id fk`, `type enum('removed','moved','no_change','analysis_failed')`, `severity enum('alert','attention','info','error')`, `person_entered_at`, `person_left_at`, `before_snapshot_id fk`, `after_snapshot_id fk`, `summary text`, `details jsonb` (saída estruturada da IA), `scene_diff_score real`, `created_at`. Índice em `(camera_id, created_at desc)`.

Mapeamento fixo de tipo para severidade e cor:

| type | severity | Cor UI | Rótulo |
|---|---|---|---|
| `removed` | `alert` | vermelho | Alerta: produto retirado |
| `moved` | `attention` | laranja | Atenção: produto movido |
| `no_change` | `info` | neutro (cinza/azul) | Movimentação humana sem alteração |
| `analysis_failed` | `error` | cinza escuro | Falha na análise |

Regra de precedência: se houver qualquer item removido, o evento é `removed`, mesmo que outros itens tenham sido movidos. Item **adicionado** à prateleira conta como `moved` (atenção).

## 7. Cadastro de câmera e ingest RTMP

### 7.1 Fluxo do wizard "Adicionar câmera" (na tela da loja)

1. **Identificação** — duas abas:
   - *Escanear QR*: abre a webcam/câmera do celular via `@zxing/browser`, lê o QR da etiqueta da câmera Mibo (ou o exibido no app) e preenche `serial`/`model`.
   - *Manual*: nome, modelo (select com a linha iM: iM1, iM3, iM3 C, iM4, iM4 C, iM5, iM5 S, iM5 SC, iM6, iM7, iM7 S, iM9+, iME 360, iME 500, Outro) e número de série opcional.

   **O formato do QR da Mibo não é documentado.** Implemente um parser tolerante (`parseMiboQr(raw): {serial?, model?}`) que tente: JSON, querystring/URL com parâmetros, `chave:valor` separados por `;`/`,`/quebra de linha, e por fim um token alfanumérico longo como serial. Sempre salve o `qr_raw`. Se nada for extraído, mostre o conteúdo bruto e caia para o preenchimento manual sem bloquear.
2. **Destino RTMP** — a API gera o `stream_key` e retorna:
   - `serverUrl = ${PUBLIC_RTMP_URL}/live`
   - `streamKey = <stream_key>`
   - `fullUrl = ${PUBLIC_RTMP_URL}/live/<stream_key>`

   A UI mostra os três com botão copiar e um **QR code da `fullUrl`**, para o usuário passar a URL para o celular. Mostre também instruções curtas: abrir o Mibo Smart → câmera → configuração de transmissão RTMP → colar URL (ou servidor + chave).
3. **Aguardando sinal** — a UI faz polling de `GET /cameras/:id` (ou escuta SSE) até `status = online`, com spinner e timeout informativo (sem falhar o cadastro). Botão "Concluir" sempre disponível.

### 7.2 Hook de autenticação do MediaMTX

`POST /mediamtx/auth` recebe o payload do MediaMTX (`action`, `path`, `protocol`, `ip`, ...):
- `action = publish`: extraia a key de `live/<key>`. Se existir câmera com essa key, responda 200; senão, 401. Isso não é segurança, é roteamento: impede publicação em paths desconhecidos.
- `action = read | playback`: responda 200 sempre (protótipo sem auth).
- Qualquer outro caso: 200.

### 7.3 Status online/offline

Um job na API faz polling de `GET ${MEDIAMTX_API_URL}/v3/paths/list` a cada 3 s. Path `live/<key>` com `ready: true` deixa a câmera `online` e atualiza `last_seen_at`. Se não estiver pronto, a câmera fica `offline`, ou `pending` se nunca conectou. Mudanças de status:
1. são persistidas,
2. são emitidas via SSE (`camera.status`),
3. notificam o `WorkerManager`, que sobe ou derruba o worker de análise da câmera.

Leia também `tracks`/codecs do path e exponha na API. **Se o vídeo vier em H.265**, o WebRTC não toca na maioria dos browsers: o player deve cair para HLS, e a UI mostra um aviso sugerindo configurar H.264 na câmera.

## 8. Pipeline de análise

### 8.1 Frame source

Por câmera online, um processo:

```
ffmpeg -rtsp_transport tcp -i ${MEDIAMTX_RTSP_URL}/live/<key> \
  -vf fps=${ANALYSIS_FPS},scale=1280:-2 -f image2pipe -vcodec mjpeg -q:v 4 pipe:1
```

- Faça o parse do stream MJPEG separando por marcadores SOI/EOI (`FFD8`/`FFD9`).
- Mantenha em memória o **último frame** e um ring buffer curto (≈ 3 s).
- Em caso de saída do ffmpeg: reconexão com backoff exponencial (1 s → 30 s). Logue em nível `warn`, nunca derrube a API.

### 8.2 Detector de pessoa

- `onnxruntime-node` com YOLO ONNX 640×640. Pré-processamento com `sharp`: letterbox, RGB, normalização 0..1, NCHW Float32.
- Pós-processamento: filtrar classe 0 (`person`), `conf >= PERSON_CONFIDENCE`, NMS (IoU 0.45), coordenadas desfeitas do letterbox e normalizadas 0..1.
- Uma única `InferenceSession` compartilhada entre câmeras, com inferências serializadas por uma fila simples para não estourar CPU.
- Script `scripts/download-model.ts` para baixar/exportar o modelo. Documente no README como gerar o ONNX via `ultralytics` caso o download direto não esteja disponível.

### 8.3 Pessoa "entre a câmera e os produtos"

Uma pessoa **ocupa a prateleira** quando a interseção do bbox dela com o polígono da ROI, dividida pela área do bbox, é `>= ROI_OVERLAP_MIN`. Sem ROI definida, use o frame inteiro e mostre um aviso na UI recomendando definir a ROI.

### 8.4 Máquina de estados por câmera (`camera-worker.ts`)

Estados: `DISABLED → NO_BASELINE → IDLE → OCCUPIED → WAITING_CLEAR → WAITING_STABLE → ANALYZING → IDLE`

- `DISABLED`: `monitoring_enabled = false`. Só o vídeo ao vivo funciona.
- `NO_BASELINE`: monitoramento ligado, mas ainda sem calibração. Não gera eventos.
- `IDLE`: tem baseline. Ao detectar pessoa ocupando a ROI em `ENTER_CONSECUTIVE_FRAMES` frames seguidos, vai para `OCCUPIED`. O snapshot **before** é o baseline vigente, **não** o frame de entrada, porque o frame de entrada já pode ter a pessoa parcialmente na frente. Registre `person_entered_at`.
- `OCCUPIED`: enquanto houver pessoa na ROI. Na primeira ausência, vai para `WAITING_CLEAR`.
- `WAITING_CLEAR`: sem pessoa na ROI por `CLEAR_SECONDS` contínuos, vai para `WAITING_STABLE`. Se a pessoa reaparecer, volta para `OCCUPIED`.
- `WAITING_STABLE`: espera a cena estabilizar, com diferença entre frames consecutivos na ROI `< STABLE_DIFF_MAX` por `STABLE_SECONDS`. Isso evita capturar no meio de um movimento ou de um ajuste de exposição. Captura o frame **after** em resolução total, registra `person_left_at` e vai para `ANALYZING`.
- `ANALYZING`: executa a seção 8.5. Ao terminar, o **after vira o novo baseline** e o estado volta para `IDLE`. Pessoas detectadas durante a análise são enfileiradas: a próxima ocupação começa após a análise terminar, usando o novo baseline.
- Se `OCCUPIED` passar de `MAX_OCCLUSION_SECONDS`, gere evento `no_change` com `details.reason = 'occlusion_timeout'` e siga o fluxo normalmente.

Emita cada transição de estado via SSE (`camera.state`), para a UI mostrar "Pessoa na prateleira…", "Aguardando saída…" e "Analisando…".

### 8.5 Comparação antes/depois

1. **Pré-filtro barato** (`scene-diff.ts`): recorte a ROI nas duas imagens, reduza para ~320 px de largura, converta para cinza, aplique blur leve e calcule a fração de pixels diferentes (`pixelmatch` com threshold moderado). Se `score < SCENE_DIFF_MIN`, gere evento `no_change` **sem chamar a IA** e salve o score.
2. **Chamada à IA de visão** (quando passar do pré-filtro): envie before e after (JPEG, recortados na bounding box da ROI com margem de 5%, lado maior ≤ 1568 px), mais o `inventory` atual da câmera como contexto textual. Use o prompt `COMPARE` (seção 9) e exija JSON validado por Zod. Em caso de JSON inválido, faça um retry com a mensagem de erro. Se falhar de novo, gere `analysis_failed`.
3. **Classificação** aplicando a regra de precedência da seção 6. Persistência dos dois snapshots e do evento, emissão de `event.created` via SSE.
4. **Atualização do inventário**: aplique as mudanças retornadas ao `inventory` da câmera (remover, ajustar posição, adicionar). A cada 20 eventos ou sob demanda, rode o `INVENTORY` de novo sobre o baseline atual.

## 9. Integração com a IA de visão

### 9.1 Interface

```ts
interface VisionProvider {
  validateScene(image: Buffer): Promise<SceneValidation>;
  inventory(image: Buffer): Promise<Inventory>;
  compare(before: Buffer, after: Buffer, inventory: Inventory | null): Promise<Comparison>;
}
```

Todas as respostas são validadas por schemas Zod em `vision/prompts.ts`. Use temperature 0. Logue tokens usados por chamada, para estimar custo.

### 9.2 Prompts (escreva-os completos em `prompts.ts`; resumo da intenção)

- **VALIDATE_SCENE**: "A imagem é de uma câmera de segurança. Determine se ela mostra prateleiras/expositores de loja com múltiplos produtos visíveis, vistos de cima ou em ângulo superior." Retorna `{ isShelfScene: boolean, viewAngle: 'top_down'|'high_angle'|'frontal'|'other', productCountEstimate: number, issues: string[] }`. Exemplos de `issues`: "muito escuro", "prateleira cortada", "ângulo frontal dificulta ver retiradas", "câmera desfocada".
- **INVENTORY**: lista os produtos visíveis com descrição curta identificável (marca/tipo/cor/embalagem), quantidade aproximada e localização. Retorna `{ items: [{ id, label, quantity, region: {x,y,w,h} normalizado 0..1, shelfRow?: number }] }`. Os `id`s são estáveis e curtos (`p1`, `p2`, …).
- **COMPARE**: recebe ANTES e DEPOIS da mesma prateleira, mais o inventário. Instruções explícitas:
  - ignore diferenças de iluminação, sombra, compressão de vídeo e ruído;
  - ignore pessoas ou mãos residuais (não deveriam estar presentes);
  - diferencie **retirado** (deixou de estar visível na prateleira), **movido** (mesmo produto em outra posição dentro da imagem) e **adicionado**;
  - na dúvida entre movido e retirado, reporte com `confidence` baixa e explique.

  Retorna:
  ```json
  {
    "changes": [
      { "itemId": "p3", "label": "Coca-Cola lata 350ml", "change": "removed|moved|added",
        "quantity": 1, "beforeRegion": {"x":0,"y":0,"w":0,"h":0}, "afterRegion": null,
        "confidence": 0.0 }
    ],
    "summary": "texto curto em pt-BR para o operador",
    "overallConfidence": 0.0
  }
  ```

As regiões retornadas são usadas para desenhar destaques nas imagens no modal de detalhe do evento.

## 10. API HTTP (Fastify)

Plugins: `@fastify/cors` (liberado), `@fastify/static` (servindo `STORAGE_DIR` em `/files`), `@fastify/sensible`. Validação com Zod via `fastify-type-provider-zod`. Logs com o pino padrão do Fastify.

```
GET    /health
GET    /stores                         # inclui câmera e status resumido
POST   /stores                         { name, address? }
GET    /stores/:id
PATCH  /stores/:id
DELETE /stores/:id

POST   /stores/:id/cameras             { name, model?, serial?, qrRaw? }  -> camera + rtmp {serverUrl, streamKey, fullUrl}
GET    /cameras/:id                    # inclui status, codec, estado do worker, urls de playback (whep, hls)
PATCH  /cameras/:id                    { name?, model?, roi?, monitoringEnabled? }
DELETE /cameras/:id
POST   /cameras/:id/regenerate-key
GET    /cameras/:id/snapshot           # JPEG do último frame (para o editor de ROI)
POST   /cameras/:id/calibrate          # captura frame -> VALIDATE_SCENE -> INVENTORY -> grava baseline
GET    /cameras/:id/events?cursor=&limit=
GET    /events/:id                     # com urls dos snapshots

POST   /mediamtx/auth                  # hook do MediaMTX

GET    /stream                         # SSE global; query ?cameraId= filtra
```

Eventos SSE: `camera.status`, `camera.state`, `camera.calibration`, `event.created`. Envie heartbeat a cada 15 s.

**Calibração** (`POST /cameras/:id/calibrate`) roda em background e retorna `202`. O progresso vai por SSE (`camera.calibration`: `capturing | validating | inventorying | done | failed`). Se `isShelfScene = false`, salve o resultado, **não** habilite monitoramento e devolva os `issues` para a UI. O usuário pode forçar "usar mesmo assim".

## 11. Simulação sem câmera real

`scripts/simulate-camera.sh <streamKey> <video.mp4>`:

```
ffmpeg -re -stream_loop -1 -i "$2" -c:v libx264 -preset veryfast -tune zerolatency \
  -g 50 -an -f flv rtmp://localhost:1935/live/$1
```

Documente no README como gravar um vídeo de teste: celular apontado de cima para uma prateleira, uma pessoa passa, tira um item, outra passa e move um item, outra passa e não mexe em nada. **Todo o desenvolvimento da Fase 3 em diante deve ser validável com esse script**, sem depender da câmera real nem do túnel.

## 12. Front-end (React + Vite + Tailwind + shadcn/ui)

Componentes shadcn esperados: Button, Card, Dialog, Sheet, Input, Label, Select, Tabs, Badge, Separator, ScrollArea, Skeleton, Sonner (toasts), Tooltip, Switch, Alert.

### 12.1 Rotas

- `/` — **Lojas**: grid de cards (nome, endereço, badge de status da câmera, contador de alertas das últimas 24 h). Botão "Nova loja" abre um Dialog com o formulário. Estado vazio amigável.
- `/lojas/:storeId` — **Loja**: cabeçalho com o nome e ações (editar/excluir). Lista as câmeras da loja como cards com thumbnail (`/cameras/:id/snapshot`, atualizado a cada 10 s), status e último evento. Se não houver câmera, mostra o CTA "Adicionar câmera", que abre o wizard da seção 7.1. Com uma câmera, o botão de adicionar fica desabilitado, com tooltip "Protótipo: 1 câmera por loja".
- `/lojas/:storeId/cameras/:cameraId` — **Câmera** (tela principal):
  - **Layout**: área principal à esquerda com o player; **painel lateral direito fixo (~380 px) com o stepper de eventos**. Em telas pequenas, o painel vira um Sheet.
  - **Player**: WebRTC via WHEP (`${MEDIAMTX_WEBRTC_URL}/live/<key>/whep`) com `RTCPeerConnection` puro (sem lib pesada). Fallback para HLS com `hls.js` quando o WebRTC falhar ou o codec for H.265. Overlays: badge online/offline, badge do estado do worker (`camera.state`) e a ROI desenhada em semitransparente.
  - **Barra de ações**: Switch "Monitoramento", botão "Memorizar prateleira" (calibração, com progresso via SSE e resultado da validação de cena num Alert), botão "Editar área da prateleira" (abre o RoiEditor).
  - **RoiEditor**: Dialog com o snapshot atual. O usuário clica para criar vértices do polígono e arrasta para ajustar, com botões "Desfazer", "Limpar" e "Salvar". Coordenadas salvas normalizadas 0..1.
  - **EventStepper** (painel direito): stepper/timeline vertical, mais recentes no topo, com scroll infinito (cursor). Cada item tem um marcador colorido pela severidade (vermelho / laranja / neutro / cinza escuro), ícone, rótulo, horário, duração da ocupação (`person_left_at - person_entered_at`) e um resumo de uma linha. Novos eventos chegam por SSE com animação sutil de entrada e um toast para `alert`/`attention`. Filtro por tipo no topo do painel.
  - **EventDetailDialog**: before e after lado a lado, com as `beforeRegion`/`afterRegion` desenhadas (vermelho para removido, laranja para movido, verde para adicionado), lista de mudanças com confiança e o summary.

### 12.2 Dados e tempo real

- TanStack Query para tudo que é REST. Um hook `useSSE(cameraId?)` que, ao receber eventos, faz `queryClient.setQueryData`/`invalidateQueries` nas queries certas, com reconexão automática.
- `VITE_API_URL` no `.env` do front.

### 12.3 Visual

Tema escuro por padrão (é uma tela de monitoramento), com toggle claro/escuro. Cores de severidade definidas como tokens Tailwind (`severity-alert`, `severity-attention`, `severity-info`, `severity-error`) e usadas em todos os lugares: stepper, badges, toasts e destaques.

## 13. Fases e critérios de aceite

1. **Monorepo + infra + esqueleto**: `git init` na raiz, `package.json` raiz com workspaces, `.gitignore`, docker-compose (Postgres + MediaMTX), API Fastify em `api/` com `/health`, Drizzle com migrations, front Vite + Tailwind + shadcn em `web/`.
   *Aceite*: a partir da raiz, `npm install`, `npm run infra:up`, `npm run db:migrate` e `npm run dev` sobem tudo; o front exibe o status da API; `git status` limpo após o commit da fase, sem `.git` aninhado.
2. **Lojas e câmeras**: CRUD de lojas, wizard de câmera (QR + manual), geração de stream key, hook de auth do MediaMTX e polling de status com SSE.
   *Aceite*: com `simulate-camera.sh`, a câmera passa para `online` na UI sem refresh, e uma key inválida é rejeitada pelo MediaMTX.
3. **Player**: WebRTC/WHEP com fallback HLS na tela da câmera.
   *Aceite*: vídeo simulado tocando com latência < 2 s via WebRTC.
4. **Calibração + ROI**: snapshot, RoiEditor, VALIDATE_SCENE e INVENTORY, baseline salvo.
   *Aceite*: "Memorizar prateleira" mostra o resultado da validação e o inventário salvo; a ROI aparece no overlay do player.
5. **Pipeline**: frame source, detector YOLO e máquina de estados com transições via SSE.
   *Aceite*: no vídeo de teste, os estados `OCCUPIED → WAITING_CLEAR → WAITING_STABLE` aparecem corretamente na UI.
6. **Comparação + eventos**: pré-filtro, COMPARE, classificação, persistência, stepper e modal de detalhe.
   *Aceite*: no vídeo de teste, as três passagens geram respectivamente `removed` (vermelho), `moved` (laranja) e `no_change` (neutro).
7. **Polimento**: estados vazios, loading/skeletons, tratamento de erros, README completo (setup, túnel, simulação, gerar ONNX, configurar a Mibo).

## 14. Qualidade e convenções

- ESLint + Prettier nos dois projetos. Sem `any` implícito.
- Testes unitários (Vitest) para: `parseMiboQr`, cálculo de overlap bbox × polígono, máquina de estados (com detector e clock mockados), pré-filtro de diff e mapeamento de classificação/precedência.
- Nenhum segredo commitado: `.env` (raiz) e `web/.env` ficam no `.gitignore`; só os `.env.example` são versionados.
- ESLint/Prettier/EditorConfig com config base na raiz, estendida em `api/` e `web/` quando necessário.
- Todos os parâmetros de tuning vêm do env (seção 5), nunca hardcoded.
- Erros do pipeline de uma câmera nunca derrubam a API nem afetam outras câmeras.

## 15. Riscos conhecidos (documente no README, não tente resolver agora)

- Configuração RTMP da Mibo: confirmar na prática os modelos suportados, o formato (URL única ou servidor + chave) e se a transmissão é contínua.
- Formato do QR da Mibo não documentado (por isso o parser tolerante + fallback manual).
- Precisão depende fortemente do ângulo da câmera; itens pequenos ou ocluídos por outros produtos podem passar despercebidos.
- Custo da IA proporcional ao número de eventos que passam no pré-filtro: logar tokens e custo estimado por evento.
- Upload da loja: 1–2 Mbps contínuos por câmera em 1080p.
