// ==========================================================================
// SPARE PARTS - 14-historico.js (extraido do v16.32)
// ==========================================================================

// ============================================================
// MODULO: AUDITORIA DE CARRO
// ============================================================
const AuditModule = {
    renderBulkTable() {
        const sel  = document.getElementById('auditBulkCarSelect');
        const car  = sel ? sel.value : '';
        const body = document.getElementById('auditBulkBody');
        if (!car || !body) return;

        const locs = State.validLocations
            .filter(l => l.car === car)
            .sort((a, b) => a.loc.localeCompare(b.loc, undefined, {numeric:true}));

        // Mostra/esconde a toolbar de limpeza
        const toolbar = document.getElementById('auditCleanToolbar');
        if (toolbar) toolbar.style.display = car ? 'block' : 'none';

        if (locs.length === 0) {
            body.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#64748b; padding:20px;">Nenhuma locacao cadastrada para este carro.</td></tr>`;
            return;
        }

        const filled = locs.filter(l => State.inventory.some(i => i.car === l.car && i.loc === l.loc && i.code));
        const summary = document.getElementById('auditCarSummary');
        summary.style.display = 'flex';
        summary.innerHTML = `<i class="fas fa-box" style="margin-right:8px;"></i> ${filled.length} / ${locs.length} preenchidas`;

        const frag = document.createDocumentFragment();
        locs.forEach(l => {
            const item    = State.inventory.find(i => i.car === l.car && i.loc === l.loc);
            const hasItem = item && item.code;
            const tr      = document.createElement('tr');
            tr.innerHTML  = `
                <td><strong style="font-family:'Roboto Mono',monospace;">${Security.sanitize(l.loc)}</strong></td>
                <td>${hasItem ? `<b style="color:var(--tpv-blue);">${Security.sanitize(item.code)}</b>` : '<span style="color:#94a3b8; font-style:italic;">[ Vazio ]</span>'}</td>
                <td style="text-align:center;">${hasItem ? item.qty : '-'}</td>
                <td><span class="badge ${hasItem ? 'bg-ok' : 'bg-err'}">${hasItem ? 'OCUPADO' : 'VAZIO'}</span></td>
                <td style="text-align:center;">
                    ${hasItem ? `<button class="btn-3d btn-red" style="padding:4px 10px; font-size:0.75rem;"
                        onclick="AuditModule.clearSingle('${Security.sanitize(l.car)}','${Security.sanitize(l.loc)}')"
                        title="Limpar esta posicao">
                        <i class="fas fa-times"></i>
                    </button>` : '<span style="color:#e2e8f0;">—</span>'}
                </td>
            `;
            frag.appendChild(tr);
        });
        body.innerHTML = '';
        body.appendChild(frag);
    },

    // Limpa UMA posicao especifica
    async clearSingle(car, loc) {
        if (!DB.guard('Limpar Posicao')) return;
        const item = State.inventory.find(i => i.car === car && i.loc === loc);
        if (!item || !item.code) { Toast.warn('Posicao ja esta vazia.'); return; }

        const ok = await Modal.confirm(
            'Limpar Posicao',
            `Remover "${item.code}" da posicao ${car}-${loc}?`,
            'Limpar', true
        );
        if (!ok) return;

        const code = item.code;
        State.inventory = State.inventory.filter(i => !(i.car === car && i.loc === loc));

        const histId = `${Date.now()}`;
        const record = {
            id: histId, type: 'AUDIT_CLEAR',
            removedItems: [{ car, loc, code, qty: item.qty }],
            auditRange: `${car}-${loc}`,
            user: State.currentUser.nome,
            matricula: State.currentUser.matricula,
            printUser: State.currentUser.nome,
            timestamp: Date.now(),
        };
        State.checkoutHistory.unshift(record);
        State.logs.unshift({
            matricula: State.currentUser.matricula, nome: State.currentUser.nome,
            action: 'AUDIT_CLEAR', refId: histId, timestamp: Date.now(),
            details: Security.sanitize(`Limpeza de posicao: ${car}-${loc} (${code})`),
        });

        await DB.saveNow();
        AuditModule.renderBulkTable();
        HistoryModule.render();
        Toast.success(`Posicao ${loc} limpa.`);
    },

    // Limpa uma FAIXA de posicoes (individual, virgula ou faixa com "-")
    async clearRange() {
        if (!DB.guard('Limpeza em Faixa')) return;
        const car = document.getElementById('auditBulkCarSelect')?.value;
        if (!car) { Toast.warn('Selecione um carro primeiro.'); return; }

        const raw = document.getElementById('auditClearInput')?.value.trim();
        if (!raw) { Toast.warn('Informe as posicoes a limpar.'); return; }

        // Resolve a lista de posicoes a partir da string de entrada
        const locsForCar = State.validLocations
            .filter(l => l.car === car)
            .sort((a, b) => a.loc.localeCompare(b.loc, undefined, {numeric: true}))
            .map(l => l.loc);

        let targetLocs = [];

        if (raw.includes('-') && !raw.includes(',')) {
            // Faixa: "001-050"
            const parts = raw.split('-');
            if (parts.length === 2) {
                const startLoc = parts[0].trim();
                const endLoc   = parts[1].trim();
                const iStart   = locsForCar.indexOf(startLoc);
                const iEnd     = locsForCar.indexOf(endLoc);
                if (iStart === -1) { Toast.error(`Posicao inicial "${startLoc}" nao encontrada neste carro.`); return; }
                if (iEnd   === -1) { Toast.error(`Posicao final "${endLoc}" nao encontrada neste carro.`); return; }
                if (iStart > iEnd) { Toast.error('Posicao inicial deve ser menor que a final.'); return; }
                targetLocs = locsForCar.slice(iStart, iEnd + 1);
            }
        } else {
            // Individual ou virgula: "001" ou "001,005,010"
            targetLocs = raw.split(',').map(s => s.trim()).filter(Boolean);
            const invalid = targetLocs.filter(l => !locsForCar.includes(l));
            if (invalid.length > 0) { Toast.error(`Posicao(oes) nao encontrada(s): ${invalid.join(', ')}`); return; }
        }

        if (targetLocs.length === 0) { Toast.warn('Nenhuma posicao valida identificada.'); return; }

        // Filtra apenas as que tem material (nao adianta "limpar" vazio)
        const occupied = targetLocs.filter(l => State.inventory.some(i => i.car === car && i.loc === l && i.code));
        if (occupied.length === 0) { Toast.info('Todas as posicoes selecionadas ja estao vazias.'); return; }

        const rangeLabel = targetLocs.length === 1
            ? targetLocs[0]
            : (raw.includes('-') && !raw.includes(','))
                ? `${targetLocs[0]} ate ${targetLocs[targetLocs.length - 1]}`
                : targetLocs.join(', ');

        const ok = await Modal.confirm(
            'Confirmar Limpeza em Faixa',
            `Limpar ${occupied.length} posicao(oes) com material no carro ${car}? Faixa: ${rangeLabel}. Esta acao sera registrada no historico como Auditoria de Carro.`,
            `Limpar ${occupied.length} Posicao(oes)`, true
        );
        if (!ok) return;

        // Captura os itens que serao removidos (para o historico)
        const removedItems = occupied.map(l => {
            const item = State.inventory.find(i => i.car === car && i.loc === l);
            return item ? { car, loc: l, code: item.code, qty: item.qty } : null;
        }).filter(Boolean);

        // Remove do inventario
        const targetSet = new Set(occupied);
        State.inventory = State.inventory.filter(i => !(i.car === car && targetSet.has(i.loc)));

        const histId = `${Date.now()}`;
        State.checkoutHistory.unshift({
            id: histId, type: 'AUDIT_CLEAR',
            removedItems,
            auditRange: `${car}: ${rangeLabel}`,
            user: State.currentUser.nome,
            matricula: State.currentUser.matricula,
            printUser: State.currentUser.nome,
            timestamp: Date.now(),
        });
        State.logs.unshift({
            matricula: State.currentUser.matricula, nome: State.currentUser.nome,
            action: 'AUDIT_CLEAR', refId: histId, timestamp: Date.now(),
            details: Security.sanitize(`Auditoria de carro ${car}: limpeza de ${occupied.length} posicoes (${rangeLabel})`),
        });

        await DB.saveNow();
        AuditModule.renderBulkTable();
        HistoryModule.render();
        document.getElementById('auditClearInput').value = '';
        Toast.success(`${occupied.length} posicao(oes) limpas no carro ${car}.`);
    },
};

// ============================================================
// MODULO: HISTORICO DE BAIXAS
// ============================================================
const HistoryModule = {
    applyFilters() {
        const type      = document.getElementById('histFilterType')?.value;
        const filterDiv = document.getElementById('histReturnFilters');
        if (!filterDiv) return;

        if (type === 'RETURN') {
            filterDiv.style.display = 'flex';
            const cars  = [...new Set(State.validLocations.map(l => l.car))].sort();
            document.getElementById('histFilterCar').innerHTML  = '<option value="">Todos</option>' + cars.map(c => `<option>${Security.sanitize(c)}</option>`).join('');
            document.getElementById('histFilterUser').innerHTML = '<option value="">Todos</option>' + State.users.map(u => `<option value="${Security.sanitize(u.matricula)}">${Security.sanitize(u.nome)}</option>`).join('');
        } else {
            filterDiv.style.display = 'none';
        }
    },

    _filterHistory() {
        const type  = document.getElementById('histFilterType')?.value || 'ALL';
        const car   = document.getElementById('histFilterCar')?.value  || '';
        const user  = document.getElementById('histFilterUser')?.value || '';
        const start = document.getElementById('histFilterStart')?.value || '';
        const end   = document.getElementById('histFilterEnd')?.value   || '';
        let h       = [...State.checkoutHistory];

        if (type !== 'ALL') {
            if (type === 'CHECKOUT')       h = h.filter(x => x.type !== 'MANUAL_KITTING' && x.type !== 'RETURN' && x.type !== 'AUDIT_CLEAR');
            if (type === 'MANUAL_KITTING') h = h.filter(x => x.type === 'MANUAL_KITTING');
            if (type === 'AUDIT_CLEAR')    h = h.filter(x => x.type === 'AUDIT_CLEAR');
            if (type === 'RETURN') {
                h = h.filter(x => x.type === 'RETURN');
                if (car)   h = h.filter(x => x.returnedItems?.some(i => i.car === car));
                if (user)  h = h.filter(x => x.matricula === user);
                if (start) h = h.filter(x => x.timestamp >= new Date(start).getTime());
                if (end)   h = h.filter(x => x.timestamp <= new Date(end).getTime());
            }
        }
        return h;
    },

    // ===== v16.21 — Exportacao do Dashboard Operacional para Excel =====
    _typeLabel(t) {
        switch (t) {
            case 'RETURN':          return 'DEVOLUCAO DE MATERIAL';
            case 'MANUAL_KITTING':  return 'BUSCA AVULSA (KITTING)';
            case 'AUDIT_CLEAR':     return 'AUDITORIA DE CARRO (LIMPEZA)';
            case 'UNDO':            return 'ESTORNO / DESFAZER';
            case 'DELETE_CAR':      return 'EXCLUSAO DE CARRO';
            default:                return 'LISTA DE PRODUCAO (FEEDER)';
        }
    },

    _turno(d) {
        const hh = d.getHours();
        if (hh >= 6  && hh < 14) return '1o TURNO';
        if (hh >= 14 && hh < 22) return '2o TURNO';
        return '3o TURNO';
    },

    exportToExcel() {
        const data = HistoryModule._filterHistory();
        if (!data.length) { Toast.warn('Nenhuma operacao encontrada com os filtros atuais.'); return; }

        const carFilter = document.getElementById('histFilterCar')?.value || '';
        const rows = [];

        data.forEach(h => {
            const d        = new Date(h.timestamp);
            const dataStr  = d.toLocaleDateString('pt-BR');
            const horaStr  = d.toLocaleTimeString('pt-BR');
            const tipo     = HistoryModule._typeLabel(h.type);
            const items    = h.returnedItems || h.removedItems || [];
            const totQtd   = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);

            const base = {
                'DATA':               dataStr,
                'HORARIO':            horaStr,
                'TURNO':              HistoryModule._turno(d),
                'OPERADOR':           h.user || '-',
                'MATRICULA':          h.matricula || '-',
                'TIPO DE MOVIMENTO':  tipo,
                'W/O':                (h.config?.wo && h.config.wo !== '--') ? h.config.wo : '',
                'LINHA':              h.config?.line && h.config.line !== '--' ? h.config.line : '',
                'MAQUINA':            h.config?.machine || '',
                'ID DA OPERACAO':     h.id,
                'ITENS NA OPERACAO':  items.length,
                'QTD TOTAL OPERACAO': totQtd,
            };

            if (!items.length) {
                rows.push({
                    ...base,
                    'CODIGO DO ITEM': '-',
                    'QTD DE ITENS':   0,
                    'CARRO':          '',
                    'LOCACAO':        '',
                    'ENDERECO (CARRO-LOCACAO)': h.auditRange || '-',
                });
                return;
            }

            items.forEach(i => {
                // Se o usuario filtrou um carro especifico, exporta so as linhas daquele carro
                if (carFilter && i.car !== carFilter) return;
                rows.push({
                    ...base,
                    'CODIGO DO ITEM': i.code || '-',
                    'QTD DE ITENS':   Number(i.qty) || 0,
                    'CARRO':          i.car || '',
                    'LOCACAO':        i.loc || '',
                    'ENDERECO (CARRO-LOCACAO)': (i.car || '') + '-' + (i.loc || ''),
                });
            });
        });

        if (!rows.length) { Toast.warn('Nenhum item encontrado para exportar.'); return; }

        // Ordem final das colunas
        const ordem = ['DATA','HORARIO','TURNO','OPERADOR','MATRICULA','TIPO DE MOVIMENTO',
                       'CODIGO DO ITEM','QTD DE ITENS','CARRO','LOCACAO','ENDERECO (CARRO-LOCACAO)',
                       'W/O','LINHA','MAQUINA','ITENS NA OPERACAO','QTD TOTAL OPERACAO','ID DA OPERACAO'];
        const finalRows = rows.map(r => { const o = {}; ordem.forEach(k => o[k] = r[k] ?? ''); return o; });

        const ws = XLSX.utils.json_to_sheet(finalRows, { header: ordem });
        ws['!cols'] = [
            {wch:12},{wch:11},{wch:11},{wch:26},{wch:12},{wch:30},
            {wch:20},{wch:13},{wch:10},{wch:10},{wch:22},
            {wch:14},{wch:10},{wch:14},{wch:18},{wch:19},{wch:16}
        ];
        ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:finalRows.length, c:ordem.length-1} }) };
        ws['!freeze'] = { xSplit: 0, ySplit: 1 };

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Operacoes');

        const tipoSel = document.getElementById('histFilterType')?.value || 'ALL';
        const stamp   = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
        XLSX.writeFile(wb, `TPV_Operacoes_${tipoSel}_${stamp}.xlsx`);

        Logs.log('EXPORT', `Exportou levantamento de operacoes (filtro: ${tipoSel}) - ${finalRows.length} linha(s)`);
        Toast.success(`Excel gerado com ${finalRows.length} linha(s)!`);
    },

    render() {
        const data      = HistoryModule._filterHistory();
        const userDiv   = document.getElementById('checkoutHistoryList');
        const adminDiv  = document.getElementById('adminCheckoutHistoryList');
        const isAdmin   = Perms.can('act:history_undo');

        const empty = '<div style="color:#94a3b8; text-align:center; font-style:italic; padding:20px;">Nenhum historico encontrado.</div>';

        if (data.length === 0) {
            if (userDiv)  userDiv.innerHTML  = empty;
            if (adminDiv) adminDiv.innerHTML = empty;
            return;
        }

        // v17.02: corta em paginas. Antes montava TODAS as entradas de uma vez —
        // com 30 dias de historico o navegador engasgava so para desenhar.
        const pag  = Paginador.fatiar('historico', data);
        const barra = Paginador.controles('historico', pag, 'HistoryModule.render');

        const html = pag.itens.map(h => {
            // Label e cor por tipo
            let label, color, icon;
            if (h.type === 'RETURN') {
                label = '(Devolucao)'; color = 'var(--ind-green)'; icon = 'fa-box-open';
            } else if (h.type === 'MANUAL_KITTING') {
                label = '(Busca Avulsa)'; color = 'var(--ind-red)'; icon = 'fa-search';
            } else if (h.type === 'AUDIT_CLEAR') {
                label = '(Auditoria de Carro)'; color = '#7c3aed'; icon = 'fa-eraser';
            } else if (h.type === 'UNDO') {
                label = '(Estorno/Desfazer)'; color = '#dc2626'; icon = 'fa-undo';
            } else if (h.type === 'DELETE_CAR') {
                label = '(Carro Excluido)'; color = '#dc2626'; icon = 'fa-trash';
            } else {
                label = '(Lista Producao)'; color = 'var(--tpv-blue)'; icon = 'fa-list-check';
            }

            const count = h.removedItems?.length || h.returnedItems?.length || h._itemCount || h._returnCount || 0;
            const totalQty = h._totalQty || (h.removedItems?.reduce((s,i)=>s+(Number(i.qty)||0),0)) || h._totalReturnQty || (h.returnedItems?.reduce((s,i)=>s+(Number(i.qty)||0),0)) || 0;

            // Linha de descricao varia por tipo
            let descLine = '';
            if (h.type === 'RETURN') {
                // Mostra carro+locacao de cada item devolvido
                const items = h.returnedItems || h.removedItems || [];
                const locInfo = items.map(i => `${Security.sanitize(i.car)}-${Security.sanitize(i.loc)}`).join(', ');
                descLine = `${count} item(ns) devolvido(s) (${totalQty} un.) por <b>${Security.sanitize(h.user)}</b> &rarr; <span style="font-family:'Roboto Mono',monospace; color:var(--tpv-blue); font-weight:900;">${locInfo}</span>`;
            } else if (h.type === 'AUDIT_CLEAR') {
                descLine = `Limpeza de posicoes por <b>${Security.sanitize(h.user)}</b> &mdash; <span style="font-family:'Roboto Mono',monospace; color:#7c3aed; font-weight:700;">${Security.sanitize(h.auditRange || `${count} posicoes`)}</span>`;
            } else if (h.type === 'UNDO') {
                descLine = `Estorno executado por <b>${Security.sanitize(h.user)}</b> &mdash; <span style="color:#dc2626; font-size:0.8rem;">${Security.sanitize(h.auditRange || '')}</span>`;
            } else if (h.type === 'DELETE_CAR') {
                descLine = `Carro excluido por <b>${Security.sanitize(h.user)}</b> &mdash; <span style="font-family:'Roboto Mono'; color:#dc2626; font-weight:900;">${Security.sanitize(h.auditRange || '')}</span>`;
            } else {
                const acao = 'retirado(s) por';
                const woStr = h.config?.wo && h.config.wo !== '--' ? ` &mdash; <span style="font-family:'Roboto Mono',monospace; font-weight:900; color:#b45309; background:#fef3c7; padding:1px 7px; border-radius:4px;">W/O: ${Security.sanitize(h.config.wo)}</span>` : '';
                descLine = `${count} item(ns) ${acao} <b>${Security.sanitize(h.user)}</b> (${totalQty} un.)${woStr}`;
            }

            const showReprint = h.type !== 'RETURN' && h.type !== 'AUDIT_CLEAR' && h.type !== 'UNDO' && h.type !== 'DELETE_CAR';
            const showUndo    = isAdmin && h.type !== 'UNDO' && h.type !== 'DELETE_CAR';

            return `
            <div class="history-item">
                <div style="flex:1;">
                    <div style="font-weight:bold; color:var(--tpv-blue); display:flex; align-items:center; gap:6px;">
                        <i class="fas ${icon}" style="color:${color}; font-size:0.9rem;"></i>
                        ${new Date(h.timestamp).toLocaleString('pt-BR')}
                        <span style="color:${color}; font-weight:bold; font-size:0.8rem;">${label}</span>
                    </div>
                    <div style="font-size:0.82rem; color:#64748b; margin-top:3px; line-height:1.4;">${descLine}</div>
                </div>
                <div style="display:flex; gap:5px; align-items:center;">
                    ${showUndo ? `<button class="btn-3d btn-yellow" style="font-size:0.7rem; padding:5px 8px;" onclick="HistoryModule.undo('${h.id}')"><i class="fas fa-undo"></i> DESFAZER</button>` : ''}
                    ${showReprint ? `<button class="btn-3d btn-gray" style="font-size:0.7rem; padding:5px 8px;" onclick="HistoryModule.reprint('${h.id}')"><i class="fas fa-print"></i> REIMPRIMIR</button>` : ''}
                </div>
            </div>`;
        }).join('');

        if (userDiv)  userDiv.innerHTML  = barra + html;
        if (adminDiv) adminDiv.innerHTML = Perms.can('tab:dashboard') || Perms.can('act:history_undo') ? (barra + html) : '<div style="color:#94a3b8; text-align:center;">Visualizacao restrita a administradores.</div>';
    },

    async undo(histId) {
        if (!Perms.can('act:history_undo')) { Toast.error('Voce nao tem permissao para estornar operacoes.'); return; }
        const idx  = State.checkoutHistory.findIndex(h => String(h.id) === String(histId));
        if (idx === -1) { Toast.error('Historico nao encontrado.'); return; }
        const hist = State.checkoutHistory[idx];

        const ok = await Modal.confirm(
            'Confirmar Estorno',
            hist.type === 'RETURN'
                ? `Desfazer esta Devolucao ira deduzir ${hist.returnedItems.length} item(ns) do estoque. Confirmar?`
                : `Restaurar ${hist.removedItems.length} material(is) de volta ao estoque. Confirmar?`,
            'Confirmar Estorno', true
        );
        if (!ok) return;

        if (hist.type === 'RETURN') {
            hist.returnedItems.forEach(item => {
                const s = State.inventory.find(i => i.car === item.car && i.loc === item.loc);
                if (s) { s.qty = Math.max(0, s.qty - item.qty); if (s.qty === 0) s.code = ''; }
            });
        } else if (hist.type === 'AUDIT_CLEAR') {
            hist.removedItems.forEach(item => {
                const existing = State.inventory.find(i => i.car === item.car && i.loc === item.loc);
                if (!existing) {
                    State.inventory.push({ ...item, id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, timestamp: Date.now() });
                }
            });
        } else {
            hist.removedItems.forEach(item => {
                State.inventory.push({ ...item, id: `${Date.now()}_${Math.random().toString(36).slice(2)}` });
            });
        }

        // === REGISTRO DE AUDITORIA DO ESTORNO ===
        const undoId = `${Date.now()}`;
        const itemCount = (hist.removedItems || hist.returnedItems || []).length;
        State.checkoutHistory.unshift({
            id: undoId,
            type: 'UNDO',
            undoType: hist.type,
            undoRef: histId,
            removedItems: hist.removedItems || hist.returnedItems || [],
            auditRange: `Estorno de: ${hist.type} — ${new Date(hist.timestamp).toLocaleString('pt-BR')} (${Security.sanitize(hist.user || '')})`,
            user: State.currentUser.nome,
            matricula: State.currentUser.matricula,
            printUser: State.currentUser.nome,
            timestamp: Date.now(),
        });
        State.logs.unshift({
            matricula: State.currentUser.matricula, nome: State.currentUser.nome,
            action: 'UNDO', refId: undoId, timestamp: Date.now(),
            details: Security.sanitize(`Estorno de ${hist.type} (${itemCount} item(ns)) por ${State.currentUser.nome} — ref. original: ${histId}`),
        });
        // === FIM REGISTRO ===

        State.checkoutHistory.splice(idx + 1, 1); // remove o original (idx+1 pois unshift adicionou no topo)
        await DB.saveNow();
        UI.triggerRefresh();
        Toast.success('Estorno realizado e registrado na auditoria!');
    },

    reprint(histId) {
        const hist = State.checkoutHistory.find(h => String(h.id) === String(histId));
        if (!hist) { Toast.error('Historico nao encontrado.'); return; }

        // Kitting: usa o print dedicado da aba estoque (mais limpo)
        if (hist.type === 'MANUAL_KITTING') {
            Kitting.print(histId);
            return;
        }

        if (!hist.tableHTML) { Toast.error('Reimpressao disponivel por ate 1 hora apos a baixa. Este snapshot ja expirou.', 6000); return; }

        // LOCK: impede que triggerRefresh/recalcMatches sobrescreva o HTML injetado
        State._reprintMode = true;

        // Esconde tudo da aba feeder menos a area de resultado
        document.querySelectorAll('#mainApp .section').forEach(s => s.classList.remove('active'));
        const feederTab = document.getElementById('tab-feeder');
        feederTab.classList.add('active');

        // Atualiza nav visual
        document.querySelectorAll('#mainNav .nav-item').forEach(el => {
            el.classList.toggle('active', el.getAttribute('onclick')?.includes("'feeder'"));
        });

        document.getElementById('feederDrop').style.display     = 'none';
        document.getElementById('feederMapper').style.display   = 'none';
        document.getElementById('feederRulesBar').style.display = 'none';
        document.getElementById('feederResults').style.display  = 'block';
        document.getElementById('feederProcessSuccess').style.display = 'none';
        document.getElementById('btnCheckoutFeeder').style.display    = 'none';

        // Cabecalho da tabela correto para o tipo
        const thead = document.querySelector('#resTable thead');
        if (hist.tableHead) {
            thead.innerHTML = hist.tableHead;
        } else if (hist.type === 'MANUAL_KITTING') {
            thead.innerHTML = '<tr><th>Origem</th><th>Codigo Material</th><th>Carro / Posicao</th><th style="text-align:center;">Status</th></tr>';
        } else {
            thead.innerHTML = '<tr><th>Maquina</th><th>Posicao</th><th>Codigo</th><th>LOCAL ESTOQUE</th><th style="text-align:center;">Status</th></tr>';
        }

        // Injeta o HTML salvo
        document.querySelector('#resTable tbody').innerHTML = hist.tableHTML;

        // Cabecalho de impressao
        const now = new Date();
        const dateStr  = now.toLocaleDateString('pt-BR');
        const timeStr  = now.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
        const origDate = hist.printDate || new Date(hist.timestamp).toLocaleString('pt-BR');
        document.getElementById('printDateTime').innerHTML    = `REIMP. ${dateStr} ${timeStr}<br><span style="font-size:0.75rem; color:#64748b;">Orig: ${origDate}</span>`;
        document.getElementById('printUser').textContent      = hist.printUser || hist.user || '--';
        document.getElementById('printLineDisplay').textContent = hist.config?.line || '--';
        document.getElementById('printWODisplay').textContent   = hist.config?.wo   || '--';
        // v16.20: maquina na reimpressao
        const _mW = document.getElementById('printMachineWrap');
        document.getElementById('printMachineDisplay').textContent = hist.config?.machine || '--';
        if (_mW) _mW.style.display = hist.config?.machine ? 'block' : 'none';

        // Barra de regras adaptada
        const rulesLabel = hist.type === 'MANUAL_KITTING' ? 'Busca Avulsa (Kitting)' : 'Lista de Producao (Feeder)';
        document.getElementById('rulesDisplay').textContent = `REIMPRESSAO: ${rulesLabel}`;
        document.getElementById('feederRulesBar').style.display = 'flex';

        Toast.info('Reimpressao pronta. Abrindo impressao...', 2500);

        setTimeout(() => {
            window.print();
            // Libera o lock apos a impressao
            setTimeout(() => {
                State._reprintMode = false;
                document.getElementById('feederRulesBar').style.display = 'none';
                document.getElementById('btnCheckoutFeeder').style.display = 'block';
            }, 1000);
        }, 600);
    },
};

// ============================================================
// MODULO: COMPROMETIMENTO (Modal Poka-Yoke de Retirada)
// ============================================================
const Commitment = {
    open(callback) {
        State.commitmentCallback = callback;
        document.getElementById('commitmentModal').style.display = 'flex';
    },
    close() {
        State.commitmentCallback = null;
        document.getElementById('commitmentModal').style.display = 'none';
    },
};
document.getElementById('btnConfirmCommitment').onclick = () => {
    const cb = State.commitmentCallback;
    Commitment.close();
    if (cb) cb();
};
document.getElementById('btnCancelCommitment').onclick = () => Commitment.close();
