// ==========================================================================
// SPARE PARTS - 13-estoque.js (extraido do v16.32)
// ==========================================================================

// ============================================================
// MODULO: INVENTARIO (CRUD)
// ============================================================
const Inventory = {
    // noSave=true: só muta o estado, não grava. O chamador é responsável pelo save.
    async updateItem(car, loc, code, qty, noSave = false) {
        car  = Security.sanitize(car);
        loc  = Security.sanitize(loc);
        code = Security.sanitize(code);

        const isCarValid = State.validLocations.some(l => l.car === car);
        if (!isCarValid && State.currentUser && !State.currentUser.isAdmin) {
            Toast.error('Este carro nao existe no Mapa de Carros.');
            return false;
        }

        const isLocValid = State.validLocations.some(l => l.car === car && l.loc === loc);
        if (!isLocValid) {
            State.validLocations.push({ car, loc, id: `${Date.now()}_${Math.random().toString(36).slice(2)}` });
        }

        const existing = State.inventory.find(i => i.car === car && i.loc === loc);
        if (existing) {
            existing.code = code;
            existing.qty  = qty;
            existing.timestamp = Date.now();
        } else {
            State.inventory.push({ id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, code, car, loc, qty, timestamp: Date.now() });
        }

        if (!noSave) {
            await DB.saveNow();
            UI.triggerRefresh();
        }
        return true;
    },
};

// ============================================================
// MODULO: ARMARIOS PTH (posicoes fixas) — v16.17
// Itens PTH ficam em armarios de posicoes fixas, nao em carros.
// A base abaixo e FIXA no sistema (extraida da planilha Carro_Geral_PTH,
// aba "IA-PTH NOVO"): cada armario e criado vazio, com N posicoes
// numeradas. O usuario escolhe o material de cada posicao normalmente.
// Nomenclatura exibida: "ARMARIO - IA_01_01".
// ============================================================
const PTHCabinets = {
    // Nome exibido: "IA 01-01", "IA 02-01", ...
    NAME_RE: /^IA\s\d{2}-\d{2}$/,
    LEGACY_PREFIX: 'ARMÁRIO - ',

    // [nome da posicao no armario, quantidade de posicoes internas]
    BASE: [
        ['IA 01-01',9],
        ['IA 01-02',9],
        ['IA 01-03',9],
        ['IA 01-04',9],
        ['IA 01-05',9],
        ['IA 01-06',9],
        ['IA 01-07',9],
        ['IA 02-01',9],
        ['IA 02-02',9],
        ['IA 02-03',9],
        ['IA 02-04',9],
        ['IA 02-05',9],
        ['IA 02-06',9],
        ['IA 02-07',9],
        ['IA 03-01',9],
        ['IA 03-02',9],
        ['IA 03-03',9],
        ['IA 03-04',9],
        ['IA 03-05',9],
        ['IA 03-06',8],
        ['IA 03-07',9],
        ['IA 04-01',24],
        ['IA 04-02',24],
        ['IA 04-03',23],
        ['IA 04-04',9],
        ['IA 04-05',9],
        ['IA 04-06',9],
        ['IA 04-07',9],
        ['IA 04-08',9],
        ['IA 04-09',9],
        ['IA 04-10',9],
        ['IA 04-11',9],
        ['IA 04-12',6],
        ['IA 04-13',9],
        ['IA 04-14',9]
    ],

    // true se o nome do "carro" e, na verdade, um armario PTH
    isCabinet(name) {
        if (typeof name !== 'string') return false;
        return PTHCabinets.NAME_RE.test(name.trim()) || name.indexOf(PTHCabinets.LEGACY_PREFIX) === 0;
    },

    // Converte o nome antigo "ARMÁRIO - IA_01_01" para o novo "IA 01-01"
    _newName(oldName) {
        const m = String(oldName).match(/IA[_\s-]*(\d{2})[_\s-]*(\d{2})/i);
        return m ? `IA ${m[1]}-${m[2]}` : oldName;
    },

    // v16.17.1: migra bases antigas (renomeia os armarios uma unica vez)
    migrate() {
        let n = 0;
        const fix = obj => {
            if (obj && typeof obj.car === 'string' && obj.car.indexOf(PTHCabinets.LEGACY_PREFIX) === 0) {
                obj.car = PTHCabinets._newName(obj.car);
                if (obj.id) obj.id = obj.car + '_' + obj.loc;
                n++;
            }
        };
        (State.validLocations || []).forEach(fix);
        (State.inventory      || []).forEach(fix);
        if (State.carMaterialType) {
            Object.keys(State.carMaterialType).forEach(k => {
                if (k.indexOf(PTHCabinets.LEGACY_PREFIX) === 0) {
                    State.carMaterialType[PTHCabinets._newName(k)] = State.carMaterialType[k];
                    delete State.carMaterialType[k];
                }
            });
        }
        return n;
    },

    // v16.17: EDITAR MATERIAL DE UMA POSICAO DE ARMARIO.
    // Exclusivo dos armarios PTH — abre um modal com Codigo + Quantidade.
    // Carros comuns continuam com o fluxo normal (importacao/devolucao).
    async editItem(car, loc) {
        if (!PTHCabinets.isCabinet(car)) { Toast.error('Esta funcao e exclusiva dos armarios PTH.'); return; }
        if (!DB.guard('Editar item do armario')) return;
        if (!State.currentUser) { Toast.error('Faca login para editar.'); return; }
        if (!Perms.can('act:stock_edit')) { Toast.error('Voce nao tem permissao para editar itens do estoque.'); return; }

        const atual = State.inventory.find(i => i.car === car && i.loc === loc);
        const codeAtual = atual?.code || '';
        const qtyAtual  = atual?.qty  || 0;

        const dados = await new Promise(resolve => {
            const backdrop = document.createElement('div');
            backdrop.className = 'modal-backdrop';
            backdrop.style.zIndex = '200002';
            backdrop.innerHTML = `
                <div class="modal-box" style="max-width:430px;">
                    <div class="modal-title"><i class="fas fa-pen" style="color:var(--tpv-blue);"></i> Editar Posicao do Armario</div>
                    <div class="modal-body" style="margin-bottom:10px;">
                        <span style="font-weight:800; color:var(--tpv-dark-blue);">${Security.sanitize(car)}</span>
                        &nbsp;&bull;&nbsp; Posicao <span style="font-family:'Roboto Mono',monospace; font-weight:900;">${Security.sanitize(loc)}</span>
                    </div>
                    <label style="font-weight:bold; font-size:0.82rem; color:#475569;">Codigo do Material:</label>
                    <input id="_pthCode" type="text" class="modal-input" placeholder="Bipe ou digite o codigo" autocomplete="off" maxlength="60">
                    <label style="font-weight:bold; font-size:0.82rem; color:#475569; margin-top:12px; display:block;">Quantidade:</label>
                    <input id="_pthQty" type="number" class="modal-input" min="0" step="1" placeholder="0">
                    <div style="font-size:0.75rem; color:#94a3b8; margin-top:8px;">Deixe o codigo em branco para esvaziar a posicao.</div>
                    <div style="display:flex; gap:10px; margin-top:18px;">
                        <button class="btn-3d btn-gray" style="flex:1;" id="_pthCancel">CANCELAR</button>
                        <button class="btn-3d btn-green" style="flex:2;" id="_pthOk"><i class="fas fa-check-circle"></i> SALVAR</button>
                    </div>
                </div>`;
            document.body.appendChild(backdrop);
            const iCode = backdrop.querySelector('#_pthCode');
            const iQty  = backdrop.querySelector('#_pthQty');
            iCode.value = codeAtual;
            iQty.value  = qtyAtual;
            setTimeout(() => { iCode.focus(); iCode.select(); }, 60);
            const close = v => { if (backdrop.parentElement) document.body.removeChild(backdrop); resolve(v); };
            backdrop.querySelector('#_pthCancel').onclick = () => close(null);
            backdrop.querySelector('#_pthOk').onclick     = () => close({ code: iCode.value.trim(), qty: parseInt(iQty.value, 10) || 0 });
            iCode.onkeydown = e => { if (e.key === 'Enter') iQty.focus(); };
            iQty.onkeydown  = e => { if (e.key === 'Enter') backdrop.querySelector('#_pthOk').click(); };
        });

        if (dados === null) return;

        // Codigo em branco = esvaziar a posicao (a posicao FIXA continua existindo)
        if (!dados.code) {
            State.inventory = State.inventory.filter(i => !(i.car === car && i.loc === loc));
            await DB.saveNow();
            await Logs.log('EDIT', `Armario ${car} — posicao ${loc} esvaziada`);
            UI.triggerRefresh();
            StockAdmin.renderMapManager();
            Toast.success(`Posicao ${loc} esvaziada.`);
            return;
        }

        const ok = await Inventory.updateItem(car, loc, dados.code, dados.qty);
        if (!ok) return;
        await Logs.log('EDIT', `Armario ${car} — posicao ${loc}: ${Security.sanitize(dados.code)} (qtd ${dados.qty})`);
        StockAdmin.renderMapManager();
        Toast.success(`Posicao ${loc} atualizada: ${Security.sanitize(dados.code)} — ${dados.qty} un.`);
    },

    // Cria (uma unica vez) os armarios e suas posicoes vazias.
    // Idempotente: nunca duplica, nunca apaga e nunca sobrescreve material.
    ensure() {
        if (!State.validLocations) State.validLocations = [];
        let added = 0;
        PTHCabinets.migrate();   // renomeia armarios de bases antigas
        PTHCabinets.BASE.forEach(([car, total]) => {
            const existentes = new Set(State.validLocations.filter(l => l.car === car).map(l => String(l.loc)));
            for (let i = 1; i <= total; i++) {
                const loc = String(i).padStart(2, '0');
                if (!existentes.has(loc)) {
                    State.validLocations.push({ car, loc, id: car + '_' + loc });
                    added++;
                }
            }
        });
        return added;
    }
};

// ============================================================
// MODULO: ADMIN - ESTOQUE
// ============================================================
const StockAdmin = {
    _auditId: null,

    // v17.02 — apoio da paginacao das tabelas de locacao.
    // A barra fica FORA da <table>: um <div> solto dentro de <table> e movido
    // pelo parser do HTML e apareceria no lugar errado.
    _barraPaginacao(html) {
        const box = document.getElementById('estoquePaginacao');
        if (box) box.innerHTML = html || '';
    },

    // Redesenha a visao atual mantendo o carro selecionado (usado pelos
    // botoes de pagina, que nao sabem qual carro esta aberto).
    _recarregarMapa() {
        StockAdmin.selectCar(State.selectedMapCar || 'ALL');
    },

    renderMapManager() {
        const listDiv = document.getElementById('adminCarList');
        if (!listDiv) return;
        // v16.17: armarios PTH ficam sempre no FINAL da lista
        const cars = [...new Set(State.validLocations.map(l => l.car))].sort((a,b) => {
            const ca = PTHCabinets.isCabinet(a) ? 1 : 0, cb = PTHCabinets.isCabinet(b) ? 1 : 0;
            if (ca !== cb) return ca - cb;
            return a.localeCompare(b,undefined,{numeric:true});
        });
        const frag  = document.createDocumentFragment();

        const allItem = document.createElement('div');
        allItem.className = `car-item ${State.selectedMapCar === 'ALL' ? 'selected' : ''}`;
        allItem.innerHTML = `<span><i class="fas fa-globe"></i> Visao Geral (Todos)</span><i class="fas fa-chevron-right" style="font-size:0.8rem; opacity:0.5;"></i>`;
        allItem.onclick   = () => StockAdmin.selectCar('ALL');
        frag.appendChild(allItem);

        cars.forEach(c => {
            const item     = document.createElement('div');
            item.className = `car-item ${State.selectedMapCar === c ? 'selected' : ''}`;
            const _ico = PTHCabinets.isCabinet(c) ? 'fa-archive' : 'fa-box';
            item.innerHTML = `<span><i class="fas ${_ico}"></i> ${Security.sanitize(c)}</span><i class="fas fa-chevron-right" style="font-size:0.8rem; opacity:0.5;"></i>`;
            item.onclick   = () => StockAdmin.selectCar(c);
            frag.appendChild(item);
        });

        listDiv.innerHTML = '';
        listDiv.appendChild(frag);
        if (State.selectedMapCar) StockAdmin.renderLocEditor(State.selectedMapCar);
    },

    selectCar(car) {
        State.selectedMapCar = car;
        StockAdmin.renderMapManager();
    },

    renderLocEditor(car) {
        document.getElementById('locEditorEmpty').style.display   = 'none';
        document.getElementById('locEditorContent').style.display = 'flex';
        const isAdmin = State.currentUser && State.currentUser.isAdmin;
        const tbody   = document.getElementById('adminLocTableBody');
        const thead   = document.getElementById('adminLocTableHead');
        const toolbar = document.getElementById('adminEditorToolbar');

        // v17.02 — INDICE DO INVENTARIO.
        // Antes: State.inventory.find(...) DENTRO do forEach das locacoes (O(n x m)).
        //
        // MEDIDO com 3.000 locacoes e 2.000 itens (testes/paginacao.js):
        //   busca antiga no laco .......  32ms   <- nao era o gargalo
        //   desenhar 3.000 <tr> no DOM .. 119ms  <- era ISTO
        // Ou seja: quem resolve a lentidao e a PAGINACAO, nao este indice.
        // O indice fica porque e mais claro e nao degrada se o estoque crescer,
        // mas o ganho dele sozinho e pequeno — o numero acima esta aqui para
        // ninguem (eu inclusive) repetir a suposicao errada.
        //
        // O agravante real: renderLocEditor roda dentro do triggerRefresh, que
        // dispara a CADA sincronismo. Sem paginar, todo PC redesenhava 3.000
        // linhas toda vez que qualquer colega gravava qualquer coisa.
        const _inv = new Map();
        (State.inventory || []).forEach(i => { if (i.car && i.loc) _inv.set(i.car + '|' + i.loc, i); });

        if (car === 'ALL') {
            toolbar.style.display = 'none';
            thead.innerHTML = `<tr><th>Carro</th><th>Locacao</th><th>Item (Cod)</th><th>Qtd</th><th style="width:80px; text-align:center;">Acoes</th></tr>`;
            const locs = [...State.validLocations].sort((a,b) => {
                const c = a.car.localeCompare(b.car,undefined,{numeric:true}); return c !== 0 ? c : a.loc.localeCompare(b.loc,undefined,{numeric:true});
            });
            document.getElementById('locCountBadge').textContent = locs.length;
            const _pag = Paginador.fatiar('estoque_todos', locs);
            StockAdmin._barraPaginacao(Paginador.controles('estoque_todos', _pag, 'StockAdmin._recarregarMapa'));
            const frag = document.createDocumentFragment();
            _pag.itens.forEach(l => {
                const item = _inv.get(l.car + '|' + l.loc);
                const tr   = document.createElement('tr');
                tr.innerHTML = `<td><strong>${Security.sanitize(l.car)}</strong></td><td><strong>${Security.sanitize(l.loc)}</strong></td><td>${item?.code ? `<b>${Security.sanitize(item.code)}</b>` : '<span style="color:#94a3b8; font-style:italic;">[ Vazio ]</span>'}</td><td>${item?.qty || ''}</td><td style="text-align:center;">${(item?.code && Perms.can('act:stock_clear')) ? `<button class="btn-3d btn-gray" style="padding:5px 10px;" title="Limpar material desta posicao" onclick="StockAdmin.deleteLoc('${Security.sanitize(l.id)}')"><i class="fas fa-broom"></i></button>` : '<span style="color:#e2e8f0;">—</span>'}</td>`;
                frag.appendChild(tr);
            });
            tbody.innerHTML = ''; tbody.appendChild(frag);
        } else {
            toolbar.style.display = 'flex';
            thead.innerHTML = `<tr><th>Locacao</th><th>Item (Cod)</th><th>Qtd</th><th style="width:${PTHCabinets.isCabinet(car) ? 175 : 130}px; text-align:center;">Acoes</th></tr>`;
            const locs = State.validLocations.filter(l => l.car === car).sort((a,b) => a.loc.localeCompare(b.loc,undefined,{numeric:true}));
            document.getElementById('locCountBadge').textContent = locs.length;
            const _pag = Paginador.fatiar('estoque_carro', locs);
            StockAdmin._barraPaginacao(Paginador.controles('estoque_carro', _pag, 'StockAdmin._recarregarMapa'));
            const frag = document.createDocumentFragment();
            _pag.itens.forEach(l => {
                const item = _inv.get(car + '|' + l.loc);
                const tr   = document.createElement('tr');
                // v16.17: botao EDITAR — exclusivo dos armarios PTH
                const _btnEdit = (PTHCabinets.isCabinet(car) && Perms.can('act:stock_edit'))
                    ? `<button class="btn-3d btn-blue" style="padding:5px 8px;" title="Editar codigo e quantidade desta posicao" onclick="PTHCabinets.editItem('${Security.sanitize(car)}','${Security.sanitize(l.loc)}')"><i class="fas fa-pen"></i></button> `
                    : '';
                tr.innerHTML = `<td><strong>${Security.sanitize(l.loc)}</strong></td><td>${item?.code ? `<b>${Security.sanitize(item.code)}</b>` : '<span style="color:#94a3b8; font-style:italic;">[ Vazio ]</span>'}</td><td>${item?.qty || ''}</td><td style="text-align:center; white-space:nowrap;">${_btnEdit}${(item?.code && Perms.can('act:stock_clear')) ? `<button class="btn-3d btn-gray" style="padding:5px 8px;" title="Limpar material desta posicao" onclick="StockAdmin.deleteLoc('${Security.sanitize(l.id)}')"><i class="fas fa-broom"></i></button> ` : ''}${Perms.can('act:stock_delloc') ? `<button class="btn-3d btn-red" style="padding:5px 8px;" title="Apagar locacao do carro" onclick="StockAdmin.deleteLocSlot('${Security.sanitize(l.id)}')"><i class="fas fa-trash-alt"></i></button>` : ''}</td>`;
                frag.appendChild(tr);
            });
            tbody.innerHTML = ''; tbody.appendChild(frag);
        }
    },

    async addCar() {
        if (!Perms.can('act:stock_tools')) { Toast.error('Voce nao tem permissao para adicionar carros.'); return; }
        // ---- PASSO 1: Nome do carro ----
        const carName = await new Promise(resolve => {
            const backdrop = document.createElement('div');
            backdrop.className = 'modal-backdrop';
            backdrop.innerHTML = `
                <div class="modal-box" style="max-width:420px;">
                    <div class="modal-title"><i class="fas fa-plus-circle" style="color:var(--ind-green);"></i> Novo Carro — Passo 1 de 2</div>
                    <div class="modal-body">Digite o nome ou numero do carro.<br><span style="font-size:0.82rem; color:#94a3b8;">Ex: <b>19</b>, <b>CARRO 19</b>, <b>C-19</b></span></div>
                    <input id="_addCarName" type="text" class="modal-input" placeholder="Ex: 19" autocomplete="off" maxlength="30">
                    <div style="display:flex; gap:10px; margin-top:18px;">
                        <button class="btn-3d btn-gray" style="flex:1;" id="_addCarCancel1">CANCELAR</button>
                        <button class="btn-3d btn-blue" style="flex:2;" id="_addCarNext">PROXIMO <i class="fas fa-arrow-right"></i></button>
                    </div>
                </div>`;
            document.body.appendChild(backdrop);
            const inp = backdrop.querySelector('#_addCarName');
            setTimeout(() => inp.focus(), 80);
            const go = () => {
                const v = inp.value.trim().toUpperCase();
                document.body.removeChild(backdrop);
                resolve(v || null);
            };
            backdrop.querySelector('#_addCarCancel1').onclick = () => { document.body.removeChild(backdrop); resolve(null); };
            backdrop.querySelector('#_addCarNext').onclick = go;
            inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
        });
        if (!carName) return;

        // Verifica se carro ja existe
        if (State.validLocations.some(l => l.car === Security.sanitize(carName))) {
            Toast.warn(`Carro "${carName}" ja existe no sistema.`); return;
        }

        // ---- PASSO 2: Posicoes ----
        const posResult = await new Promise(resolve => {
            const backdrop = document.createElement('div');
            backdrop.className = 'modal-backdrop';
            backdrop.innerHTML = `
                <div class="modal-box" style="max-width:480px;">
                    <div class="modal-title"><i class="fas fa-map-pin" style="color:var(--tpv-blue);"></i> Posicoes — Passo 2 de 2</div>
                    <div class="modal-body">
                        <span style="font-weight:800; color:var(--tpv-dark-blue);">Carro: ${Security.sanitize(carName)}</span><br><br>
                        Selecione uma faixa rapida ou digite manualmente:
                    </div>
                    <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px;">
                        <button class="_rangeBtn btn-3d btn-blue" style="font-size:0.78rem; padding:7px 12px;" data-range="001-090">001 a 090</button>
                        <button class="_rangeBtn btn-3d btn-blue" style="font-size:0.78rem; padding:7px 12px;" data-range="001-060">001 a 060</button>
                        <button class="_rangeBtn btn-3d btn-blue" style="font-size:0.78rem; padding:7px 12px;" data-range="001-120">001 a 120</button>
                        <button class="_rangeBtn btn-3d btn-blue" style="font-size:0.78rem; padding:7px 12px;" data-range="001-150">001 a 150</button>
                    </div>
                    <div style="font-size:0.8rem; font-weight:700; color:#475569; margin-bottom:6px;">Ou digite manualmente (faixa "001-090" ou lista "001,002,003"):</div>
                    <input id="_addCarPos" type="text" class="modal-input" placeholder="Ex: 001-090" autocomplete="off">
                    <div id="_addCarPreview" style="margin-top:10px; font-size:0.82rem; font-weight:700; color:var(--ind-green); min-height:1.2em; text-align:center;"></div>
                    <div style="display:flex; gap:10px; margin-top:14px;">
                        <button class="btn-3d btn-gray" style="flex:1;" id="_addCarCancel2">CANCELAR</button>
                        <button class="btn-3d btn-green" style="flex:2;" id="_addCarConfirm" disabled><i class="fas fa-check-circle"></i> CRIAR CARRO</button>
                    </div>
                </div>`;
            document.body.appendChild(backdrop);

            const inp       = backdrop.querySelector('#_addCarPos');
            const preview   = backdrop.querySelector('#_addCarPreview');
            const btnCreate = backdrop.querySelector('#_addCarConfirm');

            const parsePos = (raw) => {
                const r = raw.toUpperCase().trim();
                let list = [];
                const m = r.match(/^(\d+)\s*-\s*(\d+)$/);
                if (m) {
                    const a = m[1], b = m[2];
                    const s = parseInt(a), e = parseInt(b);
                    const pad = Math.max(a.length, b.length);
                    if (!isNaN(s) && !isNaN(e) && s <= e) for (let i = s; i <= e; i++) list.push(String(i).padStart(pad, '0'));
                } else {
                    list = r.split(',').map(x => x.trim()).filter(Boolean);
                }
                return list;
            };

            const updatePreview = () => {
                const list = parsePos(inp.value);
                if (list.length > 0) {
                    preview.textContent = `✔ ${list.length} posicoes: ${list[0]} ate ${list[list.length-1]}`;
                    preview.style.color = 'var(--ind-green)';
                    btnCreate.disabled = false;
                } else {
                    preview.textContent = inp.value.trim() ? 'Formato invalido' : '';
                    preview.style.color = 'var(--ind-red)';
                    btnCreate.disabled = true;
                }
            };

            inp.addEventListener('input', updatePreview);

            backdrop.querySelectorAll('._rangeBtn').forEach(btn => {
                btn.addEventListener('click', () => {
                    inp.value = btn.dataset.range;
                    updatePreview();
                });
            });

            backdrop.querySelector('#_addCarCancel2').onclick = () => { document.body.removeChild(backdrop); resolve(null); };
            btnCreate.onclick = () => {
                const list = parsePos(inp.value);
                document.body.removeChild(backdrop);
                resolve(list.length > 0 ? list : null);
            };
            inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !btnCreate.disabled) btnCreate.click(); });
            setTimeout(() => inp.focus(), 80);
        });
        if (!posResult || posResult.length === 0) return;

        const safeCarName = Security.sanitize(carName);
        posResult.forEach(loc => {
            if (!State.validLocations.some(x => x.car === safeCarName && x.loc === loc)) {
                State.validLocations.push({ car: safeCarName, loc, id: `${Date.now()}_${Math.random().toString(36).slice(2)}` });
            }
        });
        await DB.saveNow();
        State.selectedMapCar = safeCarName;
        StockAdmin.renderMapManager();
        UI.triggerRefresh();
        Toast.success(`Carro ${safeCarName} criado com ${posResult.length} posicoes!`);
    },

    async addLocation() {
        if (!Perms.can('act:stock_tools')) { Toast.error('Voce nao tem permissao para adicionar locacoes.'); return; }
        if (!State.selectedMapCar || State.selectedMapCar === 'ALL') { Toast.warn('Selecione um carro especifico antes.'); return; }
        const input  = document.getElementById('newLocInput');
        const rawVal = Security.sanitize(input.value.trim());
        if (!rawVal) return;

        let newLocs = [];
        const rangeMatch = rawVal.match(/^(\d+)\s*-\s*(\d+)$/);
        if (rangeMatch) {
            const a = rangeMatch[1], b = rangeMatch[2];
            const s = parseInt(a), e = parseInt(b);
            const pad = Math.max(a.length, b.length);
            if (!isNaN(s) && !isNaN(e) && s <= e) for (let i = s; i <= e; i++) newLocs.push(String(i).padStart(pad, '0'));
        }
        if (newLocs.length === 0) newLocs = rawVal.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        if (newLocs.length === 0) return;

        const existing = new Set(State.validLocations.filter(l => l.car === State.selectedMapCar).map(l => l.loc));
        const toAdd    = newLocs.filter(l => !existing.has(l));
        if (toAdd.length === 0) { Toast.warn('Todas as locacoes ja existem.'); return; }

        toAdd.forEach(locName => State.validLocations.push({ car: State.selectedMapCar, loc: locName, id: `${Date.now()}_${Math.random().toString(36).slice(2)}` }));
        await DB.saveNow(); UI.triggerRefresh();
        input.value = ''; input.style.borderColor = 'var(--ind-green)';
        setTimeout(() => input.style.borderColor = '#94a3b8', 600);
        Toast.success(`${toAdd.length} locacao(es) adicionada(s)!`);
    },

    async deleteCar() {
        if (!Perms.can('act:stock_tools')) { Toast.error('Voce nao tem permissao para excluir carros.'); return; }
        if (!State.selectedMapCar || State.selectedMapCar === 'ALL') { Toast.warn('Selecione um carro especifico.'); return; }
        const car = State.selectedMapCar;
        const totalLocs  = State.validLocations.filter(l => l.car === car).length;
        const totalItems = State.inventory.filter(i => i.car === car && i.code).length;

        const ok = await Modal.confirm(
            'CERTEZA QUE QUER EXCLUIR ESSE CARRO PERMANENTEMENTE?',
            `Carro: ${car} | Posicoes: ${totalLocs} | Itens em estoque: ${totalItems}\n\nTODAS as posicoes e materiais deste carro serao PERMANENTEMENTE APAGADOS.\nEsta acao NAO pode ser desfeita.`,
            'EXCLUIR PERMANENTEMENTE', true
        );
        if (!ok) return;

        const removedItems = State.inventory
            .filter(i => i.car === car && i.code)
            .map(i => ({ car: i.car, loc: i.loc, code: i.code, qty: i.qty }));

        State.validLocations = State.validLocations.filter(l => l.car !== car);
        State.inventory      = State.inventory.filter(i => i.car !== car);
        State.selectedMapCar = null;

        const histId = `${Date.now()}`;
        State.checkoutHistory.unshift({
            id: histId, type: 'DELETE_CAR',
            removedItems,
            auditRange: `Carro excluido: ${car} (${totalLocs} posicoes, ${totalItems} itens)`,
            user: State.currentUser.nome,
            matricula: State.currentUser.matricula,
            printUser: State.currentUser.nome,
            timestamp: Date.now(),
        });
        State.logs.unshift({
            matricula: State.currentUser.matricula, nome: State.currentUser.nome,
            action: 'DELETE_CAR', refId: histId, timestamp: Date.now(),
            details: Security.sanitize(`CARRO EXCLUIDO PERMANENTEMENTE: ${car} — ${totalLocs} posicoes, ${totalItems} itens removidos`),
        });

        await DB.saveNow(); UI.triggerRefresh();
        Toast.success(`Carro ${car} excluido. (${totalLocs} posicoes, ${totalItems} itens removidos)`);
    },

    async deleteLocSlot(id) {
        if (!Perms.can('act:stock_delloc')) { Toast.error('Voce nao tem permissao para apagar locacoes.'); return; }
        if (!DB.guard('Apagar Locacao')) return;
        const loc = State.validLocations.find(l => String(l.id) === String(id));
        if (!loc) { Toast.warn('Locacao nao encontrada.'); return; }
        const item = State.inventory.find(i => i.car === loc.car && i.loc === loc.loc);
        const hasItem = item && item.code;

        const ok = await Modal.confirm(
            'Apagar Locacao',
            `Voce tem certeza que deseja apagar a locacao ${loc.loc} do carro ${loc.car}?` + (hasItem ? '\n\nAVISO: Esta posicao contem o material ' + item.code + ' que tambem sera removido.' : '\n\nA posicao esta vazia.'),
            'SIM, APAGAR', true
        );
        if (!ok) return;

        State.validLocations = State.validLocations.filter(l => String(l.id) !== String(id));
        if (hasItem) State.inventory = State.inventory.filter(i => !(i.car === loc.car && i.loc === loc.loc));

        await DB.saveNow(); UI.triggerRefresh();
        Toast.success(`Locacao ${loc.car}-${loc.loc} apagada do sistema.`);
        Logs.log('DELETE_LOC', `Apagou locacao ${loc.car}-${loc.loc}${hasItem ? ' (continha ' + item.code + ')' : ''}`);
    },

    async deleteLoc(id) {
        if (!Perms.can('act:stock_clear')) { Toast.error('Voce nao tem permissao para limpar posicoes.'); return; }
        if (!DB.guard('Limpar Material da Posicao')) return;
        const loc = State.validLocations.find(l => String(l.id) === String(id));
        if (!loc) { Toast.warn('Posicao nao encontrada.'); return; }
        const item = State.inventory.find(i => i.car === loc.car && i.loc === loc.loc);
        if (!item || !item.code) { Toast.info('Posicao ja esta vazia.'); return; }

        const ok = await Modal.confirm(
            'Limpar Material da Posicao',
            `Remover o material "${item.code}" da posicao ${loc.car}-${loc.loc}?\n\nA POSICAO CONTINUARA EXISTINDO no mapa — apenas o material sera apagado.`,
            'Limpar Material', true
        );
        if (!ok) return;

        const code = item.code;
        const qty  = item.qty;
        // Remove apenas o item do inventario, a posicao (validLocation) permanece
        State.inventory = State.inventory.filter(i => !(i.car === loc.car && i.loc === loc.loc));

        const histId = `${Date.now()}`;
        State.checkoutHistory.unshift({
            id: histId, type: 'AUDIT_CLEAR',
            removedItems: [{ car: loc.car, loc: loc.loc, code, qty }],
            auditRange: `${loc.car}-${loc.loc}`,
            user: State.currentUser.nome,
            matricula: State.currentUser.matricula,
            printUser: State.currentUser.nome,
            timestamp: Date.now(),
        });
        State.logs.unshift({
            matricula: State.currentUser.matricula, nome: State.currentUser.nome,
            action: 'AUDIT_CLEAR', refId: histId, timestamp: Date.now(),
            details: Security.sanitize(`Limpeza de material via Gestao de Estoque: ${loc.car}-${loc.loc} (${code})`),
        });

        await DB.saveNow(); UI.triggerRefresh();
        Toast.success(`Material "${code}" removido. Posicao ${loc.car}-${loc.loc} liberada.`);
    },

    exportToExcel() {
        if (!State.validLocations.length) { Toast.warn('Mapa de estoque vazio.'); return; }
        const data = State.validLocations.map(l => {
            const item = State.inventory.find(i => i.car === l.car && i.loc === l.loc);
            return { 'Carro': l.car, 'Locacao': l.loc, 'Codigo': item?.code || 'VAZIO', 'Qtd': item?.qty || 0, 'Ultima Modif.': item ? new Date(item.timestamp).toLocaleString('pt-BR') : '-' };
        });
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Estoque');
        XLSX.writeFile(wb, `TPV_Estoque_${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.xlsx`);
        Logs.log('EXPORT', 'Exportou relatorio de estoque completo');
        Toast.success('Arquivo Excel gerado!');
    },

    prepareMasterLoad(input) {
        if (!Perms.can('act:stock_master')) { Toast.error('Voce nao tem permissao para fazer Carga Mestra.'); return; }
        if (!input.files[0]) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const wb  = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
            const ws  = wb.Sheets[wb.SheetNames[0]];
            State.rawMasterData = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
            document.getElementById('masterMapper').style.display = 'block';
            StockAdmin.updateMasterCols();
        };
        reader.readAsArrayBuffer(input.files[0]);
    },

    updateMasterCols() {
        if (!State.rawMasterData) return;
        const startRow = parseInt(document.getElementById('masterStartRow').value) || 0;
        const headers  = State.rawMasterData[startRow] || [];
        const opts     = headers.map((h,i) => `<option value="${i}">${Security.sanitize(String(h))} (Col ${i+1})</option>`).join('');
        ['selColCar','selColLoc','selColCode','selColQty'].forEach(id => document.getElementById(id).innerHTML = opts);
    },

    async confirmMasterLoad() {
        if (!Perms.can('act:stock_master')) { Toast.error('Voce nao tem permissao para fazer Carga Mestra.'); return; }
        const ok = await Modal.confirm('Carga Mestra', 'Isso APAGARA todo o estoque atual e substituira pelos dados da planilha. Deseja continuar?', 'Importar e Apagar', true);
        if (!ok || !State.rawMasterData) return;

        const startRow = (parseInt(document.getElementById('masterStartRow').value) || 1) - 1;
        const cCar  = parseInt(document.getElementById('selColCar').value);
        const cLoc  = parseInt(document.getElementById('selColLoc').value);
        const cCode = parseInt(document.getElementById('selColCode').value);
        const cQty  = parseInt(document.getElementById('selColQty').value);

        State.inventory = []; State.validLocations = [];

        for (let i = startRow + 1; i < State.rawMasterData.length; i++) {
            const r = State.rawMasterData[i];
            if (!r || !r[cCar] || !r[cLoc]) continue;
            const car  = Security.sanitize(String(r[cCar]).trim().toUpperCase());
            const loc  = Security.sanitize(String(r[cLoc]).trim());
            const code = Security.sanitize(String(r[cCode] || '').trim());
            const qty  = parseInt(r[cQty]) || 0;
            if (!State.validLocations.some(l => l.car === car && l.loc === loc)) {
                State.validLocations.push({ car, loc, id: `${Date.now()}_${Math.random().toString(36).slice(2)}` });
            }
            if (code) State.inventory.push({ id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, code, car, loc, qty, timestamp: Date.now() });
        }

        await DB.saveNow(); UI.triggerRefresh();
        Toast.success(`Carga mestra concluida: ${State.validLocations.length} posicoes, ${State.inventory.length} itens.`);
        Logs.log('MASTER_LOAD', `Carga mestra de ${State.inventory.length} itens importada`);
    },

    openAuditModal() { document.getElementById('auditModal').style.display = 'flex'; },
    closeAuditModal() { document.getElementById('auditModal').style.display = 'none'; },

    setAuditMode(mode) {
        document.getElementById('auditSingleWrapper').style.display = mode === 'single' ? 'block' : 'none';
        document.getElementById('auditRangeWrapper').style.display  = mode === 'range'  ? 'block' : 'none';
        document.getElementById('btnAuditSingle').classList.toggle('active', mode === 'single');
        document.getElementById('btnAuditRange').classList.toggle('active', mode === 'range');
    },

    updateAuditLocs() {
        const car  = document.getElementById('auditCar').value;
        const locs = State.validLocations.filter(l => l.car === car).sort((a,b) => a.loc.localeCompare(b.loc,undefined,{numeric:true}));
        document.getElementById('auditLoc').innerHTML = locs.map(l => `<option value="${Security.sanitize(l.loc)}">${Security.sanitize(l.loc)}</option>`).join('');
        StockAdmin.checkAuditStatus();
    },

    checkAuditStatus() {
        const car  = document.getElementById('auditCar')?.value;
        const loc  = document.getElementById('auditLoc')?.value;
        const box  = document.getElementById('auditStatusBox');
        if (!car || !loc || !box) return;
        const item = State.inventory.find(i => i.car === car && i.loc === loc);
        if (item && item.code) {
            box.className = 'audit-status status-filled';
            box.textContent = `Preenchido: ${item.code} (Qtd: ${item.qty})`;
            document.getElementById('auditCode').value = item.code;
            document.getElementById('auditQty').value  = item.qty;
        } else {
            box.className = 'audit-status status-empty';
            box.textContent = 'POSICAO VAZIA';
            document.getElementById('auditCode').value = '';
            document.getElementById('auditQty').value  = 1;
        }
    },

    async saveAudit() {
        if (!DB.guard('Editar Estoque Manual')) return;
        const car  = document.getElementById('auditCar').value;
        const loc  = document.getElementById('auditLoc').value;
        const code = document.getElementById('auditCode').value.trim().toUpperCase();
        const qty  = parseInt(document.getElementById('auditQty').value) || 1;
        if (!car || !loc || !code) { Toast.warn('Preencha todos os campos.'); return; }
        await Inventory.updateItem(car, loc, code, qty);
        StockAdmin.checkAuditStatus();
        Toast.success('Posicao atualizada!');
        Logs.log('AUDIT_SAVE', `Atualizou ${car}-${loc} -> ${code} (Qtd: ${qty})`);
    },

    async clearAudit() {
        const car = document.getElementById('auditCar').value;
        const loc = document.getElementById('auditLoc').value;
        if (!car || !loc) return;
        const ok  = await Modal.confirm('Esvaziar Posicao', `Apagar o material de ${car}-${loc}?`, 'Esvaziar', true);
        if (!ok) return;
        State.inventory = State.inventory.filter(i => !(i.car === car && i.loc === loc));
        await DB.saveNow(); UI.triggerRefresh();
        StockAdmin.checkAuditStatus();
        Toast.success('Posicao esvaziada.');
        Logs.log('AUDIT_CLEAR', `Esvaziou ${car}-${loc}`);
    },

    populateRangeSelects() {
        const car  = document.getElementById('auditRangeCar')?.value;
        if (!car) return;
        const locs = State.validLocations.filter(l => l.car === car).sort((a,b) => a.loc.localeCompare(b.loc,undefined,{numeric:true}));
        const opts = locs.map(l => `<option value="${Security.sanitize(l.loc)}">${Security.sanitize(l.loc)}</option>`).join('');
        document.getElementById('auditRangeStart').innerHTML = opts;
        document.getElementById('auditRangeEnd').innerHTML   = opts;
    },

    async executeBulkClear() {
        const car   = document.getElementById('auditRangeCar').value;
        const start = document.getElementById('auditRangeStart').value;
        const end   = document.getElementById('auditRangeEnd').value;
        if (!car || !start || !end) { Toast.warn('Selecione carro e intervalo.'); return; }
        const ok = await Modal.confirm('Esvaziar Intervalo', `Apagar TODOS os materiais de ${car} entre ${start} e ${end}?`, 'Esvaziar Tudo', true);
        if (!ok) return;

        const locs = State.validLocations.filter(l => l.car === car).sort((a,b) => a.loc.localeCompare(b.loc,undefined,{numeric:true})).map(l => l.loc);
        const iStart = locs.indexOf(start);
        const iEnd   = locs.indexOf(end);
        if (iStart === -1 || iEnd === -1 || iStart > iEnd) { Toast.error('Intervalo invalido.'); return; }

        const locsToDelete = new Set(locs.slice(iStart, iEnd + 1));
        State.inventory = State.inventory.filter(i => !(i.car === car && locsToDelete.has(i.loc)));
        await DB.saveNow(); UI.triggerRefresh();
        Toast.success(`${locsToDelete.size} posicoes esvaziadas.`);
        Logs.log('AUDIT_BULK_CLEAR', `Esvaziou ${locsToDelete.size} posicoes de ${car} (${start}->${end})`);
    },
};
