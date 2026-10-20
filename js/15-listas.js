// ==========================================================================
// SPARE PARTS - 15-listas.js (extraido do v16.32)
// ==========================================================================

// ============================================================
//  MODULO: CONFIRMACAO DE LISTAS  (v16.23)
// ------------------------------------------------------------
//  - Lista TODAS as listas tiradas do sistema (type === 'CHECKOUT'),
//    agrupadas pela LINHA informada na propria lista (config.line).
//  - Cada lista mostra OP (W/O), maquina, qtd de itens, quem tirou e quando.
//  - TRAVA DE TEMPO: base de 10 itens = 3 minutos de busca no estoque
//    => 18 segundos por item. O botao FINALIZAR so libera depois desse
//    tempo minimo, contado a partir da hora em que a lista foi tirada.
//  - TROCA DE TURNO: o colaborador pode registrar que esta deixando a
//    lista com X itens faltando; quem finalizar depois fica registrado
//    como o funcionario que concluiu a lista.
//  - Tudo fica gravado dentro do proprio registro do historico (h.confirm),
//    portanto entra no JSON/backup normalmente.
// ============================================================
// ============================================================================
// MODULO: LINHAS OFICIAIS (v16.24)
// ----------------------------------------------------------------------------
// Linhas possiveis do sistema, na ordem em que devem aparecer nos cards:
//   A01, A02, A03, S01A, S02, S03, S04, S05, S06, S07, S08, S09, S10
// Regra de ordenacao: primeiro as que comecam com "A", depois as com "S",
// e dentro de cada grupo pelo numero que vem depois.
// ============================================================================
// ============================================================================
// MODULO: ORDENACAO DE PICKING (v16.24.2)
// Ordena os materiais pelo CARRO e depois pela LOCACAO, em ordem crescente,
// para que a lista impressa siga o caminho de busca no estoque.
// Usa comparacao "natural": CARRO 2 vem antes de CARRO 10.
// ============================================================================
const Picking = {
    _natural(a, b) {
        const A = String(a == null ? '' : a).trim().toUpperCase();
        const B = String(b == null ? '' : b).trim().toUpperCase();
        return A.localeCompare(B, 'pt-BR', { numeric: true, sensitivity: 'base' });
    },
    // comparador: carro crescente, depois locacao crescente
    cmp(a, b) {
        const c = Picking._natural(a?.car, b?.car);
        if (c !== 0) return c;
        return Picking._natural(a?.loc, b?.loc);
    },
    // devolve uma COPIA ordenada (nao altera o array original)
    ordenar(arr) { return [...(arr || [])].sort(Picking.cmp); },
};

const LINHAS = {
    OFICIAIS: ['A01','A02','A03','S01A','S02','S03','S04','S05','S06','S07','S08','S09','S10'],

    norm(v) { return String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, ''); },

    ehOficial(v) { return LINHAS.OFICIAIS.indexOf(LINHAS.norm(v)) >= 0; },

    // chave de ordenacao: [grupo, numero, sufixo]
    _chave(v) {
        const s = LINHAS.norm(v);
        const m = s.match(/^([A-Z]+)(\d+)([A-Z]*)$/);
        if (!m) return [9, 9999, s];                 // desconhecidas vao para o fim
        const grupo = m[1] === 'A' ? 0 : (m[1] === 'S' ? 1 : 8);
        return [grupo, parseInt(m[2], 10), m[3] || ''];
    },

    ordenar(a, b) {
        const ka = LINHAS._chave(a), kb = LINHAS._chave(b);
        if (ka[0] !== kb[0]) return ka[0] - kb[0];
        if (ka[1] !== kb[1]) return ka[1] - kb[1];
        return String(ka[2]).localeCompare(String(kb[2]));
    },
};

const ListConfirm = {

    // Base da regra: 10 itens -> 3 min  =>  18 s por item
    ITENS_BASE:    10,
    MINUTOS_BASE:  3,

    segPorItem() { return (ListConfirm.MINUTOS_BASE * 60) / ListConfirm.ITENS_BASE; }, // 18s

    // tempo minimo (ms) que a lista precisa ficar aberta antes de finalizar
    tempoMinimoMs(qtdItens) {
        const n = Math.max(1, Number(qtdItens) || 0);
        return Math.round(n * ListConfirm.segPorItem() * 1000);
    },

    fmtDur(ms) {
        if (ms < 0) ms = 0;
        const tot = Math.round(ms / 1000);
        const m = Math.floor(tot / 60), sg = tot % 60;
        return (m > 0 ? m + 'min ' : '') + sg + 's';
    },

    _all() {
        return (State.checkoutHistory || []).filter(h => h.type === 'CHECKOUT');
    },

    _qtd(h) { return (h.removedItems?.length) || (h._itemCount || 0); },

    _conf(h) {
        if (!h.confirm) h.confirm = { status: 'ABERTA', pendencias: [] };
        if (!h.confirm.pendencias) h.confirm.pendencias = [];
        return h.confirm;
    },

    _find(id) { return ListConfirm._all().find(h => String(h.id) === String(id)); },

    // v16.24: uma lista so deixa de "ocupar" a linha quando esta FINALIZADA ou PAUSADA.
    ehAtiva(h) {
        const st = ListConfirm._conf(h).status;
        return st !== 'CONCLUIDA' && st !== 'PAUSADA';
    },

    // Retorna a lista ainda em andamento daquela linha (ou null)
    listaAtivaDaLinha(linha) {
        const alvo = LINHAS.norm(linha);
        if (!alvo || alvo === '--') return null;
        return ListConfirm._all()
            .filter(h => LINHAS.norm(h.config?.line) === alvo && ListConfirm.ehAtiva(h))
            .sort((a, b) => b.timestamp - a.timestamp)[0] || null;
    },

    _injectCSS() {
        if (document.getElementById('lcCSS')) return;
        const st = document.createElement('style');
        st.id = 'lcCSS';
        st.textContent = `
        #confirmContent .lc-wrap{max-width:1180px;margin:0 auto;font-family:'Roboto',sans-serif;color:#1e293b;}
        #confirmContent .lc-rule{background:#fff;border:1px solid #e2e8f0;border-left:5px solid var(--tpv-blue);border-radius:10px;padding:12px 18px;margin-bottom:18px;font-size:13px;color:#475569;}
        #confirmContent .lc-rule b{color:var(--tpv-dark-blue);}
        #confirmContent .lc-kpis{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;}
        #confirmContent .lc-kpi{flex:1;min-width:150px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;}
        #confirmContent .lc-kpi .n{font-family:'Roboto Mono',monospace;font-size:26px;font-weight:700;color:var(--tpv-dark-blue);line-height:1;}
        #confirmContent .lc-kpi .l{font-size:10.5px;letter-spacing:1.2px;color:#94a3b8;text-transform:uppercase;margin-top:5px;}
        #confirmContent .lc-line{margin-bottom:26px;}
        #confirmContent .lc-line-h{display:flex;align-items:center;gap:10px;margin-bottom:10px;}
        #confirmContent .lc-line-t{font-weight:900;font-size:14px;letter-spacing:1.4px;color:#fff;background:var(--tpv-dark-blue);padding:5px 14px;border-radius:8px;text-transform:uppercase;}
        #confirmContent .lc-line-c{font-size:11.5px;color:#94a3b8;}
        #confirmContent .lc-line-ln{flex:1;height:1px;background:linear-gradient(90deg,#cbd5e1,transparent);}
        #confirmContent .lc-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-bottom:10px;}
        #confirmContent .lc-card.done{border-left:5px solid var(--ind-green);background:#f6fdf9;}
        #confirmContent .lc-card.pend{border-left:5px solid #f59e0b;background:#fffbeb;}
        #confirmContent .lc-card.open{border-left:5px solid var(--tpv-blue);}
        #confirmContent .lc-card.paused{border-left:5px solid #8b5cf6;background:#faf8ff;}
        #confirmContent .lc-top{display:flex;align-items:center;gap:14px;flex-wrap:wrap;}
        #confirmContent .lc-op{font-family:'Roboto Mono',monospace;font-weight:900;font-size:17px;color:var(--tpv-dark-blue);}
        #confirmContent .lc-tag{font-size:10.5px;font-weight:900;letter-spacing:1px;text-transform:uppercase;padding:3px 9px;border-radius:20px;}
        #confirmContent .lc-meta{display:flex;gap:22px;flex-wrap:wrap;margin-top:9px;font-size:12.5px;color:#64748b;}
        #confirmContent .lc-meta b{color:#1e293b;font-family:'Roboto Mono',monospace;}
        #confirmContent .lc-acts{display:flex;gap:9px;flex-wrap:wrap;margin-top:12px;align-items:center;}
        /* v16.31: botao de acao administrativa no canto do card */
        #confirmContent .lc-adm{margin-left:auto;border:1px solid #fecaca;background:#fef2f2;color:#b91c1c;border-radius:8px;padding:6px 13px;font-size:11px;font-weight:900;letter-spacing:.8px;text-transform:uppercase;cursor:pointer;font-family:'Roboto',sans-serif;transition:all .15s;white-space:nowrap;}
        #confirmContent .lc-adm:hover{background:#b91c1c;color:#fff;border-color:#b91c1c;box-shadow:0 3px 10px -3px rgba(185,28,28,.6);}
        #confirmContent .lc-adm.reabrir{border-color:#bfdbfe;background:#eff6ff;color:#1d4ed8;}
        #confirmContent .lc-adm.reabrir:hover{background:#1d4ed8;color:#fff;border-color:#1d4ed8;}
        #confirmContent .lc-lock{font-size:12px;color:#b45309;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:6px 11px;display:inline-flex;align-items:center;gap:7px;}
        #confirmContent .lc-hist{margin-top:10px;padding-top:9px;border-top:1px dashed #e2e8f0;font-size:12px;color:#64748b;}
        #confirmContent .lc-hist .it{margin-bottom:3px;}
        #confirmContent .lc-form{margin-top:11px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;}
        #confirmContent .lc-form label{font-size:11.5px;font-weight:700;color:#475569;display:block;margin-bottom:4px;}
        #confirmContent .lc-form input{width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:7px;font-size:14px;}
        #confirmContent .lc-empty{text-align:center;color:#94a3b8;padding:40px;font-style:italic;}
        #confirmContent .lc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px;}
        #confirmContent .lc-lcard{background:#fff;border:1px solid #e2e8f0;border-top:5px solid var(--tpv-blue);border-radius:12px;padding:16px 18px;cursor:pointer;transition:.18s;}
        #confirmContent .lc-lcard:hover{transform:translateY(-3px);box-shadow:0 12px 26px -18px rgba(0,90,160,.9);border-color:var(--tpv-blue);}
        #confirmContent .lc-lcard .nm{font-weight:900;font-size:19px;letter-spacing:1px;color:var(--tpv-dark-blue);text-transform:uppercase;}
        #confirmContent .lc-lcard .qt{font-size:11.5px;color:#94a3b8;margin-top:2px;}
        #confirmContent .lc-lcard .pills{display:flex;gap:6px;flex-wrap:wrap;margin-top:11px;}
        #confirmContent .lc-pill{font-size:10.5px;font-weight:900;letter-spacing:.5px;padding:3px 9px;border-radius:20px;}
        #confirmContent .lc-lcard .go{margin-top:12px;font-size:11px;color:var(--tpv-blue);font-weight:700;}
        #confirmContent .lc-lcard.lc-vazia{cursor:default;opacity:.55;border-top-color:#cbd5e1;}
        #confirmContent .lc-lcard.lc-vazia:hover{transform:none;box-shadow:none;border-color:#e2e8f0;}
        #confirmContent .lc-back{background:#fff;border:1px solid #e2e8f0;border-radius:9px;padding:8px 14px;cursor:pointer;font-weight:700;font-size:12.5px;color:var(--tpv-dark-blue);display:inline-flex;align-items:center;gap:7px;margin-bottom:16px;}
        #confirmContent .lc-back:hover{background:#f1f5f9;}
        `;
        document.head.appendChild(st);
    },

    // v16.23.1: navegacao em 2 niveis — cards de LINHA -> listas daquela linha
    _linhaAberta: null,

    abrirLinha(linha) { ListConfirm._linhaAberta = linha; ListConfirm.render(); },
    voltar()          { ListConfirm._linhaAberta = null;  ListConfirm.render(); },

    _agrupar() {
        const porLinha = {};
        ListConfirm._all().forEach(h => {
            const linha = (h.config?.line || '--').toString().trim() || '--';
            (porLinha[linha] = porLinha[linha] || []).push(h);
        });
        return porLinha;
    },

    _cardLista(h) {
        const esc   = (t) => Security.sanitize(String(t == null ? '' : t));
        const c     = ListConfirm._conf(h);
        const qtd   = ListConfirm._qtd(h);
        const minMs = ListConfirm.tempoMinimoMs(qtd);
        const falta = (h.timestamp + minMs) - Date.now();
        const liberado = falta <= 0;

        // v16.31: acoes de ADMINISTRADOR no canto do card.
        //  - PENDENTE (troca de turno)  -> forcar a finalizacao
        //  - CONCLUIDA                  -> reabrir a lista
        // Liberadas em Sistema > Usuarios > PERMISSOES.
        let admBtn = '';
        if (c.status === 'PENDENTE' && Perms.can('act:list_force_done')) {
            admBtn = `<button class="lc-adm" title="Finalizar esta lista como administrador"
                        onclick="ListConfirm.finalizarADM('${esc(h.id)}')">
                        <i class="fas fa-user-shield"></i> FINALIZAR (ADM)
                      </button>`;
        } else if (c.status === 'CONCLUIDA' && Perms.can('act:list_reopen')) {
            admBtn = `<button class="lc-adm reabrir" title="Reabrir esta lista como administrador"
                        onclick="ListConfirm.reabrirADM('${esc(h.id)}')">
                        <i class="fas fa-rotate-left"></i> REABRIR (ADM)
                      </button>`;
        }

        const tag = c.status === 'CONCLUIDA'
            ? '<span class="lc-tag" style="background:rgba(16,185,129,.15);color:#047857;">Concluida</span>'
            : c.status === 'PENDENTE'
            ? '<span class="lc-tag" style="background:rgba(245,158,11,.18);color:#b45309;">Pendente / troca de turno</span>'
            : c.status === 'PAUSADA'
            ? '<span class="lc-tag" style="background:rgba(139,92,246,.16);color:#6d28d9;">Pausada</span>'
            : '<span class="lc-tag" style="background:rgba(0,102,161,.13);color:var(--tpv-dark-blue);">Aguardando confirmacao</span>';

        const pausas = c.pausas || [];
        const reab = c.reaberturas || [];
        const histHTML = (c.pendencias.length || pausas.length || reab.length || c.status === 'CONCLUIDA') ? `
          <div class="lc-hist">
            ${c.pendencias.map(pd => `<div class="it">⚠️ <b>${esc(pd.by)}</b> deixou a lista para o proximo turno em ${esc(pd.at)} — faltando <b>${esc(pd.missing)}</b> item(ns)${pd.note ? ' — ' + esc(pd.note) : ''}</div>`).join('')}
            ${pausas.map(pa => `<div class="it">⏸️ <b>${esc(pa.by)}</b> pausou a lista em ${esc(pa.at)} — motivo: <b>${esc(pa.note)}</b></div>`).join('')}
            ${c.status === 'CONCLUIDA' ? `<div class="it">✅ Finalizada por <b>${esc(c.finishedBy)}</b> (mat. ${esc(c.finishedMat)}) em ${esc(c.finishedAt)}${c.finishedBy !== h.printUser ? ' — <b>lista iniciada por ' + esc(h.printUser) + '</b>' : ''}</div>` : ''}
            ${reab.map(rb => `<div class="it" style="color:#1d4ed8;">🔓 <b>${esc(rb.by)}</b> (mat. ${esc(rb.mat)}) reabriu a lista como administrador em ${esc(rb.at)} — estava finalizada por <b>${esc(rb.eraDe)}</b> em ${esc(rb.eraEm)}</div>`).join('')}
            ${c.admForced ? `<div class="it" style="color:#b91c1c;">🛡️ Finalizada como <b>ACAO ADMINISTRATIVA</b> por <b>${esc(c.admForced.by)}</b> (mat. ${esc(c.admForced.mat)}) em ${esc(c.admForced.at)}${c.admForced.missing ? ' — com <b>' + esc(c.admForced.missing) + '</b> item(ns) pendente(s)' : ''}</div>` : ''}
          </div>` : '';

        // v16.30: se a lista veio de uma leitura de caixas que ainda esta aberta,
        // ela ganha o botao CONTINUAR LEITURA junto das acoes normais.
        const _bxOpen = (typeof BoxScan !== 'undefined') ? BoxScan.sessaoDaLista(h) : null;
        const btnCaixa = _bxOpen
            ? `<button class="btn-3d" style="background:#0ea5e9;" onclick="BoxScan.open('${esc(_bxOpen.id)}','scanner')"><i class="fas fa-barcode"></i> CONTINUAR LEITURA</button>`
            : '';

        const acoes = c.status === 'CONCLUIDA' ? '' : `
          <div class="lc-acts">
            ${btnCaixa}
            ${liberado
              ? `<button class="btn-3d btn-green" onclick="ListConfirm.finalizar('${esc(h.id)}')"><i class="fas fa-check"></i> FINALIZAR CARRO</button>`
              : `<span class="lc-lock"><i class="fas fa-lock"></i> Liberado em <b id="lc-cd-${esc(h.id)}" data-alvo="${h.timestamp + minMs}">${ListConfirm.fmtDur(falta)}</b> (tempo minimo de busca: ${ListConfirm.fmtDur(minMs)})</span>`}
            ${c.status !== 'PAUSADA'
              ? `<button class="btn-3d" style="background:#8b5cf6;" onclick="ListConfirm.abrirPausa('${esc(h.id)}')"><i class="fas fa-pause"></i> PAUSAR LISTA</button>`
              : `<span class="lc-lock" style="background:#f5f3ff;border-color:#ddd6fe;color:#6d28d9;"><i class="fas fa-pause"></i> Lista pausada — a linha esta liberada para uma nova lista</span>`}
            <button class="btn-3d" style="background:#f59e0b;" onclick="ListConfirm.abrirPendencia('${esc(h.id)}')"><i class="fas fa-right-left"></i> DEIXAR PARA O PROXIMO TURNO</button>
          </div>
          <div id="lc-pause-${esc(h.id)}" style="display:none;" class="lc-form">
            <label>Motivo da pausa (obrigatorio)</label>
            <input type="text" id="lc-pnote-${esc(h.id)}" placeholder="ex.: material em falta, aguardando reposicao do WH">
            <div style="margin-top:10px;display:flex;gap:8px;">
              <button class="btn-3d" style="background:#8b5cf6;" onclick="ListConfirm.salvarPausa('${esc(h.id)}')"><i class="fas fa-pause"></i> PAUSAR</button>
              <button class="btn-3d" style="background:#94a3b8;" onclick="ListConfirm.fecharPausa('${esc(h.id)}')">Cancelar</button>
            </div>
          </div>
          <div id="lc-form-${esc(h.id)}" style="display:none;" class="lc-form">
            <div style="display:flex;gap:12px;flex-wrap:wrap;">
              <div style="flex:1;min-width:150px;">
                <label>Quantos itens estao FALTANDO?</label>
                <input type="number" min="1" max="${qtd}" id="lc-miss-${esc(h.id)}" placeholder="ex.: 4">
              </div>
              <div style="flex:2;min-width:200px;">
                <label>Observacao (opcional)</label>
                <input type="text" id="lc-note-${esc(h.id)}" placeholder="ex.: itens do carro 3 nao localizados">
              </div>
            </div>
            <div style="margin-top:10px;display:flex;gap:8px;">
              <button class="btn-3d btn-green" onclick="ListConfirm.salvarPendencia('${esc(h.id)}')"><i class="fas fa-save"></i> REGISTRAR</button>
              <button class="btn-3d" style="background:#94a3b8;" onclick="ListConfirm.fecharPendencia('${esc(h.id)}')">Cancelar</button>
            </div>
          </div>`;

        return `
        <div class="lc-card ${c.status === 'CONCLUIDA' ? 'done' : c.status === 'PAUSADA' ? 'paused' : c.status === 'PENDENTE' ? 'pend' : 'open'}">
          <div class="lc-top">
            <span class="lc-op">OP ${esc(h.config?.wo || '--')}</span>
            ${h.config?.machine ? `<span class="lc-tag" style="background:#e2e8f0;color:#475569;">MAQ ${esc(h.config.machine)}</span>` : ''}
            ${h.config?.boxSession ? '<span class="lc-tag" style="background:rgba(14,165,233,.16);color:#0369a1;"><i class="fas fa-box-open"></i> passou pela leitura de caixas</span>' : ''}
            ${tag}
            ${admBtn}
          </div>
          <div class="lc-meta">
            <span>Itens: <b>${qtd}</b></span>
            <span>Tirada por: <b>${esc(h.printUser || h.user || '--')}</b></span>
            <span>Data/hora: <b>${esc(h.printDate || new Date(h.timestamp).toLocaleString('pt-BR'))}</b></span>
            <span>Tempo minimo: <b>${ListConfirm.fmtDur(minMs)}</b></span>
            ${c.status === 'CONCLUIDA' ? `<span>Finalizada as: <b>${esc(c.finishedAt)}</b></span>` : ''}
          </div>
          ${histHTML}
          ${acoes}
        </div>`;
    },

    // v16.30: card da leitura de caixas — aparece DENTRO do card da linha
    _cardCaixa(ss) {
        const esc = (t) => Security.sanitize(String(t == null ? '' : t));
        const tot = ss.items.length;
        const ok  = ss.items.filter(i => i.f).length;
        const pct = tot ? Math.round((ok / tot) * 100) : 0;
        return `
        <div class="lc-card" style="border-left:5px solid #0ea5e9;background:#f0f9ff;">
          <div class="lc-top">
            <span class="lc-op">OP ${esc(ss.wo)}</span>
            ${ss.machine ? `<span class="lc-tag" style="background:#e2e8f0;color:#475569;">MAQ ${esc(ss.machine)}</span>` : ''}
            <span class="lc-tag" style="background:rgba(14,165,233,.16);color:#0369a1;">Leitura de caixa em andamento</span>
          </div>
          <div class="lc-meta">
            <span>Conferidos na caixa: <b>${ok} de ${tot}</b></span>
            <span>Faltam bipar: <b>${tot - ok}</b></span>
            <span>Iniciada por: <b>${esc(ss.nome)}</b></span>
            <span>Ultima leitura: <b>${esc(new Date(ss.updatedAt).toLocaleString('pt-BR'))}</b></span>
          </div>
          <div style="margin-top:10px;height:8px;border-radius:5px;background:#e0f2fe;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:#0ea5e9;"></div>
          </div>
          <div class="lc-acts">
            <button class="btn-3d btn-blue" onclick="BoxScan.open('${esc(ss.id)}','scanner')"><i class="fas fa-barcode"></i> CONTINUAR LEITURA</button>
          </div>
        </div>`;
    },

    render() {
        const el = document.getElementById('confirmContent');
        if (!el) return;
        ListConfirm._injectCSS();
        const esc = (t) => Security.sanitize(String(t == null ? '' : t));

        const listas = ListConfirm._all();

        const porLinha = ListConfirm._agrupar();
        // v16.24.2: a regra aparece SO na tela dos cards de linha (dentro da linha nao repete)
        const regra = `
          <div class="lc-rule">
            <b>Uma lista por linha:</b> so e possivel tirar uma nova lista para a linha depois que a anterior for <b>finalizada</b> ou <b>pausada</b> (a pausa exige motivo).
            <br><b>Troca de turno:</b> se a lista nao for concluida, registre quantos itens ficaram faltando — quem finalizar depois fica registrado como o responsavel pela conclusao.
          </div>`;

        const contar = (arr) => {
            let ab = 0, pd = 0, dn = 0, ps = 0, it = 0;
            arr.forEach(h => {
                const st = ListConfirm._conf(h).status;
                if (st === 'CONCLUIDA') dn++;
                else if (st === 'PAUSADA') ps++;
                else if (st === 'PENDENTE') pd++;
                else ab++;
                it += ListConfirm._qtd(h);
            });
            return { ab, pd, dn, ps, it };
        };

        // ---------- NIVEL 2: listas de uma linha ----------
        const caixasDe = (linha) => (typeof BoxScan !== 'undefined') ? BoxScan.abertasDaLinha(linha) : [];

        if (ListConfirm._linhaAberta && (porLinha[ListConfirm._linhaAberta] || caixasDe(ListConfirm._linhaAberta).length)) {
            const linha = ListConfirm._linhaAberta;
            const arr   = (porLinha[linha] || []).slice().sort((a, b) => b.timestamp - a.timestamp);
            const k     = contar(arr);
            const bx    = caixasDe(linha);
            el.innerHTML = `
            <div class="lc-wrap">
              <div class="lc-back" onclick="ListConfirm.voltar()"><i class="fas fa-arrow-left"></i> Voltar para as linhas</div>
              <div class="lc-line-h">
                <span class="lc-line-t">Linha ${esc(linha)}</span>
                <span class="lc-line-c">${arr.length} lista(s) &middot; ${k.it} materiais${bx.length ? ' &middot; ' + bx.length + ' leitura(s) de caixa' : ''}</span>
                <div class="lc-line-ln"></div>
              </div>
              ${bx.map(ss => ListConfirm._cardCaixa(ss)).join('')}
              ${arr.map(h => ListConfirm._cardLista(h)).join('')}
              ${(!arr.length && !bx.length) ? '<div style="text-align:center;color:#94a3b8;padding:30px;font-style:italic;">Nenhuma lista nesta linha.</div>' : ''}
            </div>`;
            ListConfirm._startTicker();
            return;
        }

        // ---------- NIVEL 1: cards por linha ----------
        const g = contar(listas);
        // v16.24: ordem fixa das linhas — A01..A03 e depois S01A..S10.
        // Linhas oficiais aparecem sempre; qualquer linha diferente entra no fim.
        const extras = Object.keys(porLinha).filter(l => !LINHAS.ehOficial(l)).sort(LINHAS.ordenar);
        const ordem  = LINHAS.OFICIAIS.slice().concat(extras);

        const cards = ordem.map(linha => {
            const chave = Object.keys(porLinha).find(l => LINHAS.norm(l) === LINHAS.norm(linha));
            const arr   = chave ? porLinha[chave] : [];
            const k     = contar(arr);
            const bx    = caixasDe(linha);   // v16.30: leituras de caixa da linha

            if (!arr.length && !bx.length) {
                return `
                <div class="lc-lcard lc-vazia">
                  <div class="nm">Linha ${esc(linha)}</div>
                  <div class="qt">nenhuma lista tirada</div>
                  <div class="pills"><span class="lc-pill" style="background:#f1f5f9;color:#94a3b8;">livre</span></div>
                </div>`;
            }
            const alvoLinha = chave || linha;
            const cor = bx.length ? '#0ea5e9' : (k.ab + k.pd === 0 ? 'var(--ind-green)' : k.pd ? '#f59e0b' : 'var(--tpv-blue)');
            return `
            <div class="lc-lcard" style="border-top-color:${cor};" onclick="ListConfirm.abrirLinha('${esc(alvoLinha).replace(/'/g, "")}')">
              <div class="nm">Linha ${esc(linha)}</div>
              <div class="qt">${arr.length} lista(s) &middot; ${k.it} materiais</div>
              <div class="pills">
                ${bx.length ? `<span class="lc-pill" style="background:rgba(14,165,233,.16);color:#0369a1;">${bx.length} leitura(s) de caixa</span>` : ''}
                ${k.ab ? `<span class="lc-pill" style="background:rgba(0,102,161,.12);color:var(--tpv-dark-blue);">${k.ab} aguardando</span>` : ''}
                ${k.pd ? `<span class="lc-pill" style="background:rgba(245,158,11,.18);color:#b45309;">${k.pd} pendente(s)</span>` : ''}
                ${k.ps ? `<span class="lc-pill" style="background:rgba(139,92,246,.16);color:#6d28d9;">${k.ps} pausada(s)</span>` : ''}
                ${k.dn ? `<span class="lc-pill" style="background:rgba(16,185,129,.15);color:#047857;">${k.dn} concluida(s)</span>` : ''}
              </div>
              <div class="go">Ver listas <i class="fas fa-chevron-right"></i></div>
            </div>`;
        }).join('');

        el.innerHTML = `
        <div class="lc-wrap">
          ${regra}
          <div class="lc-kpis">
            <div class="lc-kpi"><div class="n">${listas.length}</div><div class="l">Listas Tiradas</div></div>
            <div class="lc-kpi"><div class="n">${g.it}</div><div class="l">Materiais nas Listas</div></div>
            <div class="lc-kpi"><div class="n" style="color:var(--tpv-blue);">${g.ab}</div><div class="l">Aguardando</div></div>
            <div class="lc-kpi"><div class="n" style="color:#b45309;">${g.pd}</div><div class="l">Pendentes (turno)</div></div>
            <div class="lc-kpi"><div class="n" style="color:#6d28d9;">${g.ps}</div><div class="l">Pausadas</div></div>
            <div class="lc-kpi"><div class="n" style="color:var(--ind-green);">${g.dn}</div><div class="l">Concluidas</div></div>
          </div>
          <div class="lc-line-h">
            <span class="lc-line-t">Linhas</span>
            <span class="lc-line-c">clique em uma linha para ver as listas</span>
            <div class="lc-line-ln"></div>
          </div>
          <div class="lc-grid">${cards}</div>
        </div>`;

        if (ListConfirm._tick) { clearInterval(ListConfirm._tick); ListConfirm._tick = null; }
    },

    // Atualiza os contadores regressivos a cada segundo
    _startTicker() {
        if (ListConfirm._tick) clearInterval(ListConfirm._tick);
        ListConfirm._tick = setInterval(() => {
            const els = document.querySelectorAll('[id^="lc-cd-"]');
            if (!els.length) { clearInterval(ListConfirm._tick); ListConfirm._tick = null; return; }
            let liberou = false;
            els.forEach(e => {
                const falta = Number(e.dataset.alvo) - Date.now();
                if (falta <= 0) liberou = true; else e.textContent = ListConfirm.fmtDur(falta);
            });
            if (liberou) {
                const sec = document.getElementById('tab-confirmacao');
                if (sec && sec.style.display !== 'none') ListConfirm.render();
            }
        }, 1000);
    },

    // ===== v16.24: PAUSAR LISTA (motivo obrigatorio) =====
    // v16.24.1: garante um processo de cada vez — abrir um form fecha todos os outros
    _fecharTodosForms() {
        document.querySelectorAll('#confirmContent .lc-form').forEach(f => { f.style.display = 'none'; });
    },

    abrirPausa(id) {
        ListConfirm._fecharTodosForms();
        const f = document.getElementById('lc-pause-' + id);
        if (f) { f.style.display = 'block'; const i = document.getElementById('lc-pnote-' + id); if (i) i.focus(); }
    },
    fecharPausa(id) {
        const f = document.getElementById('lc-pause-' + id);
        if (f) f.style.display = 'none';
    },

    async salvarPausa(id) {
        if (!DB.guard('Pausar lista')) return;
        const h = ListConfirm._find(id);
        if (!h) return;

        const note = (document.getElementById('lc-pnote-' + id)?.value || '').trim();
        if (note.length < 5) {
            Toast.warn('Para pausar a lista e OBRIGATORIO escrever o motivo (minimo 5 caracteres).');
            const i = document.getElementById('lc-pnote-' + id); if (i) i.focus();
            return;
        }

        const c = ListConfirm._conf(h);
        if (!c.pausas) c.pausas = [];
        c.status = 'PAUSADA';
        c.pausas.push({
            by:   State.currentUser?.nome || '--',
            mat:  State.currentUser?.matricula || '--',
            at:   new Date().toLocaleString('pt-BR'),
            note: note.slice(0, 200),
        });

        await DB.saveNow();
        await Logs.log('LIST_PAUSED', `Lista OP ${h.config?.wo || '--'} (linha ${h.config?.line || '--'}) PAUSADA por ${c.pausas[c.pausas.length - 1].by} — motivo: ${note}`, h.id);
        Toast.success('Lista pausada. A linha ja pode receber uma nova lista.');
        ListConfirm.render();
    },

    abrirPendencia(id) {
        ListConfirm._fecharTodosForms();
        const f = document.getElementById('lc-form-' + id);
        if (f) { f.style.display = 'block'; const i = document.getElementById('lc-miss-' + id); if (i) i.focus(); }
    },
    fecharPendencia(id) {
        const f = document.getElementById('lc-form-' + id);
        if (f) f.style.display = 'none';
    },

    async salvarPendencia(id) {
        if (!DB.guard('Registrar pendencia de lista')) return;
        const h = ListConfirm._find(id);
        if (!h) return;
        const inp  = document.getElementById('lc-miss-' + id);
        const note = (document.getElementById('lc-note-' + id)?.value || '').trim();
        const miss = parseInt(inp?.value, 10);
        const qtd  = ListConfirm._qtd(h);

        if (!miss || miss < 1 || miss > qtd) {
            Toast.warn(`Informe quantos itens estao faltando (1 a ${qtd}).`);
            return;
        }

        const c = ListConfirm._conf(h);
        c.status = 'PENDENTE';
        c.pendencias.push({
            by:      State.currentUser?.nome || '--',
            mat:     State.currentUser?.matricula || '--',
            at:      new Date().toLocaleString('pt-BR'),
            missing: miss,
            note:    note,
        });

        await DB.saveNow();
        await Logs.log('LIST_PENDING', `Lista OP ${h.config?.wo || '--'} (linha ${h.config?.line || '--'}) deixada para o proximo turno com ${miss} item(ns) faltando`, h.id);
        Toast.success('Pendencia registrada. O proximo turno ja consegue ver o que falta.');
        ListConfirm.render();
    },

    async finalizar(id) {
        if (!DB.guard('Finalizar lista')) return;
        const h = ListConfirm._find(id);
        if (!h) return;
        const qtd   = ListConfirm._qtd(h);
        const minMs = ListConfirm.tempoMinimoMs(qtd);
        const falta = (h.timestamp + minMs) - Date.now();

        // TRAVA: nao permite finalizar antes do tempo minimo de busca
        if (falta > 0) {
            Toast.warn(`Ainda nao e possivel finalizar. Faltam ${ListConfirm.fmtDur(falta)} do tempo minimo de busca (${ListConfirm.fmtDur(minMs)} para ${qtd} itens).`);
            ListConfirm.render();
            return;
        }

        // v16.24: confirmacao obrigatoria do login que esta finalizando o carro
        ListConfirm._fecharTodosForms();
        const nome = State.currentUser?.nome || '--';
        const mat  = State.currentUser?.matricula || '--';
        const ok = await Modal.confirm(
            'Finalizar Carro',
            `Registrar a finalizacao neste login ${nome} (matricula ${mat})?\n\n` +
            `OP ${h.config?.wo || '--'}  |  Linha ${h.config?.line || '--'}  |  ${qtd} item(ns).`,
            'Sim, finalizar'
        );
        if (!ok) return;

        const c = ListConfirm._conf(h);
        c.status      = 'CONCLUIDA';
        c.finishedBy  = State.currentUser?.nome || '--';
        c.finishedMat = State.currentUser?.matricula || '--';
        c.finishedAt  = new Date().toLocaleString('pt-BR');

        await DB.saveNow();
        await Logs.log('LIST_DONE', `Carro/lista OP ${h.config?.wo || '--'} (linha ${h.config?.line || '--'}) finalizado por ${c.finishedBy} (mat. ${c.finishedMat})`, h.id);
        Toast.success(`Carro finalizado! Registrado no login ${c.finishedBy} (mat. ${c.finishedMat}).`);
        ListConfirm.render();
    },

    // ========================================================================
    // v16.31 — ACOES DE ADMINISTRADOR
    // Exigem a permissao correspondente (Sistema > Usuarios > PERMISSOES).
    // Toda acao fica registrada no historico do card e nos Logs do sistema.
    // ========================================================================

    // Encerra uma lista que ficou PENDENTE / deixada para o proximo turno
    async finalizarADM(id) {
        if (!DB.guard('Finalizar lista como administrador')) return;
        if (!Perms.can('act:list_force_done')) { Toast.error('Voce nao tem permissao para finalizar listas como administrador.'); return; }

        const h = ListConfirm._find(id);
        if (!h) { Toast.error('Lista nao encontrada.'); return; }
        const c = ListConfirm._conf(h);
        if (c.status !== 'PENDENTE') { Toast.warn('Essa acao so vale para listas pendentes / deixadas para o proximo turno.'); return; }

        const nome  = State.currentUser?.nome || '--';
        const mat   = State.currentUser?.matricula || '--';
        const falta = (c.pendencias || []).reduce((acc, pd) => acc + (parseInt(pd.missing) || 0), 0);

        const ok = await Modal.confirm(
            'Finalizar como administrador',
            `Tem certeza que deseja ENCERRAR esta lista mesmo com pendencia registrada?\n\n` +
            `OP ${h.config?.wo || '--'}  |  Linha ${h.config?.line || '--'}  |  ${ListConfirm._qtd(h)} item(ns).\n` +
            (falta ? `Pendencia aberta: ${falta} item(ns) faltando.\n` : '') +
            `\nA finalizacao ficara registrada como acao administrativa no login ${nome} (matricula ${mat}) e a linha sera liberada.`,
            'Sim, finalizar como ADM', true
        );
        if (!ok) return;

        c.status      = 'CONCLUIDA';
        c.finishedBy  = nome;
        c.finishedMat = mat;
        c.finishedAt  = new Date().toLocaleString('pt-BR');
        c.admForced   = { by: nome, mat, at: c.finishedAt, missing: falta };

        await DB.saveNow();
        await Logs.log('LIST_ADM_DONE',
            `ADM: lista OP ${h.config?.wo || '--'} (linha ${h.config?.line || '--'}) finalizada como administrador por ${nome} (mat. ${mat})`
            + (falta ? ` — havia ${falta} item(ns) pendente(s)` : ''), h.id);
        Toast.success('Lista finalizada como administrador. A linha esta liberada.', 6000);
        ListConfirm.render();
    },

    // Devolve para andamento uma lista ja CONCLUIDA
    async reabrirADM(id) {
        if (!DB.guard('Reabrir lista como administrador')) return;
        if (!Perms.can('act:list_reopen')) { Toast.error('Voce nao tem permissao para reabrir listas.'); return; }

        const h = ListConfirm._find(id);
        if (!h) { Toast.error('Lista nao encontrada.'); return; }
        const c = ListConfirm._conf(h);
        if (c.status !== 'CONCLUIDA') { Toast.warn('Essa acao so vale para listas ja concluidas.'); return; }

        const linha = h.config?.line || '--';
        const ativa = ListConfirm.listaAtivaDaLinha(linha);
        const aviso = ativa
            ? `\n\nATENCAO: a linha ${linha} ja tem a OP ${ativa.config?.wo || '--'} em andamento. Reabrindo esta, a linha ficara com duas listas ativas.`
            : `\n\nA linha ${linha} voltara a ficar ocupada por esta lista.`;

        const nome = State.currentUser?.nome || '--';
        const mat  = State.currentUser?.matricula || '--';

        const ok = await Modal.confirm(
            'Reabrir lista concluida',
            `Tem certeza que deseja REABRIR esta lista?\n\n` +
            `OP ${h.config?.wo || '--'}  |  Linha ${linha}  |  ${ListConfirm._qtd(h)} item(ns).\n` +
            `Finalizada por ${c.finishedBy || '--'} em ${c.finishedAt || '--'}.` + aviso,
            'Sim, reabrir como ADM', true
        );
        if (!ok) return;

        c.reaberturas = c.reaberturas || [];
        c.reaberturas.push({
            by: nome, mat, at: new Date().toLocaleString('pt-BR'),
            eraDe: c.finishedBy || '--', eraEm: c.finishedAt || '--',
        });

        // volta para pendente se havia pendencia registrada, senao para aberta
        c.status = (c.pendencias && c.pendencias.length) ? 'PENDENTE' : 'ABERTA';
        delete c.finishedBy; delete c.finishedMat; delete c.finishedAt; delete c.admForced;

        await DB.saveNow();
        const _ult = c.reaberturas[c.reaberturas.length - 1];
        await Logs.log('LIST_ADM_REOPEN',
            `ADM: lista OP ${h.config?.wo || '--'} (linha ${linha}) reaberta por ${nome} (mat. ${mat}) — estava finalizada por ${_ult.eraDe} em ${_ult.eraEm}`, h.id);
        Toast.success('Lista reaberta. Ela voltou para o andamento da linha.', 6000);
        ListConfirm.render();
    },
};
