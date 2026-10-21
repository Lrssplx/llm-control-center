# LLM Control Center

Dashboard local para acompanhar uma integração com a API OpenAI, com exibição opcional em um ESP32 com OLED. Mostra tokens, custo, latência, erros e histórico de chamadas.

## Como funciona

- **Métricas locais:** registra chamadas feitas pelo playground do dashboard e salva o histórico em `data/events.jsonl`.
- **Consumo da organização:** com uma chave administrativa, consulta tokens e custos globais. Esses dados têm prioridade nos cartões de consumo e no OLED; quando indisponíveis, o sistema usa dados locais.
- **OLED:** consulta o backend a cada 3 segundos e exibe status, modelo, latência, erros, tokens e custo.

O ESP32 é opcional. Atualizar as métricas não gera prompts de IA; enviar uma pergunta pelo playground realiza uma chamada real à API.

## Requisitos

- Node.js 20 ou superior e npm.
- Chave da API OpenAI para enviar prompts.
- Para o dispositivo: VS Code com PlatformIO, ESP32-WROOM-32 e OLED SSD1306 I2C de 128 × 64 pixels.
- Computador e ESP32 na mesma rede, com Wi-Fi de 2,4 GHz para a placa.

## Iniciar o dashboard

No terminal, dentro da pasta do projeto:

```powershell
npm install
Copy-Item .env.example .env
```

Se o `.env` já existir, preserve o arquivo atual. Edite suas configurações:

| Variável | Finalidade |
| --- | --- |
| `OPENAI_API_KEY` | Chave usada para enviar prompts. |
| `OPENAI_MODEL` | Modelo disponível na sua conta. |
| `OPENAI_ADMIN_KEY` | Opcional: chave administrativa com permissão de leitura de uso e custos da organização. |
| `PORT` | Porta do servidor; padrão `3000`. |
| `MAX_DAILY_CALLS` | Limite diário de tentativas de chamadas pelo backend. |
| `PRICE_INPUT_PER_M` | Preço estimado em USD por milhão de tokens de entrada. |
| `PRICE_OUTPUT_PER_M` | Preço estimado em USD por milhão de tokens de saída. |

Inicie o servidor:

```powershell
npm start
```

Acesse **http://localhost:3000**. Use o **Prompt playground** para enviar uma pergunta e acompanhar as métricas. Reinicie o servidor após alterar o `.env`.

Para desenvolvimento com reinício automático, use `npm run dev`.

## Configurar o ESP32

### Ligação do OLED

| OLED | ESP32 |
| --- | --- |
| VCC | 3V3 |
| GND | GND |
| SDA | GPIO21 |
| SCL | GPIO22 |

O firmware usa o endereço I2C `0x3C`.

### Rede e backend

Crie a configuração local, caso ainda não exista:

```powershell
Copy-Item firmware/secrets.example.h firmware/secrets.h
```

Em `firmware/secrets.h`, preencha:

```cpp
const char* WIFI_SSID = "SEU_WIFI";
const char* WIFI_PASSWORD = "SUA_SENHA";
const char* URL_METRICS = "http://IP_DO_COMPUTADOR:3000/api/oled";
```

Use `ipconfig` no Windows para descobrir o IPv4 do computador que executa o backend. Se alterar `PORT`, ajuste também a URL.

Mantenha o backend em execução e permita o acesso à porta do servidor no firewall da rede privada.

### Compilar e enviar pelo PlatformIO

Abra a pasta do projeto no VS Code. O `platformio.ini` já configura a placa **ESP32 Dev Module** e as bibliotecas necessárias.

1. Conecte o ESP32 por USB.
2. Abra **PlatformIO → Project Tasks → esp32dev → General**.
3. Execute **Build** para compilar.
4. Execute **Upload** para gravar na placa.
5. Abra **Monitor** para ver as mensagens em **115200 baud**.

Também é possível usar o terminal do PlatformIO:

```powershell
pio run
pio run --target upload
pio device monitor
```

Feche o Monitor Serial antes de fazer outro upload.

## Dados, custos e limites

As métricas locais usam o dia no horário de São Paulo. O consumo da organização usa o dia em UTC, com consultas em intervalos de aproximadamente 60 segundos. Os valores locais e globais podem ser diferentes.

O custo local é uma estimativa calculada com os preços do `.env`; ajuste-os conforme o modelo utilizado. Quando a consulta da organização funciona, o sistema usa o custo retornado por ela.

`MAX_DAILY_CALLS` limita as tentativas feitas por este backend, incluindo falhas. Esse limite não controla gastos ou chamadas de outras aplicações. O histórico local contém trechos de respostas e fica em `data/events.jsonl`.

## Segurança e GitHub

As configurações reais ficam em `.env` e `firmware/secrets.h`, ignorados pelo Git. Publique apenas os arquivos de exemplo com valores fictícios.

O `.gitignore` também exclui `data/`, logs, `node_modules/` e `.pio/`. O firmware compilado contém as credenciais Wi-Fi e deve permanecer local.

Confira os arquivos antes do commit. O `.gitignore` não protege uploads manuais nem remove arquivos já rastreados. Se uma credencial já foi publicada, revogue-a e substitua-a.

O servidor não possui autenticação e aceita conexões da rede local. Execute-o em uma rede de confiança e mantenha a porta sem exposição à internet.

## Estrutura

| Arquivo ou pasta | Função |
| --- | --- |
| `server.js` | Backend, métricas e integração com a API. |
| `public/` | Dashboard HTML, CSS e JavaScript. |
| `firmware/llm_control_oled.ino` | Firmware do ESP32. |
| `firmware/secrets.example.h` | Exemplo de configuração da placa. |
| `platformio.ini` | Configuração de compilação e upload. |
| `.env.example` | Exemplo de configuração do backend. |
| `data/events.jsonl` | Histórico local criado automaticamente. |

## Endpoints

| Método e rota | Função |
| --- | --- |
| `GET /api/health` | Estado do backend. |
| `GET /api/metrics` | Métricas e eventos locais. |
| `GET /api/org-usage` | Consumo da organização, com chave administrativa. |
| `GET /api/oled` | Dados simplificados para o display. |
| `POST /api/ask` | Envia um prompt no formato `{ "prompt": "Sua pergunta" }`. |

## Problemas comuns

| Sintoma | O que verificar |
| --- | --- |
| `NO KEY` ou `SEM CHAVE` | Configure `OPENAI_API_KEY` no `.env` e reinicie o servidor. |
| Consumo global indisponível | Confira `OPENAI_ADMIN_KEY` e suas permissões; o sistema usa dados locais como alternativa. |
| `WIFI OFFLINE` | Confira credenciais, rede de 2,4 GHz e alimentação. |
| `BACKEND OFF` | Confira IP do PC, porta, servidor em execução e firewall. Teste a URL do OLED em outro dispositivo da mesma rede. |
| OLED apagado | Revise os fios e o endereço I2C; alguns módulos usam `0x3D`. |
| Porta COM ocupada ou acesso negado | Feche monitores seriais e outros programas que usam a placa; reconecte o USB. |
| Erro `429` | Verifique o limite diário local e a mensagem retornada pela API. |
| Modelo indisponível | Ajuste `OPENAI_MODEL` para um modelo disponível na sua conta. |
