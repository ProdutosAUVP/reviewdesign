# Integração com a planilha de respostas

O formulário de solicitação de demandas grava cada envio na planilha
**planilha_com_respostas_formulário**, que espelha a esteira de design da Área de
Produto no ClickUp.

- Planilha: https://docs.google.com/spreadsheets/d/1dBvXUrNmi11ZwYKdUWtBfgTsfNcvVpTuHLNeesArvAs/edit
- Lista no ClickUp: `Área de Produto` › `🧑‍🎨 Design |  Esteira` (`list_id 901112432875`)

## Os três formulários da página

O `index.htm` reúne os formulários do time de design. Cada um escreve na sua
própria planilha, por um Apps Script próprio — mexer em um não afeta os outros.
Os scripts deste diretório são **apenas os da solicitação de demandas**.

| Seção | Endereço | Constante no `index.htm` | Coberto por este diretório |
| --- | --- | --- | --- |
| Solicitação de demandas | `#solicitacao` | `GOOGLE_SHEET_REQUEST_URL` | Sim |
| Avaliação de entregas (satisfação) | `#avaliacao` | `GOOGLE_SHEET_URL` | Não |
| Autoavaliação de design (checklist) | `#autoavaliacao` | `QA_SHEET_URL`, dentro do módulo `QA` | Não |

Os resultados dos dois últimos aparecem em `#metricas`, atrás da mesma senha, em
abas separadas: **Satisfação** (médias, gráficos e histórico) e **Autoavaliações**
(checklists enviados). A autoavaliação vivia no repositório `q-a-design`, que hoje
só redireciona para cá.

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

1. **Gravação** — `POST` com `mode: 'no-cors'`, corpo em
   `application/x-www-form-urlencoded` (`URLSearchParams`, não `FormData`): é o
   formato que o Apps Script preenche em `e.parameter` de maneira confiável.
   Leva só os campos do formulário, em torno de 3 KB. Os arquivos sobem depois,
   em requisições próprias.
2. **Confirmação** — o formulário gera um `ID do Envio` único, manda junto com os
   dados, e depois consulta o endpoint por **JSONP** (`?envioId=…&callback=…`)
   procurando esse identificador na planilha. Uma tag `<script>` não passa por
   CORS, então funciona onde o `fetch` é bloqueado.

A tela de sucesso aparece assim que o POST sai — em torno de 0,1s. A conferência
roda **em segundo plano**, sem prender quem está usando, e atualiza a linha de
confirmação quando termina:

| Estado | O que aparece na tela de sucesso |
| --- | --- |
| Enviando | *Enviando seus dados… prometemos não deixar cair nada no caminho.* |
| Com anexos | *Enviando os anexos (1 de 2)…* › *Guardando os anexos…* |
| Deu certo | *Tudo certo! Seus dados foram salvos.* |
| Não confirmou | *Não conseguimos confirmar se seus dados foram salvos.* |

São 4 tentativas a cada 1,5s. Um envio normal confirma na primeira ou na segunda.

### Segundo caminho de gravação

Se em 6 segundos a linha não aparecer, o formulário grava de novo **por JSONP**,
com os campos na própria URL (`?acao=gravar&…`). Parâmetros de URL sempre chegam
em `e.parameter`, então esse caminho não depende de como o corpo do POST é
interpretado — e a resposta é legível, então um erro do lado do Google aparece
na tela em vez de virar silêncio.

A gravação é **idempotente pelo `ID do Envio`**: se a linha já existe, o script
devolve a existente em vez de duplicar. É isso que torna seguro tentar os dois
caminhos.

Limite: URLs acima de 7.000 caracteres são recusadas antes de sair, com aviso.
Anexos não usam esse caminho — continuam apenas por POST.

O único caso que segura o usuário no formulário é o `fetch` estourar de verdade —
aí a solicitação não saiu, o erro é mostrado e ela fica guardada no navegador
(`localStorage`). Ao reabrir a página, um aviso mostra qual demanda não chegou e
oferece copiar o resumo.

Quando o envio sai mas a conferência não encontra, **nada é guardado como
pendente**: reenviar criaria uma linha duplicada. O aviso na tela pede para
conferir na planilha, e o resumo continua copiável.

Os anexos não entram nesse rascunho de segurança — em base64 estouram a cota do
`localStorage` —, então o resumo guardado lista apenas os nomes dos arquivos.

Enquanto o `GOOGLE_SHEET_REQUEST_URL` estiver com o placeholder, o formulário
recusa o envio com uma mensagem explícita, em vez de fingir sucesso.

### Diagnóstico rápido

Abra numa **janela anônima**:

```
<URL /exec>?diagnostico=1
```

A resposta diz exatamente o que o script enxerga:

```json
{ "ok": true, "versao": "2026-08-07-c", "aba": "...", "totalColunas": 19,
  "totalLinhas": 2, "temColunaEnvioId": false, "temColunaAnexos": false }
```

| O que aparece | O que significa |
| --- | --- |
| `versao` igual à do `esteira-design.gs` | implantação atualizada |
| `versao` diferente ou ausente | **falta republicar** como nova versão |
| tela de login | acesso da implantação restrito ao domínio |
| erro de permissão | `Executar como` não está em **Eu** |

O campo `versao` está no topo do `esteira-design.gs`, na constante `VERSAO`.

## Da planilha para o ClickUp

O arquivo [`clickup-esteira.gs`](./clickup-esteira.gs) é o segundo do mesmo
projeto do Apps Script. Ele percorre a planilha, cria a tarefa no ClickUp via
API e escreve o ID e a URL da tarefa de volta na linha.

Uma linha que já tem `ID da Tarefa` nunca é reenviada, então rodar a
sincronização de novo é seguro: só o que falta é tentado.

### Passo a passo

**1. Pegue o seu token pessoal do ClickUp**

No ClickUp: foto do perfil (canto inferior esquerdo) › **Settings** › **Apps** ›
em *API Token*, clique em **Generate**. O token começa com `pk_`.

Ele age em seu nome: as tarefas aparecem como criadas por você, e o token
alcança tudo que a sua conta alcança. Trate como senha.

**2. Cole o script no mesmo projeto**

No editor do Apps Script da planilha, **+ › Script** e nomeie
`clickup-esteira`. Cole o conteúdo do arquivo e salve.

São dois arquivos no mesmo projeto de propósito — `clickup-esteira.gs`
reaproveita `getSheet_()` e `getCabecalhos_()` do `esteira-design.gs`.

**3. Guarde o token**

Em `configurarClickUp()`, troque `pk_COLE_SEU_TOKEN_AQUI` pelo seu token, rode a
função uma vez, **apague o token do código** e salve.

O token vai para as Propriedades do Script. Ele nunca pode ficar no código: este
repositório é público.

**4. Confira antes de criar qualquer coisa**

Rode **`testarClickUp()`**. Ela não cria nada — só lê. O log em **Execuções**
mostra:

```
Conexão com o ClickUp funcionando.
Campos encontrados na lista (18): 0️⃣ Produto | Qual a área... | ...
0️⃣ Produto (drop down) → ok
Qual a área a que se refere? (drop down) → ok
...
Linhas aguardando sincronização: 3
```

Qualquer `CAMPO NÃO ENCONTRADO` aponta um campo renomeado no ClickUp — ajuste o
nome em `CLICKUP_CAMPOS`.

**5. Rode a primeira sincronização**

Rode **`sincronizarComClickUp()`**. Confira as tarefas criadas na esteira e as
colunas novas na planilha: `ID da Tarefa`, `URL da Tarefa`, `Sincronizado em` e
`Erro da Sincronização`.

Sugestão: teste primeiro com uma linha só. Preencha `ID da Tarefa` das demais
com qualquer texto para elas serem ignoradas, rode, confira o resultado e depois
limpe o que você preencheu.

**6. Deixe rodando sozinho**

Rode **`criarGatilhoDeSincronizacao()`** uma vez. Ela instala um gatilho de
minuto em minuto e remove o anterior, então rodar de novo não duplica.

Quem já instalou o gatilho antigo, de 5 em 5 minutos, precisa **rodar a função de
novo** para passar a 1 minuto — mudar o código não mexe em gatilho já criado.

Rodar a cada minuto não pesa: quando não há nada na fila, a execução sai antes de
falar com o ClickUp, então a rodada vazia custa só a leitura da planilha.

### O que vai para cada lugar

| Na planilha | Na tarefa do ClickUp |
| --- | --- |
| `Task Name` | Nome |
| `Status` | Status (nasce em `aguardando`) |
| `Priority` | Prioridade — `URGENT`→1, `HIGH`→2, `NORMAL`→3, `LOW`→4 |
| `Assignee` | Responsáveis pela tarefa |
| `Data de entrega (date)` | Data de entrega, nos campos nativo e personalizado |
| `0️⃣ Produto`, `Qual a área...`, `O uso será...` | Campos personalizados de seleção |
| `Qual o objetivo...`, `Justificativa da prioridade` | Campos personalizados de texto |
| `Task Content` + objetivo + solicitante + SLA + anexos | Descrição |

Os IDs dos campos, das opções e das pessoas **não** ficam no código: são
resolvidos pelo nome a cada execução, lendo `GET /list/{id}/field` e
`GET /list/{id}/member`. Incluir um produto novo no ClickUp, ou trocar quem está
no time, passa a funcionar sozinho, sem mexer no script.

**A coluna `Assignee`** aceita um ou mais nomes separados por vírgula, escritos
como o ClickUp os mostra (`Éria Cunha de Alencar, Armando Custodio Neto`) — o
e-mail também serve. É o formulário que a preenche: a demanda nasce atribuída aos
dois designers, e quem solicita pode direcioná-la a um deles. Colchetes em volta,
como nas linhas exportadas do próprio ClickUp, são ignorados.

Um nome que não bate com nenhum membro da lista **não impede a criação**: a tarefa
nasce sem aquele responsável e o log de Execuções diz qual nome ficou de fora.
Perder a atribuição custa menos do que barrar a demanda inteira. O
`testarClickUp()` lista os membros que a lista reconhece, para conferir a grafia
antes de qualquer envio.

### Pontos de atenção

**Tipagem da Tarefa** é obrigatória no ClickUp, mas saiu do formulário por ser
preenchida na triagem. A criação por API não é barrada por isso — a tarefa nasce
com o campo vazio, para o time preencher.

**Limite da API**: 100 requisições por minuto. O gatilho roda de minuto em minuto
e cada execução cria no máximo 25 tarefas (`CLICKUP_MAX_POR_EXECUCAO`), então o
pior caso de uma rodada são 26 requisições — a leitura dos campos mais as
criações.

**Quando uma linha falha**, o motivo vai para `Erro da Sincronização` e a linha
continua na fila. Corrigido o problema, a próxima execução tenta de novo — não é
preciso limpar nada.

**Quando a execução inteira falha** — token expirado, limite de requisições
estourado, ClickUp fora do ar —, o motivo é carimbado em `Erro da Sincronização`
de todas as linhas da fila, e não só no log de Execuções. Sem isso a fila pararia
em silêncio: a planilha mostraria linhas sem tarefa, sem dizer por quê. As linhas
seguem na fila e a coluna é limpa sozinha quando a tarefa for criada.

**Anexos** entram como links do Drive na descrição, não como arquivos anexados à
tarefa. Os arquivos já estão no Drive; duplicá-los no ClickUp só ocuparia espaço
nos dois lugares.

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

Os arquivos **não** viajam junto com a solicitação. Mandar tudo numa requisição só
deixava o envio lento e arriscava estourar o limite do Apps Script: um PNG de 2 MB
levava a requisição de 3 KB para 2,6 MB.

A sequência passou a ser:

1. A solicitação é gravada primeiro, levando apenas os **nomes** dos arquivos na
   coluna `Anexos`.
2. Confirmada a linha, cada arquivo sobe numa requisição própria
   (`acao=anexo`, com o `envioId` para achar a linha).
3. O script grava o arquivo na pasta do Drive `Anexos | Solicitações de Design` e
   **acrescenta** o link à célula de anexos daquela linha. O primeiro link
   substitui os nomes; os seguintes entram abaixo.
4. O formulário confere se a quantidade de links bateu com a de arquivos.

Vantagens: a solicitação nunca fica presa por causa de um arquivo grande, a falha
de um anexo não derruba os outros nem a linha, e o progresso aparece arquivo a
arquivo na tela de sucesso.

Limites aplicados no formulário: 10 MB por arquivo e 20 MB no total. O base64 infla
o tamanho em cerca de 33%, então cada requisição de anexo chega a ~13 MB no pior
caso — bem abaixo do que um envio único com todos os arquivos alcançaria.

### Prioridade e SLA

A prioridade não é escolhida no escuro: ela é derivada da comparação entre a data
de entrega pedida e o SLA do tipo de demanda.

A data pedida cai em um de três estados, gravados na coluna `Status do SLA`:

| `Status do SLA` | Quando | Prioridade | `Priority` |
| --- | --- | --- | --- |
| Acima do SLA | data além do prazo máximo | Normal | `NORMAL` |
| Dentro do SLA | data entre o mínimo e o máximo | Alta | `HIGH` |
| Abaixo do SLA | data aquém do prazo mínimo | Urgente | `URGENT` |

Quem solicita pode sobrescrever a sugestão nos três botões. Nesse caso — e sempre
que a prioridade for Urgente ou a data ficar abaixo do SLA — a justificativa de
urgência passa a ser obrigatória e vai para `Justificativa da prioridade (text)`.

Todos os campos do formulário são obrigatórios, com exceção dos anexos.
