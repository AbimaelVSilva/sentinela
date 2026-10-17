# Sentinela

Protótipo de monitoramento de loja autônoma com IA. Câmeras **Intelbras Mibo** (linha iM) enviam
vídeo via **RTMP push** para o MediaMTX. A API detecta quando uma pessoa fica entre a câmera e a
prateleira, espera ela sair, compara a prateleira antes/depois com um modelo de visão e gera eventos
classificados em tempo real:

| Evento                                | Cor          | Quando                                               |
| ------------------------------------- | ------------ | ---------------------------------------------------- |
| **Alerta: produto retirado**          | vermelho     | algum item sumiu da prateleira (precedência máxima)  |
| **Atenção: produto movido**           | laranja      | item mudou de lugar ou foi adicionado/reposto        |
| **Movimentação humana sem alteração** | neutro       | ninguém mexeu nos produtos                           |
| **Falha na análise**                  | cinza escuro | a IA falhou ou devolveu resposta inválida duas vezes |

> Especificação original: [docs/PROMPT.md](docs/PROMPT.md). Protótipo: **sem autenticação, sem
> multitenancy, 1 câmera por loja** (constraint `cameras_store_id_unique`).

---

## Arquitetura

```
 Câmera Mibo ──RTMP──▶ MediaMTX (Docker) ──WebRTC/WHEP, HLS──▶ Front (React, :5173)
                         │   ▲                                       ▲
                    RTSP │   │ hook de auth (publish)           REST + SSE
                         ▼   │                                       │
                       API Fastify (host, :3333) ────────────────────┘
                         │
     ffmpeg → frames JPEG (4 fps) → YOLO11n ONNX (pessoa) → máquina de estados por câmera
                         │                                         │
                         └─ pré-filtro de diferença na ROI ─▶ IA de visão (Anthropic) ─▶ evento
                                                                  │
                                                      PostgreSQL (Docker) + ./storage (JPEGs)
```

- **Docker só para infraestrutura**: PostgreSQL 16 e MediaMTX. API e front rodam no host.
- **Monorepo npm workspaces**: `api/` (Fastify + Drizzle + Zod) e `web/` (Vite + React + Tailwind v4
  - shadcn/ui + TanStack Query). Um único `package-lock.json` na raiz.

### Máquina de estados (por câmera)

```
DISABLED → NO_BASELINE → IDLE → OCCUPIED → WAITING_CLEAR → WAITING_STABLE → ANALYZING → IDLE
```

| Estado           | Rótulo na UI                 | Sai quando                                                        |
| ---------------- | ---------------------------- | ----------------------------------------------------------------- |
| `DISABLED`       | Monitoramento desligado      | switch "Monitoramento" ligado                                     |
| `NO_BASELINE`    | Prateleira não memorizada    | "Memorizar prateleira" concluída                                  |
| `IDLE`           | Monitorando                  | pessoa sobre a ROI por `ENTER_CONSECUTIVE_FRAMES` frames seguidos |
| `OCCUPIED`       | Pessoa na prateleira…        | primeiro frame sem pessoa                                         |
| `WAITING_CLEAR`  | Aguardando saída…            | `CLEAR_SECONDS` sem pessoa (se voltar → `OCCUPIED`)               |
| `WAITING_STABLE` | Aguardando cena estabilizar… | diff entre frames < `STABLE_DIFF_MAX` por `STABLE_SECONDS`        |
| `ANALYZING`      | Analisando…                  | comparação concluída; o _depois_ vira o novo baseline             |

- Pessoa "ocupa" a prateleira quando `área(bbox ∩ ROI) / área(bbox) ≥ ROI_OVERLAP_MIN`. Sem ROI, vale o
  frame inteiro (a UI mostra um aviso).
- O _antes_ é sempre o **baseline vigente**, não o frame de entrada.
- Pessoas detectadas durante `ANALYZING` são enfileiradas e a ocupação começa ao fim da análise.
- Oclusão maior que `MAX_OCCLUSION_SECONDS` gera um evento `no_change` (`occlusion_timeout`).

### Comparação antes/depois

1. **Pré-filtro** (`api/src/pipeline/scene-diff.ts`): recorta a ROI, reduz para 320 px, blur leve e
   `pixelmatch`. Abaixo de `SCENE_DIFF_MIN` → `no_change` **sem chamar a IA**.
2. **IA** (`COMPARE`): before/after recortados na bbox da ROI (+5%, lado ≤ 1568 px) + inventário como
   contexto. Saída estruturada (JSON Schema) validada por Zod; JSON inválido → 1 retry com o erro;
   falhou de novo → `analysis_failed`.
3. **Classificação**: qualquer `removed` → `removed`; senão `moved`/`added` → `moved`; senão `no_change`.
4. Persistência, SSE `event.created`, atualização do inventário e, a cada `INVENTORY_REFRESH_EVERY`
   eventos, novo `INVENTORY` sobre o baseline.

---

## Requisitos

- Node.js 20+ (testado com 22) e npm 10+
- Docker + Docker Compose
- FFmpeg no host (`ffmpeg -version`)
- Chave da API da Anthropic **ou** da OpenAI (ou `VISION_PROVIDER=mock` para desenvolver sem custo)

## Setup

```bash
cp .env.example .env              # ajuste PUBLIC_RTMP_URL, chave da IA, MEDIAMTX_WEBRTC_HOSTS
cp web/.env.example web/.env
npm install
npm run infra:up                  # Postgres + MediaMTX
npm run db:migrate
npm run model:download            # YOLO11n → api/models/yolo.onnx (ver "Modelo YOLO")
npm run dev                       # API :3333 + front :5173
```

Abra <http://localhost:5173>. O indicador no topo mostra API, banco, MediaMTX, detector e provider de IA.

### Scripts (na raiz)

| Script                                 | O que faz                                         |
| -------------------------------------- | ------------------------------------------------- |
| `npm run dev`                          | API (tsx watch) e front (Vite) em paralelo        |
| `npm run dev:api` / `npm run dev:web`  | só um dos dois                                    |
| `npm run infra:up` / `infra:down`      | sobe/derruba Postgres e MediaMTX                  |
| `npm run db:migrate`                   | aplica as migrations do Drizzle                   |
| `npm run db:generate -- --name <nome>` | gera migration a partir de `api/src/db/schema.ts` |
| `npm run model:download -w api`        | baixa/exporta o modelo YOLO                       |
| `npm run video:make -w api`            | gera o vídeo sintético de teste                   |
| `npm run lint` / `typecheck` / `test`  | ESLint, `tsc` e Vitest nos dois workspaces        |

---

## Variáveis de ambiente

A API e o `docker-compose.yml` leem o `.env` da **raiz**. O front lê `web/.env` (`VITE_API_URL`).

| Variável                                         | Padrão                                                    | Descrição                                                 |
| ------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------- |
| `DATABASE_URL`                                   | `postgres://sentinela:sentinela@localhost:5432/sentinela` | conexão do Postgres                                       |
| `API_PORT`                                       | `3333`                                                    | porta da API (o hook do MediaMTX usa a mesma)             |
| `PUBLIC_RTMP_URL`                                | —                                                         | URL RTMP **pública** mostrada ao usuário (túnel/VPS)      |
| `MEDIAMTX_WEBRTC_HOSTS`                          | `127.0.0.1`                                               | IPs anunciados no ICE do WebRTC (inclua o IP da LAN)      |
| `MEDIAMTX_*_URL`                                 | `localhost`                                               | API (9997), RTSP (8554), WebRTC (8889), HLS (8888)        |
| `STORAGE_DIR`                                    | `./storage`                                               | snapshots JPEG (relativo a `api/`)                        |
| `YOLO_MODEL_PATH`                                | `./models/yolo.onnx`                                      | modelo ONNX (relativo a `api/`)                           |
| `YOLO_ONNX_URL`                                  | —                                                         | URL direta de um `.onnx` pronto (opcional)                |
| `VISION_PROVIDER`                                | `anthropic`                                               | `anthropic`, `openai` ou `mock` (análise simulada)        |
| `ANTHROPIC_API_KEY`                              | —                                                         | chave da Anthropic (o SDK também aceita `ant auth login`) |
| `VISION_MODEL`                                   | `claude-sonnet-5-5`                                       | modelo de visão                                           |
| `VISION_EFFORT`                                  | `medium`                                                  | esforço de raciocínio (`low`/`medium`/`high`)             |
| `OPENAI_API_KEY`                                 | —                                                         | chave da OpenAI (`VISION_PROVIDER=openai`)                |
| `OPENAI_MODEL`                                   | `gpt-5.1`                                                 | modelo da OpenAI com visão                                |
| `OPENAI_BASE_URL`                                | —                                                         | endpoint compatível opcional (Azure OpenAI, proxy)        |
| `GOOGLE_API_KEY`                                 | —                                                         | chave da API Gemini (`VISION_PROVIDER=google`)            |
| `GOOGLE_MODEL`                                   | `gemini-2.5-flash`                                        | modelo Gemini                                             |
| `VISION_PRICE_INPUT_PER_MTOK` / `..._OUTPUT_...` | —                                                         | preço por milhão de tokens para a estimativa de custo     |
| `INVENTORY_REFRESH_EVERY`                        | `20`                                                      | refaz o inventário a cada N eventos                       |
| `ANALYSIS_FPS`                                   | `4`                                                       | frames/s analisados por câmera                            |
| `PERSON_CONFIDENCE`                              | `0.45`                                                    | confiança mínima do YOLO para `person`                    |
| `ROI_OVERLAP_MIN`                                | `0.15`                                                    | fração do bbox da pessoa dentro da ROI                    |
| `ENTER_CONSECUTIVE_FRAMES`                       | `3`                                                       | frames seguidos para considerar ocupação                  |
| `CLEAR_SECONDS`                                  | `2.5`                                                     | tempo sem pessoa para considerar a saída                  |
| `STABLE_SECONDS` / `STABLE_DIFF_MAX`             | `1.5` / `0.01`                                            | estabilidade da cena antes da captura                     |
| `STABLE_MAX_WAIT_SECONDS`                        | `15`                                                      | captura mesmo sem estabilizar após esse tempo             |
| `SCENE_DIFF_MIN`                                 | `0.004`                                                   | limiar do pré-filtro (fração de pixels diferentes)        |
| `MAX_OCCLUSION_SECONDS`                          | `600`                                                     | oclusão prolongada                                        |

---

## Exposição pública (câmera real)

A Mibo publica **para fora** da rede dela, então a porta RTMP (1935) precisa ser alcançável pela
internet. A URL mostrada no wizard vem de `PUBLIC_RTMP_URL` — nunca de `localhost`.

**Opção A — túnel TCP (desenvolvimento):**

```bash
ngrok tcp 1935
# Forwarding  tcp://0.tcp.sa.ngrok.io:12345 -> localhost:1935
```

Coloque no `.env`: `PUBLIC_RTMP_URL=rtmp://0.tcp.sa.ngrok.io:12345` e reinicie a API. Em contas
gratuitas o host/porta mudam a cada execução — gere a chave de novo ou atualize a URL na câmera.

**Opção B — VPS:** rode o `docker-compose.yml` (ou só o MediaMTX) numa VPS com a 1935/tcp aberta,
aponte `MEDIAMTX_*_URL` para ela e o hook de auth (`MTX_AUTHHTTPADDRESS`) para onde a API estiver.

**WebRTC na LAN:** para assistir de outro dispositivo, inclua o IP da máquina em
`MEDIAMTX_WEBRTC_HOSTS` (ex.: `127.0.0.1,192.168.1.210`), use esse IP em `MEDIAMTX_WEBRTC_URL`,
`MEDIAMTX_HLS_URL` e `VITE_API_URL`, e libere 8189/udp. Se o WebRTC falhar, o player cai para HLS.

## Configurar a câmera Mibo

1. Na loja, clique em **Adicionar câmera** → escaneie o QR da etiqueta (ou preencha manualmente).
2. O wizard mostra **URL completa**, **servidor** e **chave**, com botões de copiar e um QR code da URL
   (para levar ao celular).
3. No app **Mibo Smart**: selecione a câmera → Configurações → transmissão **RTMP** → cole a URL
   completa (ou servidor + chave, se o app pedir separado). Prefira **H.264**.
4. O wizard aguarda o sinal e marca a câmera como online sozinho (SSE).
5. Na tela da câmera: **Editar área da prateleira** (ROI) → **Memorizar prateleira** (valida o
   enquadramento, lista os produtos e salva o baseline) → o monitoramento liga automaticamente.

Dicas: câmera fixa, de cima ou em ângulo alto, com a prateleira inteira no quadro e boa iluminação.

> **QR pela webcam** exige contexto seguro (https ou `localhost`). Pelo IP da LAN em http o
> navegador bloqueia a câmera; use a aba "Manual" ou cole o conteúdo do QR.

---

## Simulação sem câmera real

Todo o pipeline pode ser validado localmente, sem túnel:

```bash
# 1. Gere o vídeo sintético (prateleira desenhada + pessoa real recortada de uma imagem
#    de exemplo pública do ultralytics, baixada na primeira execução)
npm run video:make -w api          # → samples/prateleira-sintetica.mp4 (87 s, em loop)

# 2. Cadastre loja + câmera na UI e copie a chave de transmissão
# 3. Publique (com a API já rodando — o hook de auth recusa se ela estiver fora do ar)
api/scripts/simulate-camera.sh <streamKey> samples/prateleira-sintetica.mp4
```

O vídeo tem quatro passagens: **15 s** retira uma Coca (→ `removed`), **33 s** move o Suco
(→ `moved`), **51 s** passa sem mexer (→ `no_change`, pelo pré-filtro), **69 s** repõe tudo
(→ `moved`, fecha o loop). Memorize a prateleira nos primeiros 15 s após iniciar o stream.

> O vídeo sintético é ótimo para o detector, a máquina de estados e o pré-filtro, mas os produtos são
> retângulos com rótulo: para avaliar a IA de verdade, grave um vídeo real.

### Gravando um vídeo de teste real

Celular fixo (tripé/fita) apontado **de cima** para uma prateleira com vários produtos, 1080p, H.264,
2–3 minutos:

1. 15 s com a prateleira parada;
2. uma pessoa entra na frente, **retira** um item e sai;
3. 15 s parado; outra pessoa **muda um item de lugar** e sai;
4. 15 s parado; outra pessoa passa na frente **sem mexer em nada**;
5. 15 s parado no final.

Depois: `api/scripts/simulate-camera.sh <streamKey> meu-video.mp4`.

### Desenvolvendo sem chave da Anthropic

`VISION_PROVIDER=mock` usa um provider heurístico (segmenta manchas de cor saturada e compara antes e
depois). Funciona com o vídeo sintético e deixa a UI inteira utilizável sem custo, mas **não serve
para cenas reais**. As validações e eventos trazem "[simulado]" no texto.

---

## Modelo YOLO (ONNX)

`npm run model:download -w api` grava `api/models/yolo.onnx` (não versionado):

1. se `YOLO_ONNX_URL` estiver definida, baixa o `.onnx` direto;
2. senão, **exporta via Docker** (`python:3.12-slim` + ultralytics, sem instalar nada no host).

Manualmente, com Python:

```bash
pip install ultralytics onnx
yolo export model=yolo11n.pt format=onnx imgsz=640 opset=12
mv yolo11n.onnx api/models/yolo.onnx
```

Qualquer YOLOv8/11 de detecção COCO com saída `[1, 84, N]` e entrada 640×640 funciona. Sem o modelo,
a API sobe normalmente, mas o monitoramento fica inativo (aviso no log e no indicador de status).

---

## IA de visão

As chaves ficam no `.env` do servidor; **qual IA e qual modelo usar** se escolhe no painel, pelo botão
**Configurações** (engrenagem no topo). A escolha fica salva no banco (`app_settings`) e vale na
próxima análise, sem reiniciar. O painel lista os modelos disponíveis na conta de cada provider e só
habilita as IAs com chave configurada. `VISION_PROVIDER` e os `*_MODEL` do `.env` são só os valores
iniciais.

| Provider    | Variáveis                                                              | Implementação                                             |
| ----------- | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| `anthropic` | `ANTHROPIC_API_KEY`, `VISION_MODEL` (padrão `claude-sonnet-5-5`)       | `api/src/vision/anthropic.ts` (Messages API)              |
| `openai`    | `OPENAI_API_KEY`, `OPENAI_MODEL` (padrão `gpt-5.1`), `OPENAI_BASE_URL` | `api/src/vision/openai.ts` (Responses API)                |
| `mock`      | —                                                                      | `api/src/vision/mock.ts` (heurístico, só desenvolvimento) |

- Os providers reais usam os mesmos prompts e schemas Zod (`api/src/vision/prompts.ts`:
  `VALIDATE_SCENE`, `INVENTORY`, `COMPARE`), saída estruturada por JSON Schema, validação Zod com
  normalização de regiões/confianças e um retry com a mensagem de erro.
- `VISION_EFFORT` vira `output_config.effort` (Anthropic) ou `reasoning.effort` (OpenAI, modelos
  `gpt-5*`/`o*`); o Gemini decide sozinho quanto raciocinar. `temperature: 0` só é enviado aos
  modelos que aceitam.
- Anthropic: fallback server-side (`fallbacks: "default"`) se o modelo recusar por política.
  OpenAI e Google: recusa/bloqueio ou resposta truncada viram `analysis_failed`.
- Sem chave, a API sobe normalmente; as análises falham com mensagem clara até a chave ser definida.
- O custo estimado usa uma tabela interna de preços; para modelos fora dela (ex.: `gpt-5.1`),
  defina `VISION_PRICE_INPUT_PER_MTOK` e `VISION_PRICE_OUTPUT_PER_MTOK`.
- Tokens e custo estimado são logados por chamada e salvos em `events.details.usage` (o modal do
  evento mostra os valores).

---

## API

```
GET    /health
GET    /stores                         POST /stores
GET    /stores/:id                     PATCH /stores/:id      DELETE /stores/:id
POST   /stores/:id/cameras             → { camera, rtmp: { serverUrl, streamKey, fullUrl } }
GET    /cameras/:id                    PATCH /cameras/:id     DELETE /cameras/:id
POST   /cameras/:id/regenerate-key
GET    /cameras/:id/snapshot           JPEG do último frame
POST   /cameras/:id/calibrate          202; progresso via SSE (body opcional { force: true })
POST   /cameras/:id/inventory/refresh  refaz o INVENTORY sobre o baseline
GET    /cameras/:id/events?cursor=&limit=&type=
GET    /events/:id
POST   /mediamtx/auth                  hook do MediaMTX
GET    /settings                       IA/modelo em uso e providers com chave
PATCH  /settings                       { vision: { provider?, model?, effort? } }
GET    /settings/models?provider=      modelos disponíveis na conta do provider
GET    /stream?cameraId=               SSE: camera.status, camera.state, camera.calibration, event.created
GET    /files/*                        snapshots salvos
```

## Testes

```bash
npm test
```

Vitest cobre `parseMiboQr`, overlap bbox × polígono, máquina de estados (detector e relógio mockados),
pré-filtro de diferença, classificação/precedência, inventário, splitter MJPEG, pós-processamento do
YOLO e o provider Anthropic com cliente mockado (retry, refusal, parâmetros por modelo).

---

## Decisões e desvios da especificação

- **Pré-filtro em cor, não em cinza.** Em cinza, uma lata vermelha sobre prateleira de mesma
  luminância desaparece e a retirada seria descartada sem chamar a IA (coberto por teste).
- **`temperature: 0`** só é enviado aos modelos que aceitam; a família Claude 4.7+/5 (incluindo o
  padrão `claude-sonnet-5-5`) rejeita valores não-padrão. O determinismo vem da saída estruturada.
- **Frame "depois" em resolução total**: a análise usa 1280 px a `ANALYSIS_FPS`; na captura do
  baseline e do _depois_ a API pega um frame cheio do RTSP (cai para o frame reduzido se demorar).
- **`person_left_at`** é o instante em que a pessoa deixou a ROI (início do `WAITING_CLEAR`), para que
  a duração mostrada seja a da ocupação.
- **`analysis_failed` também troca o baseline**, como pede a seção 8.4; a mudança não analisada não é
  reavaliada na próxima passagem.
- **`STABLE_MAX_WAIT_SECONDS`** (novo) evita ficar preso em `WAITING_STABLE` com cena oscilando.
- **`VISION_PROVIDER=mock`** (novo) para desenvolver sem chave.

## Riscos conhecidos (não resolvidos no protótipo)

- **RTMP da Mibo**: confirmar na prática quais modelos suportam push RTMP, se o app pede URL única ou
  servidor + chave e se a transmissão é contínua (ou só por evento).
- **QR da Mibo não documentado**: o parser é tolerante (JSON, URL, `chave:valor`, token longo) e
  sempre salva o conteúdo bruto; se nada for reconhecido, o cadastro segue manual.
- **Precisão depende do ângulo**: itens pequenos, ocluídos por outros produtos ou em ângulo frontal
  podem passar despercebidos.
- **Custo da IA** proporcional ao número de passagens que passam do pré-filtro (logado por evento).
- **Banda da loja**: 1–2 Mbps contínuos de upload por câmera em 1080p.
- **H.265**: WebRTC não toca na maioria dos navegadores; o player usa HLS (mais latência) e a UI
  sugere configurar H.264.

## Solução de problemas

| Sintoma                                  | Causa provável                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| `authentication failed` ao publicar      | API fora do ar (hook de auth) ou chave errada/regenerada                            |
| Câmera fica "Aguardando sinal"           | URL/porta RTMP não acessível pela internet; confira o túnel                         |
| Player preso em "Conectando (WebRTC)…"   | ICE bloqueado: ajuste `MEDIAMTX_WEBRTC_HOSTS` / 8189/udp; use o botão HLS           |
| Monitoramento nunca sai de "Monitorando" | modelo YOLO ausente, ROI errada ou `PERSON_CONFIDENCE` alto                         |
| Muitos `analysis_failed`                 | chave da IA (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`) ausente ou inválida (veja o log) |
