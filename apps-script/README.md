# Integração com a planilha de respostas

O formulário de solicitação de demandas grava cada envio na planilha
**planilha_com_respostas_formulário**, que espelha a esteira de design da Área de
Produto no ClickUp.

- Planilha: https://docs.google.com/spreadsheets/d/1dBvXUrNmi11ZwYKdUWtBfgTsfNcvVpTuHLNeesArvAs/edit
- Lista no ClickUp: `Área de Produto` › `🧑‍🎨 Design |  Esteira` (`list_id 901112432875`)

## Como publicar o Apps Script

1. Abra a planilha e vá em **Extensões › Apps Script**.
2. Cole o conteúdo de [`esteira-design.gs`](./esteira-design.gs) por cima do
   `Código.gs` e salve.
3. **Implantar › Nova implantação › App da Web**, com:
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
4. Copie a URL gerada (termina em `/exec`).
5. Em `index.htm`, substitua o placeholder:

   ```js
   const GOOGLE_SHEET_REQUEST_URL = 'SUA_URL_DO_WEB_APP_AQUI';
   ```

Ao alterar o script depois, crie uma **nova versão da implantação** — a URL só
passa a servir o código novo a partir disso.

> O acesso precisa ser **Qualquer pessoa**. É isso que faz a resposta do script
> vir com CORS liberado, e é dela que o formulário depende para confirmar a
> gravação.

## Conferindo antes de publicar

No editor do Apps Script, rode a função **`testarLigacao`**. Ela grava uma linha de
teste, registra no log a aba, a lista de colunas e o número da linha gravada, e em
seguida apaga a linha. O resultado aparece em **Execuções**.

Se essa função rodar sem erro, a ligação entre script e planilha está de pé.

## Como o formulário garante a gravação

O envio **não** usa `mode: 'no-cors'`. O formulário lê a resposta do script e só
mostra a tela de sucesso quando recebe `{ ok: true, linha: N }` — e exibe esse
número de linha na confirmação, para que dê para conferir na planilha.

Quando algo dá errado:

1. **Três tentativas** com espera crescente (1,5s, 3s), para absorver oscilação de rede.
2. Se todas falharem, a tela de sucesso **não** aparece. O erro é mostrado com o
   motivo devolvido pelo script.
3. A solicitação fica guardada no navegador (`localStorage`). Ao reabrir a página,
   um aviso mostra qual demanda não chegou e oferece copiar o resumo.

Os anexos não entram nesse rascunho de segurança — em base64 estouram a cota do
`localStorage` —, então o resumo guardado lista apenas os nomes dos arquivos.

Enquanto o `GOOGLE_SHEET_REQUEST_URL` estiver com o placeholder, o formulário
recusa o envio com uma mensagem explícita, em vez de fingir sucesso.

## Como o mapeamento funciona

O formulário envia cada campo usando como chave o **nome exato da coluna**. O
script lê a linha de cabeçalho e encaixa cada valor na coluna de mesmo nome, sem
depender da ordem. Se você reordenar colunas na planilha, nada quebra.

### Colunas que já existem na planilha

| Coluna | Origem no formulário |
| --- | --- |
| `Task Name` | Nome da demanda |
| `Status` | fixo: `aguardando` |
| `Priority` | Prioridade (ver abaixo) |
| `Date Created` | data e hora do envio |
| `Created By` | Quem é você? |
| `Space` | fixo: `Área de Produto` |
| `Folder` | fixo: `hidden` |
| `List` | fixo: `🧑‍🎨 Design \|  Esteira` |
| `0️⃣ Produto (drop down)` | Produto |
| `Data de entrega (date)` | Data de entrega |
| `Justificativa da prioridade (text)` | Justificativa de urgência |
| `O uso será interno ou externo? (drop down)` | O uso será interno ou externo? |
| `Qual a área a que se refere? (drop down)` | Qual a área a que se refere? |
| `Qual o objetivo da demanda, para o que será usada? (text)` | Objetivo da demanda |

As colunas `Assignee`, `Tasks com interface (tasks)`, `Tipagem da Tarefa (drop down)`,
`URL (url)` e `🗓️ Alinhamento Realizado (labels)` existem na planilha mas não são
coletadas pelo formulário, então chegam vazias. As de triagem são preenchidas
manualmente no ClickUp; os links de referência passaram a ser colados dentro da
descrição da demanda.

### Colunas criadas pelo script

Na primeira solicitação recebida, o script acrescenta à direita as colunas que o
formulário envia e a planilha ainda não tem:

`Task Content`, `Tipo de Demanda`, `SLA`, `Status do SLA` e `Anexos`.

Para desligar esse comportamento, mude `CRIAR_COLUNAS_FALTANTES` para `false` no
script — nesse caso, campos sem coluna correspondente são descartados.

### Anexos

Os arquivos anexados na descrição viajam em base64 dentro do campo `anexosJson`,
que é consumido pelo script e **não** vira coluna. Cada arquivo é gravado numa pasta
do Drive chamada `Anexos | Solicitações de Design`, criada na primeira execução, e a
coluna `Anexos` recebe os links, um por linha.

Se a gravação no Drive falhar, a coluna mantém os nomes dos arquivos enviados, para
que a solicitação não chegue sem indício de que havia anexos.

Limites aplicados no formulário: 10 MB por arquivo e 20 MB no total. O base64 infla
o tamanho em cerca de 33%, então o teto real do POST fica em torno de 27 MB.

### Prioridade e SLA

A prioridade não é escolhida no escuro: ela é derivada da comparação entre a data
de entrega pedida e o SLA do tipo de demanda.

| Checagem de SLA | Prioridade | `Priority` na planilha |
| --- | --- | --- |
| Dentro do SLA | Normal | `NORMAL` |
| No limite do SLA | Alta | `HIGH` |
| Abaixo do SLA | Urgente | `URGENT` |

Quem solicita pode sobrescrever a sugestão nos três botões. Nesse caso — e sempre
que a prioridade for Urgente ou a data furar o SLA — a justificativa de urgência
passa a ser obrigatória e vai para `Justificativa da prioridade (text)`.
