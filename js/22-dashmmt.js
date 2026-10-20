// ==========================================================================
// MODULO: DASHBOARD DE ESTOQUE MMT — GRAFICOS  (v17.03)
// --------------------------------------------------------------------------
// Vitrine para a direcao. Cada grafico e montado para ser lido SOZINHO, num
// print colado no PowerPoint: titulo proprio, legenda propria e os numeros
// desenhados dentro do grafico. Tooltip nao sobrevive a um print, entao aqui
// nao existe informacao que dependa do mouse.
//
// POR QUE SVG PURO, E NAO UMA BIBLIOTECA
//   1. A Chart.js vem de CDN. Se a internet cair, o grafico some — e este e
//      justamente o material que vai para a diretoria.
//   2. Exportar PNG em alta resolucao a partir de SVG e nativo do navegador
//      (canvas + drawImage), sem html2canvas.
//   3. Controle total sobre os rotulos de valor, que sao o requisito central.
//
// A fonte dos SVGs e a familia generica (Arial/Helvetica/sans-serif) de
// proposito: fonte de CDN nao e embutida na exportacao PNG e o texto sairia
// trocado justamente no arquivo que vai para a apresentacao.
// ==========================================================================
const DashMMT = {

    FONTE: "Arial, Helvetica, sans-serif",
    LARGURA: 980,

    _movCache: null,      // movimentos dos ultimos 12 meses (carregados 1x)
    _modoG3: 'qtd',       // 'qtd' = pecas | 'mov' = numero de movimentos

    // ----------------------------------------------------------------------
    // UTILITARIOS
    // ----------------------------------------------------------------------
    _esc(t) { return Security.sanitize(String(t == null ? '' : t)); },

    _num(n) { return (Number(n) || 0).toLocaleString('pt-BR'); },

    // Ocultar o "Nao classificado" muda TODOS os numeros do dashboard, inclusive
    // os totais. Um numero que muda sem aviso e um numero em que ninguem pode
    // confiar, entao todo bloco afetado carrega esta frase no rodape.
    _notaNC() {
        const c = Familias.configNC();
        return c.oculta
            ? ` Os codigos sem familia estao OCULTOS por configuracao — eles nao entram nestes numeros `
              + `(Gestao do Sistema > Familias de Materiais).`
            : '';
    },

    // Encurta nomes longos para nao estourar a area de rotulo
    _corta(t, max) {
        t = String(t || '');
        return t.length > max ? t.slice(0, max - 1) + '…' : t;
    },

    // Moldura padrao de um grafico: titulo, subtitulo e a area do SVG.
    // O `id` e usado pela exportacao para achar o SVG e nomear o arquivo.
    // `controles` recebe HTML pronto (ex.: o seletor do Grafico 3) e por isso
    // NAO passa pelo sanitizador — o subtitulo, que e texto, passa. Misturar os
    // dois num campo so fazia o <select> ser impresso como texto na tela.
    // `semGrafico` esconde o botao PNG nos blocos que sao tabela.
    _bloco(id, numero, titulo, subtitulo, svg, rodape, controles, semGrafico) {
        return `
        <div class="dm-bloco" data-dm-id="${id}" data-dm-num="${numero}" style="background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:18px 20px; margin-bottom:18px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:4px; flex-wrap:wrap;">
                <div>
                    <h3 style="margin:0; color:var(--tpv-dark-blue); font-size:1.05rem;">${DashMMT._esc(titulo)}</h3>
                    ${subtitulo ? `<div style="font-size:0.78rem; color:#64748b; margin-top:2px;">${DashMMT._esc(subtitulo)}</div>` : ''}
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    ${controles || ''}
                    ${semGrafico ? '' : `<button class="btn-3d btn-gray" style="padding:6px 10px; font-size:0.72rem; white-space:nowrap;"
                        onclick="DashMMT.exportarUm('${id}')" title="Salvar este grafico em PNG">
                        <i class="fas fa-download"></i> PNG</button>`}
                </div>
            </div>
            <div class="dm-svg">${svg}</div>
            ${rodape ? `<div style="font-size:0.75rem; color:#64748b; margin-top:8px; font-style:italic;">${rodape}</div>` : ''}
        </div>`;
    },

    _svgVazio(msg) {
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DashMMT.LARGURA} 120" width="100%" style="display:block;">
            <rect width="100%" height="100%" fill="#f8fafc"/>
            <text x="${DashMMT.LARGURA / 2}" y="64" text-anchor="middle" font-family="${DashMMT.FONTE}"
                  font-size="15" fill="#94a3b8">${DashMMT._esc(msg)}</text>
        </svg>`;
    },

    // ----------------------------------------------------------------------
    // RENDER PRINCIPAL
    // ----------------------------------------------------------------------
    render() {
        const area = document.getElementById('dashMmtArea');
        if (!area) return;

        try { Familias.garantir(); } catch (e) {}

        const agg      = Familias.agregarEstoque(false);
        const aggSemXP = Familias.agregarEstoque(true);

        area.innerHTML =
              DashMMT._kpis(agg)
            + DashMMT._g1(agg)
            + DashMMT._g2(agg)
            + DashMMT._g3Placeholder()
            + DashMMT._g4()
            + DashMMT._g5()
            + DashMMT._g6()
            + DashMMT._rodape();

        // O Grafico 3 le os arquivos de movimento, o que pode demorar em rede.
        // Os outros ja estao na tela; este se completa sozinho quando chegar.
        DashMMT._carregarG3();
    },

    // ----------------------------------------------------------------------
    // KPIs
    // ----------------------------------------------------------------------
    _kpis(agg) {
        const locsTotal = (State.validLocations || []).length;
        const locsCheias = (State.inventory || []).filter(i => i && i.code).length;
        const ocup = locsTotal ? Math.round((locsCheias / locsTotal) * 100) : 0;

        const L = Familias.limites();
        const criticos = Familias.totaisPorCodigo(true).filter(t => t.qty < L.critico).length;

        const card = (valor, rotulo, cor, icone) => `
            <div style="background:#fff; border:1px solid #e2e8f0; border-left:5px solid ${cor}; border-radius:8px; padding:14px 16px;">
                <div style="display:flex; align-items:center; gap:8px; color:${cor}; font-size:0.72rem; font-weight:800; text-transform:uppercase; letter-spacing:.4px;">
                    <i class="fas ${icone}"></i>${DashMMT._esc(rotulo)}
                </div>
                <div style="font-size:1.75rem; font-weight:900; color:var(--tpv-dark-blue); font-family:'Roboto Mono',monospace; margin-top:4px;">${valor}</div>
            </div>`;

        return `
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px; margin-bottom:18px;">
            ${card(DashMMT._num(agg.totalQtd),      'Pecas em estoque',   '#0066A1', 'fa-layer-group')}
            ${card(DashMMT._num(agg.totalCodigos),  'Codigos distintos',  '#7c3aed', 'fa-microchip')}
            ${card(DashMMT._num(locsCheias),        'Locacoes ocupadas',  '#0891b2', 'fa-boxes')}
            ${card(ocup + '%',                      'Ocupacao',           '#16a34a', 'fa-percent')}
            ${card(DashMMT._num(criticos),          'Codigos criticos',   '#dc2626', 'fa-triangle-exclamation')}
        </div>`;
    },

    // ----------------------------------------------------------------------
    // GRAFICO 1 — Quantidade por Familia (barras VERTICAIS)
    //
    // Colunas com o valor no TOPO de cada barra e a escala na LATERAL, do
    // jeito que a direcao esta acostumada a ler. As linhas de grade sao
    // BRANCAS sobre um fundo levemente cinza: sobre fundo branco elas
    // sumiriam, e em cinza escuro brigariam com as barras no print.
    // ----------------------------------------------------------------------
    _g1(agg) {
        const dados = agg.porFamilia.filter(f => f.qtd > 0);
        if (!dados.length) {
            return DashMMT._bloco('01_familias', 1, 'Quantidade por Familia',
                '', DashMMT._svgVazio('Nenhum material em estoque.'), '');
        }

        const W = DashMMT.LARGURA, H = 430;
        const ml = 78, mr = 24, mt = 34, mb = 96;      // mb maior: nome da familia em 2 linhas
        const gw = W - ml - mr, gh = H - mt - mb;

        const maxV = Math.max(...dados.map(d => d.qtd)) || 1;
        // escala com marcas redondas, sempre um degrau acima do maior valor
        const passo = DashMMT._passoBonito(maxV);
        const topoY = Math.ceil(maxV / passo) * passo || passo;

        // fundo da area do grafico + grade branca
        let grade = `<rect x="${ml}" y="${mt}" width="${gw}" height="${gh}" fill="#eef2f6"/>`;
        for (let v = 0; v <= topoY + 0.0001; v += passo) {
            const y = mt + gh - (v / topoY) * gh;
            grade += `<line x1="${ml}" y1="${y}" x2="${ml + gw}" y2="${y}" stroke="#ffffff" stroke-width="1.5"/>`
                   + `<text x="${ml - 10}" y="${y + 4}" text-anchor="end" font-family="${DashMMT.FONTE}"
                            font-size="12" font-weight="bold" fill="#475569">${DashMMT._num(v)}</text>`;
        }

        // colunas
        const faixa = gw / dados.length;
        const larg  = Math.min(74, faixa * 0.62);
        let barras = '';
        dados.forEach((d, i) => {
            const cx = ml + faixa * (i + 0.5);
            const x  = cx - larg / 2;
            const h  = Math.max(2, (d.qtd / topoY) * gh);
            const y  = mt + gh - h;

            barras += `<rect x="${x}" y="${y}" width="${larg}" height="${h}" fill="${DashMMT._esc(d.cor)}" stroke="#1e293b" stroke-width="0.8"/>`
                   +  `<text x="${cx}" y="${y - 8}" text-anchor="middle" font-family="${DashMMT.FONTE}"
                             font-size="13" font-weight="bold" fill="#0f172a">${DashMMT._num(d.qtd)}</text>`;

            // nome embaixo, quebrado em duas linhas quando nao couber
            const nome = DashMMT._corta(d.nome, 26);
            const corte = nome.length > 13 ? nome.lastIndexOf(' ', Math.ceil(nome.length / 2) + 4) : -1;
            const l1 = corte > 0 ? nome.slice(0, corte) : nome;
            const l2 = corte > 0 ? nome.slice(corte + 1) : '';
            barras += `<text x="${cx}" y="${mt + gh + 18}" text-anchor="middle" font-family="${DashMMT.FONTE}"
                             font-size="11.5" font-weight="bold" fill="#334155">${DashMMT._esc(l1)}</text>`;
            if (l2) barras += `<text x="${cx}" y="${mt + gh + 32}" text-anchor="middle" font-family="${DashMMT.FONTE}"
                                     font-size="11.5" font-weight="bold" fill="#334155">${DashMMT._esc(l2)}</text>`;
        });

        // eixos
        const eixos = `<line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + gh}" stroke="#334155" stroke-width="2"/>
                       <line x1="${ml}" y1="${mt + gh}" x2="${ml + gw}" y2="${mt + gh}" stroke="#334155" stroke-width="2"/>
                       <text x="${ml - 10}" y="${mt - 12}" text-anchor="end" font-family="${DashMMT.FONTE}"
                             font-size="11" font-weight="bold" fill="#94a3b8">PECAS</text>`;

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block;">
            <rect width="100%" height="100%" fill="#fff"/>${grade}${barras}${eixos}</svg>`;

        return DashMMT._bloco('01_familias', 1, 'Quantidade por Familia',
            'Soma das pecas em estoque, por padrao de codificacao. Ordenado do maior para o menor.',
            svg, '');
    },

    // Passo de escala "redondo" (1, 2, 5 x 10^n) para o eixo nao sair com
    // numeros quebrados do tipo 137, 274, 411...
    _passoBonito(maxV) {
        const bruto = maxV / 5;
        const mag   = Math.pow(10, Math.floor(Math.log10(bruto || 1)));
        const norm  = bruto / mag;
        const mult  = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
        return Math.max(1, mult * mag);
    },

    // ----------------------------------------------------------------------
    // GRAFICO 2 — Participacao no Estoque (%)
    // ----------------------------------------------------------------------
    _g2(agg) {
        const dados = agg.porFamilia.filter(f => f.qtd > 0);
        const total = agg.totalQtd;
        if (!dados.length || !total) {
            return DashMMT._bloco('02_participacao', 2, 'Participacao no Estoque',
                '', DashMMT._svgVazio('Nenhum material em estoque.'), '');
        }

        const W = DashMMT.LARGURA, H = Math.max(280, 40 + dados.length * 24);
        const cx = 150, cy = H / 2, rExt = 105, rInt = 58;

        // Arcos da rosca
        let ang = -Math.PI / 2;   // comeca no topo
        let fatias = '';
        dados.forEach(d => {
            const frac = d.qtd / total;
            const fim  = ang + frac * Math.PI * 2;
            // circulo completo nao pode virar arco (o path colapsa)
            if (frac >= 0.9999) {
                fatias += `<circle cx="${cx}" cy="${cy}" r="${(rExt + rInt) / 2}" fill="none"
                           stroke="${DashMMT._esc(d.cor)}" stroke-width="${rExt - rInt}"/>`;
            } else {
                const x1 = cx + rExt * Math.cos(ang), y1 = cy + rExt * Math.sin(ang);
                const x2 = cx + rExt * Math.cos(fim), y2 = cy + rExt * Math.sin(fim);
                const x3 = cx + rInt * Math.cos(fim), y3 = cy + rInt * Math.sin(fim);
                const x4 = cx + rInt * Math.cos(ang), y4 = cy + rInt * Math.sin(ang);
                const grande = frac > 0.5 ? 1 : 0;
                fatias += `<path d="M${x1} ${y1} A${rExt} ${rExt} 0 ${grande} 1 ${x2} ${y2}
                                    L${x3} ${y3} A${rInt} ${rInt} 0 ${grande} 0 ${x4} ${y4} Z"
                           fill="${DashMMT._esc(d.cor)}" stroke="#fff" stroke-width="2"/>`;
            }
            ang = fim;
        });

        // Legenda com o percentual SEMPRE visivel (o print nao tem tooltip)
        let legenda = '';
        dados.forEach((d, i) => {
            const pct = (d.qtd / total) * 100;
            const y = 34 + i * 24;
            legenda += `
            <rect x="300" y="${y - 11}" width="13" height="13" rx="3" fill="${DashMMT._esc(d.cor)}"/>
            <text x="321" y="${y}" font-family="${DashMMT.FONTE}" font-size="13" fill="#334155">${DashMMT._esc(DashMMT._corta(d.nome, 30))}</text>
            <text x="700" y="${y}" text-anchor="end" font-family="${DashMMT.FONTE}" font-size="13" font-weight="bold" fill="#0f172a">${pct.toFixed(1).replace('.', ',')}%</text>
            <text x="880" y="${y}" text-anchor="end" font-family="${DashMMT.FONTE}" font-size="12" fill="#64748b">${DashMMT._num(d.qtd)} pc</text>`;
        });

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block;">
            <rect width="100%" height="100%" fill="#fff"/>
            ${fatias}
            <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-family="${DashMMT.FONTE}" font-size="12" fill="#64748b">TOTAL</text>
            <text x="${cx}" y="${cy + 18}" text-anchor="middle" font-family="${DashMMT.FONTE}" font-size="19" font-weight="bold" fill="#0f172a">${DashMMT._num(total)}</text>
            ${legenda}
        </svg>`;

        return DashMMT._bloco('02_participacao', 2, 'Participacao no Estoque',
            'Quanto cada familia representa do total de pecas.', svg, '');
    },

    // ----------------------------------------------------------------------
    // GRAFICO 3 — Movimentacao Mensal por Familia
    // ----------------------------------------------------------------------
    _g3Placeholder() {
        const sel = `
        <select class="big-input" style="width:auto; padding:5px 9px; font-size:0.78rem; margin-left:8px;"
                onchange="DashMMT.trocarModoG3(this.value)">
            <option value="qtd" ${DashMMT._modoG3 === 'qtd' ? 'selected' : ''}>Quantidade de pecas</option>
            <option value="mov" ${DashMMT._modoG3 === 'mov' ? 'selected' : ''}>Numero de movimentos</option>
        </select>`;
        return `<div id="dmG3Wrap">` +
            DashMMT._bloco('03_movimentacao', 3, 'Movimentacao Mensal por Familia',
                'Retiradas dos ultimos 12 meses.',
                DashMMT._svgVazio('Lendo os movimentos dos ultimos 12 meses...'), '', sel) +
            `</div>`;
    },

    async _carregarG3() {
        try {
            if (!DashMMT._movCache) {
                const de = new Date(); de.setMonth(de.getMonth() - 11); de.setDate(1);
                de.setHours(0, 0, 0, 0);
                DashMMT._movCache = (typeof Store !== 'undefined' && Store._mov)
                    ? await Store.lerHistoricoPeriodo(de.getTime(), Date.now())
                    : (State.checkoutHistory || []);
            }
            DashMMT._pintarG3();
            DashMMT._pintarG6();   // a tabela de reposicao depende do consumo
        } catch (e) {
            console.warn('[DashMMT] G3:', e.message);
            const w = document.getElementById('dmG3Wrap');
            if (w) w.querySelector('.dm-svg').innerHTML =
                DashMMT._svgVazio('Nao foi possivel ler os movimentos: ' + e.message);
        }
    },

    trocarModoG3(v) { DashMMT._modoG3 = (v === 'mov' ? 'mov' : 'qtd'); DashMMT._pintarG3(); },

    // Meses no formato AAAA-MM, do mais antigo ao mais novo
    _ultimos12Meses() {
        const out = [];
        const d = new Date(); d.setDate(1);
        for (let i = 11; i >= 0; i--) {
            const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
            out.push({
                chave: x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'),
                rotulo: x.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase(),
                ano: String(x.getFullYear()).slice(2),
            });
        }
        return out;
    },

    // { familiaId: { nome, cor, meses: {chave: valor} } }
    _agregarMovimentos() {
        const meses = DashMMT._ultimos12Meses();
        const validas = new Set(meses.map(m => m.chave));
        const fams = new Map();

        (DashMMT._movCache || []).forEach(h => {
            if (!h || !h.timestamp) return;
            const itens = h.removedItems || [];       // so RETIRADAS, como pedido
            if (!itens.length || h.type === 'RETURN') return;
            const d = new Date(h.timestamp);
            const ch = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            if (!validas.has(ch)) return;

            itens.forEach(it => {
                if (!it || !it.code) return;
                const f = Familias.classificar(it.code);
                let reg = fams.get(f.id);
                if (!reg) { reg = { nome: f.nome, cor: f.cor || '#94a3b8', meses: {} }; fams.set(f.id, reg); }
                reg.meses[ch] = (reg.meses[ch] || 0) +
                    (DashMMT._modoG3 === 'mov' ? 1 : (Number(it.qty) || 0));
            });
        });
        return { meses, fams };
    },

    _pintarG3() {
        const wrap = document.getElementById('dmG3Wrap');
        if (!wrap) return;
        const alvo = wrap.querySelector('.dm-svg');
        const { meses, fams } = DashMMT._agregarMovimentos();

        if (!fams.size) {
            alvo.innerHTML = DashMMT._svgVazio('Nenhuma retirada registrada nos ultimos 12 meses.');
            return;
        }

        // Mantem as 6 familias de maior movimento; o resto vira "Outras".
        // Com 10 series o grafico vira um emaranhado e perde o valor de print.
        const totalDe = r => Object.values(r.meses).reduce((s, v) => s + v, 0);
        let series = [...fams.values()].sort((a, b) => totalDe(b) - totalDe(a));
        if (series.length > 6) {
            const resto = series.slice(6);
            // #475569 e nao o cinza claro: "Nao classificado" ja usa #94a3b8 e as
            // duas series ficavam indistinguiveis na legenda.
            const outras = { nome: 'Outras familias', cor: '#475569', meses: {} };
            resto.forEach(r => Object.keys(r.meses).forEach(k => { outras.meses[k] = (outras.meses[k] || 0) + r.meses[k]; }));
            series = series.slice(0, 6).concat([outras]);
        }

        const W = DashMMT.LARGURA, H = 430;
        const ml = 70, mr = 20, mt = 20, mb = 96;
        const gw = W - ml - mr, gh = H - mt - mb;
        const maxV = Math.max(1, ...series.flatMap(s => meses.map(m => s.meses[m.chave] || 0)));

        // eixo Y com marcas redondas
        const passo = Math.pow(10, Math.floor(Math.log10(maxV))) / 2 || 1;
        const topoY = Math.ceil(maxV / passo) * passo;
        let eixo = '';
        for (let v = 0; v <= topoY; v += passo) {
            const y = mt + gh - (v / topoY) * gh;
            eixo += `<line x1="${ml}" y1="${y}" x2="${W - mr}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>
                     <text x="${ml - 8}" y="${y + 4}" text-anchor="end" font-family="${DashMMT.FONTE}" font-size="11" fill="#94a3b8">${DashMMT._num(v)}</text>`;
        }

        const xDe = i => ml + (gw / meses.length) * (i + 0.5);

        let linhas = '', rotulos = '';
        series.forEach(s => {
            const pts = meses.map((m, i) => {
                const v = s.meses[m.chave] || 0;
                return { x: xDe(i), y: mt + gh - (v / topoY) * gh, v };
            });
            linhas += `<polyline points="${pts.map(p => p.x + ',' + p.y).join(' ')}" fill="none"
                        stroke="${DashMMT._esc(s.cor)}" stroke-width="2.5" stroke-linejoin="round"/>`;
            pts.forEach(p => { linhas += `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${DashMMT._esc(s.cor)}"/>`; });
            // valor do ULTIMO mes ao lado da linha: o numero que interessa na leitura
            const ult = pts[pts.length - 1];
            if (ult.v > 0) {
                rotulos += `<text x="${ult.x + 7}" y="${ult.y + 4}" font-family="${DashMMT.FONTE}" font-size="11"
                             font-weight="bold" fill="${DashMMT._esc(s.cor)}">${DashMMT._num(ult.v)}</text>`;
            }
        });

        let eixoX = '';
        meses.forEach((m, i) => {
            eixoX += `<text x="${xDe(i)}" y="${mt + gh + 18}" text-anchor="middle" font-family="${DashMMT.FONTE}" font-size="11" fill="#64748b">${m.rotulo}</text>
                      <text x="${xDe(i)}" y="${mt + gh + 31}" text-anchor="middle" font-family="${DashMMT.FONTE}" font-size="9" fill="#cbd5e1">${m.ano}</text>`;
        });

        let legenda = '';
        series.forEach((s, i) => {
            const cols = 4, cw = gw / cols;
            const x = ml + (i % cols) * cw, y = mt + gh + 54 + Math.floor(i / cols) * 19;
            legenda += `<rect x="${x}" y="${y - 9}" width="11" height="11" rx="2" fill="${DashMMT._esc(s.cor)}"/>
                        <text x="${x + 17}" y="${y}" font-family="${DashMMT.FONTE}" font-size="11.5" fill="#334155">${DashMMT._esc(DashMMT._corta(s.nome, 22))}</text>`;
        });

        alvo.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block;">
            <rect width="100%" height="100%" fill="#fff"/>
            ${eixo}${linhas}${rotulos}${eixoX}${legenda}
        </svg>`;
    },

    // ----------------------------------------------------------------------
    // Familias diferentes podem carregar o MESMO nome — e o caso dos tres
    // "DELL", que sao tres padroes de codificacao distintos. No grafico isso
    // vira tres barras com o mesmo rotulo e ninguem sabe qual e qual. Quando o
    // nome repete, numeramos. A numeracao sai do id (estavel), e nao da ordem
    // do grafico: assim "DELL (2)" continua sendo o mesmo DELL em toda tela e
    // em todo print, mesmo que a ordenacao mude.
    // ----------------------------------------------------------------------
    _nomesUnicos(lista) {
        const porNome = new Map();
        lista.forEach(g => {
            if (!porNome.has(g.nome)) porNome.set(g.nome, []);
            porNome.get(g.nome).push(g.id);
        });
        const numero = new Map();
        porNome.forEach(ids => {
            if (ids.length < 2) return;
            [...ids].sort().forEach((id, i) => numero.set(id, i + 1));
        });
        lista.forEach(g => {
            g.rotulo = numero.has(g.id) ? g.nome + ' (' + numero.get(g.id) + ')' : g.nome;
        });
        return { lista, houveRepetido: numero.size > 0 };
    },

    // ----------------------------------------------------------------------
    // GRAFICO 4 — Saude do Estoque por Faixa Critica (XP EXCLUIDO)
    //
    // POR QUE ESTE GRAFICO FOI REFEITO
    //   A versao anterior era uma barra empilhada normalizada em 100%: toda
    //   familia ocupava a mesma largura e so o percentual variava. O efeito
    //   pratico era o oposto do pretendido. Uma familia com 41 codigos e 39%
    //   criticos (16 codigos) aparecia no TOPO, com o maior bloco vermelho da
    //   tela, enquanto uma com 2.140 codigos e 14% criticos (310 codigos)
    //   aparecia logo abaixo com um bloco bem menor. Quem lesse o grafico numa
    //   reuniao priorizaria os 16 no lugar dos 310.
    //
    //   Agora sao dois paineis, cada um com UMA pergunta e UMA escala:
    //     Painel 1 — como esta o estoque inteiro (uma barra so, o todo).
    //     Painel 2 — onde estao os codigos que precisam de reposicao, em
    //                VOLUME ABSOLUTO. O comprimento da barra e a quantidade
    //                real de codigos, entao a barra maior e mesmo o maior
    //                problema. O percentual continua na tela, na coluna da
    //                direita, como leitura de apoio.
    // ----------------------------------------------------------------------
    _g4() {
        const L = Familias.limites();
        const totais = Familias.totaisPorCodigo(true);   // true = sem XP
        const F = DashMMT.FONTE;

        let nota = `Materiais XP nao entram nesta analise — trabalham com volumes naturalmente reduzidos. `
                 + `Faixas: Critico &lt; ${L.critico} · Atencao ${L.critico}–${L.atencao - 1} · `
                 + `Observacao ${L.atencao}–${L.saudavel - 1} · Saudavel ≥ ${L.saudavel} pecas.`;

        if (!totais.length) {
            return DashMMT._bloco('04_saude', 4, 'Saude do Estoque por Faixa Critica',
                '', DashMMT._svgVazio('Nenhum material fora de carros XP.'), nota + DashMMT._notaNC());
        }

        // agrega por familia e, na mesma passada, o total geral do estoque
        const porFam = new Map();
        const geral  = { critico: 0, atencao: 0, observacao: 0, saudavel: 0, total: 0 };
        totais.forEach(t => {
            let g = porFam.get(t.familia.id);
            if (!g) {
                g = { id: t.familia.id, nome: t.familia.nome, critico: 0, atencao: 0, observacao: 0, saudavel: 0, total: 0 };
                porFam.set(t.familia.id, g);
            }
            const f = Familias.faixaDe(t.qty);
            g[f]++;     g.total++;
            geral[f]++; geral.total++;
        });

        const u = DashMMT._nomesUnicos([...porFam.values()].filter(g => g.total > 0));
        // Ordenado pelo NUMERO de codigos a repor, nao pelo percentual: a fila
        // de trabalho e feita de codigos, nao de porcentagem.
        const dados = u.lista.sort((a, b) =>
            (b.critico + b.atencao) - (a.critico + a.atencao) || b.total - a.total);

        nota += DashMMT._notaNC();

        if (u.houveRepetido) {
            nota += ` Familias com o mesmo nome aparecem numeradas — sao padroes de codificacao diferentes; `
                  + `renomeie em Configuracoes do Sistema > Familias de Materiais para identifica-las melhor.`;
        }

        const porFaixa = id => Familias.FAIXAS.find(f => f.id === id);
        const fCrit = porFaixa('critico'), fAten = porFaixa('atencao');

        const W = DashMMT.LARGURA, ROT = 196, DIR = 176;
        const util = W - ROT - DIR;

        // ---------- geometria ----------
        const yLeg = 16;                    // legenda das 4 faixas
        const yT1  = 44;                    // titulo do painel 1
        const yB1  = 54, hB1 = 46;          // barra do painel 1
        const yT2  = yB1 + hB1 + 62;        // titulo do painel 2 (espaco p/ rotulos abaixo da barra)
        const y0   = yT2 + 34;              // primeira linha do painel 2
        const hb = 26, gap = 11;
        const yFim = y0 + dados.length * (hb + gap);
        const H = yFim + 22;

        // ---------- legenda ----------
        let leg = '';
        Familias.FAIXAS.forEach((f, i) => {
            const x = ROT + i * 150;
            leg += `<rect x="${x}" y="${yLeg - 10}" width="12" height="12" rx="2" fill="${f.cor}"/>
                    <text x="${x + 18}" y="${yLeg}" font-family="${F}" font-size="12" fill="#334155">${f.rotulo}</text>`;
        });

        // ---------- PAINEL 1: o estoque inteiro numa barra so ----------
        let p1 = `<text x="0" y="${yT1}" font-family="${F}" font-size="11.5" font-weight="bold" fill="#64748b">TODO O ESTOQUE</text>
                  <text x="${ROT - 10}" y="${yB1 + 21}" text-anchor="end" font-family="${F}" font-size="15" font-weight="bold" fill="#0f172a">${DashMMT._num(geral.total)}</text>
                  <text x="${ROT - 10}" y="${yB1 + 37}" text-anchor="end" font-family="${F}" font-size="11" fill="#64748b">codigos</text>`;
        let px = ROT, nivel = 0;
        Familias.FAIXAS.forEach(f => {
            const nq = geral[f.id];
            if (!nq) return;
            const w  = (nq / geral.total) * util;
            const wr = Math.max(1.5, w - 2);        // 2px de respiro entre as faixas
            const pct = (nq / geral.total) * 100;
            const sub = (pct < 10 ? pct.toFixed(1) : String(Math.round(pct))).replace('.', ',') + '%';
            p1 += `<rect x="${px}" y="${yB1}" width="${wr}" height="${hB1}" rx="2" fill="${f.cor}"/>`;
            if (wr >= 58) {
                p1 += `<text x="${px + wr / 2}" y="${yB1 + 21}" text-anchor="middle" font-family="${F}" font-size="13.5" font-weight="bold" fill="${f.corTexto}">${DashMMT._num(nq)}</text>
                       <text x="${px + wr / 2}" y="${yB1 + 37}" text-anchor="middle" font-family="${F}" font-size="11.5" fill="${f.corTexto}">${sub}</text>`;
            } else {
                // Faixa estreita demais para o rotulo caber dentro. Em vez de
                // esconder o numero (era o que a versao antiga fazia com tudo
                // abaixo de 7%), ele desce com uma guia. Dois niveis alternados
                // evitam que dois rotulos vizinhos se sobreponham.
                const ly = yB1 + hB1 + 17 + nivel * 15;
                p1 += `<line x1="${px + wr / 2}" y1="${yB1 + hB1 + 1}" x2="${px + wr / 2}" y2="${ly - 10}" stroke="${f.cor}" stroke-width="1.5"/>
                       <text x="${px + wr / 2}" y="${ly}" text-anchor="middle" font-family="${F}" font-size="11" font-weight="bold" fill="#334155">${DashMMT._num(nq)} · ${sub}</text>`;
                nivel = nivel ? 0 : 1;
            }
            px += w;
        });

        // ---------- PAINEL 2: volume absoluto por familia ----------
        const maxV  = Math.max(...dados.map(g => g.critico + g.atencao)) || 1;
        const passo = DashMMT._passoBonito(maxV);
        const topoV = Math.ceil(maxV / passo) * passo || passo;

        let grade = '';
        for (let v = 0; v <= topoV + 0.0001; v += passo) {
            const gx = ROT + (v / topoV) * util;
            grade += `<line x1="${gx}" y1="${y0 - 12}" x2="${gx}" y2="${yFim - gap + 4}" stroke="${v === 0 ? '#94a3b8' : '#e2e8f0'}" stroke-width="${v === 0 ? 1.5 : 1}"/>
                      <text x="${gx}" y="${y0 - 18}" text-anchor="middle" font-family="${F}" font-size="10.5" fill="#94a3b8">${DashMMT._num(v)}</text>`;
        }

        let p2 = `<text x="0" y="${yT2}" font-family="${F}" font-size="11.5" font-weight="bold" fill="#64748b">PRECISA DE REPOSICAO — codigos abaixo de ${DashMMT._num(L.atencao)} pecas, por familia</text>`;
        dados.forEach((g, i) => {
            const y    = y0 + i * (hb + gap);
            const soma = g.critico + g.atencao;
            const wC   = (g.critico / topoV) * util;
            const wA   = (g.atencao / topoV) * util;

            p2 += `<text x="${ROT - 10}" y="${y + hb / 2 + 4.5}" text-anchor="end" font-family="${F}"
                     font-size="12.5" font-weight="bold" fill="#334155">${DashMMT._esc(DashMMT._corta(g.rotulo, 24))}</text>`;

            if (g.critico) {
                p2 += `<rect x="${ROT}" y="${y}" width="${Math.max(1.5, wC)}" height="${hb}" fill="${fCrit.cor}"/>`;
                if (wC >= 34) p2 += `<text x="${ROT + wC / 2}" y="${y + hb / 2 + 4.5}" text-anchor="middle" font-family="${F}"
                                       font-size="11.5" font-weight="bold" fill="${fCrit.corTexto}">${DashMMT._num(g.critico)}</text>`;
            }
            if (g.atencao) {
                const xA = ROT + wC + 2;
                p2 += `<rect x="${xA}" y="${y}" width="${Math.max(1.5, wA - 2)}" height="${hb}" fill="${fAten.cor}"/>`;
                if (wA >= 36) p2 += `<text x="${xA + (wA - 2) / 2}" y="${y + hb / 2 + 4.5}" text-anchor="middle" font-family="${F}"
                                       font-size="11.5" font-weight="bold" fill="${fAten.corTexto}">${DashMMT._num(g.atencao)}</text>`;
            }

            // Coluna da direita: o mesmo numero em percentual da familia. E a
            // leitura que a barra NAO da — e de proposito que ela seja a
            // secundaria, em texto menor.
            const pct = Math.round((soma / g.total) * 100);
            p2 += `<text x="${ROT + util + 12}" y="${y + hb / 2 + 4.5}" font-family="${F}" font-size="11.5" fill="#475569">
                     <tspan font-weight="bold" fill="#0f172a">${DashMMT._num(soma)}</tspan> de ${DashMMT._num(g.total)} · ${pct}%</text>`;
        });

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block;">
            <rect width="100%" height="100%" fill="#fff"/>
            ${leg}${p1}${grade}${p2}
        </svg>`;

        return DashMMT._bloco('04_saude', 4, 'Saude do Estoque por Faixa Critica',
            'Em cima, o estoque inteiro. Embaixo, quantos codigos cada familia tem para repor — em quantidade, nao em percentual.',
            svg, nota);
    },

    // ----------------------------------------------------------------------
    // BLOCO 5 — Top Criticos: quanto do estoque esta em cada faixa de
    // quantidade, em percentual ACUMULADO.
    //
    // "Acumulado" quer dizer que cada faixa inclui as menores: "abaixo de 100"
    // ja contem tudo que esta "abaixo de 10". E a leitura pedida — "abaixo de
    // 10 tem 10%, abaixo de 100 tem 30%, e assim vai" — e a que responde de
    // cabeca a pergunta da diretoria: "quanto do meu estoque esta raspando?".
    // A ultima faixa e o complemento: do ultimo corte ate o maior codigo.
    // ----------------------------------------------------------------------
    FAIXAS_QTD: [10, 50, 100, 500],

    // Rampa de severidade (do pior para o melhor). Nao e paleta categorica: a
    // ordem tem significado, entao a cor caminha junto com a gravidade.
    CORES_QTD: [
        { cor: '#7f1d1d', texto: '#ffffff' },
        { cor: '#b91c1c', texto: '#ffffff' },
        { cor: '#f97316', texto: '#ffffff' },
        { cor: '#facc15', texto: '#1f2937' },
        { cor: '#15803d', texto: '#ffffff' },
    ],

    _g5() {
        const F = DashMMT.FONTE;
        const totais = Familias.totaisPorCodigo(true);   // sem XP, somando todas as locacoes

        if (!totais.length) {
            return DashMMT._bloco('05_faixas_qtd', 5, 'Top Criticos — onde agir agora',
                '', DashMMT._svgVazio('Nenhum material fora de carros XP.'),
                'Materiais XP nao entram nesta analise.');
        }

        const qs    = totais.map(t => t.qty).sort((a, b) => a - b);
        const n     = qs.length;
        const maior = qs[n - 1];
        const abaixoDe = c => qs.filter(q => q < c).length;

        // Um corte maior que o proprio estoque geraria uma faixa de 100% sem
        // informacao nenhuma; fica de fora. O primeiro corte sempre entra,
        // mesmo num estoque minusculo, senao o grafico ficaria sem faixas.
        const cortes = DashMMT.FAIXAS_QTD.filter(c => c < maior);
        if (!cortes.length) cortes.push(DashMMT.FAIXAS_QTD[0]);

        const linhas = cortes.map((c, i) => {
            const qtd = abaixoDe(c);
            return {
                rotulo: 'Abaixo de ' + DashMMT._num(c) + ' pecas',
                qtd, pct: (qtd / n) * 100,
                extra: i === 0 ? '' : '+' + DashMMT._num(qtd - abaixoDe(cortes[i - 1])) + ' vs a faixa acima',
                c: DashMMT.CORES_QTD[Math.min(i, DashMMT.CORES_QTD.length - 2)],
            };
        });
        const ultimo = cortes[cortes.length - 1];
        const resto  = n - abaixoDe(ultimo);
        linhas.push({
            rotulo: 'De ' + DashMMT._num(ultimo) + ' ate ' + DashMMT._num(maior) + ' pecas',
            qtd: resto, pct: (resto / n) * 100,
            extra: 'o restante do estoque',
            c: DashMMT.CORES_QTD[DashMMT.CORES_QTD.length - 1],
        });

        const W = DashMMT.LARGURA, ROT = 232, DIR = 196;
        const util = W - ROT - DIR;
        const hb = 36, gap = 14, y0 = 50;
        const H = y0 + linhas.length * (hb + gap) + 14;

        // Eixo: a trilha cinza de cada linha vale 100%, e estas duas marcas
        // dizem isso sem precisar de uma grade inteira atras das barras.
        const eixo = `<text x="${ROT}" y="${y0 - 16}" font-family="${F}" font-size="10.5" fill="#94a3b8">0%</text>
                      <text x="${ROT + util}" y="${y0 - 16}" text-anchor="end" font-family="${F}" font-size="10.5" fill="#94a3b8">100% dos ${DashMMT._num(n)} codigos</text>
                      <line x1="${ROT}" y1="${y0 - 10}" x2="${ROT + util}" y2="${y0 - 10}" stroke="#e2e8f0" stroke-width="1"/>`;

        let corpo = '';
        linhas.forEach((l, i) => {
            const y = y0 + i * (hb + gap);
            const w = Math.max(2, (l.pct / 100) * util);
            const pctTxt = (l.pct < 10 ? l.pct.toFixed(1) : String(Math.round(l.pct))).replace('.', ',') + '%';

            corpo += `<text x="${ROT - 14}" y="${y + hb / 2 + 5}" text-anchor="end" font-family="${F}"
                        font-size="13" font-weight="bold" fill="#334155">${DashMMT._esc(l.rotulo)}</text>
                      <rect x="${ROT}" y="${y}" width="${util}" height="${hb}" rx="4" fill="#f1f5f9"/>
                      <rect x="${ROT}" y="${y}" width="${w}" height="${hb}" rx="4" fill="${l.c.cor}"/>`;

            // O percentual entra dentro da barra quando cabe; quando a barra e
            // curta demais ele sai para fora, em tinta escura. Nunca some.
            corpo += w >= 68
                ? `<text x="${ROT + w - 12}" y="${y + hb / 2 + 6}" text-anchor="end" font-family="${F}"
                     font-size="16" font-weight="bold" fill="${l.c.texto}">${pctTxt}</text>`
                : `<text x="${ROT + w + 10}" y="${y + hb / 2 + 6}" font-family="${F}"
                     font-size="16" font-weight="bold" fill="#0f172a">${pctTxt}</text>`;

            corpo += `<text x="${ROT + util + 14}" y="${y + 16}" font-family="${F}" font-size="12.5"
                        font-weight="bold" fill="#0f172a">${DashMMT._num(l.qtd)} codigos</text>`;
            if (l.extra) {
                corpo += `<text x="${ROT + util + 14}" y="${y + 31}" font-family="${F}" font-size="10.5"
                            fill="#94a3b8">${DashMMT._esc(l.extra)}</text>`;
            }
        });

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block;">
            <rect width="100%" height="100%" fill="#fff"/>${eixo}${corpo}
        </svg>`;

        const nota = `Leitura ACUMULADA: cada faixa inclui as menores — "abaixo de ${DashMMT._num(100)} pecas" ja contem tudo que esta `
                   + `"abaixo de ${DashMMT._num(10)}". A ultima faixa e o complemento: de ${DashMMT._num(ultimo)} pecas ate o maior codigo do estoque `
                   + `(${DashMMT._num(maior)} pecas). Base: ${DashMMT._num(n)} codigos, somando todas as locacoes de cada codigo e excluindo carros XP.`
                   + DashMMT._notaNC();

        return DashMMT._bloco('05_faixas_qtd', 5, 'Top Criticos — onde agir agora',
            'Percentual dos codigos do estoque em cada faixa de quantidade.', svg, nota);
    },

    // ----------------------------------------------------------------------
    // BLOCO 6 — a lista nominal de reposicao (tabela de acao)
    //
    // Fica num bloco proprio porque responde outra pergunta: o bloco 5 diz
    // QUANTO do estoque esta raspando, este diz QUAIS codigos pegar primeiro.
    // ----------------------------------------------------------------------
    _g6() {
        const L = Familias.limites();
        // MINIMO_ACAO: abaixo disto o item nao entra na lista. Sao sobras e
        // pontas de serie que poluiriam a tabela de acao — nao ha o que
        // "repor" num codigo com 2 pecas residuais. Definido pelo usuario.
        const MINIMO_ACAO = 5;
        const criticos = Familias.totaisPorCodigo(true)
            .filter(t => t.qty >= MINIMO_ACAO && t.qty < L.critico);

        // consumo medio mensal, a partir dos movimentos ja carregados
        const consumo = new Map();
        const meses = new Set();
        (DashMMT._movCache || []).forEach(h => {
            if (!h || !h.timestamp || h.type === 'RETURN') return;
            const d = new Date(h.timestamp);
            meses.add(d.getFullYear() + '-' + d.getMonth());
            (h.removedItems || []).forEach(it => {
                if (!it || !it.code) return;
                consumo.set(it.code, (consumo.get(it.code) || 0) + (Number(it.qty) || 0));
            });
        });
        const nMeses = Math.max(1, meses.size);

        const linhas = criticos.map(t => {
            const mes = (consumo.get(t.code) || 0) / nMeses;
            // Sem consumo registrado nao da para estimar cobertura. Marcamos
            // como desconhecida em vez de inventar "infinito", que passaria a
            // ideia errada de que o item esta tranquilo.
            const dias = mes > 0 ? (t.qty / mes) * 30 : null;
            return { ...t, consumoMes: mes, dias };
        }).sort((a, b) => {
            if (a.dias === null && b.dias === null) return a.qty - b.qty;
            if (a.dias === null) return 1;      // sem consumo vai para o fim
            if (b.dias === null) return -1;
            return a.dias - b.dias;
        }).slice(0, 20);

        const nota = `Os 20 codigos entre ${MINIMO_ACAO} e ${L.critico - 1} pecas, excluindo carros XP. `
                   + `Cobertura = quantidade atual dividida pelo consumo medio (${nMeses} ${nMeses === 1 ? 'mes' : 'meses'} de historico). `
                   + `Ordenado pelo que acaba primeiro. `
                   + `Itens com menos de ${MINIMO_ACAO} pecas nao entram: sao sobras, nao reposicao.`
                   + DashMMT._notaNC();

        if (!linhas.length) {
            return `<div id="dmG6Wrap">` + DashMMT._bloco('06_top_criticos', 6, 'Codigos para Repor Primeiro',
                '', DashMMT._svgVazio('Nenhum codigo em estado critico. '), nota, '', true) + `</div>`;
        }

        const cat = (code) => {
            const c = (State.componentCatalog || []).find(x => x.code && x.code.toUpperCase() === code.toUpperCase());
            return c ? c.description : '';
        };

        const tr = linhas.map((l, i) => {
            const urgente = l.dias !== null && l.dias < 15;
            return `<tr style="background:${i % 2 ? '#f8fafc' : '#fff'};">
                <td style="padding:7px 9px; font-weight:bold; color:#64748b;">${i + 1}</td>
                <td style="padding:7px 9px; font-family:'Roboto Mono',monospace; font-weight:bold;">${DashMMT._esc(l.code)}</td>
                <td style="padding:7px 9px;"><span style="display:inline-block; width:9px; height:9px; border-radius:2px; background:${DashMMT._esc(l.familia.cor || '#94a3b8')}; margin-right:5px;"></span>${DashMMT._esc(DashMMT._corta(l.familia.nome, 22))}</td>
                <td style="padding:7px 9px; color:#475569; font-size:0.82rem;">${DashMMT._esc(DashMMT._corta(cat(l.code), 38))}</td>
                <td style="padding:7px 9px; text-align:right; font-weight:bold; color:#b91c1c;">${DashMMT._num(l.qty)}</td>
                <td style="padding:7px 9px; text-align:right; color:#475569;">${l.consumoMes > 0 ? DashMMT._num(Math.round(l.consumoMes)) : '—'}</td>
                <td style="padding:7px 9px; text-align:right; font-weight:bold; color:${urgente ? '#b91c1c' : '#334155'};">
                    ${l.dias === null ? '<span style="color:#94a3b8; font-weight:normal;">sem consumo</span>' : Math.round(l.dias) + ' dias'}
                </td>
            </tr>`;
        }).join('');

        const tabela = `
        <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
            <thead><tr style="background:var(--tpv-dark-blue); color:#fff; text-align:left;">
                <th style="padding:8px 9px; width:34px;">#</th>
                <th style="padding:8px 9px;">Codigo</th>
                <th style="padding:8px 9px;">Familia</th>
                <th style="padding:8px 9px;">Descricao</th>
                <th style="padding:8px 9px; text-align:right;">Qtd</th>
                <th style="padding:8px 9px; text-align:right;">Consumo/mes</th>
                <th style="padding:8px 9px; text-align:right;">Cobertura</th>
            </tr></thead>
            <tbody>${tr}</tbody>
        </table></div>`;

        return `<div id="dmG6Wrap">` +
            DashMMT._bloco('06_top_criticos', 6, 'Codigos para Repor Primeiro',
                'Os que acabam antes, pelo consumo dos ultimos 12 meses.', tabela, nota, '', true) +
            `</div>`;
    },

    // A coluna "Cobertura" depende do consumo, e o consumo so chega depois da
    // leitura dos arquivos de movimento (assincrona). Sem este repintar a
    // tabela ficava congelada em "sem consumo" para TODOS os codigos na
    // primeira abertura da aba, e so acertava numa segunda renderizacao.
    _pintarG6() {
        const w = document.getElementById('dmG6Wrap');
        if (w) w.outerHTML = DashMMT._g6();
    },

    _rodape() {
        const agora = new Date().toLocaleString('pt-BR');
        const nc = Familias.configNC();
        const aviso = nc.oculta
            ? `<div style="margin-bottom:8px; color:#b45309; font-weight:bold;">
                 <i class="fas fa-eye-slash"></i> Codigos sem familia estao ocultos de todos os graficos e totais desta tela.
               </div>` : '';
        return aviso + `
        <div style="text-align:center; padding:14px; color:#64748b; font-size:0.8rem; border-top:1px solid #e2e8f0; margin-top:6px;">
            <b>Dashboard de Estoque MMT</b> — desenvolvido por Guilherme Fernandes | MMT · TPV Vision<br>
            <span style="font-family:'Roboto Mono',monospace; font-size:0.75rem;">Dados gerados em ${DashMMT._esc(agora)}</span>
        </div>`;
    },

    // ----------------------------------------------------------------------
    // EXPORTACAO PNG
    // Serializa o SVG, desenha num canvas em 2x e baixa. Tudo nativo: sem
    // html2canvas, entao funciona mesmo com a internet bloqueada.
    // ----------------------------------------------------------------------
    _svgParaPng(svgEl, escala) {
        return new Promise((resolve, reject) => {
            const vb = (svgEl.getAttribute('viewBox') || '0 0 900 400').split(/\s+/).map(Number);
            const w = vb[2], h = vb[3];
            const copia = svgEl.cloneNode(true);
            copia.setAttribute('width',  w);
            copia.setAttribute('height', h);
            copia.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            const txt  = new XMLSerializer().serializeToString(copia);
            const url  = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(txt);
            const img  = new Image();
            img.onload = () => {
                const cv = document.createElement('canvas');
                cv.width = w * escala; cv.height = h * escala;
                const ctx = cv.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, cv.width, cv.height);
                ctx.drawImage(img, 0, 0, cv.width, cv.height);
                cv.toBlob(b => b ? resolve(b) : reject(new Error('canvas vazio')), 'image/png');
            };
            img.onerror = () => reject(new Error('o navegador nao conseguiu rasterizar o grafico'));
            img.src = url;
        });
    },

    _baixar(blob, nome) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = nome;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    },

    async exportarUm(id) {
        const bloco = document.querySelector(`.dm-bloco[data-dm-id="${id}"]`);
        const svg   = bloco && bloco.querySelector('svg');
        if (!svg) { Toast.warn('Este bloco e uma tabela: use o print da tela ou o Excel.'); return; }
        try {
            const blob = await DashMMT._svgParaPng(svg, 2);
            DashMMT._baixar(blob, id + '.png');
            Toast.success('Grafico salvo: ' + id + '.png');
        } catch (e) { Toast.error('Falha ao exportar: ' + e.message); }
    },

    async exportarTodos() {
        const blocos = [...document.querySelectorAll('.dm-bloco')].filter(b => b.querySelector('svg'));
        if (!blocos.length) { Toast.warn('Nenhum grafico para exportar.'); return; }
        let n = 0;
        for (const b of blocos) {
            const id = b.dataset.dmId;
            try {
                const blob = await DashMMT._svgParaPng(b.querySelector('svg'), 2);
                DashMMT._baixar(blob, id + '.png');
                n++;
                await new Promise(r => setTimeout(r, 350));   // o Chrome bloqueia downloads em rajada
            } catch (e) { console.warn('[DashMMT] export', id, e.message); }
        }
        Toast.success(n + ' grafico(s) exportado(s). Os nomes ja estao na ordem do PPT.', 7000);
    },
};

window.DashMMT = DashMMT;
