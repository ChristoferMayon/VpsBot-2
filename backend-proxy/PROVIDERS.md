# Integração com múltiplas fornecedoras (Providers)

Este backend suporta seleção dinâmica de provider via variável `PROVIDER` no `.env`. O padrão é `zapi`.

## Como trocar de fornecedora

1. Defina `PROVIDER` no arquivo `.env` para o nome do adapter desejado.
   - Ex.: `PROVIDER=zapi` ou `PROVIDER=template` (copie o template para criar seu adapter).
2. Configure as credenciais no `.env` conforme a documentação da fornecedora.
3. Reinicie o servidor (`npm start`) para aplicar as mudanças.

## Estrutura de adapters

- Local: `backend-proxy/providers/`
- Cada adapter exporta:
  - `sendSimpleText({ phone, message })`
  - `sendCarouselMessage({ phone, elements })`
  - `configureWebhook(publicBaseUrl)`

### Adapter Z-API (`providers/zapi.js`)

Usa as variáveis:

- `ZAPI_INSTANCE_ID`
- `ZAPI_TOKEN`
- `ZAPI_CLIENT_TOKEN`

Endpoints implementados:

- Texto simples: `POST /send-simple-text`
- Carrossel: `POST /send-carousel-message`
- Configurar webhook: `POST /configure-webhook`

### Template para nova fornecedora (`providers/template.js`)

Copie este arquivo e ajuste:

- Endpoints de envio de texto/carrossel
- Cabeçalhos (ex.: `Authorization: Bearer <token>`) e payloads
- Webhook (URL apontará para `/webhook/message-status` deste backend)

Variáveis sugeridas:

- `PROV_BASE_URL`
- `PROV_TOKEN`
- `PROV_CLIENT_ID` (se aplicável)

## .env

Exemplo mínimo:

```
PROVIDER=zapi
ZAPI_INSTANCE_ID=...
ZAPI_TOKEN=...
ZAPI_CLIENT_TOKEN=...
# Para outra fornecedora
# PROV_BASE_URL=https://api.fornecedora.com
# PROV_TOKEN=SEU_TOKEN_AQUI
```

### UAZAPI (`providers/uazapi.js`)

- Autenticação: endpoints regulares exigem header `token` com o token da instância (não admin). 
  - Endpoints administrativos exigem header `admintoken` com o token administrativo.
- Payload de carrossel: `number`, `text`, `carousel`, `delay` (ms), `readchat`.
- Botões aceitos: `REPLY`, `URL`, `COPY`, `CALL`.
- Mapeamento:
  - `REPLY`: `id` recebe o texto do botão.
  - `URL`: `id` recebe a URL completa.
  - `COPY`: `id` recebe o texto que será copiado.
  - `CALL`: `id` recebe o número de telefone.

Configuração .env típica:

```
PROVIDER=uazapi
PROV_BASE_URL=https://free.uazapi.com
PROV_TOKEN=<token_da_instancia>
```

Observações:
- O `PROV_TOKEN` deve ser o token da instância conectada ao WhatsApp.
- Caso use outro host, ajuste `PROV_BASE_URL` conforme documentação do seu servidor UAZAPI.
- Para webhooks, o adapter retorna a URL calculada (`/webhook/message-status`).

#### Overrides de endpoints via `.env`

Se o seu servidor UAZAPI usa caminhos diferentes para QR/Status e para desconexão de instância, você pode configurar overrides explícitos pelo `.env` sem alterar código. O provider tentará primeiro os overrides e, caso falhem, usará os candidatos padrão.

Variáveis suportadas:

- `UAZAPI_ADMIN_QR_PATH`: caminho para obter QR/Status por instância (admin). Suporta placeholders `:name` ou `{name}`.
  - Ex.: `/admin/sessions/:name/qr` ou `/admin/qr?session=:name`
- `UAZAPI_ADMIN_QR_METHOD`: método a usar no override (`GET` ou `POST`). Padrão `GET`.
- `UAZAPI_ADMIN_QR_KEYS`: chaves para enviar o nome da instância (quando não houver placeholder na rota). Lista separada por vírgulas.
  - Ex.: `session,name` (o provider enviará todas as chaves indicadas)
- `UAZAPI_ADMIN_QR_FORCE`: se `true`, força `force=true` na query/corpo.

- `UAZAPI_ADMIN_DISCONNECT_PATH`: caminho para desconectar/resetar uma instância específica (admin). Suporta `:name`/`{name}`.
  - Ex.: `/admin/sessions/:name/logout`, `/admin/instances/:name/reset`
- `UAZAPI_ADMIN_DISCONNECT_METHOD`: método do override (`POST` ou `GET`). Padrão `POST`.
- `UAZAPI_ADMIN_DISCONNECT_KEYS`: chaves para enviar o nome da instância quando não houver placeholder. Ex.: `session,name`.

Também existem variantes não-admin (caso seu servidor não use cabeçalhos administrativos):

- `UAZAPI_QR_PATH`, `UAZAPI_QR_METHOD`, `UAZAPI_QR_KEYS`, `UAZAPI_QR_FORCE`
- `UAZAPI_DISCONNECT_PATH`, `UAZAPI_DISCONNECT_METHOD`, `UAZAPI_DISCONNECT_KEYS`

Criação de instância:

- `UAZAPI_ADMIN_CREATE_PATH`: caminho para criar instância (admin). Suporta `:name`/`{name}`.
  - Ex.: `/admin/sessions/:name/create` ou `/admin/instance/create`
- `UAZAPI_ADMIN_CREATE_METHOD`: método do override (`POST`/`GET`). Padrão `POST`.
- `UAZAPI_ADMIN_CREATE_KEYS`: chaves para enviar o nome quando não houver placeholder. Ex.: `name,instance,session`.
- Também existem variantes não-admin: `UAZAPI_CREATE_PATH`, `UAZAPI_CREATE_METHOD`, `UAZAPI_CREATE_KEYS`.

Endpoints oficiais segundo `uazapi-openapi-spec.yaml`:

- Criação (admin): `POST /instance/init`
  - Header: `admintoken: <token_admin>`
  - Body: `{ name, systemName?, adminField01?, adminField02? }`
  - Resposta inclui `token` da instância criada.

- Conexão (instância): `POST /instance/connect`
  - Header: `token: <token_da_instancia>`
  - Body: `{ phone? }` (se enviar `phone`, retorna pair code; sem `phone`, retorna QR code atualizando via status)
  - Estados retornados: `connected`, `loggedIn`, `jid`, `instance`.

- Status (instância): `GET /instance/status`
  - Header: `token: <token_da_instancia>`
  - Retorna `connected`, `loggedIn`, `jid` e `instance` com `qrcode/paircode` quando em `connecting`.

Chamada pelo proxy:

- `POST /create-instance` com body:
  - `instance` ou `name`: nome da instância
  - demais campos opcionais serão encaminhados ao provider
  - Autenticação administrativa via header `admintoken` (usa `PROV_ADMIN_TOKEN` do `.env`).

- `POST /connect-instance` com body:
  - `instance` ou `name`: nome da instância
  - `phone` (opcional): número no formato E.164 (ex.: `5511999999999`).
  - O proxy resolve automaticamente o `token` da instância via rotas admin e chama `/instance/connect` com o header `token` correto.

- `GET /instance-status?instance=<nome>`
  - O proxy resolve o `token` da instância e consulta `/instance/status` com o header `token` correto.
  - Resposta normalizada inclui `status.connected`, `status.loggedIn`, `status.qrcode` e `status.paircode` quando disponíveis.

Exemplo de configuração `.env`:

```
PROVIDER=uazapi
PROV_BASE_URL=https://seu-servidor-uazapi.local
PROV_TOKEN=TOKEN_PADRAO_DA_INSTANCIA
PROV_ADMIN_TOKEN=TOKEN_ADMINISTRATIVO

# QR/Status por instância (admin): GET com placeholder
UAZAPI_ADMIN_QR_PATH=/admin/sessions/:name/qr
UAZAPI_ADMIN_QR_METHOD=GET
UAZAPI_ADMIN_QR_FORCE=true

# Logout por instância (admin): POST sem placeholder, chaves "session,name"
UAZAPI_ADMIN_DISCONNECT_PATH=/admin/logout
UAZAPI_ADMIN_DISCONNECT_METHOD=POST
UAZAPI_ADMIN_DISCONNECT_KEYS=session,name
```

Como funciona:

- Se `UAZAPI_ADMIN_*` estiverem definidos, o provider prioriza esses caminhos com cabeçalhos admin.
- Se a rota tiver `:name`/`{name}`, o provider substitui pelo nome pedido; caso contrário, adiciona o nome nas chaves configuradas (query para `GET`, corpo para `POST`).
- Se o override falhar, o provider segue tentando os caminhos padrão pré-configurados.
- Para rotas de instância (`/instance/connect`, `/instance/status`), o provider primeiro resolve o `token` da instância pelo nome usando rotas administrativas e então usa o header `token` correto.

## Observações

- Após alteração do `.env` ou dos adapters, reinicie o servidor.
- Mantenha HTTPS no `PUBLIC_BASE_URL` quando a fornecedora exigir para webhooks.
- O frontend permanece igual; apenas o backend delega para o provider selecionado.