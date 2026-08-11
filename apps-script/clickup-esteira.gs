/**
 * Leva as solicitações gravadas na planilha para a esteira de design no ClickUp.
 *
 * Este arquivo é o segundo do mesmo projeto do Apps Script — o primeiro
 * (esteira-design.gs) recebe o formulário e grava as linhas. Aqui as linhas
 * viram tarefas.
 *
 * Como funciona:
 *   1. Percorre a planilha procurando linhas sem "ID da Tarefa".
 *   2. Cria a tarefa no ClickUp via API.
 *   3. Escreve de volta o ID e a URL da tarefa na própria linha.
 *
 * Uma linha já sincronizada nunca é reenviada, então rodar de novo é seguro:
 * o que já foi some da fila e só o que falta é tentado.
 *
 * O token da API fica nas Propriedades do Script, nunca no código — este
 * arquivo vive num repositório público.
 *
 * Para guardar o token, use o próprio editor, sem mexer em código:
 *   Configurações do projeto › Propriedades do script › Adicionar propriedade
 *   Nome: CLICKUP_TOKEN
 *   Valor: o token que começa com pk_
 *
 * Depois rode `verificarToken()` para confirmar que ficou salvo.
 */

// Lista de destino: Área de Produto › 🧑‍🎨 Design |  Esteira
var CLICKUP_LIST_ID = '901112432875';

// Status em que a tarefa nasce na esteira.
var CLICKUP_STATUS_INICIAL = 'aguardando';

// Quantas tarefas criar por execução. A API do ClickUp aceita 100 requisições
// por minuto; este teto deixa folga com sobra.
var CLICKUP_MAX_POR_EXECUCAO = 25;

// Colunas de controle da sincronização, criadas na planilha se não existirem.
var COLUNA_TAREFA_ID = 'ID da Tarefa';
var COLUNA_TAREFA_URL = 'URL da Tarefa';
var COLUNA_SINCRONIZADO = 'Sincronizado em';
var COLUNA_ERRO_SYNC = 'Erro da Sincronização';

// Prioridade da planilha para o número que a API espera.
var CLICKUP_PRIORIDADES = { URGENT: 1, HIGH: 2, NORMAL: 3, LOW: 4 };

/**
 * De/para entre a coluna da planilha e o campo personalizado no ClickUp.
 * Os IDs não são fixados aqui de propósito: são resolvidos pelo nome a cada
 * execução, então incluir uma opção nova no ClickUp passa a funcionar sozinho.
 */
var CLICKUP_CAMPOS = [
  { coluna: '0️⃣ Produto (drop down)', campo: '0️⃣ Produto', tipo: 'opcao' },
  { coluna: 'Qual a área a que se refere? (drop down)', campo: 'Qual a área a que se refere?', tipo: 'opcao' },
  { coluna: 'O uso será interno ou externo? (drop down)', campo: 'O uso será interno ou externo?', tipo: 'opcao' },
  { coluna: 'Qual o objetivo da demanda, para o que será usada? (text)', campo: 'Qual o objetivo da demanda, para o que será usada?', tipo: 'texto' },
  { coluna: 'Justificativa da prioridade (text)', campo: 'Justificativa da prioridade', tipo: 'texto' },
  { coluna: 'Data de entrega (date)', campo: 'Data de entrega', tipo: 'data' }
];

// ==========================================================================
// USO
// ==========================================================================

/**
 * Confirma que o token foi guardado, sem expor o valor no log.
 *
 * O token é cadastrado pelo editor, em Configurações do projeto › Propriedades
 * do script, com o nome CLICKUP_TOKEN. Não passa por aqui e não entra no código:
 * assim não há como colá-lo fora das aspas, e ele não vaza em captura de tela.
 */
function verificarToken() {
  var token = PropertiesService.getScriptProperties().getProperty('CLICKUP_TOKEN');

  if (!token) {
    Logger.log('Token não encontrado.');
    Logger.log('Cadastre em: Configurações do projeto › Propriedades do script › Adicionar propriedade.');
    Logger.log('Nome: CLICKUP_TOKEN | Valor: o token que começa com pk_');
    return;
  }

  if (token.indexOf('pk_') !== 0) {
    Logger.log('Há um valor em CLICKUP_TOKEN, mas ele não começa com "pk_". Confira se colou o token certo.');
    return;
  }

  Logger.log('Token guardado: %s...%s (%s caracteres). Pode rodar testarClickUp().',
    token.slice(0, 7), token.slice(-4), token.length);
}

/**
 * Confere se o token funciona e se a lista está acessível, sem criar nada.
 */
function testarClickUp() {
  if (!PropertiesService.getScriptProperties().getProperty('CLICKUP_TOKEN')) {
    Logger.log('Token não configurado. Rode verificarToken() para ver como cadastrar.');
    return;
  }

  var campos = getCamposClickUp_();
  var nomes = Object.keys(campos);

  Logger.log('Conexão com o ClickUp funcionando.');
  Logger.log('Campos encontrados na lista (%s): %s', nomes.length, nomes.join(' | '));

  CLICKUP_CAMPOS.forEach(function (mapa) {
    Logger.log('%s → %s', mapa.coluna, campos[mapa.campo] ? 'ok' : 'CAMPO NÃO ENCONTRADO');
  });

  var pendentes = contarPendentes_();
  Logger.log('Linhas aguardando sincronização: %s', pendentes);
}

/**
 * Cria no ClickUp as tarefas das linhas ainda não sincronizadas.
 * Pode ser chamada na mão ou por um gatilho de tempo.
 */
function sincronizarComClickUp() {
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);
  } catch (err) {
    Logger.log('Outra sincronização já está rodando. Saindo.');
    return;
  }

  try {
    var sheet = getSheet_();
    var cabecalhos = garantirColunasSync_(sheet);
    var valores = sheet.getDataRange().getValues();

    var idxTarefa = cabecalhos.indexOf(COLUNA_TAREFA_ID);
    var idxNome = cabecalhos.indexOf('Task Name');

    var campos = getCamposClickUp_();
    var criadas = 0;
    var falhas = 0;

    for (var i = 1; i < valores.length && criadas + falhas < CLICKUP_MAX_POR_EXECUCAO; i++) {
      var linha = valores[i];

      // Já sincronizada, ou linha sem título: não há o que fazer
      if (String(linha[idxTarefa] || '').trim()) continue;
      if (!String(linha[idxNome] || '').trim()) continue;

      var dados = linhaParaObjeto_(cabecalhos, linha);
      var resultado = criarTarefa_(dados, campos);

      if (resultado.ok) {
        registrarSucesso_(sheet, cabecalhos, i + 1, resultado);
        criadas++;
        Logger.log('Linha %s → tarefa %s', i + 1, resultado.id);
      } else {
        registrarErro_(sheet, cabecalhos, i + 1, resultado.error);
        falhas++;
        Logger.log('Linha %s falhou: %s', i + 1, resultado.error);
      }
    }

    SpreadsheetApp.flush();
    Logger.log('Sincronização concluída. Criadas: %s. Falhas: %s.', criadas, falhas);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Instala o gatilho que sincroniza sozinho a cada 5 minutos.
 * Rodar de novo não duplica: o gatilho antigo é removido antes.
 */
function criarGatilhoDeSincronizacao() {
  ScriptApp.getProjectTriggers().forEach(function (gatilho) {
    if (gatilho.getHandlerFunction() === 'sincronizarComClickUp') {
      ScriptApp.deleteTrigger(gatilho);
    }
  });

  ScriptApp.newTrigger('sincronizarComClickUp').timeBased().everyMinutes(5).create();
  Logger.log('Gatilho criado: sincronizarComClickUp a cada 5 minutos.');
}

// ==========================================================================
// CLICKUP
// ==========================================================================

function getTokenClickUp_() {
  var token = PropertiesService.getScriptProperties().getProperty('CLICKUP_TOKEN');

  if (!token) {
    throw new Error('Token do ClickUp não configurado. Cadastre CLICKUP_TOKEN em Configurações do projeto › Propriedades do script.');
  }

  return token;
}

function chamarClickUp_(url, opcoes) {
  var config = opcoes || {};
  config.headers = { Authorization: getTokenClickUp_() };
  config.muteHttpExceptions = true;

  if (config.payload) {
    config.contentType = 'application/json';
  }

  var resposta = UrlFetchApp.fetch(url, config);
  var codigo = resposta.getResponseCode();
  var corpo = resposta.getContentText();

  if (codigo < 200 || codigo >= 300) {
    throw new Error('ClickUp respondeu ' + codigo + ': ' + corpo.slice(0, 300));
  }

  return JSON.parse(corpo);
}

/**
 * Lê os campos personalizados da lista e devolve um índice por nome, já com as
 * opções mapeadas por rótulo. Resolver pelo nome a cada execução evita ter IDs
 * copiados no código, que envelhecem sem avisar.
 */
function getCamposClickUp_() {
  var dados = chamarClickUp_('https://api.clickup.com/api/v2/list/' + CLICKUP_LIST_ID + '/field');
  var indice = {};

  (dados.fields || []).forEach(function (campo) {
    var opcoes = {};

    var lista = (campo.type_config && campo.type_config.options) || [];
    lista.forEach(function (opcao) {
      var rotulo = opcao.name !== undefined ? opcao.name : opcao.label;
      if (rotulo) opcoes[String(rotulo).trim()] = opcao.id;
    });

    indice[campo.name] = { id: campo.id, tipo: campo.type, opcoes: opcoes };
  });

  return indice;
}

function criarTarefa_(dados, campos) {
  var corpo = {
    name: dados['Task Name'],
    description: montarDescricao_(dados),
    status: dados['Status'] || CLICKUP_STATUS_INICIAL
  };

  var prioridade = CLICKUP_PRIORIDADES[String(dados['Priority'] || '').toUpperCase()];
  if (prioridade) corpo.priority = prioridade;

  var entrega = paraTimestamp_(dados['Data de entrega (date)']);
  if (entrega) {
    corpo.due_date = entrega;
    corpo.due_date_time = false;
  }

  var personalizados = montarCamposPersonalizados_(dados, campos);
  if (personalizados.length) corpo.custom_fields = personalizados;

  try {
    var tarefa = chamarClickUp_(
      'https://api.clickup.com/api/v2/list/' + CLICKUP_LIST_ID + '/task',
      { method: 'post', payload: JSON.stringify(corpo) }
    );

    return { ok: true, id: tarefa.id, url: tarefa.url };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

function montarCamposPersonalizados_(dados, campos) {
  var saida = [];

  CLICKUP_CAMPOS.forEach(function (mapa) {
    var valor = String(dados[mapa.coluna] || '').trim();
    if (!valor) return;

    var campo = campos[mapa.campo];
    if (!campo) return;

    if (mapa.tipo === 'opcao') {
      var opcaoId = campo.opcoes[valor];
      if (opcaoId) saida.push({ id: campo.id, value: opcaoId });
      return;
    }

    if (mapa.tipo === 'data') {
      var ts = paraTimestamp_(valor);
      if (ts) saida.push({ id: campo.id, value: ts });
      return;
    }

    saida.push({ id: campo.id, value: valor });
  });

  return saida;
}

/**
 * A descrição reúne o que não cabe em campo próprio: o briefing, o objetivo, o
 * SLA acordado e os links dos anexos.
 */
function montarDescricao_(dados) {
  var partes = [];

  if (dados['Task Content']) partes.push(dados['Task Content']);

  var objetivo = dados['Qual o objetivo da demanda, para o que será usada? (text)'];
  if (objetivo) partes.push('', '**Objetivo:** ' + objetivo);

  var contexto = [];
  if (dados['Created By']) contexto.push('Solicitante: ' + dados['Created By']);
  if (dados['Tipo de Demanda']) contexto.push('Tipo de demanda: ' + dados['Tipo de Demanda']);
  if (dados['SLA']) contexto.push('SLA: ' + dados['SLA']);
  if (dados['Status do SLA']) contexto.push('Status do SLA: ' + dados['Status do SLA']);
  if (contexto.length) partes.push('', contexto.join('\n'));

  var anexos = String(dados['Anexos'] || '').trim();
  if (anexos.indexOf('http') === 0) {
    partes.push('', '**Anexos:**', anexos);
  }

  return partes.join('\n');
}

// ==========================================================================
// PLANILHA
// ==========================================================================

function garantirColunasSync_(sheet) {
  var cabecalhos = getCabecalhos_(sheet);
  var novas = [COLUNA_TAREFA_ID, COLUNA_TAREFA_URL, COLUNA_SINCRONIZADO, COLUNA_ERRO_SYNC]
    .filter(function (coluna) {
      return cabecalhos.indexOf(coluna) === -1;
    });

  if (novas.length === 0) return cabecalhos;

  var atualizados = cabecalhos.concat(novas);
  sheet.getRange(1, 1, 1, atualizados.length).setValues([atualizados]);

  return atualizados;
}

function linhaParaObjeto_(cabecalhos, linha) {
  var objeto = {};

  cabecalhos.forEach(function (coluna, i) {
    if (coluna) objeto[coluna] = linha[i];
  });

  return objeto;
}

function registrarSucesso_(sheet, cabecalhos, numeroLinha, resultado) {
  escreverCelula_(sheet, cabecalhos, numeroLinha, COLUNA_TAREFA_ID, resultado.id);
  escreverCelula_(sheet, cabecalhos, numeroLinha, COLUNA_TAREFA_URL, resultado.url);
  escreverCelula_(sheet, cabecalhos, numeroLinha, COLUNA_SINCRONIZADO, new Date());
  escreverCelula_(sheet, cabecalhos, numeroLinha, COLUNA_ERRO_SYNC, '');
}

function registrarErro_(sheet, cabecalhos, numeroLinha, erro) {
  escreverCelula_(sheet, cabecalhos, numeroLinha, COLUNA_ERRO_SYNC, erro);
}

function escreverCelula_(sheet, cabecalhos, numeroLinha, coluna, valor) {
  var i = cabecalhos.indexOf(coluna);
  if (i === -1) return;

  sheet.getRange(numeroLinha, i + 1).setValue(valor);
}

function contarPendentes_() {
  var sheet = getSheet_();
  var valores = sheet.getDataRange().getValues();
  if (valores.length < 2) return 0;

  var idxTarefa = valores[0].indexOf(COLUNA_TAREFA_ID);
  var idxNome = valores[0].indexOf('Task Name');
  if (idxNome === -1) return 0;

  return valores.slice(1).filter(function (linha) {
    var temNome = String(linha[idxNome] || '').trim() !== '';
    var jaFoi = idxTarefa !== -1 && String(linha[idxTarefa] || '').trim() !== '';
    return temNome && !jaFoi;
  }).length;
}

/**
 * A planilha guarda a data como texto (aaaa-mm-dd) ou como Date, dependendo de
 * como a célula foi formatada. A API espera milissegundos.
 */
function paraTimestamp_(valor) {
  if (!valor) return null;

  if (valor instanceof Date) return valor.getTime();

  var texto = String(valor).trim();
  if (!texto) return null;

  var iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12, 0, 0).getTime();
  }

  var br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) {
    return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]), 12, 0, 0).getTime();
  }

  var data = new Date(texto);
  return isNaN(data.getTime()) ? null : data.getTime();
}
