// ==========================================================================
// SPARE PARTS - 24-alertas.js (portado do v16.33)
// ==========================================================================

// ============================================================================
//  ALERTAS DE PROCESSO — codigos sem movimentacao (analise por CODIGO)
// ============================================================================
const ObsAlerts = {
    rows: [], limit: 200, sortKey: 'days', sortDir: -1, open: {},
    FX: [ { k:'ATIVO', c:'#4A6B3A', min:0, max:30, d:'ate 30 dias' }, { k:'ATENCAO', c:'#C08A1E', min:31, max:60, d:'31 a 60 dias' },
          { k:'LENTO', c:'#8A5A2B', min:61, max:90, d:'61 a 90 dias' }, { k:'OBSOLETO', c:'#B42318', min:91, max:1e9, d:'mais de 90 dias' } ],
    _norm(c) { return String(c || '').trim().toUpperCase(); },
    _faixa(d) { return ObsAlerts.FX.find(f => d >= f.min && d <= f.max) || ObsAlerts.FX[3]; },
    _type(car) { const m = State.carMaterialType || {}; return m[car] || m[String(parseInt(car, 10))] || ''; },
    _fmt(ts) { return ts ? new Date(ts).toLocaleDateString('pt-BR') : '-'; },

    build() {
        const now = Date.now(), DAY = 86400000;
        const desc = {};
        (State.componentCatalog || []).forEach(c => { desc[ObsAlerts._norm(c.code)] = c.description || ''; });
        const map = {};
        let carga = Infinity;
        (State.inventory || []).forEach(i => {
            const k = ObsAlerts._norm(i.code); if (!k) return;
            const t = Number(i.timestamp) || 0;
            if (t) carga = Math.min(carga, t);
            const r = map[k] || (map[k] = { code: k, pos: [], qty: 0, last: 0, types: {} });
            r.pos.push({ car: i.car, loc: i.loc, qty: Number(i.qty) || 0, t });
            r.qty += Number(i.qty) || 0; r.last = Math.max(r.last, t);
            const ty = ObsAlerts._type(i.car); if (ty) r.types[ty] = 1;
        });
        (State.checkoutHistory || []).forEach(h => {
            if (h.type === 'UNDO') return;
            (h.removedItems || []).concat(h.returnedItems || []).forEach(it => {
                const r = map[ObsAlerts._norm(it.code)];
                if (r && h.timestamp > r.last) r.last = h.timestamp;
            });
        });
        const cargaDay = isFinite(carga) ? new Date(carga).toDateString() : '';
        ObsAlerts.carga = isFinite(carga) ? carga : 0;
        ObsAlerts.rows = Object.values(map).map(r => {
            const days = r.last ? Math.floor((now - r.last) / DAY) : 9999;
            return Object.assign(r, { desc: desc[r.code] || '(fora do catalogo)', tipo: Object.keys(r.types).sort().join('/') || '-',
                n: r.pos.length, days, fx: ObsAlerts._faixa(days).k, init: !!r.last && new Date(r.last).toDateString() === cargaDay });
        });
        const sel = document.getElementById('oaType');
        if (sel) {
            const cur = sel.value, ts = [...new Set(ObsAlerts.rows.flatMap(r => Object.keys(r.types)))].sort();
            sel.innerHTML = '<option value="">Todos</option>' + ts.map(t => `<option value="${Security.sanitize(t)}">${Security.sanitize(t)}</option>`).join('');
            sel.value = cur;
        }
        ObsAlerts.limit = 200;
    },

    filtered() {
        const q = ObsAlerts._norm((document.getElementById('oaSearch') || {}).value);
        const min = Number((document.getElementById('oaMinDays') || {}).value || 0);
        const ty = (document.getElementById('oaType') || {}).value || '';
        const onlyInit = !!(document.getElementById('oaOnlyInit') || {}).checked;
        const k = ObsAlerts.sortKey, dir = ObsAlerts.sortDir;
        return ObsAlerts.rows.filter(r => r.days >= min
                && (!ty || r.types[ty]) && (!onlyInit || r.init)
                && (!q || r.code.includes(q) || r.desc.toUpperCase().includes(q)))
            .sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir || b.days - a.days);
    },

    setMin(v) { const s = document.getElementById('oaMinDays'); if (s) { if (![...s.options].some(o => o.value == v)) s.add(new Option(v + ' dias', v)); s.value = v; } ObsAlerts.render(); },
    sort(k) { if (ObsAlerts.sortKey === k) ObsAlerts.sortDir *= -1; else { ObsAlerts.sortKey = k; ObsAlerts.sortDir = (k === 'code' || k === 'desc' || k === 'tipo') ? 1 : -1; } ObsAlerts.render(); },
    more() { ObsAlerts.limit += 300; ObsAlerts.render(); },
    toggle(code) { ObsAlerts.open[code] = !ObsAlerts.open[code]; ObsAlerts.render(); },

    render() {
        const S = Security.sanitize, all = ObsAlerts.rows, list = ObsAlerts.filtered();
        const min = Number((document.getElementById('oaMinDays') || {}).value || 0);
        const sub = document.getElementById('oaSub');
        if (sub) sub.textContent = `${all.length} codigos em estoque · carga inicial ${ObsAlerts._fmt(ObsAlerts.carga)} · calculado em ${new Date().toLocaleString('pt-BR')}`;
        const kp = document.getElementById('oaKpis');
        if (kp) kp.innerHTML = ObsAlerts.FX.map(f => {
            const rs = all.filter(r => r.fx === f.k), q = rs.reduce((s, r) => s + r.qty, 0);
            const pct = all.length ? (rs.length / all.length * 100).toFixed(1) : '0.0';
            const on = min === f.min && f.min > 0 ? ' on' : '';
            return `<div class="oa-kpi${on}" style="border-left:5px solid ${f.c};" onclick="ObsAlerts.setMin(${f.min})" title="Filtrar a partir desta faixa">
                <div style="font-size:0.66rem;font-weight:900;color:${f.c};letter-spacing:0.8px;">${f.k} · ${f.d}</div>
                <div style="font-size:1.8rem;font-weight:900;color:var(--tpv-dark-blue);font-family:'Roboto Mono',monospace;line-height:1.2;">${rs.length}</div>
                <div style="font-size:0.7rem;color:#64748b;">${pct}% dos codigos · ${q.toLocaleString('pt-BR')} pcs</div></div>`;
        }).join('') + (() => { const n = all.filter(r => r.init).length;
            return `<div class="oa-kpi" style="border-left:5px solid var(--tpv-blue);" onclick="document.getElementById('oaOnlyInit').click()">
                <div style="font-size:0.66rem;font-weight:900;color:var(--tpv-blue);letter-spacing:0.8px;">NUNCA MOVIDOS</div>
                <div style="font-size:1.8rem;font-weight:900;color:var(--tpv-dark-blue);font-family:'Roboto Mono',monospace;line-height:1.2;">${n}</div>
                <div style="font-size:0.7rem;color:#64748b;">parados desde a carga inicial</div></div>`; })();
        document.querySelectorAll('.oa-table th[data-k]').forEach(th => {
            th.textContent = th.textContent.replace(/ [▲▼]$/, '') + (th.dataset.k === ObsAlerts.sortKey ? (ObsAlerts.sortDir > 0 ? ' ▲' : ' ▼') : '');
        });
        const cnt = document.getElementById('oaCount');
        if (cnt) cnt.textContent = `${list.length} codigo(s) no filtro · ${list.reduce((s, r) => s + r.n, 0)} posicao(oes) ocupada(s) · ${list.reduce((s, r) => s + r.qty, 0).toLocaleString('pt-BR')} pcs`;
        const body = document.getElementById('oaBody'); if (!body) return;
        if (!list.length) { body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#64748b;font-style:italic;padding:24px;">Nenhum codigo neste filtro.</td></tr>'; }
        else body.innerHTML = list.slice(0, ObsAlerts.limit).map(r => {
            const f = ObsAlerts._faixa(r.days), c = S(r.code);
            const det = ObsAlerts.open[r.code] ? `<tr class="oa-det"><td colspan="8">${r.pos.slice().sort((a, b) => (a.car + a.loc).localeCompare(b.car + b.loc))
                .map(p => `C${S(p.car)}-${S(p.loc)} · ${p.qty} pcs · entrada ${ObsAlerts._fmt(p.t)}`).join(' &nbsp;|&nbsp; ')}</td></tr>` : '';
            return `<tr class="oa-row" onclick="ObsAlerts.toggle('${c.replace(/'/g, "\\'")}')">
                <td style="font-family:'Roboto Mono',monospace;font-weight:800;color:var(--tpv-dark-blue);white-space:nowrap;"><i class="fas fa-${ObsAlerts.open[r.code] ? 'minus' : 'plus'}-square" style="color:#94a3b8;margin-right:5px;"></i>${c}</td>
                <td style="color:#475569;">${S(r.desc)}</td><td>${S(r.tipo)}</td>
                <td style="text-align:center;">${r.n}</td><td style="text-align:right;font-family:'Roboto Mono',monospace;">${r.qty.toLocaleString('pt-BR')}</td>
                <td style="white-space:nowrap;">${ObsAlerts._fmt(r.last)}${r.init ? ' <span title="Sem movimento desde a carga inicial" style="color:#B42318;font-weight:900;">*</span>' : ''}</td>
                <td style="text-align:center;font-weight:900;font-family:'Roboto Mono',monospace;color:${f.c};">${r.days}</td>
                <td><span class="oa-tag" style="background:${f.c};">${f.k}</span></td></tr>${det}`;
        }).join('');
        const mb = document.getElementById('oaMore'); if (mb) mb.style.display = list.length > ObsAlerts.limit ? 'inline-block' : 'none';
    },

    exportXlsx() {
        if (!window.XLSX) { Toast.error('Biblioteca XLSX nao carregada.'); return; }
        if (!ObsAlerts.rows.length) ObsAlerts.build();
        const list = ObsAlerts.filtered();
        if (!list.length) { Toast.warn('Nenhum codigo no filtro atual.'); return; }
        const d = ts => ts ? new Date(ts) : '';
        const r1 = [['CODIGO', 'DESCRICAO', 'TIPO CARRO', 'QTD POSICOES', 'QTD TOTAL', 'ULTIMA MOVIMENTACAO', 'DIAS PARADO', 'FAIXA', 'DESDE CARGA INICIAL', 'POSICOES']]
            .concat(list.map(r => [r.code, r.desc, r.tipo, r.n, r.qty, d(r.last), r.days, r.fx, r.init ? 'SIM' : 'NAO',
                r.pos.map(p => `C${p.car}-${p.loc}`).sort().join(', ')]));
        const r2 = [['CODIGO', 'CARRO', 'LOCAL', 'QTD', 'ENTRADA NA POSICAO', 'FAIXA DO CODIGO']];
        list.forEach(r => r.pos.forEach(p => r2.push([r.code, p.car, p.loc, p.qty, d(p.t), r.fx])));
        const r3 = [['FAIXA', 'CRITERIO', 'CODIGOS', 'QTD PECAS']].concat(ObsAlerts.FX.map(f => {
            const rs = ObsAlerts.rows.filter(r => r.fx === f.k); return [f.k, f.d, rs.length, rs.reduce((s, r) => s + r.qty, 0)]; }));
        r3.push([], ['Gerado em', new Date().toLocaleString('pt-BR')], ['Gerado por', (State.currentUser && State.currentUser.nome) || '-'],
            ['Filtro', `>= ${(document.getElementById('oaMinDays') || {}).value || 0} dias`]);
        const wb = XLSX.utils.book_new();
        const mk = (rows, cols, name) => { const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true, dateNF: 'dd/mm/yyyy hh:mm' });
            ws['!cols'] = cols.map(w => ({ wch: w })); if (rows.length > 1 && name !== 'Resumo') ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: cols.length - 1 } }) };
            XLSX.utils.book_append_sheet(wb, ws, name); };
        mk(r1, [22, 40, 10, 12, 11, 18, 11, 11, 12, 60], 'Codigos Parados');
        mk(r2, [22, 8, 8, 10, 18, 14], 'Posicoes');
        mk(r3, [14, 18, 10, 12], 'Resumo');
        XLSX.writeFile(wb, `TPV_Codigos_Sem_Movimentacao_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.xlsx`);
        Toast.success && Toast.success(`${list.length} codigos exportados.`);
    }
};
window.ObsAlerts = ObsAlerts;
