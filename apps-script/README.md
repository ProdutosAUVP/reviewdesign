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
| `Priority` | Prioridade (ver abaixo) |
| `Date Created` | data e hora do envio |
| `Created By` | Quem é você? |
| `Space` | fixo: `Área de Produto` |
| `Folder` | fixo: `hidden` |
| `List` | fixo: `🧑‍🎨 Design \|  Esteira` |
| `0️⃣ Produto (drop down)` | 0️⃣ Produto |
| `Data de entrega (date)` | Data de entrega |
| `Justificativa da prioridade (text)` | Justificativa de urgência |
| `O uso será interno ou externo? (drop down)` | O uso será interno ou externo? |
| `Qual a área a que se refere? (drop down)` | Qual a área a que se refere? |
| `Qual o objetivo da demanda, para o que será usada? (text)` | Objetivo da demanda |
| `URL (url)` | URL |

As colunas `Tasks com interface (tasks)`, `Tipagem da Tarefa (drop down)` e
`🗓️ Alinhamento Realizado (labels)` existem na planilha mas não são coletadas pelo
formulário — são preenchidas manualmente no ClickUp, na triagem da demanda —,
então chegam vazias.

### Colunas criadas pelo script

Na primeira solicitação recebida, o script acrescenta à direita as colunas que o
formulário envia e a planilha ainda não tem:

`Task Content`, `Tipo de Demanda`, `SLA` e `Status do SLA`.

Para desligar esse comportamento, mude `CRIAR_COLUNAS_FALTANTES` para `false` no
script — nesse caso, campos sem coluna correspondente são descartados.

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
