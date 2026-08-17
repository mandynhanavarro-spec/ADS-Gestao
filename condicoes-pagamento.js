// ════════════ CONDIÇÕES DE PAGAMENTO — componente compartilhado ════════════
// Usado pelos wizards de Novo Orçamento/Recibo (portões e serralheria) para
// substituir o antigo select único "Forma de Pagamento" por 1+ condições.

var TIPOS_PAGAMENTO_COND = ['Pix','Dinheiro','Parcelado','Sinal de 50% / Restante 50%','Cartão Crédito','Cartão Débito','Pendente'];

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
// opts.tipoInicial: pré-seleciona o tipo da condição única (ex: vindo de template)
// opts.onChange: callback disparado sempre que as condições mudam
function montarCondicoesPagamento(containerId, valorInicial, opts){
  opts = opts||{};
  var cont = document.getElementById(containerId);
  if(!cont) return;
  var v = parseFloat(valorInicial||0)||0;
  _condPagState[containerId] = {
    condicoes: [_condPagNovaCondicao(opts.tipoInicial||'Pix', v)],
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
  st.condicoes[0].valor = parseFloat(valorTotal||0)||0;
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

// ── Impressão no PDF (jsPDF) — consolida o que antes era duplicado entre
// gerarPDF / gerarPDFRecibo / gerarPDFSerrOrc / gerarPDFSerrRec_novo.
// Retorna o y atualizado após imprimir todas as condições.
function imprimirCondicoesPagamento(doc, condicoes, x, y){
  var pixKey = (typeof CFG!=='undefined'&&CFG.doc&&CFG.doc.pix)||'ads.pg@hotmail.com';
  var bancoInfo = (typeof CFG!=='undefined'&&CFG.doc&&CFG.doc.banco)||'Banco Itau AG 0466 CC 60864-3';
  var respNome = (typeof CFG!=='undefined'&&CFG.empresa&&CFG.empresa.resp)||'Ananias Antonio dos Santos';
  doc.setFont('helvetica','normal');
  (condicoes||[]).forEach(function(c){
    if(c.tipo==='Pix'){
      doc.text('via Pix: '+pixKey,x,y);y+=6;
      doc.text('ou '+bancoInfo,x,y);y+=6;
    } else if(c.tipo==='Parcelado'||c.tipo==='Sinal de 50% / Restante 50%'){
      doc.text('Sinal de 50% / Restante 50% na entrega do serviço.',x,y);y+=6;
      doc.text('Sendo Pix '+pixKey+' ou '+bancoInfo,x,y);y+=6;
    } else if(c.tipo==='Pendente'){
      doc.text('Pagamento Pendente — via Pix: '+pixKey,x,y);y+=6;
      doc.text('ou '+bancoInfo,x,y);y+=6;
    } else if(c.tipo==='Dinheiro'){
      doc.text('Pagamento em dinheiro na entrega do serviço.',x,y);y+=6;
    } else if(c.tipo==='Cartão Crédito'&&c.modalidade==='parcelado'){
      var n=c.parcelas||1;
      var vp=(c.valorParcela!=null)?c.valorParcela:_condPagCalcParcela(c.valor,n);
      doc.text(n+'x de '+fmtVal(vp)+' no cartão de crédito.',x,y);y+=6;
    } else {
      doc.text('Pagamento via '+c.tipo+'.',x,y);y+=6;
    }
  });
  doc.text(respNome,x,y);y+=6;
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
    html += '<input class="fi" type="number" step="0.01" min="0" value="'+(cond.valor||'')+'" placeholder="0,00" oninput="_condPagValorChange(\''+containerId+'\',\''+cond._rowId+'\',this.value)"></div>';
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
      html += '<input class="fi" type="number" step="0.01" min="0" id="cp-valorparcela-'+cond._rowId+'" value="'+(cond.valorParcela!=null?cond.valorParcela:'')+'" placeholder="0,00" oninput="_condPagValorParcelaChange(\''+containerId+'\',\''+cond._rowId+'\',this.value)"></div>';
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
  c.valor = parseFloat(novoValor||0)||0;
  if(c.tipo==='Cartão Crédito'&&c.modalidade==='parcelado'&&c.parcelas){
    c.valorParcela=_condPagCalcParcela(c.valor,c.parcelas);
    var vpEl=document.getElementById('cp-valorparcela-'+rowId);
    if(vpEl) vpEl.value=c.valorParcela.toFixed(2);
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
    if(vpEl) vpEl.value=c.valorParcela.toFixed(2);
  }
  _condPagFireChange(containerId);
}

function _condPagValorParcelaChange(containerId, rowId, novoValor){
  var st = _condPagState[containerId]; if(!st) return;
  var c = st.condicoes.find(function(x){return x._rowId===rowId;}); if(!c) return;
  c.valorParcela = parseFloat(novoValor||0)||0;
  _condPagFireChange(containerId);
}
