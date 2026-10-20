// ==========================================================================
// SPARE PARTS - 21-dashboards.js (extraido do v16.32)
// ==========================================================================

// ============================================================
// MODULO: ADMIN - DASHBOARD
// ============================================================
const AdminDash = {
    prevWeek() { /* graficos removidos */ },
    nextWeek()  { /* graficos removidos */ },
    _updateChartsOnly() { /* graficos removidos */ },

    // Calcula o inicio da semana atual (segunda-feira)
    _weekStart() {
        const now = new Date();
        const day = now.getDay(); // 0=dom, 1=seg...
        const diff = (day === 0 ? -6 : 1 - day);
        const start = new Date(now);
        start.setDate(now.getDate() + diff);
        start.setHours(0, 0, 0, 0);
        return start.getTime();
    },

    // Abre modal de detalhe do funcionario com filtro de data
    openDetail(matricula) {
        const user = State.users.find(u => u.matricula === matricula) || { nome: matricula, matricula };
        const allLogs = (State.checkoutHistory || []).filter(h => h.matricula === matricula);

        // Cria/reutiliza modal
        let modal = document.getElementById('opDetailModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'opDetailModal';
            modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.75);z-index:100001;display:flex;justify-content:center;align-items:center;backdrop-filter:blur(3px);';
            document.body.appendChild(modal);
        }

        const renderRows = (logs) => logs.map(h => {
            const dt   = new Date(h.timestamp);
            const tipo = h.type === 'CHECKOUT' ? 'Lista Tirada' : h.type === 'MANUAL_KITTING' ? 'Busca Avulsa' : h.type === 'RETURN' ? 'Devolucao' : h.type === 'AUDIT_CLEAR' ? 'Limpeza Auditoria' : h.type;
            const items = (h.removedItems || h.returnedItems || []);
            const mats  = items.map(i => Security.sanitize(i.code || '-')).slice(0, 3).join(', ') + (items.length > 3 ? ` +${items.length-3}` : '');
            return `<tr>
                <td style="padding:8px 10px;font-size:0.82rem;">${dt.toLocaleDateString('pt-BR')} ${dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</td>
                <td style="padding:8px 10px;font-weight:700;color:var(--tpv-blue);font-size:0.82rem;">${tipo}</td>
                <td style="padding:8px 10px;font-size:0.78rem;color:#475569;">${mats || '-'}</td>
                <td style="padding:8px 10px;text-align:center;font-size:0.82rem;font-weight:700;">${items.length}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px;">Nenhum registro no periodo.</td></tr>';

        modal.innerHTML = `
        <div style="background:#fff;border-radius:10px;padding:30px;width:90%;max-width:700px;max-height:85vh;overflow-y:auto;border-top:6px solid var(--tpv-blue);box-shadow:0 25px 50px rgba(0,0,0,0.25);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
                <div>
                    <div style="font-size:1.15rem;font-weight:900;color:var(--tpv-dark-blue);text-transform:uppercase;">${Security.sanitize(user.nome)}</div>
                    <div style="font-size:0.8rem;color:#64748b;">Matricula: ${Security.sanitize(matricula)}</div>
                </div>
                <button onclick="document.getElementById('opDetailModal').style.display='none';" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:#64748b;">&times;</button>
            </div>
            <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:flex-end;">
                <div style="flex:1;min-width:130px;"><label style="font-size:0.78rem;font-weight:700;color:#64748b;display:block;margin-bottom:4px;">De:</label>
                    <input type="date" id="opDetailFrom" class="big-input" style="padding:8px;font-size:0.88rem;">
                </div>
                <div style="flex:1;min-width:130px;"><label style="font-size:0.78rem;font-weight:700;color:#64748b;display:block;margin-bottom:4px;">Ate:</label>
                    <input type="date" id="opDetailTo" class="big-input" style="padding:8px;font-size:0.88rem;">
                </div>
                <button class="btn-3d btn-blue" style="padding:9px 18px;font-size:0.85rem;" onclick="AdminDash._applyDetailFilter('${matricula}')"><i class="fas fa-filter"></i> Filtrar</button>
                <button class="btn-3d btn-gray" style="padding:9px 14px;font-size:0.85rem;" onclick="AdminDash._clearDetailFilter('${matricula}')"><i class="fas fa-times"></i> Limpar</button>
            </div>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:0.88rem;">
                    <thead><tr style="background:#334155;color:#fff;">
                        <th style="padding:10px;text-align:left;">Data / Hora</th>
                        <th style="padding:10px;text-align:left;">Tipo</th>
                        <th style="padding:10px;text-align:left;">Materiais</th>
                        <th style="padding:10px;text-align:center;">Qtd</th>
                    </tr></thead>
                    <tbody id="opDetailBody">${renderRows(allLogs.slice(0,100))}</tbody>
                </table>
            </div>
            <div style="font-size:0.75rem;color:#94a3b8;margin-top:10px;text-align:right;">${allLogs.length} registro(s) total</div>
        </div>`;
        modal.style.display = 'flex';
    },

    _applyDetailFilter(matricula) {
        const fromVal = document.getElementById('opDetailFrom')?.value;
        const toVal   = document.getElementById('opDetailTo')?.value;
        const from = fromVal ? new Date(fromVal + 'T00:00:00').getTime() : 0;
        const to   = toVal   ? new Date(toVal + 'T23:59:59').getTime() : Date.now();
        const logs = (State.checkoutHistory || []).filter(h => h.matricula === matricula && h.timestamp >= from && h.timestamp <= to);
        const body = document.getElementById('opDetailBody');
        if (!body) return;
        body.innerHTML = logs.map(h => {
            const dt   = new Date(h.timestamp);
            const tipo = h.type === 'CHECKOUT' ? 'Lista Tirada' : h.type === 'MANUAL_KITTING' ? 'Busca Avulsa' : h.type === 'RETURN' ? 'Devolucao' : h.type === 'AUDIT_CLEAR' ? 'Limpeza Auditoria' : h.type;
            const items = (h.removedItems || h.returnedItems || []);
            const mats  = items.map(i => Security.sanitize(i.code || '-')).slice(0, 3).join(', ') + (items.length > 3 ? ` +${items.length-3}` : '');
            return `<tr><td style="padding:8px 10px;font-size:0.82rem;">${dt.toLocaleDateString('pt-BR')} ${dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</td><td style="padding:8px 10px;font-weight:700;color:var(--tpv-blue);font-size:0.82rem;">${tipo}</td><td style="padding:8px 10px;font-size:0.78rem;color:#475569;">${mats || '-'}</td><td style="padding:8px 10px;text-align:center;font-size:0.82rem;font-weight:700;">${items.length}</td></tr>`;
        }).join('') || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px;">Nenhum registro no periodo.</td></tr>';
    },

    _clearDetailFilter(matricula) {
        const df = document.getElementById('opDetailFrom'); if (df) df.value = '';
        const dt = document.getElementById('opDetailTo');   if (dt) dt.value = '';
        AdminDash._applyDetailFilter(matricula);
        // reseta para todos os logs do usuario
        const body = document.getElementById('opDetailBody');
        const allLogs = (State.checkoutHistory || []).filter(h => h.matricula === matricula);
        if (body) AdminDash._applyDetailFilter(matricula); // rellamada com datas vazias = tudo
    },

    update() {
        const weekStart = AdminDash._weekStart();
        const weekEnd   = Date.now();
        const now       = new Date();

        // Determina semana para label
        const wStartFmt = new Date(weekStart).toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit'});
        const wEndFmt   = now.toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit', year:'numeric'});

        // Label de periodo no titulo (se existir)
        const dashPeriodEl = document.getElementById('dashWeekLabel');
        if (dashPeriodEl) dashPeriodEl.textContent = `Semana: ${wStartFmt} a ${wEndFmt}`;

        // ---- Resumo Operacional por usuario (baseado em checkoutHistory) ----
        const cardContainer = document.getElementById('dashUserCards');
        if (cardContainer) {
            // Agrega por funcionario usando checkoutHistory como fonte de verdade
            const userStats = {};

            (State.checkoutHistory || []).filter(h => h.timestamp >= weekStart && h.timestamp <= weekEnd).forEach(h => {
                const mat  = h.matricula || '?';
                const nome = h.user || h.printUser || mat;
                if (!userStats[mat]) userStats[mat] = { nome, buscasAvulsas: 0, listasTiradas: 0, devolucoes: 0, events: [] };

                if (h.type === 'MANUAL_KITTING') userStats[mat].buscasAvulsas++;
                if (h.type === 'CHECKOUT')       userStats[mat].listasTiradas++;
                if (h.type === 'RETURN')         userStats[mat].devolucoes++;
                userStats[mat].events.push(h);
            });

            const entries = Object.entries(userStats);
            if (entries.length === 0) {
                cardContainer.innerHTML = '<div style="color:#8a8579; font-style:italic; padding:20px; text-align:center; grid-column:1/-1;">Nenhuma atividade nesta semana.</div>';
            } else {
                cardContainer.innerHTML = entries.sort((a,b) => {
                    const totA = a[1].buscasAvulsas + a[1].listasTiradas + a[1].devolucoes;
                    const totB = b[1].buscasAvulsas + b[1].listasTiradas + b[1].devolucoes;
                    return totB - totA;
                }).map(([mat, s]) => `
                <div style="background:#fff;border:1px solid #C9C3B6;border-radius:8px;padding:18px;border-top:4px solid #12161C;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
                        <div>
                            <div style="font-weight:900;color:#12161C;font-size:1rem;">${Security.sanitize(s.nome)}</div>
                            <div style="font-size:0.72rem;color:#8a8579;margin-top:1px;letter-spacing:0.5px;">${Security.sanitize(mat)}</div>
                        </div>
                        <button class="btn-3d" style="padding:6px 13px;font-size:0.73rem;background:#1F4E5F;box-shadow:0 3px 0 #143843;color:#F6F4EF;text-transform:uppercase;letter-spacing:0.5px;" onclick="AdminDash.openDetail('${Security.sanitize(mat)}')">
                            <i class="fas fa-list-alt"></i> Detalhe
                        </button>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
                        <div style="background:#F6F4EF;border:1px solid #EDEAE3;border-left:4px solid #1F4E5F;border-radius:5px;padding:9px 6px;text-align:center;">
                            <div style="font-size:1.4rem;font-weight:900;color:#1F4E5F;font-family:'Roboto Mono',monospace;">${s.buscasAvulsas}</div>
                            <div style="font-size:0.64rem;font-weight:800;color:#8a8579;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">Busca Avulsa</div>
                        </div>
                        <div style="background:#F6F4EF;border:1px solid #EDEAE3;border-left:4px solid #4A6B3A;border-radius:5px;padding:9px 6px;text-align:center;">
                            <div style="font-size:1.4rem;font-weight:900;color:#4A6B3A;font-family:'Roboto Mono',monospace;">${s.listasTiradas}</div>
                            <div style="font-size:0.64rem;font-weight:800;color:#8a8579;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">Listas Tiradas</div>
                        </div>
                        <div style="background:#F6F4EF;border:1px solid #EDEAE3;border-left:4px solid #8A5A2B;border-radius:5px;padding:9px 6px;text-align:center;">
                            <div style="font-size:1.4rem;font-weight:900;color:#8A5A2B;font-family:'Roboto Mono',monospace;">${s.devolucoes}</div>
                            <div style="font-size:0.64rem;font-weight:800;color:#8a8579;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">Devolucoes</div>
                        </div>
                    </div>
                </div>`).join('');
            }
        }

        // Alertas: posicoes sem movimentacao ha mais de 72h
        const alertBox = document.getElementById('alertBoxContent');
        if (alertBox) {
            const nowTs = Date.now();
            const longAbsent = State.inventory.filter(i => i.timestamp && (nowTs - i.timestamp) > 72 * 3600 * 1000);
            alertBox.innerHTML = longAbsent.length === 0
                ? '<div style="color:#64748b; text-align:center; font-style:italic; padding:20px;">Nenhum alerta ativo.</div>'
                : longAbsent.slice(0, 20).map(i => `<div class="alert-item"><i class="fas fa-clock"></i> ${Security.sanitize(i.car)}-${Security.sanitize(i.loc)}: ${Security.sanitize(i.code)} (${Math.floor((nowTs - i.timestamp) / 3600000)}h sem movimentacao)</div>`).join('');
        }

        // Grafico de atividade (usa todos os logs da semana)
        const weekLogs = (State.logs || []).filter(l => l.timestamp >= weekStart);
        AdminDash._renderChart(weekLogs);

        // Painel de Rendimento (KPIs + ranking devolucoes / busca avulsa)
        try { RendPanel.update(weekStart, weekEnd); } catch (e) { console.warn('RendPanel:', e); }
    },

    _renderChart(logs) {
        const canvas = document.getElementById('chartActivity');
        if (!canvas) return;

        // Agrupa por hora
        const hourCounts = {};
        logs.forEach(l => {
            const h = new Date(l.timestamp).getHours();
            hourCounts[h] = (hourCounts[h] || 0) + 1;
        });

        const labels = Array.from({length: 24}, (_, i) => `${i}h`);
        const data   = Array.from({length: 24}, (_, i) => hourCounts[i] || 0);

        if (State._activityChart) { State._activityChart.destroy(); State._activityChart = null; }
        State._activityChart = new Chart(canvas, {
            type: 'bar',
            data: { labels, datasets: [{ label: 'Acoes por Hora', data, backgroundColor: 'rgba(0, 102, 161, 0.7)', borderColor: 'rgba(0, 66, 101, 1)', borderWidth: 1 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } },
        });
    },
};

// ============================================================
// MODULO: REND PANEL (KPIs + ranking Devolucoes / Busca Avulsa)
// Paleta padrao dos relatorios: papel #F6F4EF | petroleo #1F4E5F | terracota #8A5A2B
// ============================================================
const RendPanel = {
    C: { paper:'#F6F4EF', line:'#C9C3B6', ink:'#12161C', teal:'#1F4E5F', clay:'#8A5A2B', mute:'#8a8579' },

    // Plugin: escreve o numero dentro da barra (fora dela se a barra for curta)
    _valuePlugin: {
        id: 'rendBarValue',
        afterDatasetsDraw(chart) {
            const ctx = chart.ctx;
            chart.data.datasets.forEach((ds, di) => {
                const meta = chart.getDatasetMeta(di);
                meta.data.forEach((bar, i) => {
                    const v = ds.data[i];
                    if (v === null || v === undefined) return;
                    const txt = String(v);
                    ctx.save();
                    ctx.font = '800 12px Roboto, Arial, sans-serif';
                    ctx.textBaseline = 'middle';
                    const w = bar.x - bar.base;              // largura da barra (horizontal)
                    const inside = Math.abs(w) > 28;
                    ctx.fillStyle = inside ? '#FFFFFF' : '#12161C';
                    ctx.textAlign = inside ? 'right' : 'left';
                    const px = inside ? bar.x - 8 : bar.x + 8;
                    ctx.fillText(txt, px, bar.y);
                    ctx.restore();
                });
            });
        }
    },

    _firstName(n) {
        const s = String(n || '-').trim().split(/\s+/);
        return s.length > 1 ? `${s[0]} ${s[1].charAt(0)}.` : s[0];
    },

    update(weekStart, weekEnd) {
        const logs = (State.checkoutHistory || []).filter(h => h.timestamp >= weekStart && h.timestamp <= weekEnd);

        // ---- Agregacao por operador ----
        const byUser = {};
        let totDev = 0, totBusca = 0, totLista = 0, itensDev = 0, itensBusca = 0;
        const hourCount = {};

        logs.forEach(h => {
            const mat  = h.matricula || '?';
            const nome = h.user || h.printUser || mat;
            if (!byUser[mat]) byUser[mat] = { nome, dev:0, busca:0, lista:0 };
            const items = (h.removedItems || h.returnedItems || []).length;

            if (h.type === 'RETURN')              { byUser[mat].dev++;   totDev++;   itensDev   += items; }
            else if (h.type === 'MANUAL_KITTING') { byUser[mat].busca++; totBusca++; itensBusca += items; }
            else if (h.type === 'CHECKOUT')       { byUser[mat].lista++; totLista++; }

            const hh = new Date(h.timestamp).getHours();
            hourCount[hh] = (hourCount[hh] || 0) + 1;
        });

        const arr       = Object.values(byUser);
        const ativos    = arr.filter(u => (u.dev + u.busca + u.lista) > 0).length;
        const devRank   = arr.filter(u => u.dev   > 0).sort((a,b) => b.dev   - a.dev);
        const buscaRank = arr.filter(u => u.busca > 0).sort((a,b) => b.busca - a.busca);
        const totalMov  = totDev + totBusca + totLista;

        const picoH = Object.keys(hourCount).sort((a,b) => hourCount[b] - hourCount[a])[0];
        const media = ativos ? (totalMov / ativos) : 0;

        // ---- Cabecalho de periodo ----
        const lbl = document.getElementById('rendPeriodLabel');
        const sub = document.getElementById('rendPeriodSub');
        if (lbl) lbl.textContent = `${totalMov} MOVIMENTACAO(OES)`;
        if (sub) sub.textContent = `${new Date(weekStart).toLocaleDateString('pt-BR')} a ${new Date(weekEnd).toLocaleDateString('pt-BR')} · ${ativos} operador(es) ativo(s)`;

        // ---- KPI cards ----
        const card = (label, value, hint, accent) => `
            <div style="background:#fff; border:1px solid ${RendPanel.C.line}; border-left:5px solid ${accent}; border-radius:8px; padding:14px 16px;">
                <div style="font-size:0.68rem; font-weight:800; color:${RendPanel.C.mute}; text-transform:uppercase; letter-spacing:0.8px;">${label}</div>
                <div style="font-size:1.9rem; font-weight:900; color:${RendPanel.C.ink}; font-family:'Roboto Mono',monospace; line-height:1.15; margin:2px 0;">${value}</div>
                <div style="font-size:0.7rem; color:${RendPanel.C.mute};">${hint}</div>
            </div>`;

        const topDev   = devRank[0]   ? `${RendPanel._firstName(devRank[0].nome)} · ${devRank[0].dev}`     : '—';
        const topBusca = buscaRank[0] ? `${RendPanel._firstName(buscaRank[0].nome)} · ${buscaRank[0].busca}` : '—';

        const kpiRow = document.getElementById('rendKpiRow');
        if (kpiRow) {
            kpiRow.innerHTML =
                card('Devolucoes',        totDev,   `${itensDev} item(ns) devolvido(s)`,      RendPanel.C.clay) +
                card('Busca Avulsa',      totBusca, `${itensBusca} item(ns) buscado(s)`,      RendPanel.C.teal) +
                card('Listas Tiradas',    totLista, 'kits completos processados',              '#4A6B3A') +
                card('Operadores Ativos', ativos,   `media de ${media.toFixed(1)} acoes/pessoa`, RendPanel.C.ink) +
                card('Top Devolucao',     topDev,   'maior volume de entradas',                RendPanel.C.clay) +
                card('Pico de Atividade', picoH !== undefined ? `${picoH}h` : '—', picoH !== undefined ? `${hourCount[picoH]} acoes nesta hora` : 'sem registros', RendPanel.C.teal);
        }

        // ---- Graficos ----
        RendPanel._bar('rendChartDev',   '_chartDev',   devRank.map(u => RendPanel._firstName(u.nome)), devRank.map(u => u.dev),     RendPanel.C.clay, 'Devolucoes');
        RendPanel._bar('rendChartBusca', '_chartBusca', buscaRank.map(u => RendPanel._firstName(u.nome)), buscaRank.map(u => u.busca), RendPanel.C.teal, 'Busca Avulsa');
    },

    _bar(canvasId, stateKey, labels, data, color, title) {
        const cv = document.getElementById(canvasId);
        if (!cv || typeof Chart === 'undefined') return;

        if (State[stateKey]) { State[stateKey].destroy(); State[stateKey] = null; }

        if (!labels.length) {
            const ctx = cv.getContext('2d');
            ctx.clearRect(0, 0, cv.width, cv.height);
            ctx.font = '600 13px Roboto, Arial, sans-serif';
            ctx.fillStyle = RendPanel.C.mute;
            ctx.textAlign = 'center';
            ctx.fillText('Nenhum registro no periodo.', cv.width / 2, 40);
            return;
        }

        State[stateKey] = new Chart(cv, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: title,
                    data,
                    backgroundColor: color,
                    borderColor: color,
                    borderWidth: 0,
                    borderRadius: 3,
                    barPercentage: 0.78,
                    categoryPercentage: 0.85
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { right: 24 } },
                plugins: {
                    legend: { display: false },
                    tooltip: { backgroundColor: RendPanel.C.ink, titleFont:{weight:'800'}, callbacks: { label: c => ` ${title}: ${c.parsed.x}` } }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: { stepSize: 1, precision: 0, color: RendPanel.C.mute, font: { size: 11 } },
                        grid: { color: 'rgba(201,195,182,0.45)', drawBorder: false }
                    },
                    y: {
                        ticks: { color: RendPanel.C.ink, font: { size: 11, weight: '700' } },
                        grid: { display: false, drawBorder: false }
                    }
                }
            },
            plugins: [RendPanel._valuePlugin]
        });
    }
};
window.RendPanel = RendPanel;

// ============================================================
// MODULO: STOCK DASHBOARD (Dashboard de Estoque para PCM)
// ============================================================
const StockDash = {
    _consolidated: [],   // cache do relatorio consolidado

    update() {
        const days   = parseInt(document.getElementById('sdPeriodSelect')?.value || '30');
        const cutoff = Date.now() - days * 86400 * 1000;
        const now    = new Date();

        // Timestamp do relatorio
        const tsEl = document.getElementById('sdTimestamp');
        if (tsEl) tsEl.textContent = 'Gerado em: ' + now.toLocaleString('pt-BR') + ' | Periodo: ultimos ' + days + ' dias';

        // Filtra historico pelo periodo
        const history = (State.checkoutHistory || []).filter(h => h.timestamp >= cutoff);

        StockDash._updateKPIs(history);
        StockDash._updateConsolidatedTable();
        StockDash._updateCarOccupation();
        StockDash._showSnapshot();
    },

    // Exibe a foto estatica do ultimo dashboard salvo no JSON
    _showSnapshot() {
        const snap = State.sdSnapshot;
        const wrapper = document.getElementById('sdSnapshotWrapper');
        const img     = document.getElementById('sdSnapshotImg');
        if (!wrapper || !img) return;
        if (snap && snap.data) {
            img.src = snap.data;
            wrapper.style.display = 'block';
        } else {
            wrapper.style.display = 'none';
        }
    },

    // ---- KPI Cards ----
    _updateKPIs(history) {
        const inv = State.inventory || [];

        // Total de tapes: items cujo codigo contem 'tape', 'reel', 'TR', '8mm', '12mm', '16mm'
        // ou que estao em posicoes cujo carro tem "tape" no nome — usa heuristica de codigo
        // (adaptar conforme padrao de codigos da TPV)
        const tapeKeywords = ['tape', 'reel', 'tr-', '8mm', '12mm', '16mm', '24mm', '32mm', 'emboss', 'carrier'];
        const tapeItems    = inv.filter(i => i.code && tapeKeywords.some(k => i.code.toLowerCase().includes(k)));
        const tapeQty      = tapeItems.reduce((s, i) => s + (Number(i.qty) || 0), 0);
        const tapePos      = tapeItems.length;

        // Total de componentes: todos os itens com quantidade > 0
        const compItems  = inv.filter(i => i.code && (Number(i.qty) || 0) > 0);
        const totalQty   = compItems.reduce((s, i) => s + (Number(i.qty) || 0), 0);
        const totalPos   = compItems.length;
        const totalLocs  = (State.validLocations || []).length;
        const ocupRate   = totalLocs > 0 ? Math.round(totalPos / totalLocs * 100) : 0;

        // Movimentacoes no periodo
        const feederOps   = history.filter(h => h.type === 'CHECKOUT').length;
        const kittingOps  = history.filter(h => h.type === 'MANUAL_KITTING').length;
        const returnOps   = history.filter(h => h.type === 'RETURN').length;
        const feederItems = history.filter(h => h.type === 'CHECKOUT').reduce((s, h) => s + (h.removedItems?.length || 0), 0);

        // Total de codigos UNICOS no estoque (sem repetir codigo)
        const uniqueCodes = new Set(inv.filter(i => i.code).map(i => i.code.trim().toUpperCase()));
        const uniqueCount = uniqueCodes.size;

        const kpis = [
            { icon: 'fa-layer-group',  color: '#7c3aed', bg: '#f5f3ff', label: 'Total de Materiais',       value: uniqueCount.toLocaleString('pt-BR'), sub: 'codigos unicos no estoque' },
            { icon: 'fa-microchip',    color: '#0066A1', bg: '#eff6ff', label: 'Componentes (Total Qtd)',   value: totalQty.toLocaleString('pt-BR'),    sub: totalPos + ' posicoes ocupadas' },
            { icon: 'fa-boxes',        color: '#059669', bg: '#ecfdf5', label: 'Ocupacao do Estoque',       value: ocupRate + '%',                      sub: totalPos + ' / ' + totalLocs + ' posicoes' },
            { icon: 'fa-list-check',   color: '#d97706', bg: '#fffbeb', label: 'Listas de Materiais',       value: feederOps.toLocaleString('pt-BR'),   sub: feederItems + ' componentes retirados' },
            { icon: 'fa-search',       color: '#dc2626', bg: '#fef2f2', label: 'Retiradas Avulsas',         value: kittingOps.toLocaleString('pt-BR'),  sub: 'operacoes de kitting' },
        ];

        const container = document.getElementById('sdKpiRow');
        if (!container) return;
        // 5 cards sempre em linha completa, altura fixa, alinhados e centralizados
        container.style.gridTemplateColumns = 'repeat(5, 1fr)';
        container.innerHTML = kpis.map(k => `
            <div style="background:white; border:1px solid #e2e8f0; border-radius:10px; padding:18px 20px; display:flex; align-items:center; gap:14px; box-shadow:0 1px 4px rgba(0,0,0,0.05); border-left:4px solid ${k.color}; min-height:90px;">
                <div style="background:${k.bg}; color:${k.color}; width:44px; height:44px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:1.25rem; flex-shrink:0;">
                    <i class="fas ${k.icon}"></i>
                </div>
                <div style="min-width:0; flex:1;">
                    <div style="font-size:1.55rem; font-weight:900; color:#1e293b; line-height:1.1; font-family:'Roboto Mono',monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${k.value}</div>
                    <div style="font-size:0.75rem; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.3px; margin-top:3px;">${k.label}</div>
                    <div style="font-size:0.7rem; color:#94a3b8; margin-top:2px;">${k.sub}</div>
                </div>
            </div>
        `).join('');
    },

    // ---- Tabela Consolidada: codigos unicos, qtd somada ----
    _updateConsolidatedTable() {
        const inv = State.inventory || [];

        // Agrupa por codigo (case-insensitive), soma quantidades
        const codeMap = {};
        inv.forEach(item => {
            if (!item.code) return;
            const key = item.code.trim().toUpperCase();
            if (!codeMap[key]) {
                codeMap[key] = { code: item.code.trim().toUpperCase(), totalQty: 0, positions: 0, lastTimestamp: 0 };
            }
            codeMap[key].totalQty      += Number(item.qty) || 0;
            codeMap[key].positions     += 1;
            if ((item.timestamp || 0) > codeMap[key].lastTimestamp) {
                codeMap[key].lastTimestamp = item.timestamp || 0;
            }
        });

        // Ordena por quantidade decrescente
        StockDash._consolidated = Object.values(codeMap).sort((a, b) => b.totalQty - a.totalQty);
        StockDash.filterTable();
    },

    _updateCarOccupation() {
        const grid = document.getElementById('sdCarOccupationGrid');
        if (!grid) return;

        const cars = [...new Set((State.validLocations || []).map(l => l.car))]
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        if (cars.length === 0) {
            grid.innerHTML = '<div style="color:#94a3b8; font-style:italic; grid-column:1/-1; text-align:center; padding:20px;">Nenhum carro cadastrado.</div>';
            return;
        }

        grid.innerHTML = cars.map(car => {
            const totalLocs = (State.validLocations || []).filter(l => l.car === car).length;
            const filled    = (State.inventory || []).filter(i => i.car === car && i.code).length;
            const pct       = totalLocs > 0 ? Math.round(filled / totalLocs * 100) : 0;

            const color  = pct >= 80 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444';
            const bgBar  = pct >= 80 ? '#dcfce7' : pct >= 40 ? '#fef9c3' : '#fee2e2';
            const label  = pct >= 80 ? '#065f46' : pct >= 40 ? '#92400e' : '#991b1b';

            const matType = (State.carMaterialType || {})[car] || '';
            const matBadge = matType
                ? `<span style="font-size:0.65rem; font-weight:800; background:#eff6ff; color:var(--tpv-blue); border:1px solid #bfdbfe; border-radius:4px; padding:2px 6px; margin-left:6px; font-family:'Roboto',sans-serif; letter-spacing:0.5px;">${Security.sanitize(matType)}</span>`
                : '';

            return `
            <div style="background:white; border:1px solid #e2e8f0; border-radius:8px; padding:14px; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <div style="display:flex; align-items:center; font-weight:900; font-size:0.9rem; color:var(--tpv-dark-blue); font-family:'Roboto Mono',monospace;">${Security.sanitize(car)}${matBadge}</div>
                    <div style="font-size:1.15rem; font-weight:900; color:${color}; font-family:'Roboto Mono',monospace;">${pct}%</div>
                </div>
                <div style="background:#f1f5f9; border-radius:4px; height:8px; overflow:hidden; margin-bottom:7px;">
                    <div style="width:${pct}%; height:100%; background:${color}; border-radius:4px; transition:width 0.4s ease;"></div>
                </div>
                <div style="font-size:0.7rem; color:#64748b; text-align:right;">${filled} / ${totalLocs} pos.</div>
            </div>`;
        }).join('');
    },

    // Captura foto do dashboard (PNG base64 scale=0.5 para ser leve) e salva no JSON.
    // Roda automaticamente 1x por sessao ao abrir a aba.
    async _saveSnapshot() {
        const captureEl = document.getElementById('sdCaptureArea');
        if (!captureEl || typeof html2canvas === 'undefined') return;
        if (StockDash._snapshotSaved) return; // ja capturou nesta sessao
        try {
            const cap = await html2canvas(captureEl, {
                scale: 0.6, useCORS: true, backgroundColor: '#f1f5f9', logging: false,
            });
            const dataUrl = cap.toDataURL('image/jpeg', 0.70); // JPEG 70% qualidade = muito menor que PNG
            State.sdSnapshot = {
                data:      dataUrl,
                capturedAt: Date.now(),
                period:    document.getElementById('sdPeriodSelect')?.value || '30',
            };
            StockDash._snapshotSaved = true;
            await DB.saveNow();
            console.log('[StockDash] Snapshot salvo:', Math.round(dataUrl.length / 1024) + 'KB');
        } catch (e) {
            console.warn('[StockDash] Snapshot falhou:', e);
        }
    },

    filterTable() {
        const filter = (document.getElementById('sdSearchCode')?.value || '').trim().toUpperCase();
        const rows   = filter
            ? StockDash._consolidated.filter(r => r.code.includes(filter))
            : StockDash._consolidated;

        const countEl = document.getElementById('sdTableCount');
        if (countEl) countEl.textContent = rows.length + ' codigos';

        const body = document.getElementById('sdConsolidatedBody');
        if (!body) return;
        if (rows.length === 0) {
            body.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding:20px; font-style:italic;">Nenhum material encontrado.</td></tr>';
            return;
        }

        const maxQty = rows[0]?.totalQty || 1;
        const frag   = document.createDocumentFragment();
        rows.forEach((r, idx) => {
            const pct   = Math.round(r.totalQty / maxQty * 100);
            const lastDt = r.lastTimestamp ? new Date(r.lastTimestamp).toLocaleDateString('pt-BR') : '-';
            const status = r.totalQty === 0
                ? '<span class="badge bg-err" style="font-size:0.7rem; width:auto; padding:3px 8px;">ZERADO</span>'
                : r.totalQty < 5
                    ? '<span style="background:#fef9c3; color:#92400e; padding:3px 8px; border-radius:6px; font-size:0.7rem; font-weight:800;">BAIXO</span>'
                    : '<span class="badge bg-ok" style="font-size:0.7rem; width:auto; padding:3px 8px;">OK</span>';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="text-align:center; color:#94a3b8; font-size:0.78rem;">${idx + 1}</td>
                <td>
                    <div style="font-family:'Roboto Mono',monospace; font-weight:700; color:var(--tpv-dark-blue);">${Security.sanitize(r.code)}</div>
                    <div style="margin-top:3px; height:4px; background:#f1f5f9; border-radius:2px; overflow:hidden;">
                        <div style="width:${pct}%; height:100%; background:var(--tpv-blue); border-radius:2px;"></div>
                    </div>
                </td>
                <td style="text-align:center; font-weight:900; font-size:1rem; font-family:'Roboto Mono',monospace; color:var(--tpv-dark-blue);">${r.totalQty.toLocaleString('pt-BR')}</td>
                <td style="text-align:center; color:#64748b;">${r.positions}</td>
                <td style="text-align:center; font-size:0.8rem; color:#64748b;">${lastDt}</td>
                <td style="text-align:center;">${status}</td>
            `;
            frag.appendChild(tr);
        });
        body.innerHTML = '';
        body.appendChild(frag);
    },

    // ---- Exportar para Excel (relatorio PCM) ----
    // Copia relatorio rico formatado para a area de transferencia.
    // Cole (Ctrl+V) diretamente no Outlook — o email vai aparecer com tabelas e cores.
    // Gera botao de loading durante captura
    _setOutlookBtnLoading(loading) {
        const btn = document.querySelector('[onclick="StockDash.copyToOutlook()"]');
        if (!btn) return;
        if (loading) {
            btn.dataset.origHtml = btn.innerHTML;
            btn.innerHTML = '<span class="spinner"></span> Capturando...';
            btn.disabled = true;
        } else {
            btn.innerHTML = btn.dataset.origHtml || '<i class="fas fa-envelope"></i> Enviar para Outlook';
            btn.disabled  = false;
        }
    },

    async copyToOutlook() {
        if (!StockDash._consolidated || StockDash._consolidated.length === 0) {
            Toast.warn('Atualize o Dashboard antes de gerar o relatorio.');
            return;
        }

        const now    = new Date();
        const period = document.getElementById('sdPeriodSelect')?.value || '30';
        const inv    = State.inventory || [];
        const cutoff = Date.now() - Number(period) * 86400 * 1000;

        const uniqueCodes = new Set(inv.filter(i => i.code).map(i => i.code.trim().toUpperCase())).size;
        const totalQty    = inv.filter(i => i.code).reduce((s,i) => s+(Number(i.qty)||0), 0);
        const totalPos    = inv.filter(i => i.code && (Number(i.qty)||0) > 0).length;
        const totalLocs   = (State.validLocations||[]).length;
        const ocupRate    = totalLocs > 0 ? Math.round(totalPos/totalLocs*100) : 0;
        const periodHist  = (State.checkoutHistory||[]).filter(h => h.timestamp >= cutoff);
        const feederOps   = periodHist.filter(h => h.type === 'CHECKOUT').length;
        const feederItems = periodHist.filter(h => h.type === 'CHECKOUT').reduce((s,h) => s+(h.removedItems?.length||0), 0);
        const kittingOps  = periodHist.filter(h => h.type === 'MANUAL_KITTING').length;
        const top5        = [...StockDash._consolidated].slice(0, 5);

        // ── Captura screenshot do dashboard ────────────────────────────────
        StockDash._setOutlookBtnLoading(true);
        let screenshotDataUrl = null;
        const captureEl = document.getElementById('sdCaptureArea');
        if (captureEl && typeof html2canvas !== 'undefined') {
            try {
                const cap = await html2canvas(captureEl, {
                    scale: 2, useCORS: true, backgroundColor: '#f1f5f9', logging: false,
                });
                screenshotDataUrl = cap.toDataURL('image/png');
            } catch (capErr) { console.warn('html2canvas:', capErr); }
        }
        StockDash._setOutlookBtnLoading(false);

        // ── Monta HTML do email ─────────────────────────────────────────────
        const C = { blue:'#0066A1', darkBlue:'#004065', yellow:'#fbbf24', green:'#059669', gray:'#64748b', border:'#e2e8f0' };
        const imgTag = screenshotDataUrl
            ? `<img src="${screenshotDataUrl}" style="width:100%;max-width:700px;display:block;border-radius:8px;border:1px solid ${C.border};margin-bottom:16px;" alt="Dashboard de Estoque MMT">`
            : `<p style="color:#991b1b;font-size:0.8rem;">[Imagem do dashboard nao disponivel]</p>`;

        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
<div style="max-width:720px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">
  <div style="background:linear-gradient(135deg,${C.darkBlue} 0%,${C.blue} 100%);padding:22px 28px;position:relative;">
    <div style="color:white;">
      <div style="font-size:1.9rem;font-weight:900;letter-spacing:-1px;line-height:0.9;">TPV <span style="font-size:0.8rem;letter-spacing:3px;font-weight:400;opacity:0.85;">VISION</span></div>
      <div style="font-size:0.95rem;font-weight:700;margin-top:8px;">RELATORIO DE ESTOQUE — DEPARTAMENTO MMT</div>
      <div style="font-size:0.72rem;opacity:0.72;margin-top:3px;">Gerado em: ${now.toLocaleString('pt-BR')} | Periodo: ultimos ${period} dias</div>
    </div>
    <div style="position:absolute;right:24px;top:50%;transform:translateY(-50%);background:${C.yellow};color:${C.darkBlue};padding:4px 12px;border-radius:20px;font-size:0.65rem;font-weight:900;text-transform:uppercase;">Uso Interno</div>
  </div>

  <div style="padding:20px 24px 8px;">
    <div style="font-size:0.65rem;font-weight:800;color:${C.blue};text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid ${C.yellow};padding-bottom:4px;margin-bottom:14px;display:inline-block;">Indicadores de Estoque</div>
    <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:18px;"><tr>
      <td style="width:33%;padding:0 5px 0 0;">
        <div style="background:#f5f3ff;border-left:4px solid #7c3aed;border-radius:8px;padding:13px;">
          <div style="font-size:1.4rem;font-weight:900;color:#1e293b;font-family:'Courier New',monospace;">${uniqueCodes.toLocaleString('pt-BR')}</div>
          <div style="font-size:0.65rem;font-weight:700;color:${C.gray};text-transform:uppercase;margin-top:4px;">Total de Materiais</div>
          <div style="font-size:0.6rem;color:#94a3b8;margin-top:2px;">codigos unicos no estoque</div>
        </div>
      </td>
      <td style="width:33%;padding:0 5px;">
        <div style="background:#eff6ff;border-left:4px solid ${C.blue};border-radius:8px;padding:13px;">
          <div style="font-size:1.4rem;font-weight:900;color:#1e293b;font-family:'Courier New',monospace;">${totalQty.toLocaleString('pt-BR')}</div>
          <div style="font-size:0.65rem;font-weight:700;color:${C.gray};text-transform:uppercase;margin-top:4px;">Componentes em Estoque</div>
          <div style="font-size:0.6rem;color:#94a3b8;margin-top:2px;">quantidade total</div>
        </div>
      </td>
      <td style="width:33%;padding:0 0 0 5px;">
        <div style="background:#ecfdf5;border-left:4px solid ${C.green};border-radius:8px;padding:13px;">
          <div style="font-size:1.4rem;font-weight:900;color:#1e293b;font-family:'Courier New',monospace;">${ocupRate}%</div>
          <div style="font-size:0.65rem;font-weight:700;color:${C.gray};text-transform:uppercase;margin-top:4px;">Taxa de Ocupacao</div>
          <div style="font-size:0.6rem;color:#94a3b8;margin-top:2px;">${totalPos} / ${totalLocs} posicoes</div>
        </div>
      </td>
    </tr></table>
  </div>

  <div style="padding:4px 24px 20px;">
    <div style="font-size:0.65rem;font-weight:800;color:${C.blue};text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid ${C.yellow};padding-bottom:4px;margin-bottom:12px;display:inline-block;">Dashboard — Graficos e Indicadores</div>
    ${imgTag}
  </div>

  <div style="background:${C.darkBlue};padding:14px 28px;display:flex;justify-content:space-between;align-items:center;">
    <div style="color:white;font-size:0.72rem;opacity:0.85;"><strong>TPV Vision Manaus</strong> | Departamento MMT<br>
      <span style="opacity:0.6;font-size:0.65rem;">Relatorio gerado automaticamente pelo Sistema de Controle de Estoque</span></div>
    <div style="color:${C.yellow};font-size:0.68rem;font-weight:800;text-align:right;">${now.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}</div>
  </div>
</div></body></html>`;

        // ── Copia HTML rico para clipboard ──────────────────────────────────
        let clipboardOk = false;
        try {
            const blob = new Blob([html], { type: 'text/html' });
            const text = new Blob(['Relatorio TPV Vision MMT'], { type: 'text/plain' });
            await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob, 'text/plain': text })]);
            clipboardOk = true;
        } catch (e) { console.warn('ClipboardItem:', e); }

        // ── Abre Outlook via mailto: ────────────────────────────────────────
        const assunto = encodeURIComponent('[USO INTERNO] Relatorio de Estoque Spare Parts — Departamento MMT | TPV Vision Manaus');
        const corpo   = encodeURIComponent(
            'Prezados,\n\nSegue em anexo o relatorio de estoque de Spare Parts do Departamento MMT referente aos ultimos ' + period + ' dias.\n\n'
          + 'INDICADORES DE ESTOQUE\n'
          + 'Total de Materiais (codigos unicos): ' + uniqueCodes.toLocaleString('pt-BR') + '\n'
          + 'Componentes em Estoque (qtd total): ' + totalQty.toLocaleString('pt-BR') + '\n'
          + 'Taxa de Ocupacao do Estoque: ' + ocupRate + '% (' + totalPos + '/' + totalLocs + ' posicoes)\n'
          + '\n'
          + (clipboardOk ? '[O relatorio visual com graficos foi copiado. Cole com Ctrl+V no corpo do email.]\n\n' : '\n')
          + 'Atenciosamente,\n' + (State.currentUser?.nome || 'Departamento MMT') + '\nTPV Vision | MMT | Manaus - AM'
        );
        window.location.href = 'mailto:?subject=' + assunto + '&body=' + corpo;

        if (clipboardOk) {
            Toast.success('Outlook aberto! Pressione Ctrl+V no corpo do email para inserir o relatorio visual completo.', 7000);
        } else {
            Toast.info('Outlook aberto com o resumo de indicadores.', 5000);
        }
        Logs.log('EXPORT_OUTLOOK', 'Enviou relatorio para Outlook');
    },

    exportReport() {
        if (!window.XLSX) { Toast.error('Biblioteca XLSX nao carregada.'); return; }
        if (StockDash._consolidated.length === 0) {
            Toast.warn('Atualize o Dashboard antes de exportar.');
            return;
        }

        const wb = XLSX.utils.book_new();
        const now = new Date();

        // --- Aba 1: Relatorio Consolidado ---
        const rows1 = [
            ['RELATORIO DE ESTOQUE CONSOLIDADO - TPV VISION MMT'],
            ['Gerado em:', now.toLocaleString('pt-BR')],
            ['Responsavel:', State.currentUser?.nome || 'Admin'],
            [],
            ['#', 'Codigo Material', 'Qtd. Total', 'Posicoes', 'Ultima Movimentacao', 'Status'],
        ];
        StockDash._consolidated.forEach((r, idx) => {
            rows1.push([
                idx + 1,
                r.code,
                r.totalQty,
                r.positions,
                r.lastTimestamp ? new Date(r.lastTimestamp).toLocaleDateString('pt-BR') : '-',
                r.totalQty === 0 ? 'ZERADO' : r.totalQty < 5 ? 'BAIXO' : 'OK',
            ]);
        });
        const ws1 = XLSX.utils.aoa_to_sheet(rows1);
        ws1['!cols'] = [{wch:4},{wch:30},{wch:12},{wch:10},{wch:20},{wch:10}];
        XLSX.utils.book_append_sheet(wb, ws1, 'Estoque Consolidado');

        // --- Aba 2: Posicoes Detalhadas ---
        const rows2 = [['Carro','Locacao','Codigo Material','Quantidade','Ultima Movimentacao']];
        (State.inventory || [])
            .filter(i => i.code)
            .sort((a,b) => a.car.localeCompare(b.car,undefined,{numeric:true}))
            .forEach(i => rows2.push([i.car, i.loc, i.code, i.qty || 0, i.timestamp ? new Date(i.timestamp).toLocaleString('pt-BR') : '-']));
        const ws2 = XLSX.utils.aoa_to_sheet(rows2);
        ws2['!cols'] = [{wch:10},{wch:10},{wch:28},{wch:10},{wch:20}];
        XLSX.utils.book_append_sheet(wb, ws2, 'Posicoes Detalhadas');

        // --- Aba 3: Historico de Movimentacoes (30 dias) ---
        const cutoff = Date.now() - 30 * 86400 * 1000;
        const rows3  = [['Data','Hora','Tipo','Operador','Qtd. Itens','Detalhes']];
        (State.checkoutHistory || [])
            .filter(h => h.timestamp >= cutoff)
            .forEach(h => {
                const dt    = new Date(h.timestamp);
                const tipo  = h.type === 'CHECKOUT' ? 'Lista Feeder' : h.type === 'MANUAL_KITTING' ? 'Kitting Avulso' : h.type === 'RETURN' ? 'Devolucao' : h.type === 'AUDIT_CLEAR' ? 'Auditoria' : h.type;
                const count = (h.removedItems || h.returnedItems || []).length;
                const det   = h.type === 'AUDIT_CLEAR' ? (h.auditRange || '-') : (h.config?.wo ? 'W/O: ' + h.config.wo : '-');
                rows3.push([dt.toLocaleDateString('pt-BR'), dt.toLocaleTimeString('pt-BR'), tipo, h.user || '-', count, det]);
            });
        const ws3 = XLSX.utils.aoa_to_sheet(rows3);
        ws3['!cols'] = [{wch:12},{wch:10},{wch:16},{wch:20},{wch:10},{wch:20}];
        XLSX.utils.book_append_sheet(wb, ws3, 'Movimentacoes 30d');

        const fname = 'TPV_Estoque_MMT_' + now.toLocaleDateString('pt-BR').replace(/\//g,'-') + '.xlsx';
        XLSX.writeFile(wb, fname);
        Toast.success('Relatorio exportado: ' + fname);
        Logs.log('EXPORT_DASH', 'Exportou relatorio de estoque para PCM');
    },
};

window.StockDash = StockDash;
