// ════════════ CONDIÇÕES DE PAGAMENTO — componente compartilhado ════════════
// Usado pelos wizards de Novo Orçamento/Recibo (portões e serralheria) para
// substituir o antigo select único "Forma de Pagamento" por 1+ condições.

var TIPOS_PAGAMENTO_COND = ['Pix','Dinheiro','Sinal de 50% / Restante 50%','Cartão Crédito','Cartão Débito'];

var _condPagState = {}; // containerId -> {condicoes:[...], onChange:fn|null}

function _condPagNovaCondicao(tipo, valor){
  return {
    tipo: tipo||'Pix',
    valor: valor||0,
    modalidade: undefined,
    parcelas: undefined,
    valorParcela: undefined,
    _rowId: 'cp'+Date.now().toString(36)+Math.random().toString(36).slice(2,7)
  };
}

function _condPagCalcParcela(valor, parcelas){
  if(!parcelas||parcelas<=0)return 0;
  return Math.floor((parseFloat(valor||0)/parcelas)*100)/100;
}

// containerId: id do <div> onde o bloco será renderizado
// valorInicial: valor total (R$) a ser atribuído à condição única inicial
//   (ignorado quando opts.condicoesIniciais é passado)
// opts.tipoInicial: pré-seleciona o tipo da condição única (ex: vindo de template)
// opts.condicoesIniciais: array de condições já existentes (ex: vindo de um
//   registro salvo, via condicoesPagamentoOuFallback) — usado pelas telas de
//   Editar Orçamento/Recibo para carregar 1+ condições reais em vez de
//   sempre começar com uma condição única em branco.
// opts.onChange: callback disparado sempre que as condições mudam
function montarCondicoesPagamento(containerId, valorInicial, opts){
  opts = opts||{};
  var cont = document.getElementById(containerId);
  if(!cont) return;
  var condicoes;
  if(opts.condicoesIniciais && opts.condicoesIniciais.length){
    condicoes = opts.condicoesIniciais.map(function(c){
      var novo = _condPagNovaCondicao(c.tipo, parseFloat(c.valor||0)||0);
      novo.modalidade = c.modalidade;
      novo.parcelas = c.parcelas;
      novo.valorParcela = c.valorParcela;
      return novo;
    });
  } else {
    var v = parseFloat(valorInicial||0)||0;
    condicoes = [_condPagNovaCondicao(opts.tipoInicial||'Pix', v)];
  }
  _condPagState[containerId] = {
    condicoes: condicoes,
    onChange: typeof opts.onChange==='function'?opts.onChange:null
  };
  _condPagRender(containerId);
}

// Mantém a condição única sincronizada com o valor total do documento
// (o campo de valor só aparece na UI quando há 2+ condições — com 1 única
// condição ela representa 100% do valor, então precisa ser mantida em dia
// programaticamente antes de ler o estado para salvar).
function condPagamentoDefinirValorTotal(containerId, valorTotal){
  var st = _condPagState[containerId];
  if(!st || st.condicoes.length!==1) return;
  // valorTotal pode chegar como número puro (fluxos internos) ou como string
  // mascarada em pt-BR (ex: "5.000,00", vinda do oninput de um campo com
  // máscara de moeda) — desmascarar() lida com os dois casos.
  st.condicoes[0].valor = parseFloat(desmascarar(valorTotal))||0;
}

// Mesma sincronização de condPagamentoDefinirValorTotal, mas para uso "ao
// vivo" enquanto o usuário digita o valor do serviço no wizard (oninput) —
// além de atualizar o estado, recalcula e reflete na tela o valor da
// parcela quando a condição única já está em Cartão Crédito parcelado
// (sem isso, o valor da parcela só era recalculado no momento do salvar).
function condPagamentoSincronizarValor(containerId, valorTotal){
  var st = _condPagState[containerId];
  if(!st || st.condicoes.length!==1) return;
  var c = st.condicoes[0];
  // valorTotal pode chegar como número puro ou string mascarada em pt-BR
  // (ex: "5.000,00", vinda do oninput de um campo com máscara de moeda).
  c.valor = parseFloat(desmascarar(valorTotal))||0;
  if(c.tipo==='Cartão Crédito' && c.modalidade==='parcelado' && c.parcelas){
    c.valorParcela = _condPagCalcParcela(c.valor, c.parcelas);
    var vpEl = document.getElementById('cp-valorparcela-'+c._rowId);
    if(vpEl) vpEl.value = aplicarMascaraMoeda(c.valorParcela);
  }
}

// Tipo da 1ª condição — usado por fluxos legados que precisam de "uma forma
// representativa" para sugerir campos relacionados (ex: forma de recebimento
// no Financeiro do Recibo Portões).
function condPagamentoTipoPrincipal(containerId){
  var st = _condPagState[containerId];
  if(!st || !st.condicoes.length) return 'Pix';
  return st.condicoes[0].tipo;
}

function lerCondicoesPagamento(containerId){
  var st = _condPagState[containerId];
  if(!st || !st.condicoes.length) return null;
  var out = [];
  for(var i=0;i<st.condicoes.length;i++){
    var c = st.condicoes[i];
    var valor = parseFloat(c.valor||0)||0;
    if(!valor||valor<=0){
      alert('Informe um valor válido para a forma de pagamento "'+c.tipo+'".');
      return null;
    }
    var item = {tipo:c.tipo, valor:valor};
    if(c.tipo==='Cartão Crédito'){
      item.modalidade = c.modalidade==='parcelado'?'parcelado':'avista';
      if(item.modalidade==='parcelado'){
        var parcelas = parseInt(c.parcelas||0);
        if(!parcelas||parcelas<1){
          alert('Informe o número de parcelas do Cartão de Crédito.');
          return null;
        }
        item.parcelas = parcelas;
        item.valorParcela = (c.valorParcela!=null&&c.valorParcela!=='')?parseFloat(c.valorParcela):_condPagCalcParcela(valor,parcelas);
      }
    }
    out.push(item);
  }
  return out;
}

// Resumo em texto p/ manter o campo legado "pagamento" (coluna text) legível
// para telas que ainda não conhecem condicoes_pagamento.
function resumoCondicoesPagamento(condicoes){
  if(!condicoes||!condicoes.length) return '';
  if(condicoes.length===1) return condicoes[0].tipo;
  return 'Múltiplas formas';
}

// Constrói uma condição única a partir do campo legado "pgto" quando o
// registro não tem condicoes_pagamento (fallback p/ registros antigos,
// Editar Orçamento/Recibo, aprovação, "Modo Campo" etc).
function condicoesPagamentoOuFallback(condicoesPagamento, pgtoLegado, valorTotal){
  if(condicoesPagamento&&condicoesPagamento.length) return condicoesPagamento;
  return [{tipo: pgtoLegado||'Pix', valor: parseFloat(valorTotal||0)||0}];
}

// Rótulo de exibição no PDF — só muda o texto impresso; a comparação de
// tipo (c.tipo==='Cartão Crédito' etc.) em todo o resto do código continua
// usando a string original, sem "de", para não quebrar nada.
var _CONDPAG_LABEL_PDF = {
  'Cartão Crédito':'Cartão de Crédito',
  'Cartão Débito':'Cartão de Débito'
};

// ── Impressão no PDF (jsPDF) — consolida o que antes era duplicado entre
// gerarPDF / gerarPDFRecibo / gerarPDFSerrOrc / gerarPDFSerrRec_novo.
// Também imprime o cabeçalho "Forma de Pagamento:" (os 4 pontos de chamada
// não imprimem mais esse texto por conta própria) — com 2+ condições, o
// cabeçalho vira "Forma de Pagamento (Pix ou Cartão de Crédito):", deixando
// claro que são opções alternativas, não uma soma.
// valorTotal: valor total do orçamento/recibo — usado só pra decidir se o
// cabeçalho "Tipo — valor" de uma condição única é redundante (condição
// única sempre representa 100% do valor, então repetir o valor ali some
// como redundância visual). Com 2+ condições, o cabeçalho com valor é
// sempre mostrado — é o que deixa claro que são opções alternativas.
// Retorna o y atualizado após imprimir todas as condições.
function imprimirCondicoesPagamento(doc, condicoes, x, y, valorTotal){
  var pixKey = (typeof CFG!=='undefined'&&CFG.doc&&CFG.doc.pix)||'ads.pg@hotmail.com';
  var bancoInfo = (typeof CFG!=='undefined'&&CFG.doc&&CFG.doc.banco)||'Banco Itau AG 0466 CC 60864-3';
  var respNome = (typeof CFG!=='undefined'&&CFG.empresa&&CFG.empresa.resp)||'Ananias Antonio dos Santos';
  var lista = condicoes||[];
  var multiplas = lista.length>1;

  doc.setFont('helvetica','bold');
  var tituloCab = 'Forma de Pagamento';
  if(multiplas){
    var tipos = lista.map(function(c){ return _CONDPAG_LABEL_PDF[c.tipo]||c.tipo; });
    tituloCab += ' ('+tipos.join(' ou ')+')';
  }
  doc.text(tituloCab+':',x,y);y+=7;
  doc.setFont('helvetica','normal');

  lista.forEach(function(c){
    var valor = parseFloat(c.valor||0)||0;
    var igualAoTotal = valorTotal!=null && Math.abs(valor-(parseFloat(valorTotal||0)||0))<0.005;
    var mostrarCabecalho = multiplas || !igualAoTotal;
    var detX = x;
    var label = (_CONDPAG_LABEL_PDF[c.tipo]||c.tipo);
    if(mostrarCabecalho){
      var headerLabel = multiplas ? '• '+label : label;
      doc.setFont('helvetica','bold');
      doc.text(headerLabel+' — '+fmtVal(valor),x,y);y+=6;
      doc.setFont('helvetica','normal');
      detX = x+4;
    }

    // Cada branch só define o texto — a repetição do rótulo (label + " — ")
    // na 1ª linha do bloco é aplicada de forma centralizada logo abaixo,
    // e só quando não há cabeçalho "Tipo — Valor" acima cobrindo essa
    // informação (senão duplicaria). O texto de cada tipo é escrito de
    // forma que NUNCA repita o nome do tipo por conta própria — quem
    // decide se o tipo aparece é sempre o prefixo, nunca o texto do detalhe.
    var linhas = [];
    var mostrarResp = false;
    if(c.tipo==='Pix'){
      linhas = ['Chave: '+pixKey+' (ou '+bancoInfo+')'];
      mostrarResp = true;
    } else if(c.tipo==='Parcelado'||c.tipo==='Sinal de 50% / Restante 50%'){
      linhas = ['Na entrega do serviço.', 'Sendo Pix '+pixKey+' ou '+bancoInfo];
    } else if(c.tipo==='Pendente'){
      linhas = ['via Pix: '+pixKey, 'ou '+bancoInfo];
      mostrarResp = true;
    } else if(c.tipo==='Dinheiro'){
      linhas = ['Pagamento em dinheiro na entrega do serviço.'];
    } else if(c.tipo==='Cartão Crédito'&&c.modalidade==='parcelado'){
      var n=c.parcelas||1;
      var vp=(c.valorParcela!=null)?c.valorParcela:_condPagCalcParcela(c.valor,n);
      linhas = ['Em até '+n+'x de '+fmtVal(vp)];
    } else {
      // Cartão Crédito à vista, Cartão Débito, ou qualquer tipo futuro não
      // mapeado — o nome do tipo já vem do label (prefixo ou cabeçalho),
      // então o texto aqui fica neutro pra não repetir.
      linhas = ['Pagamento na entrega do serviço.'];
    }

    linhas.forEach(function(linha, i){
      var texto = (i===0 && !mostrarCabecalho) ? (label+' — '+linha) : linha;
      doc.text(texto,detX,y);y+=6;
    });
    if(mostrarResp){
      doc.text(respNome,detX,y);y+=6;
    }
  });
  return y;
}

// ── Renderização ────────────────────────────────────────────────────────

function _condPagRowHtml(containerId, cond, showValor, showRemove){
  var rowDomId = 'cp-row-'+cond._rowId;
  var tipoOpts = TIPOS_PAGAMENTO_COND.map(function(t){
    return '<option value="'+t+'"'+(t===cond.tipo?' selected':'')+'>'+t+'</option>';
  }).join('');
  var html = '<div id="'+rowDomId+'" style="background:var(--bg3);border:1px solid var(--border2);border-radius:8px;padding:10px 12px;margin-bottom:8px">';
  html += '<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">';
  html += '<div style="flex:2;min-width:140px"><div class="fl">Forma de pagamento</div>';
  html += '<select class="fs" onchange="_condPagTipoChange(\''+containerId+'\',\''+cond._rowId+'\',this.value)">'+tipoOpts+'</select></div>';
  if(showValor){
    html += '<div style="flex:1;min-width:100px"><div class="fl">Valor (R$)</div>';
    html += '<input class="fi" type="text" inputmode="decimal" value="'+(cond.valor?aplicarMascaraMoeda(cond.valor):'')+'" placeholder="0,00" oninput="mascarearInputMoeda(this);_condPagValorChange(\''+containerId+'\',\''+cond._rowId+'\',this.value)"></div>';
  }
  if(showRemove){
    html += '<button type="button" class="btn btn-red btn-sm" style="flex-shrink:0" title="Remover esta forma de pagamento" onclick="_condPagRemover(\''+containerId+'\',\''+cond._rowId+'\')">✕</button>';
  }
  html += '</div>';
  if(cond.tipo==='Cartão Crédito'){
    html += '<div style="display:flex;gap:8px;margin-top:8px;align-items:flex-end;flex-wrap:wrap">';
    html += '<div style="flex:1;min-width:100px"><div class="fl">Modalidade</div>';
    html += '<select class="fs" onchange="_condPagModalidadeChange(\''+containerId+'\',\''+cond._rowId+'\',this.value)">';
    html += '<option value="avista"'+(cond.modalidade!=='parcelado'?' selected':'')+'>À vista</option>';
    html += '<option value="parcelado"'+(cond.modalidade==='parcelado'?' selected':'')+'>Parcelado</option>';
    html += '</select></div>';
    if(cond.modalidade==='parcelado'){
      html += '<div style="flex:1;min-width:90px"><div class="fl">Nº de parcelas</div>';
      html += '<input class="fi" type="number" step="1" min="1" value="'+(cond.parcelas||'')+'" placeholder="Ex: 3" oninput="_condPagParcelasChange(\''+containerId+'\',\''+cond._rowId+'\',this.value)"></div>';
      html += '<div style="flex:1;min-width:100px"><div class="fl">Valor da parcela (R$)</div>';
      html += '<input class="fi" type="text" inputmode="decimal" id="cp-valorparcela-'+cond._rowId+'" value="'+(cond.valorParcela!=null?aplicarMascaraMoeda(cond.valorParcela):'')+'" placeholder="0,00" oninput="mascarearInputMoeda(this);_condPagValorParcelaChange(\''+containerId+'\',\''+cond._rowId+'\',this.value)"></div>';
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function _condPagRender(containerId){
  var st = _condPagState[containerId];
  var cont = document.getElementById(containerId);
  if(!st||!cont) return;
  var showValor = st.condicoes.length>1;
  var html = st.condicoes.map(function(c){
    return _condPagRowHtml(containerId,c,showValor,st.condicoes.length>1);
  }).join('');
  html += '<button type="button" class="btn btn-ghost btn-sm" onclick="_condPagAdicionar(\''+containerId+'\')">+ Adicionar outra forma de pagamento</button>';
  cont.innerHTML = html;
}

function _condPagRenderRow(containerId, rowId){
  var st = _condPagState[containerId];
  if(!st) return;
  var c = st.condicoes.find(function(x){return x._rowId===rowId;});
  var el = document.getElementById('cp-row-'+rowId);
  if(!c||!el) return;
  var showValor = st.condicoes.length>1;
  el.outerHTML = _condPagRowHtml(containerId,c,showValor,st.condicoes.length>1);
}

function _condPagFireChange(containerId){
  var st = _condPagState[containerId];
  if(st&&st.onChange) st.onChange();
}

function _condPagAdicionar(containerId){
  var st = _condPagState[containerId];
  if(!st) return;
  st.condicoes.push(_condPagNovaCondicao('Pix',0));
  _condPagRender(containerId);
  _condPagFireChange(containerId);
}

function _condPagRemover(containerId, rowId){
  var st = _condPagState[containerId];
  if(!st||st.condicoes.length<=1) return;
  st.condicoes = st.condicoes.filter(function(c){return c._rowId!==rowId;});
  _condPagRender(containerId);
  _condPagFireChange(containerId);
}

function _condPagTipoChange(containerId, rowId, novoTipo){
  var st = _condPagState[containerId]; if(!st) return;
  var c = st.condicoes.find(function(x){return x._rowId===rowId;}); if(!c) return;
  c.tipo = novoTipo;
  if(novoTipo!=='Cartão Crédito'){
    c.modalidade=undefined; c.parcelas=undefined; c.valorParcela=undefined;
  } else {
    c.modalidade = c.modalidade||'avista';
  }
  _condPagRenderRow(containerId,rowId);
  _condPagFireChange(containerId);
}

function _condPagModalidadeChange(containerId, rowId, novaModalidade){
  var st = _condPagState[containerId]; if(!st) return;
  var c = st.condicoes.find(function(x){return x._rowId===rowId;}); if(!c) return;
  c.modalidade = novaModalidade;
  if(novaModalidade==='parcelado'){
    if(!c.parcelas) c.parcelas=2;
    c.valorParcela=_condPagCalcParcela(parseFloat(c.valor||0),c.parcelas);
  } else {
    c.parcelas=undefined; c.valorParcela=undefined;
  }
  _condPagRenderRow(containerId,rowId);
  _condPagFireChange(containerId);
}

function _condPagValorChange(containerId, rowId, novoValor){
  var st = _condPagState[containerId]; if(!st) return;
  var c = st.condicoes.find(function(x){return x._rowId===rowId;}); if(!c) return;
  c.valor = parseFloat(desmascarar(novoValor))||0;
  if(c.tipo==='Cartão Crédito'&&c.modalidade==='parcelado'&&c.parcelas){
    c.valorParcela=_condPagCalcParcela(c.valor,c.parcelas);
    var vpEl=document.getElementById('cp-valorparcela-'+rowId);
    if(vpEl) vpEl.value=aplicarMascaraMoeda(c.valorParcela);
  }
  _condPagFireChange(containerId);
}

function _condPagParcelasChange(containerId, rowId, novoValor){
  var st = _condPagState[containerId]; if(!st) return;
  var c = st.condicoes.find(function(x){return x._rowId===rowId;}); if(!c) return;
  c.parcelas = parseInt(novoValor||0)||0;
  if(c.parcelas>0){
    c.valorParcela=_condPagCalcParcela(parseFloat(c.valor||0),c.parcelas);
    var vpEl=document.getElementById('cp-valorparcela-'+rowId);
    if(vpEl) vpEl.value=aplicarMascaraMoeda(c.valorParcela);
  }
  _condPagFireChange(containerId);
}

function _condPagValorParcelaChange(containerId, rowId, novoValor){
  var st = _condPagState[containerId]; if(!st) return;
  var c = st.condicoes.find(function(x){return x._rowId===rowId;}); if(!c) return;
  c.valorParcela = parseFloat(desmascarar(novoValor))||0;
  _condPagFireChange(containerId);
}
