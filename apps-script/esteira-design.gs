/**
 * Recebe as solicitações do formulário de design e grava na planilha de respostas.
 *
 * Planilha de destino: planilha_com_respostas_formulário
 * https://docs.google.com/spreadsheets/d/1dBvXUrNmi11ZwYKdUWtBfgTsfNcvVpTuHLNeesArvAs/edit
 *
 * O formulário envia cada campo usando como chave o nome exato da coluna, então
 * este script não precisa traduzir nada: ele lê a linha de cabeçalho e encaixa
 * cada valor na coluna de mesmo nome. Colunas novas (Task Content, Tipo de
 * Demanda, SLA, etc.) são criadas à direita na primeira solicitação recebida.
 *
 * Como publicar:
 *   1. Abra a planilha > Extensões > Apps Script.
 *   2. Cole este arquivo por cima do conteúdo de Código.gs e salve.
 *   3. Implantar > Nova implantação > tipo "App da Web".
 *      - Executar como: Eu
 *      - Quem pode acessar: Qualquer pessoa
 *   4. Copie a URL gerada (termina em /exec) e cole em GOOGLE_SHEET_REQUEST_URL,
 *      no index.htm.
 *
 * Ao mudar o código, é preciso criar uma NOVA versão da implantação para que a
 * URL passe a servir o código atualizado.
 */

// Nome da aba que recebe as respostas. Deixe vazio para usar a primeira aba.
var ABA_RESPOSTAS = '';

// Cria automaticamente as colunas que o formulário envia e ainda não existem.
var CRIAR_COLUNAS_FALTANTES = true;

// Chaves de controle que não viram coluna na planilha.
var CHAVES_IGNORADAS = ['formType', 'acao', 'envioId', 'nomeArquivo', 'tipoArquivo', 'dadosArquivo'];

// Coluna onde os links dos anexos são acumulados.
var COLUNA_ANEXOS = 'Anexos';

// Pasta do Drive onde os anexos das solicitações são guardados.
var PASTA_ANEXOS = 'Anexos | Solicitações de Design';

// Coluna que guarda o identificador de cada envio. É por ela que o formulário
// confirma que a solicitação chegou.
var COLUNA_ENVIO_ID = 'ID do Envio';

// Aparece no diagnóstico. Serve para saber se a implantação em uso já está
// servindo esta versão do script.
var VERSAO = '2026-08-07-c';

function doPost(e) {
  var lock = LockService.getScriptLock();

  // A trava evita que dois envios simultâneos gravem na mesma linha. Se nem ela
  // puder ser obtida, o formulário precisa saber — por isso a resposta de erro.
  try {
    lock.waitLock(30000);
  } catch (err) {
    return resposta_({ ok: false, error: 'A planilha está ocupada. Tente novamente.' });
  }

  try {
    var sheet = getSheet_();
    var dados = lerParametros_(e);

    // Os anexos chegam depois da solicitação, um arquivo por requisição, e vão
    // sendo acrescentados à linha que já foi gravada.
    if (dados.acao === 'anexo') {
      return resposta_(anexarArquivo_(sheet, dados));
    }

    return resposta_(gravarSolicitacao_(sheet, dados));
  } catch (err) {
    return resposta_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Grava a solicitação. É idempotente pelo identificador do envio: se a linha já
 * existe, devolve a linha existente em vez de duplicar. Isso permite que o
 * formulário tente por mais de um caminho sem risco de gravar duas vezes.
 */
function gravarSolicitacao_(sheet, dados) {
  var envioId = dados[COLUNA_ENVIO_ID] || dados.envioId;

  if (envioId) {
    var jaExiste = localizarEnvio_(envioId);
    if (jaExiste.ok) return { ok: true, linha: jaExiste.linha, repetido: true };
  }

  var cabecalhos = getCabecalhos_(sheet);
  cabecalhos = garantirColunas_(sheet, cabecalhos, dados);

  var linha = cabecalhos.map(function (coluna) {
    return dados[coluna] !== undefined ? dados[coluna] : '';
  });

  sheet.appendRow(linha);
  SpreadsheetApp.flush();

  return { ok: true, linha: sheet.getLastRow() };
}

/**
 * Retrato do que o script enxerga, para conferir a publicação sem adivinhação.
 */
function diagnosticar_() {
  var sheet = getSheet_();
  var cabecalhos = getCabecalhos_(sheet);

  return {
    ok: true,
    versao: VERSAO,
    aba: sheet.getName(),
    colunas: cabecalhos,
    totalColunas: cabecalhos.length,
    totalLinhas: sheet.getLastRow(),
    temColunaEnvioId: cabecalhos.indexOf(COLUNA_ENVIO_ID) !== -1,
    temColunaAnexos: cabecalhos.indexOf(COLUNA_ANEXOS) !== -1
  };
}

/**
 * Lê os campos enviados, seja qual for o formato do corpo.
 *
 * O caminho normal é e.parameter, preenchido quando o corpo vem como
 * application/x-www-form-urlencoded. Se vier vazio — o que acontece com
 * multipart/form-data — o corpo cru é lido na mão, para que nenhuma
 * solicitação seja gravada em branco por causa do formato.
 */
function lerParametros_(e) {
  var dados = (e && e.parameter) ? e.parameter : {};

  if (Object.keys(dados).length > 0) return dados;
  if (!e || !e.postData || !e.postData.contents) return dados;

  var corpo = e.postData.contents;
  var tipo = e.postData.type || '';

  if (tipo.indexOf('multipart/form-data') !== -1) {
    return lerMultipart_(corpo, tipo);
  }

  return lerUrlEncoded_(corpo);
}

function lerUrlEncoded_(corpo) {
  var dados = {};

  corpo.split('&').forEach(function (par) {
    if (!par) return;
    var i = par.indexOf('=');
    var chave = i === -1 ? par : par.slice(0, i);
    var valor = i === -1 ? '' : par.slice(i + 1);

    try {
      dados[decodeURIComponent(chave.replace(/\+/g, ' '))] = decodeURIComponent(valor.replace(/\+/g, ' '));
    } catch (err) {
      // Um campo mal codificado não pode derrubar o restante da solicitação
    }
  });

  return dados;
}

function lerMultipart_(corpo, tipo) {
  var dados = {};
  var marca = tipo.split('boundary=')[1];
  if (!marca) return dados;

  corpo.split('--' + marca).forEach(function (parte) {
    var nome = parte.match(/name="([^"]*)"/);
    if (!nome) return;

    var corte = parte.indexOf('\r\n\r\n');
    if (corte === -1) return;

    dados[nome[1]] = parte.slice(corte + 4).replace(/\r\n$/, '');
  });

  return dados;
}

/**
 * Duas funções:
 *   - com ?envioId=... devolve a linha daquele envio, para o formulário confirmar
 *     que a solicitação chegou;
 *   - sem parâmetro, devolve todas as respostas registradas.
 *
 * Aceita ?callback=... e responde em JSONP. É assim que o formulário consulta:
 * uma tag <script> não passa por CORS, então funciona mesmo onde o fetch é
 * bloqueado pelo navegador.
 */
function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  var callback = params.callback;

  try {
    // Diagnóstico: diz qual versão está publicada e o que o script enxerga.
    if (params.diagnostico) {
      return resposta_(diagnosticar_(), callback);
    }

    // Caminho alternativo de gravação, para quando o POST não chega. Os campos
    // vêm na própria URL, que o Apps Script sempre entrega em e.parameter.
    if (params.acao === 'gravar') {
      return resposta_(gravarSolicitacao_(getSheet_(), params), callback);
    }

    if (params.envioId) {
      return resposta_(localizarEnvio_(params.envioId), callback);
    }

    var sheet = getSheet_();
    var valores = sheet.getDataRange().getValues();

    if (valores.length < 2) return resposta_([], callback);

    var cabecalhos = valores[0];
    var linhas = valores.slice(1)
      .filter(function (linha) {
        return linha.join('').trim() !== '';
      })
      .map(function (linha) {
        var item = {};
        cabecalhos.forEach(function (coluna, i) {
          if (coluna) item[coluna] = linha[i];
        });
        return item;
      });

    return resposta_(linhas, callback);
  } catch (err) {
    return resposta_({ ok: false, error: String(err) }, callback);
  }
}

/**
 * Procura, de baixo para cima, a linha gravada com o identificador informado.
 * A busca começa pelo fim porque o envio recém-chegado está entre os últimos.
 */
function localizarEnvio_(envioId) {
  var sheet = getSheet_();
  var valores = sheet.getDataRange().getValues();

  if (valores.length < 2) return { ok: false };

  var coluna = valores[0].indexOf(COLUNA_ENVIO_ID);
  if (coluna === -1) {
    return { ok: false, error: 'A planilha ainda não tem a coluna "' + COLUNA_ENVIO_ID + '".' };
  }

  var colunaAnexos = valores[0].indexOf(COLUNA_ANEXOS);

  for (var i = valores.length - 1; i >= 1; i--) {
    if (String(valores[i][coluna]).trim() === String(envioId).trim()) {
      return {
        ok: true,
        linha: i + 1,
        anexos: colunaAnexos === -1 ? 0 : contarLinks_(valores[i][colunaAnexos])
      };
    }
  }

  return { ok: false };
}

/**
 * Conta quantos links do Drive já foram acrescentados à célula de anexos.
 * Enquanto só houver os nomes dos arquivos, o resultado é zero.
 */
function contarLinks_(valor) {
  var texto = String(valor || '').trim();
  if (texto.indexOf('http') !== 0) return 0;

  return texto.split('\n').filter(function (linha) {
    return linha.trim().indexOf('http') === 0;
  }).length;
}

/**
 * Rode esta função no editor do Apps Script para conferir a ligação com a
 * planilha antes de publicar. Ela grava uma linha de teste, mostra a linha
 * gravada e apaga em seguida — o log fica em Execuções.
 */
function testarLigacao() {
  var sheet = getSheet_();
  var cabecalhos = getCabecalhos_(sheet);

  Logger.log('Aba: %s', sheet.getName());
  Logger.log('Colunas (%s): %s', cabecalhos.length, cabecalhos.join(' | '));

  var teste = {};
  teste['Task Name'] = '[TESTE] Ligação do formulário';
  teste['Status'] = 'aguardando';
  teste['Created By'] = 'testarLigacao()';

  var linhaTeste = cabecalhos.map(function (coluna) {
    return teste[coluna] !== undefined ? teste[coluna] : '';
  });

  sheet.appendRow(linhaTeste);
  SpreadsheetApp.flush();

  var gravada = sheet.getLastRow();
  Logger.log('Linha de teste gravada: %s', gravada);

  sheet.deleteRow(gravada);
  Logger.log('Linha de teste removida. Ligação funcionando.');
}

function getSheet_() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ABA_RESPOSTAS ? planilha.getSheetByName(ABA_RESPOSTAS) : planilha.getSheets()[0];

  if (!sheet) throw new Error('Aba "' + ABA_RESPOSTAS + '" não encontrada.');
  return sheet;
}

function getCabecalhos_(sheet) {
  if (sheet.getLastColumn() === 0) return [];

  return sheet.getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(function (coluna) {
      return String(coluna).trim();
    });
}

/**
 * Acrescenta ao cabeçalho as colunas que o formulário enviou e a planilha ainda
 * não tem. Sem isso, campos novos seriam descartados silenciosamente.
 */
function garantirColunas_(sheet, cabecalhos, dados) {
  if (!CRIAR_COLUNAS_FALTANTES) return cabecalhos;

  var novas = Object.keys(dados).filter(function (chave) {
    return CHAVES_IGNORADAS.indexOf(chave) === -1 && cabecalhos.indexOf(chave) === -1;
  });

  if (novas.length === 0) return cabecalhos;

  var atualizados = cabecalhos.concat(novas);
  sheet.getRange(1, 1, 1, atualizados.length).setValues([atualizados]);

  return atualizados;
}

/**
 * Grava um arquivo no Drive e acrescenta o link à coluna de anexos da linha
 * daquele envio. Recebe um arquivo por vez: requisições menores são mais rápidas
 * e a falha de um arquivo não derruba os outros.
 */
function anexarArquivo_(sheet, dados) {
  if (!dados.envioId || !dados.dadosArquivo) {
    return { ok: false, error: 'Anexo sem identificador do envio ou sem conteúdo.' };
  }

  var alvo = localizarEnvio_(dados.envioId);
  if (!alvo.ok) {
    return { ok: false, error: 'A linha do envio ' + dados.envioId + ' não foi encontrada.' };
  }

  var url;
  try {
    // O formulário manda em base64 web-safe; o decodificador comum também
    // aceita, mas o web-safe cobre os dois casos.
    var blob = Utilities.newBlob(
      Utilities.base64DecodeWebSafe(dados.dadosArquivo),
      dados.tipoArquivo || 'application/octet-stream',
      dados.nomeArquivo || 'anexo'
    );

    var arquivo = getPastaAnexos_().createFile(blob);

    // Link acessível para quem tem o endereço, dentro do domínio.
    try {
      arquivo.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (err) {
      // Contas fora do Workspace não aceitam esse modo; segue o padrão da pasta.
    }

    url = arquivo.getUrl();
  } catch (err) {
    return { ok: false, error: 'Falha ao gravar o arquivo no Drive: ' + err };
  }

  var coluna = getCabecalhos_(sheet).indexOf(COLUNA_ANEXOS);
  if (coluna === -1) {
    return { ok: false, error: 'A planilha não tem a coluna "' + COLUNA_ANEXOS + '".' };
  }

  // A célula começa com os nomes dos arquivos; o primeiro link a chegar a
  // substitui, e os seguintes vão sendo acrescentados abaixo.
  var celula = sheet.getRange(alvo.linha, coluna + 1);
  var atual = String(celula.getValue() || '');
  var novo = atual.indexOf('http') === 0 ? atual + '\n' + url : url;

  celula.setValue(novo);
  SpreadsheetApp.flush();

  return { ok: true, linha: alvo.linha, url: url };
}

function getPastaAnexos_() {
  var pastas = DriveApp.getFoldersByName(PASTA_ANEXOS);
  return pastas.hasNext() ? pastas.next() : DriveApp.createFolder(PASTA_ANEXOS);
}

/**
 * Responde em JSON ou, quando vier um callback, em JSONP.
 */
function resposta_(conteudo, callback) {
  var texto = JSON.stringify(conteudo);

  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + texto + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(texto)
    .setMimeType(ContentService.MimeType.JSON);
}
