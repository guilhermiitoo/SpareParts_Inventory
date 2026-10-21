// ==========================================================================
// SPARE PARTS - 25-consumo.js   (v17.07)
// ==========================================================================

// ============================================================================
// MODULO: CONSUMO (relatorio mensal para a Controladoria)
// ----------------------------------------------------------------------------
// REGRA (por COMPONENTE — todos os rolos do mesmo codigo somados):
//   Uso   = Est. Inicio + Entradas (SAP 315) - Est. Final
//   % Uso = Uso / Apontamento (SAP 261)
//   % geral = soma do Uso dos itens validos / soma do Apontamento deles
//             (NAO e a media das porcentagens)
//
// DE ONDE VEM O SALDO (Est. Inicio / Est. Final)
//   Uma FOTO DIARIA do saldo de cada componente, gravada pelo primeiro PC que
//   abre o sistema no dia (dados/consumo/fotos/AAAA-MM.json). A foto do dia D
//   e o saldo no INICIO do dia D. O saldo FINAL de um periodo e a foto do dia
//   seguinte ao ultimo dia; se esse dia ainda nao chegou, usa o saldo atual.
//   Itens de armario (IA/PTH) ficam fora: tem posicao fixa e nao sao baixados.
//
// DADOS DO SAP
//   dados/consumo/sap.json — fora do JSON do estoque e fora do sync: so e lido
//   quando a aba e aberta e so e gravado na importacao (le, junta e grava).
//
// NADA aqui roda em segundo plano alem da foto diaria. O calculo so acontece
// quando a aba e aberta ou quando o usuario troca o periodo.
// ============================================================================
const Consumo = {
    PASTA: 'consumo',
    ARQ_SAP: 'sap.json',
    TAM_CODIGO: 18,

    _sap: null,          // { s261:[[cod,qtd,'AAAA-MM-DD']], s315:[...], precos:{cod:preco}, imp:{...} }
    _sub: 'mensal',
    _linhas: [],         // ultimo calculo exibido
    _periodo: null,      // { de, ate, rotulo, arquivo }
    _ord: { k: 'uso', dir: -1 },
    _fotoFeitaEm: null,  // 'AAAA-MM-DD' — evita reler o arquivo toda hora

    // ---------------------------------------------------------------- util
    // Mesma regra do resto do sistema: maiusculas, sem espacos, 18 caracteres.
    norm(c) { return String(c == null ? '' : c).toUpperCase().replace(/\s+/g, '').slice(0, Consumo.TAM_CODIGO); },
    _iso(d) { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); },
    _br(iso) { if (!iso) return '-'; const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; },
    _maisDias(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return Consumo._iso(d); },
    _hoje() { return Consumo._iso(Date.now()); },
    _num(v) {
        if (typeof v === 'number') return v;
        let s = String(v == null ? '' : v).trim().replace(/[R$\s]/g, '');
        if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
        const n = parseFloat(s);
        return isFinite(n) ? n : NaN;
    },
    _fmtQ(n) { return Math.round(n || 0).toLocaleString('pt-BR'); },
    _fmtP(f) { return f == null ? '-' : (f * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'; },
    _fmtR(n) { return n == null ? '-' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); },

    // Data do Excel: numero serial, objeto Date ou texto dd/mm/aaaa (ou aaaa-mm-dd)
    _data(v) {
        if (v == null || v === '') return null;
        if (v instanceof Date && !isNaN(v)) return Consumo._iso(v);
        if (typeof v === 'number' && v > 20000 && v < 80000) {
            const p = XLSX.SSF.parse_date_code(v);
            if (p) return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
        }
        const s = String(v).trim();
        let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
        if (m) { const a = m[3].length === 2 ? '20' + m[3] : m[3]; return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
        m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
        return null;
    },

    _isArmario(car) { try { return PTHCabinets.isCabinet(car); } catch (e) { return false; } },

    _desc() {
        const d = {};
        (State.componentCatalog || []).forEach(c => { d[Consumo.norm(c.code)] = c.description || ''; });
        return d;
    },

    // Saldo agora, por componente (rolos somados), sem armarios
    saldoAtual() {
        const s = {};
        (State.inventory || []).forEach(i => {
            if (!i || !i.code || Consumo._isArmario(i.car)) return;
            const k = Consumo.norm(i.code);
            s[k] = (s[k] || 0) + (Number(i.qty) || 0);
        });
        return s;
    },
    _codigosArmario() {
        const s = new Set();
        (State.inventory || []).forEach(i => { if (i && i.code && Consumo._isArmario(i.car)) s.add(Consumo.norm(i.code)); });
        // codigo que tambem existe fora do armario continua no calculo
        (State.inventory || []).forEach(i => { if (i && i.code && !Consumo._isArmario(i.car)) s.delete(Consumo.norm(i.code)); });
        return s;
    },

    // ---------------------------------------------------------- arquivos
    async _pasta() {
        if (typeof Store === 'undefined' || !Store._dados) throw new Error('Banco de dados nao conectado.');
        return Store._dados.getDirectoryHandle(Consumo.PASTA, { create: true });
    },
    async _pastaFotos() { return (await Consumo._pasta()).getDirectoryHandle('fotos', { create: true }); },
    async _lerJson(dir, nome) {
        const txt = await Store._lerTexto(dir, nome);
        if (!txt) return null;
        try { return JSON.parse(txt); } catch (e) { return null; }
    },

    async _carregarSap() {
        const d = await Consumo._lerJson(await Consumo._pasta(), Consumo.ARQ_SAP);
        Consumo._sap = Object.assign({ s261: [], s315: [], precos: {}, imp: {} }, d || {});
        return Consumo._sap;
    },

    // ------------------------------------------------------- foto diaria
    // Chamada ao conectar e a cada 30 min. Le um arquivo pequeno uma vez por
    // dia por PC; so grava se ninguem gravou a foto de hoje ainda.
    async fotoDoDia() {
        if (!Consumo._timer) Consumo._timer = setInterval(() => { Consumo.fotoDoDia().catch(() => {}); }, 30 * 60 * 1000);
        if (!State.isConnected || typeof Store === 'undefined' || !Store._dados) return;
        const hoje = Consumo._hoje();
        if (Consumo._fotoFeitaEm === hoje) return;
        const dir = await Consumo._pastaFotos();
        const nome = hoje.slice(0, 7) + '.json';
        const mes = (await Consumo._lerJson(dir, nome)) || { dias: {} };
        if (!mes.dias[hoje]) {
            mes.dias[hoje] = { t: Date.now(), pc: Store.pcId(), s: Consumo.saldoAtual() };
            await Store._gravarTexto(dir, nome, JSON.stringify(mes));
        }
        Consumo._fotoFeitaEm = hoje;
    },

    async _fotosDoMes(ym, cache) {
        if (cache[ym] !== undefined) return cache[ym];
        const d = await Consumo._lerJson(await Consumo._pastaFotos(), ym + '.json');
        cache[ym] = (d && d.dias) || {};
        return cache[ym];
    },

    // Saldo no INICIO do dia `iso`. Retorna { s, fonte, exato }.
    async saldoNoInicio(iso, cache) {
        if (iso > Consumo._hoje()) return { s: Consumo.saldoAtual(), fonte: 'saldo atual', exato: true };
        const dias = await Consumo._fotosDoMes(iso.slice(0, 7), cache);
        if (dias[iso]) return { s: dias[iso].s, fonte: 'foto de ' + Consumo._br(iso), exato: true };
        // sem foto naquele dia (ninguem abriu o sistema): a proxima foto disponivel
        let d = iso;
        for (let i = 0; i < 62 && d <= Consumo._hoje(); i++) {
            d = Consumo._maisDias(d, 1);
            if (d > Consumo._hoje()) break;
            const m = await Consumo._fotosDoMes(d.slice(0, 7), cache);
            if (m[d]) return { s: m[d].s, fonte: 'foto de ' + Consumo._br(d) + ' (aproximado)', exato: false };
        }
        return { s: Consumo.saldoAtual(), fonte: 'saldo atual (sem foto no periodo)', exato: false };
    },

    // ----------------------------------------------------------- calculo
    _somaSap(lista, de, ate) {
        const s = {};
        (lista || []).forEach(r => { if (r[2] >= de && r[2] <= ate) s[r[0]] = (s[r[0]] || 0) + r[1]; });
        return s;
    },

    // Puro: recebe os mapas e devolve as linhas + totais. Testavel sozinho.
    montar(ini, fim, ent, apo, precos, desc, fora) {
        const cods = new Set([...Object.keys(ini), ...Object.keys(fim), ...Object.keys(ent), ...Object.keys(apo)]);
        const linhas = [];
        cods.forEach(c => {
            if (fora && fora.has(c)) return;
            const r = { code: c, desc: (desc && desc[c]) || '', ini: ini[c] || 0, ent: ent[c] || 0, fim: fim[c] || 0, apo: apo[c] || 0 };
            if (!r.ini && !r.ent && !r.fim && !r.apo) return;
            r.uso   = r.ini + r.ent - r.fim;
            r.pct   = r.apo > 0 ? r.uso / r.apo : null;
            r.preco = precos && precos[c] != null ? precos[c] : null;
            r.valor = r.preco != null ? r.uso * r.preco : null;
            r.status = r.uso < 0 ? 'USO NEGATIVO'
                     : (r.apo <= 0 && r.uso > 0) ? 'SEM APONTAMENTO'
                     : r.preco == null ? 'SEM PRECO' : 'OK';
            linhas.push(r);
        });
        // % geral: so itens com uso valido e apontamento (OK e SEM PRECO)
        const validos = linhas.filter(r => r.status === 'OK' || r.status === 'SEM PRECO');
        const tot = {
            uso: validos.reduce((a, r) => a + r.uso, 0),
            apo: validos.reduce((a, r) => a + r.apo, 0),
            ini: linhas.reduce((a, r) => a + r.ini, 0),
            ent: linhas.reduce((a, r) => a + r.ent, 0),
            fim: linhas.reduce((a, r) => a + r.fim, 0),
            valor: validos.reduce((a, r) => a + (r.valor || 0), 0),
            alertas: linhas.filter(r => r.status === 'USO NEGATIVO' || r.status === 'SEM APONTAMENTO').length,
        };
        tot.pct = tot.apo > 0 ? tot.uso / tot.apo : null;
        return { linhas, tot };
    },

    async calcular(de, ate) {
        const sap = Consumo._sap || await Consumo._carregarSap();
        const cache = {};
        const a = await Consumo.saldoNoInicio(de, cache);
        const b = await Consumo.saldoNoInicio(Consumo._maisDias(ate, 1), cache);
        const r = Consumo.montar(a.s, b.s,
            Consumo._somaSap(sap.s315, de, ate), Consumo._somaSap(sap.s261, de, ate),
            sap.precos, Consumo._desc(), Consumo._codigosArmario());
        r.fonteIni = a.fonte; r.fonteFim = b.fonte; r.exato = a.exato && b.exato;
        return r;
    },

    // Ultima data coberta pelos arquivos do SAP
    _ultimaDataSap() {
        const s = Consumo._sap || {};
        let m = '';
        ['s261', 's315'].forEach(t => (s[t] || []).forEach(r => { if (r[2] > m) m = r[2]; }));
        return m || null;
    },

    // Mes 'AAAA-MM' -> periodo, cortado na data mais recente importada
    _periodoMes(ym) {
        const de = ym + '-01';
        const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0);
        let ate = Consumo._iso(d);
        const ult = Consumo._ultimaDataSap();
        if (ult && ult >= de && ult < ate) ate = ult;
        if (ate > Consumo._hoje()) ate = Consumo._hoje();
        return { de, ate, rotulo: 'Mensal ' + ym.slice(5) + '/' + ym.slice(0, 4), arquivo: 'Consumo_SpareParts_Mensal_' + ym + '.xlsx', ym };
    },

    // Mesma semana do sistema (AdminDash._weekStart): segunda a domingo
    _segunda(ts) {
        const d = new Date(ts); const dia = d.getDay();
        d.setDate(d.getDate() + (dia === 0 ? -6 : 1 - dia)); d.setHours(0, 0, 0, 0);
        return d;
    },
    _numSemana(d) {   // numero ISO (S43)
        const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const dn = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dn);
        const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
        return { ano: t.getUTCFullYear(), n: Math.ceil(((t - y0) / 86400000 + 1) / 7) };
    },
    _periodoSemana(isoSeg) {
        const de = isoSeg;
        let ate = Consumo._maisDias(de, 6);
        if (ate > Consumo._hoje()) ate = Consumo._hoje();
        const w = Consumo._numSemana(new Date(de + 'T12:00:00'));
        const tag = w.ano + '-S' + String(w.n).padStart(2, '0');
        return { de, ate, rotulo: 'Semana ' + tag, arquivo: 'Consumo_SpareParts_Semanal_' + tag + '.xlsx' };
    },

    // -------------------------------------------------------- importacao
    async _lerPlanilha(file) {
        const buf = new Uint8Array(await file.arrayBuffer());
        const wb = XLSX.read(buf, { type: 'array', cellDates: true });
        return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
    },

    async importar(tipo, input) {
        const file = input && input.files && input.files[0];
        if (input) input.value = '';
        if (!file) return;
        if (!DB.guard('Importar dados do SAP')) return;
        try {
            const rows = await Consumo._lerPlanilha(file);
            const saldo = Consumo.saldoAtual();
            const novos = [], precos = {};
            let ignoradas = 0;
            rows.forEach(r => {
                const c = Consumo.norm(r[0]);
                const q = Consumo._num(r[1]);
                if (!c || isNaN(q)) { ignoradas++; return; }       // cabecalho / linha vazia
                if (tipo === 'precos') { precos[c] = q; return; }
                const d = Consumo._data(r[2]);
                if (!d) { ignoradas++; return; }
                novos.push([c, q, d]);
            });

            await Consumo._carregarSap();
            const S = Security.sanitize;
            let ok;
            if (tipo === 'precos') {
                const n = Object.keys(precos).length;
                if (!n) { Toast.error('Nenhum preco valido. Formato: Coluna A = Componente, Coluna B = Preco unitario.'); return; }
                const fora = Object.keys(precos).filter(c => !(c in saldo)).length;
                ok = await Modal.confirm('Importar tabela de precos',
                    `Arquivo: ${file.name}\n${n} componente(s) com preco${ignoradas ? ` · ${ignoradas} linha(s) ignorada(s)` : ''}\n` +
                    `${fora} componente(s) nao estao no estoque hoje.\n\nOs precos destes componentes serao atualizados.`, 'Importar');
                if (!ok) return;
            } else {
                if (!novos.length) { Toast.error('Nenhuma linha valida. Formato: Coluna A = Componente, B = Quantidade, C = Data.'); return; }
                const datas = novos.map(r => r[2]).sort();
                const de = datas[0], ate = datas[datas.length - 1];
                const cods = new Set(novos.map(r => r[0]));
                const fora = [...cods].filter(c => !(c in saldo)).length;
                const nome = tipo === 's261' ? 'Apontamento (SAP 261)' : 'Entradas (SAP 315)';
                ok = await Modal.confirm('Importar ' + nome,
                    `Arquivo: ${file.name}\n${novos.length} linha(s) · ${cods.size} componente(s)` +
                    `${ignoradas ? ` · ${ignoradas} linha(s) ignorada(s)` : ''}\n` +
                    `Periodo coberto: ${Consumo._br(de)} a ${Consumo._br(ate)}\n` +
                    `${fora} componente(s) nao encontrados no estoque.\n\n` +
                    `Os registros de ${nome} entre essas datas serao SUBSTITUIDOS por este arquivo (sem duplicar).`, 'Importar');
                if (!ok) return;
            }

            // Relê do disco logo antes de gravar: se outro admin importou no meio, nao perde.
            const sap = await Consumo._carregarSap();
            const info = { em: Date.now(), por: State.currentUser ? State.currentUser.nome : '', arquivo: file.name };
            if (tipo === 'precos') {
                Object.assign(sap.precos, precos);
                info.n = Object.keys(precos).length;
            } else {
                const datas = novos.map(r => r[2]).sort();
                info.de = datas[0]; info.ate = datas[datas.length - 1]; info.n = novos.length;
                sap[tipo] = sap[tipo].filter(r => r[2] < info.de || r[2] > info.ate).concat(novos);
            }
            sap.imp[tipo] = info;
            await Store._gravarTexto(await Consumo._pasta(), Consumo.ARQ_SAP, JSON.stringify(sap));
            Consumo._sap = sap;
            Logs.log('CONSUMO_IMPORT', `Importou ${tipo === 'precos' ? 'precos' : tipo.toUpperCase()} (${info.n} linhas) — ${S(file.name)}`);
            Toast.success('Importacao concluida.');
            Consumo.render();
        } catch (e) {
            console.error('[Consumo.importar]', e);
            Toast.error('Erro ao importar: ' + e.message, 8000);
        }
    },

    // ---------------------------------------------------------------- tela
    async render() {
        const el = document.getElementById('consumoContent');
        if (!el) return;
        if (!State.isConnected) { el.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:40px;">Conecte o banco de dados.</div>'; return; }
        try { await Consumo._carregarSap(); }
        catch (e) { el.innerHTML = `<div style="color:var(--ind-red);padding:20px;">Erro ao ler os dados do Consumo: ${Security.sanitize(e.message)}</div>`; return; }

        const subs = [['importar', 'fa-file-import', 'Importar SAP'], ['mensal', 'fa-calendar', 'Mensal'],
                      ['semanal', 'fa-calendar-week', 'Semanal'], ['alertas', 'fa-triangle-exclamation', 'Alertas e Compras'],
                      ['dash', 'fa-chart-column', 'Dashboards']];
        el.innerHTML = `
        <div style="display:flex; gap:0; border-bottom:2px solid #e2e8f0; margin-bottom:18px; flex-wrap:wrap;">
            ${subs.map(([k, i, l]) => `<button class="gs-tab-btn" onclick="Consumo.sub('${k}')"
                style="padding:10px 20px; font-weight:800; font-size:0.85rem; text-transform:uppercase; letter-spacing:0.5px; border:1px solid #e2e8f0; border-bottom:3px solid ${Consumo._sub === k ? 'var(--tpv-blue)' : 'transparent'}; background:${Consumo._sub === k ? '#eff6ff' : '#fff'}; color:${Consumo._sub === k ? 'var(--tpv-blue)' : '#64748b'}; cursor:pointer;">
                <i class="fas ${i}"></i> ${l}</button>`).join('')}
        </div>
        <div id="consumoSub"></div>`;
        const box = document.getElementById('consumoSub');
        if (Consumo._sub === 'importar') return Consumo._telaImportar(box);
        if (Consumo._sub === 'alertas')  return Consumo._telaAlertas(box);
        if (Consumo._sub === 'dash')     return Consumo._telaDash(box);
        return Consumo._telaPeriodo(box);
    },

    sub(k) { Consumo._sub = k; Consumo.render(); },

    _telaImportar(box) {
        const imp = Consumo._sap.imp || {};
        const S = Security.sanitize;
        const card = (tipo, titulo, cor, formato) => {
            const i = imp[tipo];
            const ult = i ? `Ultima importacao: <b>${new Date(i.em).toLocaleString('pt-BR')}</b> por ${S(i.por || '-')}<br>` +
                (i.de ? `Periodo coberto: <b>${Consumo._br(i.de)} a ${Consumo._br(i.ate)}</b> · ${Consumo._fmtQ(i.n)} linhas` : `${Consumo._fmtQ(i.n)} componentes com preco`)
                : 'Nenhuma importacao ainda.';
            return `
            <div style="background:#fff; border:1px solid var(--ind-border); border-top:4px solid ${cor}; border-radius:8px; padding:18px;">
                <div style="font-weight:900; color:var(--tpv-dark-blue); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">${titulo}</div>
                <div style="font-size:0.78rem; color:#475569; margin-bottom:12px;">Formato: ${formato}</div>
                <div style="font-size:0.8rem; color:#334155; line-height:1.6; min-height:3.2em; margin-bottom:12px;">${ult}</div>
                <label class="btn-3d btn-blue" style="width:100%; cursor:pointer;"><i class="fas fa-file-excel"></i> ESCOLHER EXCEL
                    <input type="file" accept=".xlsx,.xls,.csv" style="display:none;" onchange="Consumo.importar('${tipo}', this)"></label>
            </div>`;
        };
        box.innerHTML = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:16px;">
            ${card('s261', 'Apontamento (SAP 261)', 'var(--tpv-blue)', 'A = Componente · B = Quantidade · C = Data')}
            ${card('s315', 'Entradas (SAP 315)', 'var(--ind-green)', 'A = Componente · B = Quantidade · C = Data')}
            ${card('precos', 'Tabela de precos (opcional)', 'var(--ind-yellow)', 'A = Componente · B = Preco unitario (R$)')}
        </div>
        <div style="font-size:0.75rem; color:#475569; margin-top:14px; line-height:1.6;">
            Pode importar varias vezes no mes: os registros do mesmo tipo dentro das datas do arquivo sao substituidos, nunca duplicados.
            Datas aceitas: data do Excel ou texto dd/mm/aaaa. O codigo do componente e normalizado como no resto do sistema (maiusculas, sem espacos, 18 caracteres).
        </div>`;
    },

    _opcoesSemana() {
        const out = [];
        let seg = Consumo._segunda(Date.now());
        for (let i = 0; i < 16; i++) {
            const iso = Consumo._iso(seg);
            const w = Consumo._numSemana(seg);
            out.push([iso, `S${String(w.n).padStart(2, '0')}/${w.ano} — ${Consumo._br(iso)} a ${Consumo._br(Consumo._maisDias(iso, 6))}`]);
            seg.setDate(seg.getDate() - 7);
        }
        return out;
    },

    async _telaPeriodo(box) {
        const mensal = Consumo._sub === 'mensal';
        if (mensal && !Consumo._ym) Consumo._ym = Consumo._hoje().slice(0, 7);
        if (!mensal && !Consumo._seg) Consumo._seg = Consumo._iso(Consumo._segunda(Date.now()));
        const sel = mensal
            ? `<input type="month" class="big-input" style="padding:8px 10px; margin:0; width:auto;" value="${Consumo._ym}" onchange="Consumo._ym=this.value; Consumo.render()">`
            : `<select class="big-input" style="padding:8px 10px; margin:0; width:auto;" onchange="Consumo._seg=this.value; Consumo.render()">
                ${Consumo._opcoesSemana().map(([v, l]) => `<option value="${v}" ${v === Consumo._seg ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
        const p = mensal ? Consumo._periodoMes(Consumo._ym) : Consumo._periodoSemana(Consumo._seg);
        box.innerHTML = `
        <div style="display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap; background:#f8fafc; border:1px solid var(--ind-border); border-radius:6px; padding:12px 14px; margin-bottom:14px;">
            <div><div class="oa-lbl">${mensal ? 'Mes' : 'Semana (segunda a domingo)'}</div>${sel}</div>
            <div style="flex:2; min-width:200px;"><div class="oa-lbl">Buscar codigo / descricao</div>
                <input id="csBusca" class="big-input" style="padding:8px 10px; margin:0;" placeholder="Ex.: 065G0805..." oninput="Consumo._tabela()"></div>
            <button class="btn-3d btn-green" style="padding:9px 16px; font-size:0.8rem;" onclick="Consumo.exportar()"><i class="fas fa-file-excel"></i> EXPORTAR EXCEL</button>
            <div style="flex-basis:100%; display:flex; gap:16px; align-items:center; flex-wrap:wrap; font-size:0.78rem; font-weight:700; color:var(--tpv-dark-blue);">
                <span class="oa-lbl" style="margin:0;">Colunas no Excel:</span>
                ${Consumo.OPCIONAIS.map(([k, l]) => `<label style="display:flex; align-items:center; gap:5px; cursor:pointer;">
                    <input type="checkbox" ${Consumo._colsExcel()[k] !== false ? 'checked' : ''} onchange="Consumo.setColExcel('${k}', this.checked)"> ${l}</label>`).join('')}
            </div>
        </div>
        <div id="csCorpo"><div style="text-align:center; color:#94a3b8; padding:30px;"><i class="fas fa-spinner fa-spin"></i> Calculando...</div></div>`;
        try {
            const r = await Consumo.calcular(p.de, p.ate);
            Consumo._periodo = p; Consumo._linhas = r.linhas; Consumo._tot = r.tot; Consumo._res = r;
            Consumo._corpo();
        } catch (e) {
            console.error('[Consumo]', e);
            document.getElementById('csCorpo').innerHTML = `<div style="color:var(--ind-red); padding:20px;">Erro no calculo: ${Security.sanitize(e.message)}</div>`;
        }
    },

    _kpi(rotulo, valor, cor) {
        return `<div class="oa-kpi" style="cursor:default; border-left:4px solid ${cor};"><div class="oa-lbl">${rotulo}</div>
            <div style="font-size:1.35rem; font-weight:900; color:${cor}; font-family:'Roboto Mono',monospace;">${valor}</div></div>`;
    },

    _corpo() {
        const r = Consumo._res, t = r.tot, p = Consumo._periodo, S = Security.sanitize;
        const top5 = r.linhas.filter(x => x.pct != null && x.status !== 'USO NEGATIVO').sort((a, b) => b.pct - a.pct).slice(0, 5);
        document.getElementById('csCorpo').innerHTML = `
        <div style="font-size:0.78rem; color:#334155; margin-bottom:10px;">
            Periodo: <b>${Consumo._br(p.de)} a ${Consumo._br(p.ate)}</b> · Est. Inicio: ${S(r.fonteIni)} · Est. Final: ${S(r.fonteFim)}
            ${r.exato ? '' : ' · <b style="color:#b45309;">saldo aproximado: faltou foto em algum dia do periodo</b>'}
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin-bottom:14px;">
            ${Consumo._kpi('% geral do periodo', Consumo._fmtP(t.pct), 'var(--tpv-blue)')}
            ${Consumo._kpi('Uso total (pecas)', Consumo._fmtQ(t.uso), 'var(--tpv-dark-blue)')}
            ${Consumo._kpi('Valor do uso', Consumo._fmtR(t.valor), 'var(--ind-green)')}
            ${Consumo._kpi('Itens em alerta', t.alertas, 'var(--ind-red)')}
        </div>
        ${top5.length ? `<div style="font-size:0.78rem; color:#334155; margin-bottom:12px;"><b>Maior % de uso:</b> ${top5.map(x => `${S(x.code)} <b>${Consumo._fmtP(x.pct)}</b>`).join(' · ')}</div>` : ''}
        <div id="csCount" class="oa-lbl" style="margin-bottom:6px;"></div>
        <div style="background:#fff; border:1px solid var(--ind-border); border-radius:6px; overflow:auto; max-height:600px;">
            <table class="oa-table"><thead><tr>${Consumo.COLS.map(c => `<th onclick="Consumo.ordenar('${c[0]}')" style="${c[2] ? 'text-align:right;' : ''}">${c[1]}${Consumo._ord.k === c[0] ? (Consumo._ord.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
            <tbody id="csBody"></tbody></table>
        </div>`;
        Consumo._tabela();
    },

    COLS: [['code', 'Componente'], ['desc', 'Descricao'], ['ini', 'Est. Inicio', 1], ['ent', 'Entradas (SAP 315)', 1], ['fim', 'Est. Final', 1],
           ['uso', 'Uso', 1], ['apo', 'Apontamento (SAP 261)', 1], ['pct', '% Uso', 1], ['preco', 'Preco unit.', 1], ['valor', 'Valor do uso (R$)', 1], ['status', 'Status']],
    COR_STATUS: { 'OK': '#4A6B3A', 'USO NEGATIVO': '#B42318', 'SEM APONTAMENTO': '#C08A1E', 'SEM PRECO': '#64748b' },

    ordenar(k) {
        Consumo._ord = { k, dir: Consumo._ord.k === k ? -Consumo._ord.dir : (k === 'code' || k === 'desc' || k === 'status' ? 1 : -1) };
        Consumo._corpo();
    },

    _filtradas() {
        const q = Consumo.norm((document.getElementById('csBusca') || {}).value);
        const qd = String((document.getElementById('csBusca') || {}).value || '').trim().toUpperCase();
        const { k, dir } = Consumo._ord;
        return Consumo._linhas
            .filter(r => !qd || r.code.includes(q) || String(r.desc).toUpperCase().includes(qd))
            .sort((a, b) => {
                const x = a[k], y = b[k];
                if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
                return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * dir;
            });
    },

    _tabela() {
        const body = document.getElementById('csBody'); if (!body) return;
        const S = Security.sanitize, rows = Consumo._filtradas();
        const cnt = document.getElementById('csCount');
        if (cnt) cnt.textContent = `${rows.length} componente(s)`;
        body.innerHTML = rows.length ? rows.slice(0, 1500).map(r => `<tr>
            <td style="font-weight:900; color:var(--tpv-dark-blue); font-family:'Roboto Mono',monospace;">${S(r.code)}</td>
            <td>${S(r.desc || '-')}</td>
            <td style="text-align:right;">${Consumo._fmtQ(r.ini)}</td><td style="text-align:right;">${Consumo._fmtQ(r.ent)}</td>
            <td style="text-align:right;">${Consumo._fmtQ(r.fim)}</td><td style="text-align:right; font-weight:900;">${Consumo._fmtQ(r.uso)}</td>
            <td style="text-align:right;">${Consumo._fmtQ(r.apo)}</td><td style="text-align:right; font-weight:900;">${Consumo._fmtP(r.pct)}</td>
            <td style="text-align:right;">${Consumo._fmtR(r.preco)}</td><td style="text-align:right;">${Consumo._fmtR(r.valor)}</td>
            <td><span class="oa-tag" style="background:${Consumo.COR_STATUS[r.status]};">${r.status}</span></td></tr>`).join('')
            : '<tr><td colspan="11" style="text-align:center; color:#94a3b8; padding:24px;">Nenhum componente com movimento no periodo.</td></tr>';
    },

    // --------------------------------------------------- alertas e compras
    async _telaAlertas(box) {
        if (!Consumo._ym) Consumo._ym = Consumo._hoje().slice(0, 7);
        const p = Consumo._periodoMes(Consumo._ym);
        box.innerHTML = `
        <div style="display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap; background:#f8fafc; border:1px solid var(--ind-border); border-radius:6px; padding:12px 14px; margin-bottom:14px;">
            <div><div class="oa-lbl">Mes</div><input type="month" class="big-input" style="padding:8px 10px; margin:0; width:auto;" value="${Consumo._ym}" onchange="Consumo._ym=this.value; Consumo.render()"></div>
            <button class="btn-3d btn-green" style="padding:9px 16px; font-size:0.8rem;" onclick="Consumo.exportarAlertas()"><i class="fas fa-file-excel"></i> EXPORTAR EXCEL (3 LISTAS)</button>
        </div>
        <div id="csAlertas"><div style="text-align:center; color:#94a3b8; padding:30px;"><i class="fas fa-spinner fa-spin"></i> Calculando...</div></div>`;
        const r = await Consumo.calcular(p.de, p.ate);
        Consumo._periodo = p; Consumo._res = r;
        Consumo._alertas = Consumo.listasAlerta(r, p);
        const S = Security.sanitize, A = Consumo._alertas;
        const bloco = (titulo, cor, sub, cols, rows) => `
            <div style="background:#fff; border:1px solid var(--ind-border); border-top:4px solid ${cor}; border-radius:8px; margin-bottom:18px; overflow:hidden;">
                <div style="padding:12px 16px;"><div style="font-weight:900; color:var(--tpv-dark-blue); text-transform:uppercase; letter-spacing:0.5px;">${titulo} (${rows.length})</div>
                <div style="font-size:0.75rem; color:#475569; margin-top:2px;">${sub}</div></div>
                <div style="overflow:auto; max-height:380px;"><table class="oa-table"><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>
                ${rows.length ? rows.map(r => `<tr>${r.map((v, i) => `<td style="${i === 0 ? 'font-weight:900; font-family:Roboto Mono,monospace;' : ''}">${S(String(v))}</td>`).join('')}</tr>`).join('')
                  : `<tr><td colspan="${cols.length}" style="text-align:center; color:#94a3b8; padding:18px;">Nenhum item.</td></tr>`}
                </tbody></table></div></div>`;
        document.getElementById('csAlertas').innerHTML =
            `<div style="font-size:0.78rem; color:#334155; margin-bottom:12px;">Periodo: <b>${Consumo._br(p.de)} a ${Consumo._br(p.ate)}</b></div>` +
            bloco('Usado e sem estoque — sugestao de compra', 'var(--ind-red)', 'Tiveram Apontamento (SAP 261) no periodo e estao com saldo zero (ou nao existem) no Spare Parts.', A.compra.cab, A.compra.rows) +
            bloco('Uso negativo', '#B42318', 'Terminou com mais do que poderia ter: entrada nao registrada ou saldo errado. Fica FORA do total ate ser revisado.', A.negativo.cab, A.negativo.rows) +
            bloco('Sem apontamento', '#C08A1E', 'Houve uso, mas o SAP nao mostra o componente nos kits: a % nao pode ser calculada.', A.semApo.cab, A.semApo.rows);
    },

    listasAlerta(r, p) {
        const sap = Consumo._sap, saldo = Consumo.saldoAtual(), desc = Consumo._desc(), fora = Consumo._codigosArmario();
        const ultEnt = {};
        (sap.s315 || []).forEach(x => { if (!ultEnt[x[0]] || x[2] > ultEnt[x[0]]) ultEnt[x[0]] = x[2]; });
        const apo = Consumo._somaSap(sap.s261, p.de, p.ate);
        const q = Consumo._fmtQ;
        const compra = Object.keys(apo).filter(c => apo[c] > 0 && !(saldo[c] > 0) && !fora.has(c)).sort((a, b) => apo[b] - apo[a])
            .map(c => [c, desc[c] || '-', q(apo[c]), q(saldo[c] || 0), Consumo._br(ultEnt[c])]);
        const linha = x => [x.code, x.desc || '-', q(x.ini), q(x.ent), q(x.fim), q(x.uso), q(x.apo)];
        const cab = ['Componente', 'Descricao', 'Est. Inicio', 'Entradas (SAP 315)', 'Est. Final', 'Uso', 'Apontamento (SAP 261)'];
        return {
            compra:   { cab: ['Componente', 'Descricao', 'Apontado no periodo', 'Saldo atual', 'Ultima entrada (SAP 315)'], rows: compra },
            negativo: { cab, rows: r.linhas.filter(x => x.status === 'USO NEGATIVO').sort((a, b) => a.uso - b.uso).map(linha) },
            semApo:   { cab, rows: r.linhas.filter(x => x.status === 'SEM APONTAMENTO').sort((a, b) => b.uso - a.uso).map(linha) },
        };
    },

    // ----------------------------------------------------------- Excel
    _cabecalho(p) {
        return [['Consumo Spare Parts – MMT'],
                [`Periodo: de ${Consumo._br(p.de)} a ${Consumo._br(p.ate)}`],
                [`Exportado em ${new Date().toLocaleString('pt-BR')} · Equipe MMT`], []];
    },
    _formatar(ws, linIni, linFim, colsQtd, colsPct, colsR) {
        for (let r = linIni; r <= linFim; r++) {
            const f = (cs, z) => cs.forEach(c => { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a] && typeof ws[a].v === 'number') ws[a].z = z; });
            f(colsQtd, '#,##0'); f(colsPct, '0.00%'); f(colsR, '"R$" #,##0.00');
        }
    },

    // v17.07: colunas que o usuario escolhe levar (ou nao) para o Excel.
    // A escolha fica lembrada neste PC; a tela continua mostrando tudo.
    OPCIONAIS: [['preco', 'Preco unit.'], ['valor', 'Valor do uso (R$)'], ['status', 'Status']],
    _colsExcel() { try { return JSON.parse(localStorage.getItem('consumo_cols_excel') || '{}'); } catch (e) { return {}; } },
    setColExcel(k, v) {
        const c = Consumo._colsExcel(); c[k] = !!v;
        try { localStorage.setItem('consumo_cols_excel', JSON.stringify(c)); } catch (e) {}
    },

    exportar() {
        if (!Consumo._res || !Consumo._periodo) { Toast.warn('Nada para exportar.'); return; }
        const p = Consumo._periodo, t = Consumo._res.tot, sel = Consumo._colsExcel();
        // [chave, titulo, valor(linha), valor(TOTAL), formato]
        const cols = [
            ['code',   'Componente',            r => r.code,             'TOTAL'],
            ['desc',   'Descricao',             r => r.desc || '',       ''],
            ['ini',    'Est. Inicio',           r => Math.round(r.ini),  Math.round(t.ini), 'q'],
            ['ent',    'Entradas (SAP 315)',    r => Math.round(r.ent),  Math.round(t.ent), 'q'],
            ['fim',    'Est. Final',            r => Math.round(r.fim),  Math.round(t.fim), 'q'],
            ['uso',    'Uso',                   r => Math.round(r.uso),  Math.round(t.uso), 'q'],
            ['apo',    'Apontamento (SAP 261)', r => Math.round(r.apo),  Math.round(t.apo), 'q'],
            ['pct',    '% Uso',                 r => r.pct,              t.pct,   'p'],
            ['preco',  'Preco unit.',           r => r.preco,            null,    'r'],
            ['valor',  'Valor do uso (R$)',     r => r.valor,            t.valor, 'r'],
            ['status', 'Status',                r => r.status,           '% geral = soma do Uso / soma do Apontamento (itens validos)'],
        ].filter(c => sel[c[0]] !== false);
        const aoa = Consumo._cabecalho(p);
        aoa.push(cols.map(c => c[1]));
        Consumo._filtradas().forEach(r => aoa.push(cols.map(c => c[2](r))));
        aoa.push(cols.map(c => c[3]));
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const idx = f => cols.map((c, i) => c[4] === f ? i : -1).filter(i => i >= 0);
        Consumo._formatar(ws, 5, aoa.length - 1, idx('q'), idx('p'), idx('r'));
        ws['!cols'] = cols.map(c => ({ wch: c[0] === 'desc' ? 36 : c[0] === 'code' || c[0] === 'status' ? 20 : 14 }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, Consumo._sub === 'semanal' ? 'Semanal' : 'Mensal');
        XLSX.writeFile(wb, p.arquivo);
        Logs.log('CONSUMO_EXPORT', `Exportou ${p.arquivo}`);
    },

    // ------------------------------------------------------- dashboards
    _charts: [],
    _novoGrafico(id, cfg) {
        const cv = document.getElementById(id);
        if (!cv) return;
        Consumo._charts.push(new Chart(cv, cfg));
    },

    async _telaDash(box) {
        Consumo._charts.forEach(c => { try { c.destroy(); } catch (e) {} });
        Consumo._charts = [];
        if (!Consumo._ym) Consumo._ym = Consumo._hoje().slice(0, 7);
        const p = Consumo._periodoMes(Consumo._ym);
        const card = (titulo, sub, id, alt) => `
            <div style="background:#fff; border:1px solid var(--ind-border); border-radius:8px; padding:16px;">
                <div style="font-weight:900; color:var(--tpv-dark-blue); text-transform:uppercase; letter-spacing:0.5px; font-size:0.88rem;">${titulo}</div>
                <div style="font-size:0.72rem; color:#475569; margin-bottom:10px;">${sub}</div>
                <div style="height:${alt || 300}px; position:relative;"><canvas id="${id}"></canvas></div>
            </div>`;
        box.innerHTML = `
        <div style="display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap; background:#f8fafc; border:1px solid var(--ind-border); border-radius:6px; padding:12px 14px; margin-bottom:14px;">
            <div><div class="oa-lbl">Mes</div><input type="month" class="big-input" style="padding:8px 10px; margin:0; width:auto;" value="${Consumo._ym}" onchange="Consumo._ym=this.value; Consumo.render()"></div>
            <div style="font-size:0.78rem; color:#334155; padding-bottom:8px;">Periodo: <b>${Consumo._br(p.de)} a ${Consumo._br(p.ate)}</b></div>
        </div>
        <div id="csDash"><div style="text-align:center; color:#94a3b8; padding:30px;"><i class="fas fa-spinner fa-spin"></i> Calculando...</div></div>`;

        if (typeof Chart === 'undefined') {
            document.getElementById('csDash').innerHTML = '<div style="color:var(--ind-red); padding:20px;">Os graficos nao carregaram: a biblioteca vem da internet e este PC parece sem acesso.</div>';
            return;
        }

        // Semanas do mes (segunda a domingo, cortadas nas bordas do periodo)
        const semanas = [];
        let a = p.de;
        while (a <= p.ate) {
            const seg = Consumo._iso(Consumo._segunda(new Date(a + 'T12:00:00')));
            let b = Consumo._maisDias(seg, 6);
            if (b > p.ate) b = p.ate;
            const w = Consumo._numSemana(new Date(a + 'T12:00:00'));
            semanas.push({ de: a, ate: b, rot: `S${String(w.n).padStart(2, '0')} (${a.slice(8)}–${b.slice(8)}/${b.slice(5, 7)})` });
            a = Consumo._maisDias(b, 1);
        }
        const [mes, ...porSemana] = await Promise.all([Consumo.calcular(p.de, p.ate)].concat(semanas.map(s => Consumo.calcular(s.de, s.ate))));
        const t = mes.tot, Q = Consumo._fmtQ;
        const validas = mes.linhas.filter(r => r.status !== 'USO NEGATIVO' && r.uso > 0);
        const top5 = validas.slice().sort((x, y) => y.uso - x.uso).slice(0, 5);
        const topEst = mes.linhas.slice().sort((x, y) => Math.max(y.ini, y.fim) - Math.max(x.ini, x.fim)).slice(0, 10);
        const varEst = t.ini ? (t.fim - t.ini) / t.ini : null;

        document.getElementById('csDash').innerHTML = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin-bottom:14px;">
            ${Consumo._kpi('Uso no mes (pecas)', Q(t.uso), 'var(--tpv-dark-blue)')}
            ${Consumo._kpi('% geral do mes', Consumo._fmtP(t.pct), 'var(--tpv-blue)')}
            ${Consumo._kpi('Estoque inicial', Q(t.ini), '#475569')}
            ${Consumo._kpi('Estoque final', Q(t.fim) + (varEst == null ? '' : ` <span style="font-size:0.8rem;">(${varEst >= 0 ? '+' : ''}${(varEst * 100).toFixed(1).replace('.', ',')}%)</span>`), varEst != null && varEst < 0 ? 'var(--ind-red)' : 'var(--ind-green)')}
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(420px,1fr)); gap:16px;">
            ${card('Tendencia de uso por semana', 'Barras: uso (pecas) de cada semana do mes · Linha: % de uso da semana', 'csChSemana')}
            ${card('Top 5 itens mais usados no mes', 'Uso em pecas (itens com uso negativo ficam fora)', 'csChTop')}
        </div>
        <div style="margin-top:16px;">${card('Estoque inicial x estoque final', 'Os 10 componentes com maior estoque no periodo', 'csChEst', 320)}</div>`;

        const azul = '#0066A1', escuro = '#004065', amarelo = '#fbbf24', cinza = '#94a3b8';
        Consumo._novoGrafico('csChSemana', {
            data: {
                labels: semanas.map(s => s.rot),
                datasets: [
                    { type: 'bar',  label: 'Uso (pecas)', data: porSemana.map(r => Math.round(r.tot.uso)), backgroundColor: azul, borderRadius: 4, yAxisID: 'y' },
                    { type: 'line', label: '% de uso', data: porSemana.map(r => r.tot.pct == null ? null : +(r.tot.pct * 100).toFixed(2)),
                      borderColor: amarelo, backgroundColor: amarelo, tension: 0.3, pointRadius: 4, yAxisID: 'y1' },
                ],
            },
            options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                scales: { y: { beginAtZero: true, title: { display: true, text: 'Pecas' } },
                          y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '%' } } } },
        });
        Consumo._novoGrafico('csChTop', {
            type: 'bar',
            data: { labels: top5.map(r => r.code), datasets: [{ label: 'Uso (pecas)', data: top5.map(r => Math.round(r.uso)), backgroundColor: escuro, borderRadius: 4 }] },
            options: { maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false },
                tooltip: { callbacks: { afterLabel: c => { const r = top5[c.dataIndex]; return (r.desc ? r.desc + ' · ' : '') + '% uso: ' + Consumo._fmtP(r.pct); } } } },
                scales: { x: { beginAtZero: true } } },
        });
        Consumo._novoGrafico('csChEst', {
            type: 'bar',
            data: { labels: topEst.map(r => r.code), datasets: [
                { label: 'Estoque inicial', data: topEst.map(r => Math.round(r.ini)), backgroundColor: cinza, borderRadius: 4 },
                { label: 'Estoque final',   data: topEst.map(r => Math.round(r.fim)), backgroundColor: azul,  borderRadius: 4 },
            ] },
            options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true } } },
        });
    },

    exportarAlertas() {
        const A = Consumo._alertas, p = Consumo._periodo;
        if (!A || !p) { Toast.warn('Nada para exportar.'); return; }
        const wb = XLSX.utils.book_new();
        [['Sugestao de compra', A.compra], ['Uso negativo', A.negativo], ['Sem apontamento', A.semApo]].forEach(([nome, l]) => {
            const ws = XLSX.utils.aoa_to_sheet(Consumo._cabecalho(p).concat([l.cab], l.rows));
            ws['!cols'] = [{ wch: 20 }, { wch: 36 }, ...Array(5).fill({ wch: 16 })];
            XLSX.utils.book_append_sheet(wb, ws, nome);
        });
        const nome = 'Consumo_SpareParts_Alertas_' + p.ym + '.xlsx';
        XLSX.writeFile(wb, nome);
        Logs.log('CONSUMO_EXPORT', `Exportou ${nome}`);
    },
};
window.Consumo = Consumo;
