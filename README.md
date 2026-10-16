# Sentinela

Protótipo de monitoramento de loja autônoma com IA. Câmeras Intelbras Mibo enviam vídeo via RTMP
para o MediaMTX; a API detecta pessoas na frente da prateleira, espera a saída e compara
antes/depois com um modelo de visão, gerando eventos em tempo real.

> Especificação completa: [docs/PROMPT.md](docs/PROMPT.md). README detalhado na fase de polimento.

## Setup rápido

```bash
cp .env.example .env          # ajuste PUBLIC_RTMP_URL, ANTHROPIC_API_KEY...
cp web/.env.example web/.env
npm install
npm run infra:up              # Postgres + MediaMTX (Docker)
npm run db:migrate
npm run dev                   # API (:3333) + front (:5173) no host
```
