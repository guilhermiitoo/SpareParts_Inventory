// ==========================================================================
// SPARE PARTS - 12-kitting.js (extraido do v16.32)
// ==========================================================================

// ============================================================
// MODULO: KITTING / BUSCA AVULSA
// ============================================================
const Kitting = {
    _results: [],
    _mode: 'code',      // 'code' | 'paste' | 'desc'
    _pasteList: [],     // codigos parseados do excel
    _hasReleased: false, // true apos liberar item — proxima busca confirma antes
    _confirmModalResolve: null, // callback do mini-modal de confirmacao

    // -------------------------------------------------------
    // Controle de modo (Code / Paste / Desc)
    // -------------------------------------------------------
    setMode(mode) {
        this._mode = mode;
        ['code','paste','desc'].forEach(m => {
            const panel = document.getElementById('kPanel' + m.charAt(0).toUpperCase() + m.slice(1));
            const tab   = document.getElementById('kModeTab' + m.charAt(0).toUpperCase() + m.slice(1));
            if (panel) panel.style.display = m === mode ? 'block' : 'none';
            if (tab) {
                tab.style.borderBottomColor = m === mode ? 'var(--tpv-blue)' : 'transparent';
                tab.style.background        = m === mode ? '#eff6ff' : '#fff';
                tab.style.color             = m === mode ? 'var(--tpv-blue)' : '#64748b';
            }
        });
        if (mode === 'code') setTimeout(() => document.querySelector('.dynamic-search-input')?.focus(), 50);
        if (mode === 'paste') setTimeout(() => document.getElementById('kPasteArea')?.focus(), 50);
        if (mode === 'desc') setTimeout(() => document.getElementById('kDescInput')?.focus(), 50);
    },

    // -------------------------------------------------------
    // Atalho para definir qtd de campos
    // -------------------------------------------------------
    setCount(n) {
        const el = document.getElementById('dynamicSearchCount');
        if (el) { el.value = n; this.generateInputs(); }
    },

    // -------------------------------------------------------
    // Gera os inputs de código (modo "Por Código")
    // -------------------------------------------------------
    generateInputs() {
        const count     = Math.min(parseInt(document.getElementById('dynamicSearchCount').value) || 1, 200);
        const container = document.getElementById('dynamicSearchInputsContainer');
        if (!container) return;
        const frag = document.createDocumentFragment();
        for (let i = 0; i < count; i++) {
            const inp = document.createElement('input');
            inp.type        = 'text';
            inp.className   = 'dynamic-search-input big-input';
            inp.placeholder = `Codigo ${i+1}...`;
            inp.onkeydown   = (e) => { if (e.key === 'Enter') Kitting.execute(); };
            frag.appendChild(inp);
        }
        container.innerHTML = '';
        container.appendChild(frag);
        container.querySelector('input')?.focus();
    },

    // -------------------------------------------------------
    // Parseia texto colado do Excel (modo "Colar do Excel")
    // -------------------------------------------------------
    parsePaste() {
        const raw   = document.getElementById('kPasteArea')?.value || '';
        const lines = raw.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
        // Lê até 18 caracteres, uppercase
        this._pasteList = lines.map(l => l.substring(0, 18).trim().toUpperCase()).filter(Boolean);
        const prev = document.getElementById('kPastePreview');
        if (prev) {
            prev.textContent = this._pasteList.length > 0
                ? `${this._pasteList.length} codigo(s) reconhecido(s): ${this._pasteList.slice(0,5).join(' | ')}${this._pasteList.length > 5 ? ' ...' : ''}`
                : '';
        }
    },

    // -------------------------------------------------------
    // Preview live na busca por descrição
    // -------------------------------------------------------
    descLive() {
        const q = (document.getElementById('kDescInput')?.value || '').trim();
        const container = document.getElementById('kDescResults');
        if (!container) return;
        if (q.length < 1) { container.style.display = 'none'; return; }
        const matches = Catalog.search(q);
        if (matches.length === 0) {
            container.style.display = 'block';
            container.innerHTML = '<div style="padding:12px; color:#94a3b8; font-size:0.85rem;">Nenhum componente encontrado no catalogo.</div>';
            return;
        }
        container.style.display = 'block';
        container.innerHTML = matches.slice(0, 30).map(c => {
            const inStock = (State.inventory || []).some(i => i.code && i.code.toUpperCase() === c.code);
            return `<div onclick="Kitting.descSelectCode('${c.code.replace(/'/g,"\\'")}', this)" class="desc-result-item">
                <div>
                    <span style="font-weight:800; color:var(--tpv-blue); font-family:'Roboto Mono',monospace; font-size:0.85rem;">${Security.sanitize(c.code)}</span>
                    <span style="margin-left:10px; color:#475569; font-size:0.85rem;">${c.description ? Security.sanitize(c.description) : '<i style="color:#cbd5e1;">sem descricao</i>'}</span>
                </div>
                <span style="font-size:0.72rem; padding:3px 8px; border-radius:12px; font-weight:700; ${inStock ? 'background:#dcfce7; color:#166534;' : 'background:#fee2e2; color:#991b1b;'}">${inStock ? 'NO ESTOQUE' : 'SEM ESTOQUE'}</span>
            </div>`;
        }).join('');
        if (matches.length > 30) {
            container.innerHTML += `<div style="padding:8px 14px; color:#94a3b8; font-size:0.78rem; text-align:center;">...e mais ${matches.length - 30} resultados. Refine a busca.</div>`;
        }
    },

    // Quando clica em um item do live preview, adiciona à busca
    descSelectCode(code, el) {
        // Destaca selecionado
        document.querySelectorAll('#kDescResults > div').forEach(d => d.classList.remove('selected'));
        if (el) el.classList.add('selected');
        // Executa busca diretamente pelo código
        this._executeWithCodes([code]);
    },

    // Busca no estoque tudo que tem código compatível com os resultados do catálogo
    descSearch() {
        const q = (document.getElementById('kDescInput')?.value || '').trim();
        if (!q) { Toast.warn('Digite uma descricao para buscar.'); return; }
        const catMatches = Catalog.search(q);
        if (catMatches.length === 0) {
            Toast.warn('Nenhum componente encontrado no catalogo para "' + q + '".');
            return;
        }
        const codes = catMatches.map(c => c.code);
        this._executeWithCodes(codes);
    },

    // -------------------------------------------------------
    // Mini-modal de confirmacao (sim/nao)
    // -------------------------------------------------------
    _showConfirmModal() {
        return new Promise(resolve => {
            Kitting._confirmModalResolve = (result) => {
                document.getElementById('kConfirmModal').style.display = 'none';
                Kitting._confirmModalResolve = null;
                resolve(result);
            };
            document.getElementById('kConfirmModal').style.display = 'flex';
        });
    },

    // -------------------------------------------------------
    // execute: ponto de entrada unificado
    // -------------------------------------------------------
    async execute(silent = false) {
        const wo = (document.getElementById('kWoInput')?.value || '').trim().toUpperCase();
        // Exibe badge do W/O ativo
        const badge = document.getElementById('kWoBadge');
        if (badge && wo) { badge.textContent = 'W/O: ' + wo; badge.style.display = 'inline-block'; }

        // Se ja houve liberacao, limpa silenciosamente e refaz a busca
        if (this._hasReleased) {
            this._hasReleased = false;
            const sp = document.getElementById('kSuccessPanel');
            if (sp) sp.style.display = 'none';
        }
        if (this._mode === 'paste') {
            if (this._pasteList.length === 0) { if (!silent) Toast.warn('Cole os codigos do Excel primeiro.'); return; }
            this._executeWithCodes(this._pasteList, silent);
        } else if (this._mode === 'desc') {
            this.descSearch();
        } else {
            State.isKittingRevealed = false;
            const inputs = Array.from(document.querySelectorAll('.dynamic-search-input'))
                .map(i => i.value.trim().toUpperCase()).filter(Boolean);
            if (inputs.length === 0) { if (!silent) Toast.warn('Preencha pelo menos um codigo.'); return; }
            this._executeWithCodes(inputs, silent);
        }
    },

    // -------------------------------------------------------
    // _executeWithCodes: núcleo de busca — recebe array de queries
    // Cada query pode ser parcial (busca por .includes())
    // -------------------------------------------------------
    _executeWithCodes(queries, silent = false) {
        State.isKittingRevealed = false;
        Kitting._results = [];

        // Garante que o painel de resultados esta visivel e o de sucesso oculto
        const src = document.getElementById('searchResultsContainer');
        if (src) src.style.display = 'block';
        const sp = document.getElementById('kSuccessPanel');
        if (sp) sp.style.display = 'none';

        const tbody = document.getElementById('searchResultsBody');
        const frag  = document.createDocumentFragment();

        const actionsContainer = document.getElementById('searchActionsContainer');
        if (actionsContainer) actionsContainer.innerHTML = `<button class="btn-3d btn-red" onclick="Kitting.releaseAndCheckout()"><i class="fas fa-unlock"></i> LIBERAR POSICOES E BAIXAR</button>`;
        const sit = document.getElementById('searchInstructionText');
        if (sit) sit.innerHTML = 'Selecione os itens e clique em <b>Liberar</b>.';

        let foundAny = false;

        queries.forEach(code => {
            // Para busca por descrição os codes já vêm exatos; para código usa includes
            const matches = State.inventory.filter(i => i.code && i.code.toUpperCase().includes(code));

            const groupHeader = document.createElement('tr');
            groupHeader.style.cssText = 'background:#f1f5f9; border-top:2px solid #cbd5e1;';
            groupHeader.innerHTML = `<td colspan="6" style="font-weight:900; color:var(--tpv-dark-blue); font-size:0.85rem; padding-top:15px;">RESULTADOS PARA: "${Security.sanitize(code)}"</td>`;
            frag.appendChild(groupHeader);

            if (matches.length > 0) {
                foundAny = true;
                // Ordena: maior quantidade primeiro
                const sorted = [...matches].sort((a, b) => (Number(b.qty) || 0) - (Number(a.qty) || 0));
                const maxQty = Number(sorted[0].qty) || 0;
                sorted.forEach(m => {
                    Kitting._results.push(m);
                    const isMax = (Number(m.qty) || 0) === maxQty && maxQty > 0;
                    const tr    = document.createElement('tr');
                    tr.className    = 'search-result-row';
                    tr.dataset.id   = m.id;
                    if (isMax) {
                        tr.style.cssText = 'background-color:#fefce8; border-left:4px solid var(--ind-yellow);';
                        // Auto-seleciona o de maior estoque
                        tr._autoSelect = true;
                    }
                    const catItem = Catalog.findByCode(m.code);
                    const desc    = catItem && catItem.description
                        ? Security.sanitize(catItem.description)
                        : '<span style="color:#cbd5e1;">-</span>';
                    tr.innerHTML = `
                        <td style="text-align:center; padding:8px 6px;"><input type="checkbox" class="search-item-chk" value="${Security.sanitize(m.id)}" ${isMax ? 'checked' : ''} style="width:20px; height:20px; cursor:pointer;"></td>
                        <td style="font-weight:bold; color:var(--tpv-blue); padding:8px 10px;">${Security.sanitize(m.code)}${isMax ? ' <span style="font-size:0.7rem; background:var(--ind-yellow); color:#000; padding:2px 6px; border-radius:4px; font-weight:bold;"><i class="fas fa-star"></i> MAIOR</span>' : ''}</td>
                        <td style="font-size:0.8rem; color:#64748b; font-style:italic; padding:8px 10px;">${desc}</td>
                        <td style="text-align:center; padding:8px 10px; ${isMax ? 'font-weight:900; color:#b45309;' : ''}">${m.qty}</td>
                        <td style="text-align:center; padding:8px 10px;"><span style="background:#e2e8f0; color:#64748b; padding:4px 8px; border-radius:4px; font-weight:bold; letter-spacing:2px;">***</span></td>
                        <td style="text-align:center; padding:8px 10px;"><span style="background:#e2e8f0; color:#64748b; padding:4px 8px; border-radius:4px; font-weight:bold; letter-spacing:2px;">***</span></td>
                    `;
                    frag.appendChild(tr);
                });
            } else {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td style="text-align:center;">-</td><td style="font-weight:bold; color:var(--ind-red);">${Security.sanitize(code)}</td><td colspan="4" style="color:var(--ind-red); font-style:italic;">Nao encontrado no estoque.</td>`;
                frag.appendChild(tr);
            }
        });

        tbody.innerHTML = '';
        tbody.appendChild(frag);

        document.getElementById('searchResultsContainer').style.display = 'block';
        const releaseBtn = document.querySelector('#searchActionsContainer .btn-red');
        if (releaseBtn) releaseBtn.style.display = foundAny ? 'inline-flex' : 'none';

        if (!silent) Logs.log('SEARCH_KITTING', `Busca de kitting para ${queries.length} material(is)`);
    },

    async releaseAndCheckout() {
        if (!DB.guard('Kitting - Baixa Avulsa')) return;
        const checked     = document.querySelectorAll('.search-item-chk:checked');
        const idsToRemove = Array.from(checked).map(c => String(c.value));
        if (idsToRemove.length === 0) { Toast.warn('Selecione pelo menos um material.'); return; }

        const snapshotItems = idsToRemove
            .map(id => State.inventory.find(i => String(i.id) === id))
            .filter(Boolean)
            .map(m => ({ ...m }));

        if (snapshotItems.length === 0) {
            Toast.error('Nenhum item encontrado no estoque. O estoque pode ter sido atualizado. Refaca a busca.');
            Kitting.execute(true);
            return;
        }

        if (snapshotItems.length < idsToRemove.length) {
            const diff = idsToRemove.length - snapshotItems.length;
            Toast.warn(`Atencao: ${diff} item(ns) nao encontrado(s) no estoque atual. Apenas ${snapshotItems.length} sera(o) baixado(s).`);
        }

        Commitment.open(async () => {
            State.isKittingRevealed = true;

            const itemsToRemove = snapshotItems.filter(snap =>
                State.inventory.some(i => String(i.id) === String(snap.id))
            );

            if (itemsToRemove.length === 0) {
                Toast.error('Todos os itens selecionados ja foram retirados por outro usuario. Refaca a busca.');
                State.isKittingRevealed = false;
                Kitting.execute(true);
                return;
            }

            const finalIds = itemsToRemove.map(m => String(m.id));
            // v16.17.1: itens de ARMARIO (IA) sao fixos e nunca sao baixados
            const _fixosK = itemsToRemove.filter(m => PTHCabinets.isCabinet(m.car)).length;
            State.inventory = State.inventory.filter(i =>
                PTHCabinets.isCabinet(i.car) || !finalIds.includes(String(i.id))
            );
            if (_fixosK > 0) Toast.info(`${_fixosK} item(ns) de armario (IA) permanecem no estoque — posicao fixa.`, 6000);

            const woVal = (document.getElementById('kWoInput')?.value || '').trim().toUpperCase() || '--';

            // v16.24.2: a lista sai na ordem de busca — carro e locacao crescentes
            const itemsOrdenados = Picking.ordenar(itemsToRemove);

            const kittingRows = itemsOrdenados.map(m => `
                <tr>
                    <td style="font-weight:bold; text-align:left;">${Security.sanitize(m.code)}</td>
                    <td style="text-align:center; font-weight:900;">${m.qty || 1}</td>
                    <td style="text-align:center; color:var(--tpv-blue); font-weight:bold;">${Security.sanitize(m.car)}</td>
                    <td style="text-align:center; font-weight:900; font-size:1.1rem;">${Security.sanitize(m.loc)}</td>
                    <td style="text-align:center;"><span class="badge bg-ok">BAIXADO</span></td>
                </tr>
            `).join('');

            const kittingThead = '<tr><th style="text-align:left;">Codigo Material</th><th>Quantidade</th><th>Carro</th><th>Posicao</th><th>Status</th></tr>';

            const histId = `${Date.now()}`;
            State.checkoutHistory.unshift({
                id: histId, type: 'MANUAL_KITTING',
                removedItems: itemsToRemove,
                tableHTML: kittingRows,
                tableHead: kittingThead,
                printUser: State.currentUser.nome,
                printDate: new Date().toLocaleString('pt-BR'),
                user: State.currentUser.nome, matricula: State.currentUser.matricula,
                timestamp: Date.now(),
                config: { wo: woVal },
            });

            await DB.saveNow();
            await Logs.log('CHECKOUT_MANUAL', `Baixou ${itemsToRemove.length} itens via Busca Avulsa (W/O: ${woVal})`, histId);

            // Mostra resultado no painel de sucesso (sem destruir a estrutura de busca)
            const successBody = document.getElementById('kSuccessBody');
            const successMsg  = document.getElementById('kSuccessMsg');
            const successPanel = document.getElementById('kSuccessPanel');
            const successPrintBtn = document.getElementById('kSuccessPrintBtn');

            if (successMsg)  successMsg.textContent = `${itemsToRemove.length} item(ns) baixado(s) com sucesso! (W/O: ${woVal})`;
            if (successBody) successBody.innerHTML  = itemsOrdenados.map(m => `
                <tr style="border-bottom:1px solid #bbf7d0;">
                    <td style="font-weight:bold; padding:7px 10px; color:#166534;">${Security.sanitize(m.code)}</td>
                    <td style="text-align:center; padding:7px 10px; font-weight:900;">${m.qty}</td>
                    <td style="text-align:center; padding:7px 10px; color:var(--tpv-blue); font-weight:bold;">${Security.sanitize(m.car)}</td>
                    <td style="text-align:center; padding:7px 10px; font-weight:900; font-size:1.05rem;">${Security.sanitize(m.loc)}</td>
                </tr>`).join('');
            if (successPrintBtn) successPrintBtn.onclick = () => Kitting.print(histId);
            if (successPanel) successPanel.style.display = 'block';

            // Esconde o painel de busca (mantém estrutura intacta)
            document.getElementById('searchResultsContainer').style.display = 'none';

            // Marca que houve liberação — próxima busca vai perguntar antes
            Kitting._hasReleased = true;

            Toast.success(`${itemsToRemove.length} itens baixados!`);
        });
    },

    reset() {
        // Esconde resultados, painel de sucesso e limpa tudo
        const src = document.getElementById('searchResultsContainer');
        if (src) src.style.display = 'none';
        const sb  = document.getElementById('searchResultsBody');
        if (sb)  sb.innerHTML = '';
        const sp  = document.getElementById('kSuccessPanel');
        if (sp)  { sp.style.display = 'none'; }
        const sab = document.getElementById('kSuccessBody');
        if (sab) sab.innerHTML = '';
        const sm  = document.getElementById('kSuccessMsg');
        if (sm)  sm.textContent = '';
        // Restaura botao de liberar no container de acoes
        const sac = document.getElementById('searchActionsContainer');
        if (sac)  sac.innerHTML = '<button class="btn-3d btn-red" onclick="Kitting.releaseAndCheckout()"><i class="fas fa-unlock"></i> LIBERAR POSICOES E BAIXAR</button>';
        const sit = document.getElementById('searchInstructionText');
        if (sit)  sit.innerHTML = 'Selecione os itens e clique em <b>Liberar</b>.';

        this._hasReleased = false;
        this._results = [];

        // Limpar W/O badge (mantém o campo preenchido para reuso imediato)
        const badge = document.getElementById('kWoBadge');
        if (badge) badge.style.display = 'none';

        // Limpar inputs
        document.querySelectorAll('.dynamic-search-input').forEach(i => i.value = '');
        const pasteArea = document.getElementById('kPasteArea');
        if (pasteArea) pasteArea.value = '';
        this._pasteList = [];
        const pastePreview = document.getElementById('kPastePreview');
        if (pastePreview) pastePreview.textContent = '';
        const descInput = document.getElementById('kDescInput');
        if (descInput) descInput.value = '';
        const descRes = document.getElementById('kDescResults');
        if (descRes) { descRes.innerHTML = ''; descRes.style.display = 'none'; }
        document.querySelector('.dynamic-search-input')?.focus();
    },

    print(histId) {
        const hist = State.checkoutHistory.find(h => String(h.id) === String(histId));
        if (!hist) { Toast.warn('Historico nao encontrado.'); return; }

        const printBody   = document.getElementById('kittingPrintBody');
        const printUser   = document.getElementById('kittingPrintUser');
        const printDate   = document.getElementById('kittingPrintDate');
        const printTable  = document.getElementById('kittingPrintTable');
        const printHeader = document.getElementById('kittingPrintHeader');

        if (printBody)   printBody.innerHTML   = hist.tableHTML || '';
        if (printUser)   printUser.textContent  = hist.printUser || '--';
        if (printDate)   printDate.textContent  = hist.printDate || '--';
        // NAO setar display inline aqui: o CSS de impressao (body.print-kitting)
        // ja mostra header/tabela so na impressao. Setar inline fazia o cabecalho
        // "NOTA DE RETIRADA" vazar e ficar visivel na tela apos imprimir.

        document.querySelectorAll('#mainApp .section').forEach(s => s.classList.remove('active'));
        const estoqueTab = document.getElementById('tab-estoque');
        if (estoqueTab) estoqueTab.classList.add('active');
        document.querySelectorAll('#mainNav .nav-item').forEach(el2 => {
            el2.classList.toggle('active', el2.getAttribute('onclick')?.includes("'estoque'"));
        });

        Toast.info('Abrindo impressao...', 2000);
        setTimeout(() => {
            document.body.classList.add('print-kitting');
            window.print();
            setTimeout(() => {
                document.body.classList.remove('print-kitting');
                UI.navUser('estoque');
            }, 600);
        }, 400);
    },
};
