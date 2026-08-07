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

## Como o mapeamento funciona

O formulário envia cada campo usando como chave o **nome exato da coluna**. O
script lê a linha de cabeçalho e encaixa cada valor na coluna de mesmo nome, sem
depender da ordem. Se você reordenar colunas na planilha, nada quebra.

### Colunas que já existem na planilha

| Coluna | Origem no formulário |
| --- | --- |
| `Task Name` | Task Name |
| `Status` | fixo: `aguardando` |
| `Assignee` | Designer sugerido |
| `Priority` | derivado da priorização (ver abaixo) |
| `Date Created` | data e hora do envio |
| `Created By` | Quem é você? |
| `Space` | fixo: `Área de Produto` |
| `Folder` | fixo: `hidden` |
| `List` | fixo: `🧑‍🎨 Design \|  Esteira` |
| `0️⃣ Produto (drop down)` | 0️⃣ Produto |
| `Data de entrega (date)` | Data de entrega |
| `Justificativa da prioridade (text)` | Justificativa da prioridade |
| `O uso será interno ou externo? (drop down)` | O uso será interno ou externo? |
| `Qual a área a que se refere? (drop down)` | Qual a área a que se refere? |
| `Qual o objetivo da demanda, para o que será usada? (text)` | Objetivo da demanda |
| `Tipagem da Tarefa (drop down)` | Tipagem da Tarefa |
| `URL (url)` | URL |
| `🗓️ Alinhamento Realizado (labels)` | 🗓️ Alinhamento Realizado |

A coluna `Tasks com interface (tasks)` existe na planilha mas não é coletada pelo
formulário, então fica vazia.

### Colunas criadas pelo script

Na primeira solicitação recebida, o script acrescenta à direita as colunas que o
formulário envia e a planilha ainda não tem:

`Task Content`, `Tipo de Demanda`, `SLA`, `Status do SLA`,
`1️⃣ Trimestre (drop down)`, `2️⃣ Subárea (drop down)`, `6️⃣ Priorização (drop down)`.

Para desligar esse comportamento, mude `CRIAR_COLUNAS_FALTANTES` para `false` no
script — nesse caso, campos sem coluna correspondente são descartados.

### Priority

A planilha guarda a prioridade nativa do ClickUp, derivada da priorização
escolhida no formulário:

| 6️⃣ Priorização | Priority |
| --- | --- |
| Entrega no dia da solicitação | `URGENT` |
| Now/Agora | `HIGH` |
| Next/Depois | `NORMAL` |
| Later/Mais Tarde | `LOW` |
| Backlog | `LOW` |
