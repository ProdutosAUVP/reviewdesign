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
var CHAVES_IGNORADAS = ['formType', 'anexosJson'];

// Pasta do Drive onde os anexos das solicitações são guardados.
var PASTA_ANEXOS = 'Anexos | Solicitações de Design';

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet = getSheet_();
    var dados = (e && e.parameter) ? e.parameter : {};

    // Os arquivos chegam em base64 e viram links do Drive na coluna "Anexos"
    var anexosUrls = salvarAnexos_(dados.anexosJson);
    if (anexosUrls) dados['Anexos'] = anexosUrls;

    var cabecalhos = getCabecalhos_(sheet);
    cabecalhos = garantirColunas_(sheet, cabecalhos, dados);

    var linha = cabecalhos.map(function (coluna) {
      return dados[coluna] !== undefined ? dados[coluna] : '';
    });

    sheet.appendRow(linha);

    return resposta_({ ok: true, linha: sheet.getLastRow() });
  } catch (err) {
    return resposta_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Devolve as respostas já registradas, para consulta pela aplicação.
 */
function doGet() {
  try {
    var sheet = getSheet_();
    var valores = sheet.getDataRange().getValues();

    if (valores.length < 2) return resposta_([]);

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

    return resposta_(linhas);
  } catch (err) {
    return resposta_({ error: String(err) });
  }
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
 * Grava os anexos no Drive e devolve os links, um por linha.
 * Em caso de falha devolve string vazia — a coluna "Anexos" mantém os nomes dos
 * arquivos enviados pelo formulário, para que nada se perca silenciosamente.
 */
function salvarAnexos_(anexosJson) {
  if (!anexosJson) return '';

  var anexos;
  try {
    anexos = JSON.parse(anexosJson);
  } catch (err) {
    return '';
  }

  if (!anexos || !anexos.length) return '';

  try {
    var pasta = getPastaAnexos_();

    return anexos.map(function (anexo) {
      var blob = Utilities.newBlob(
        Utilities.base64Decode(anexo.dados),
        anexo.tipo || 'application/octet-stream',
        anexo.nome
      );

      var arquivo = pasta.createFile(blob);

      // Link acessível para quem tem o endereço, dentro do domínio.
      try {
        arquivo.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (err) {
        // Contas fora do Workspace não aceitam esse modo; segue o padrão da pasta.
      }

      return arquivo.getUrl();
    }).join('\n');
  } catch (err) {
    return '';
  }
}

function getPastaAnexos_() {
  var pastas = DriveApp.getFoldersByName(PASTA_ANEXOS);
  return pastas.hasNext() ? pastas.next() : DriveApp.createFolder(PASTA_ANEXOS);
}

function resposta_(conteudo) {
  return ContentService
    .createTextOutput(JSON.stringify(conteudo))
    .setMimeType(ContentService.MimeType.JSON);
}
