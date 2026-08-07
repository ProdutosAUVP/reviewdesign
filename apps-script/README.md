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
4. Copie a URL gerada em **Implantar › Gerenciar implantações** — ela termina em
   `/exec`. Não use a que aparece na barra do navegador ao abrir a implantação:
   aquela é o destino do redirecionamento (`script.googleusercontent.com/…/echo`),
   com uma chave temporária que expira.
5. Cole a URL em `GOOGLE_SHEET_REQUEST_URL`, no `index.htm`.

A implantação em uso é a de `auvp.com.br`, já configurada no `index.htm`.

Ao alterar o script depois, crie uma **nova versão da implantação** — a URL só
passa a servir o código novo a partir disso.

> O acesso precisa ser **Qualquer pessoa**, e não *"Qualquer pessoa na AUVP"*. A
> página é servida pelo GitHub Pages e requisições entre domínios não levam o
> cookie de login do Google — com a opção restrita ao domínio, o script responde
> com a tela de login em HTML, e tanto a gravação quanto a confirmação falham,
> mesmo para quem está logado na conta da empresa.
>
> Como a URL fica no código da página, que é pública, quem a descobrir consegue
> inserir linhas na planilha — mesma exposição de um Google Forms aberto. O
> endpoint grava e consulta pelo identificador do envio: não lista dados de
> terceiros nem apaga nada.

## Conferindo antes de publicar

No editor do Apps Script, rode a função **`testarLigacao`**. Ela grava uma linha de
teste, registra no log a aba, a lista de colunas e o número da linha gravada, e em
seguida apaga a linha. O resultado aparece em **Execuções**.

Se essa função rodar sem erro, a ligação entre script e planilha está de pé.

## Como o formulário garante a gravação

Gravar e confirmar seguem caminhos diferentes, e **nenhum dos dois depende de
CORS** — foi o CORS que derrubou a primeira tentativa de integração, com um
`Failed to fetch` no navegador.

1. **Gravação** — `POST` com `mode: 'no-cors'`. O navegador não deixa ler a
   resposta, mas a requisição sai, e é isso que importa para gravar.
2. **Confirmação** — o formulário gera um `ID do Envio` único, manda junto com os
   dados, e depois consulta o endpoint por **JSONP** (`?envioId=…&callback=…`)
   procurando esse identificador na planilha. Uma tag `<script>` não passa por
   CORS, então funciona onde o `fetch` é bloqueado.

A tela de sucesso só aparece quando a consulta encontra a linha — e é o número
dela que aparece na confirmação, para dar para conferir na planilha.

A consulta é repetida até encontrar: 6 tentativas a cada 2,5s sem anexos, e 10 a
cada 4s com anexos, já que aí cada arquivo é gravado no Drive antes da linha.

Se nada for encontrado nesse intervalo, a tela de sucesso **não** aparece: o erro
é mostrado e a solicitação fica guardada no navegador (`localStorage`). Ao reabrir
a página, um aviso mostra qual demanda não chegou e oferece copiar o resumo.

Os anexos não entram nesse rascunho de segurança — em base64 estouram a cota do
`localStorage` —, então o resumo guardado lista apenas os nomes dos arquivos.

Enquanto o `GOOGLE_SHEET_REQUEST_URL` estiver com o placeholder, o formulário
recusa o envio com uma mensagem explícita, em vez de fingir sucesso.

### Diagnóstico rápido

Abra numa **janela anônima**:

```
<URL /exec>?envioId=teste
```

- Devolveu `{"ok":false}` → endpoint público e respondendo. Tudo certo.
- Caiu numa tela de login → o acesso da implantação está restrito ao domínio.
  Corrija em **Gerenciar implantações** e salve como nova versão.

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

`ID do Envio`, `Task Content`, `Tipo de Demanda`, `SLA`, `Status do SLA` e `Anexos`.

A coluna `ID do Envio` é a que sustenta a confirmação — não a apague nem a renomeie.

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
