# Guia de consultas da API Klavi

Guia prático para **buscar dados** na API Klavi: lojas, filiais, vendas, produtos, estoque e clientes. Cobre apenas operações de leitura (`GET`). Nenhum exemplo aqui grava, altera ou apaga dados.

> Levantado a partir do código do repositório `klavitecnologia/api` (branch `klavi`, commit `2080d9f`) e das chamadas que o painel em produção faz. Atualizado em 22/10/2026.

---

## 1. Visão geral

| Item | Valor |
|---|---|
| URL base | `https://api.klavi.app.br` (o mesmo backend responde em `https://api.klavi.com.br`) |
| Protocolo | Somente **HTTPS**. Em produção, chamadas HTTP são redirecionadas. |
| Formato | JSON |
| Framework | Feathers 3 + MongoDB (feathers-mongoose 6) |
| Autenticação | JWT no cabeçalho `Authorization: Bearer <token>` |
| Tempo real | Socket.io no mesmo endereço (opcional, ver seção 9) |

Cada recurso segue o padrão Feathers:

| Operação | Método e rota | Uso |
|---|---|---|
| Listar / buscar | `GET /recurso?filtros` | Retorna uma lista paginada |
| Obter um registro | `GET /recurso/:id` | Retorna um único documento |

---

## 2. Autenticação

### 2.1 Obter o token

Use um usuário **gestor** (dono da loja ou funcionário com acesso ao painel). É o mesmo login do painel `newdash`.

```bash
curl -X POST "https://api.klavi.app.br/authentication" \
  -H "Content-Type: application/json" \
  -d '{
        "strategy": "local",
        "userStrategy": "manager",
        "username": "gestor@sualoja.com.br",
        "password": "SUA_SENHA"
      }'
```

| Campo | Obrigatório | Descrição |
|---|---|---|
| `strategy` | sim | Sempre `"local"` para login com e-mail e senha |
| `userStrategy` | sim | `"manager"` para gestores. Se o usuário for dono de uma empresa, o token sai automaticamente como `owner`. |
| `username` | sim | E-mail do usuário |
| `password` | sim | Senha |

### 2.2 Resposta

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "payload": {
    "userId": "64a1...",
    "companyId": "6488...",
    "branchId": "6489...",
    "branches": ["6489...", "64b7..."],
    "type": "manager",
    "permissions": [ { "kind": "...", "actions": ["..."] } ]
  },
  "user": { "_id": "64a1...", "name": "...", "email": "..." }
}
```

- **`accessToken`** é o token que vai em todas as chamadas seguintes.
- **`payload.companyId`** é a loja (empresa) do usuário. Os endpoints `manager/*` filtram por ela automaticamente.
- **`payload.branchId` / `payload.branches`** são as filiais do usuário. Guarde esses IDs para filtrar por filial.
- Quando o token sai como `owner` (dono), `payload.branchId` traz a primeira filial da empresa.

### 2.3 Usar o token

```bash
TOKEN="eyJhbGciOiJIUzI1NiIs..."
curl -G "https://api.klavi.app.br/manager/branches" -H "Authorization: Bearer $TOKEN"
```

### 2.4 Validade e cuidados

- O token de produção **vale 5 anos**. Trate-o como uma senha: não coloque em repositório, planilha ou URL compartilhada.
- Para invalidar o uso de um token, troque a senha do usuário ou crie um usuário específico para integrações.
- Use sempre um usuário de **gestor**. Não use login de cliente ou de totem para consultas administrativas.

---

## 3. Como montar consultas

Os filtros vão na *query string*. Com `curl`, use `-G` + `--data-urlencode` para não precisar escapar `$`, `[` e `]` à mão.

### 3.1 Paginação

| Parâmetro | Padrão | Máximo | Descrição |
|---|---|---|---|
| `$limit` | 10 | 1000 | Quantidade de registros por página |
| `$skip` | 0 | – | Quantos registros pular |
| `$limit=0` | – | – | Retorna **só o total**, sem registros. Ideal para responder "existe ou não?" |

Formato da resposta paginada:

```json
{ "total": 1543, "limit": 100, "skip": 0, "data": [ ... ] }
```

### 3.2 Ordenação e campos

| Parâmetro | Exemplo | Efeito |
|---|---|---|
| `$sort` | `$sort[createdAt]=-1` | Mais recentes primeiro (`1` = crescente) |
| `$select` | `$select[]=createdAt&$select[]=total` | Retorna só esses campos (resposta menor e mais rápida) |

### 3.3 Operadores de filtro

| Operador | Exemplo | Significado |
|---|---|---|
| igualdade | `branch=6489...` | Campo igual ao valor |
| `$gte` / `$lte` | `createdAt[$gte]=2026-10-01T03:00:00.000Z` | Maior/menor ou igual |
| `$gt` / `$lt` | `total[$gt]=100` | Maior/menor que |
| `$in` | `status[$in][]=2&status[$in][]=512` | Valor está na lista |
| `$nin` | `status[$nin][]=16&status[$nin][]=32` | Valor **não** está na lista |
| `$ne` | `deleted[$ne]=true` | Diferente de |
| `$or` | `$or[0][cpfCustomer]=123&$or[1][noAuthPhone]=8599...` | Qualquer uma das condições |
| campo aninhado | `items.product=64cd...` | Filtra dentro de listas e objetos |

### 3.4 Datas e fuso horário

- As datas ficam gravadas em **UTC**.
- O horário de Brasília é UTC−3. Então **meia-noite em Brasília = `03:00:00Z`**.
- Para "outubro inteiro no horário de Brasília":
  - `createdAt[$gte]=2026-10-01T03:00:00.000Z`
  - `createdAt[$lt]=2026-11-01T03:00:00.000Z`

---

## 4. Receita principal: compras em um período

Endpoint: **`GET /manager/orders`**

- Exige token de gestor.
- Retorna **apenas pedidos da loja do token**. O filtro de `company` é aplicado automaticamente.
- Para limitar a uma filial, informe `branch`.

### 4.1 Todas as compras de uma filial em um período

```bash
curl -G "https://api.klavi.app.br/manager/orders" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "branch=ID_DA_FILIAL" \
  --data-urlencode "createdAt[\$gte]=2026-10-01T03:00:00.000Z" \
  --data-urlencode "createdAt[\$lt]=2026-11-01T03:00:00.000Z" \
  --data-urlencode "status[\$nin][]=16" \
  --data-urlencode "status[\$nin][]=32" \
  --data-urlencode "status[\$nin][]=64" \
  --data-urlencode "\$sort[createdAt]=-1" \
  --data-urlencode "\$limit=100"
```

- Os `status[$nin]` excluem pedidos cancelados (16), recusados (32) e estornados (64). Veja a tabela completa na seção 6.
- Para considerar só pedidos pagos, acrescente `paid=true`.
- Para pegar todas as filiais da loja, remova a linha `branch`.

### 4.2 Saber se um produto foi vendido no período (sim/não)

```bash
curl -G "https://api.klavi.app.br/manager/orders" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "branch=ID_DA_FILIAL" \
  --data-urlencode "items.product=ID_DO_PRODUTO" \
  --data-urlencode "createdAt[\$gte]=2026-10-01T03:00:00.000Z" \
  --data-urlencode "createdAt[\$lt]=2026-11-01T03:00:00.000Z" \
  --data-urlencode "status[\$nin][]=16" \
  --data-urlencode "status[\$nin][]=32" \
  --data-urlencode "status[\$nin][]=64" \
  --data-urlencode "\$limit=0"
```

Resposta: `{"total": 37, "limit": 0, "skip": 0, "data": []}`. Ou seja, o produto apareceu em 37 pedidos.

> **Atenção:** cada produto pertence a **uma única filial**. O mesmo item vendido em duas filiais tem dois IDs diferentes. Para buscar o mesmo produto em várias filiais, use o grupo unificado (seção 4.3).

### 4.3 Mesmo produto em várias filiais

**Passo 1.** Localize o grupo unificado do produto e anote os IDs em `products[].product`. O parâmetro `company` é **obrigatório** neste endpoint.

```bash
curl -G "https://api.klavi.app.br/app/unified-product-groups" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "company=ID_DA_LOJA" \
  --data-urlencode "name=Coca-Cola Lata 350ml"
```

**Passo 2.** Busque os pedidos com qualquer um desses IDs:

```bash
curl -G "https://api.klavi.app.br/manager/orders" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "items.product[\$in][]=ID_PRODUTO_FILIAL_A" \
  --data-urlencode "items.product[\$in][]=ID_PRODUTO_FILIAL_B" \
  --data-urlencode "createdAt[\$gte]=2026-10-01T03:00:00.000Z" \
  --data-urlencode "createdAt[\$lt]=2026-11-01T03:00:00.000Z" \
  --data-urlencode "\$limit=0"
```

Alternativa sem grupo unificado: filtre por `items.code` (código do produto). Muitos itens são cadastrados com código vazio, então esse caminho nem sempre funciona.

### 4.4 Compras de um cliente

```bash
# Por CPF informado no pedido
curl -G "https://api.klavi.app.br/manager/orders" -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "cpfCustomer=12345678900" --data-urlencode "\$sort[createdAt]=-1"

# Por ID do cliente cadastrado
curl -G "https://api.klavi.app.br/manager/orders" -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "customer=ID_DO_CLIENTE" --data-urlencode "\$sort[createdAt]=-1"
```

### 4.5 Baixar todas as páginas (script)

Exemplo em bash + `jq`. Ele percorre as páginas de 1000 em 1000 e salva tudo em `pedidos.json`:

```bash
#!/usr/bin/env bash
TOKEN="SEU_TOKEN"
BRANCH="ID_DA_FILIAL"
INI="2026-10-01T03:00:00.000Z"
FIM="2026-11-01T03:00:00.000Z"
SKIP=0; LIMIT=1000; echo "[]" > pedidos.json

while :; do
  PAGE=$(curl -s -G "https://api.klavi.app.br/manager/orders" \
    -H "Authorization: Bearer $TOKEN" \
    --data-urlencode "branch=$BRANCH" \
    --data-urlencode "createdAt[\$gte]=$INI" \
    --data-urlencode "createdAt[\$lt]=$FIM" \
    --data-urlencode "\$sort[createdAt]=1" \
    --data-urlencode "\$limit=$LIMIT" \
    --data-urlencode "\$skip=$SKIP")
  N=$(echo "$PAGE" | jq '.data | length')
  jq -s '.[0] + .[1].data' pedidos.json <(echo "$PAGE") > tmp.json && mv tmp.json pedidos.json
  [ "$N" -lt "$LIMIT" ] && break
  SKIP=$((SKIP + LIMIT))
done

echo "Total baixado: $(jq length pedidos.json)"
# Exemplo: unidades vendidas por produto
jq -r '[.[] | .items[]] | group_by(.title) | map({produto: .[0].title, unidades: (map(.quantity) | add)}) | sort_by(-.unidades) | .[] | "\(.unidades)\t\(.produto)"' pedidos.json
```

### 4.6 Campos úteis de um pedido

| Pergunta | Campo |
|---|---|
| **Quando** foi a venda? | `createdAt` (UTC). Mudanças de status ficam em `history[]` (`status` + `updatedAt`). |
| **Onde** (loja/filial)? | `company`, `branch` |
| **O que** foi vendido? | `items[]`: `title`, `product`, `code`, `quantity`, `price`, `originalPrice`, `costPrice`, `complements[]` |
| **Quem** comprou? | `customer` (ID), `customerData`, `cpfCustomer`, `totemClientName`, `noAuthName`, `noAuthPhone` |
| **Quanto**? | `subtotal`, `total`, `amount`, `deliveryFee`, `serviceFee`, `discount`, `coupon`, `totalcost` |
| **Como** pagou? | `paymentMethod.kind` / `paymentMethod.label` (ex.: `Pix`, `Dinheiro`), `paid`, `installments`, `isMixedPayment` |
| Canal da venda | `locationType` (seção 6), `totemVersion`, `appInfo.platform` |
| Número sequencial | `seq` |
| Avaliação do cliente | `review.value` (1–5), `review.comment` |
| Cancelamento | `cancellation.reason`, `cancellation.text` |

---

## 5. Referência de endpoints de leitura

Todos com `Authorization: Bearer $TOKEN`. Na coluna "Filtro automático", **loja** significa que a API já restringe os resultados à empresa do token. Onde aparece **informe `company`**, o filtro é responsabilidade de quem chama.

### 5.1 Loja e filiais

| Endpoint | Retorna | Filtro automático | Observações |
|---|---|---|---|
| `GET /manager/companies/:companyId` | Dados da loja (nome, filiais, plano, dono) | – | Use o `companyId` do payload do login |
| `GET /manager/branches` | Filiais: nome, endereço, contato, `active`, horários, integrações | loja | Inclui `deliveryArea`, `paymentMethods`, `opened` |
| `GET /manager/branches/:id` | Uma filial | loja | – |
| `GET /manager/periods` | Períodos de venda configurados | loja | – |
| `GET /manager/schedules` | Horários de funcionamento | loja | – |
| `GET /manager/tables` | Mesas cadastradas | loja | – |

### 5.2 Vendas

| Endpoint | Retorna | Filtro automático | Observações |
|---|---|---|---|
| `GET /manager/orders` | Pedidos (paginado) | loja | **Endpoint principal.** Veja a seção 4. |
| `GET /manager/orders/:id` | Um pedido completo | loja | – |
| `GET /app/sales-calendar` | Pedidos **sem paginação** | loja | Aceita os mesmos filtros de `manager/orders`. **Sempre** informe um período curto, senão a resposta fica enorme. |
| `GET /app/sales-reports` | Resumo dos **últimos 30 dias** da filial do token: total vendido, custo, quantidade, pagos, por forma de pagamento (pix/dinheiro/cartão/online) e por plataforma | filial do token | Período fixo, não aceita datas |

### 5.3 Produtos e inventário

| Endpoint | Retorna | Filtro automático | Observações |
|---|---|---|---|
| `GET /manager/products` | Produtos: `name`, `price`, `costprice`, `code`, `barCode`, `ncm`, `category`, `active`, **`stock`** | loja | Filtre por `branch=...`. Busca por texto: `$text[$search]=coca` |
| `GET /manager/products/:id` | Um produto | – | – |
| `GET /manager/product-categories` | Categorias | loja | – |
| `GET /manager/product-groups` | Grupos de produtos | loja + filial do token | – |
| `GET /manager/complements-groups` | Grupos de complementos/adicionais | loja | – |
| `GET /app/unified-product-groups` | Mesmo produto entre filiais (`commonCode`, `products[{branch, product}]`) | **informe `company`** | Base da busca entre filiais (4.3) |
| `GET /app/stock-movements` | Transferências de estoque entre filiais: `donorBranch`, `receivers[{branch, product, quantity}]`, `totalTransferred`, `reason`, `user`, `createdAt` | **informe `company`** | – |

Campos de estoque dentro de cada produto (`stock`):

| Campo | Significado |
|---|---|
| `stock.stockControl` | Controle de estoque ativado |
| `stock.currentQuantity` | Quantidade atual |
| `stock.originalQuantity` | Quantidade na última reposição |
| `stock.minimalQuantity` | Estoque mínimo |
| `stock.lastStockReposition` / `stock.dateLastReposition` | Última reposição |
| `stock.productValidUntil` | Validade |
| `stock.totemSoldOut` | Marcado como esgotado no totem |
| `stockHistory[]` | Histórico de movimentações do produto |

Exemplo: produtos de uma filial abaixo do estoque mínimo. Baixe a lista e filtre localmente:

```bash
curl -s -G "https://api.klavi.app.br/manager/products" -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "branch=ID_DA_FILIAL" --data-urlencode "stock.stockControl=true" \
  --data-urlencode "\$limit=1000" \
  --data-urlencode "\$select[]=name" --data-urlencode "\$select[]=stock" \
| jq -r '.data[] | select(.stock.currentQuantity <= (.stock.minimalQuantity // 0)) | "\(.stock.currentQuantity)\t\(.name)"'
```

### 5.4 Clientes

| Endpoint | Retorna | Filtro automático | Observações |
|---|---|---|---|
| `GET /manager/customers` | Clientes cadastrados da loja: nome, e-mail, telefone, CPF, nascimento | loja | Senha nunca é retornada |
| `GET /manager/customers/:id` | Um cliente | loja | – |
| `GET /manager/totem-customers` | Clientes identificados no totem | loja | Aceita `$search` |
| `GET /manager/totem-users` | Usuários de totem da loja | loja | – |

### 5.5 Marketing, fidelidade e equipe

| Endpoint | Retorna | Filtro automático |
|---|---|---|
| `GET /manager/coupons` | Cupons de desconto | filiais do token |
| `GET /manager/offers` | Ofertas/promoções | loja |
| `GET /manager/loyalty` | Programa de fidelidade | loja |
| `GET /manager/employees` | Funcionários | loja |
| `GET /manager/roles` | Perfis de acesso | loja |

---

## 6. Dicionário de códigos

### 6.1 `status` do pedido

| Código | Nome no sistema | Significado |
|---|---|---|
| 1 | PendingApproval | Aguardando aprovação |
| 2 | Approved | Aprovado |
| 4 | OutForDelivery | Saiu para entrega |
| 8 | Delivered | Entregue |
| **16** | Cancelled | **Cancelado** |
| **32** | Refused | **Recusado** |
| **64** | Refunded | **Estornado** |
| 128 | AtEstablishment | No estabelecimento |
| 256 | WaitingForFinish | Aguardando finalização |
| 512 | Finished | Finalizado |
| 1024 | WaitingForDelivery | Aguardando entrega |
| 2048 | WaitingForWaiter | Aguardando garçom |

> Os códigos 16, 32 e 64 estão confirmados no próprio código da API (`sales-reports`). Os demais seguem a mesma regra de geração (potências de 2 na ordem do model). Se for usar algum deles em relatório, confira antes com dados reais.

### 6.2 `locationType` (canal da venda)

| Código | Significado |
|---|---|
| 1 | Delivery |
| 2 | Retirada (TakeAway) |
| 4 | Consumo no local (Establishment) |
| 8 | Totem |

---

## 7. Endpoints que **não** devem ser usados para relatórios

| Endpoint | Motivo |
|---|---|
| `/common/maxItemSale`, `/common/dailyOrders`, `/common/monthlyOrders`, `/common/clientRecurrence` | Ignoram filtros e agregam pedidos de **todas as lojas** do sistema |
| `/manager/evaluation`, `/manager/rating` | Consideram só os 10 primeiros pedidos (paginação padrão) |
| `GET /manager/companies` (lista, sem `:id`) | Não filtra pela loja do token. Use `GET /manager/companies/:companyId`. |
| `/pdv/orders` | Exige `:id` e é voltado à integração com PDV |

---

## 8. Boas práticas e desempenho

1. **Sempre filtre por período (`createdAt`) e, se possível, por `branch`.** A coleção de pedidos não tem índices além do ID, então consultas amplas percorrem o banco inteiro e pesam no servidor de produção.
2. **Use `$select`** para trazer só os campos necessários.
3. **Use `$limit=0`** quando só precisar saber se existe e quantos são.
4. **Prefira períodos curtos** (dias ou um mês) e consultas pesadas fora do horário de pico.
5. **Não use `/app/sales-calendar` sem período.** Ele não pagina.
6. **Respeite o limite de 1000 por página.** Valores maiores são reduzidos para 1000.

---

## 9. Tempo real (opcional)

O painel recebe pedidos novos em tempo real pelo Socket.io, sem precisar consultar a API repetidamente. Exemplo em Node.js com o cliente Feathers 3:

```js
const io = require("socket.io-client");
const feathers = require("@feathersjs/feathers");
const socketio = require("@feathersjs/socketio-client");
const auth = require("@feathersjs/authentication-client");

const socket = io("https://api.klavi.app.br", { transports: ["websocket"] });
const client = feathers().configure(socketio(socket)).configure(auth());

(async () => {
  await client.authenticate({ strategy: "jwt", accessToken: process.env.KLAVI_TOKEN });
  client.service("manager/orders").on("created", (order) => {
    console.log(new Date(order.createdAt).toLocaleString("pt-BR"), order.branch, order.total);
  });
})();
```

---

## 10. Resumo rápido

```text
1. POST /authentication  {strategy:"local", userStrategy:"manager", username, password}  -> accessToken
2. Header em toda chamada: Authorization: Bearer <accessToken>
3. Filiais:        GET /manager/branches
4. Vendas:         GET /manager/orders?branch=...&createdAt[$gte]=...&createdAt[$lt]=...
5. Produto vendido? GET /manager/orders?items.product=...&createdAt[...]&$limit=0  -> total
6. Produtos/estoque: GET /manager/products?branch=...
7. Clientes:       GET /manager/customers
8. Datas em UTC: meia-noite de Brasília = T03:00:00Z
9. Excluir cancelados: status[$nin][]=16&status[$nin][]=32&status[$nin][]=64
```
