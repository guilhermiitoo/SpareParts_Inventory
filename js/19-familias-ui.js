// ==========================================================================
// MODULO: FAMILIAS DE MATERIAIS — TELA  (v17.04)
// --------------------------------------------------------------------------
// Sub-aba de Gestao do Sistema onde se cadastra e renomeia cada familia de
// codificacao de part number.
//
// O ponto central da tela: ao mexer no padrao (regex), o sistema conta na
// hora quantos codigos do estoque REAL batem com ele e mostra 5 exemplos de
// verdade. Sem isso, cadastrar padrao seria adivinhacao — e so daria para
// descobrir o erro depois, olhando um grafico torto.
//
// O nome digitado aqui e o que aparece em TODOS os graficos. Nao existe
// copia: os graficos leem o mesmo objeto de State.materialFamilies.
// ==========================================================================
const FamiliasUI = {

    _filtroSemFamilia: false,   // painel "codigos sem familia" aberto?

    // ----------------------------------------------------------------------
    // DADOS DE APOIO
    // ----------------------------------------------------------------------

    // Todos os codigos distintos do estoque (base da validacao em tempo real)
    _codigos() {
        if (FamiliasUI._cacheCodigos) return FamiliasUI._cacheCodigos;
        const s = new Set();
        (State.inventory || []).forEach(i => { if (i && i.code) s.add(String(i.code).trim().toUpperCase()); });
        FamiliasUI._cacheCodigos = [...s];
        return FamiliasUI._cacheCodigos;
    },

    _invalidar() { FamiliasUI._cacheCodigos = null; Familias.invalidar(); },

    // Quantos codigos batem com um padrao, e 5 exemplos reais
    _testar(regexTexto) {
        const codigos = FamiliasUI._codigos();
        let re;
        try { re = new RegExp(regexTexto); }
        catch (e) { return { erro: e.message, total: 0, exemplos: [] }; }
        const exemplos = [];
        let total = 0;
        for (const c of codigos) {
            if (re.test(c)) { total++; if (exemplos.length < 5) exemplos.push(c); }
        }
        return { erro: null, total, exemplos };
    },

    // Codigos que nao caem em nenhuma familia
    _semFamilia() {
        return FamiliasUI._codigos().filter(c => Familias.classificar(c) === Familias.NAO_CLASSIFICADO).sort();
    },

    // Pares de familias que disputam pelo menos um codigo
    _conflitos() {
        const pares = new Map();
        FamiliasUI._codigos().forEach(c => {
            const casam = Familias.todasQueCasam(c);
            if (casam.length < 2) return;
            for (let i = 0; i < casam.length; i++) {
                for (let j = i + 1; j < casam.length; j++) {
                    const k = casam[i].id + '|' + casam[j].id;
                    const r = pares.get(k) || { a: casam[i], b: casam[j], n: 0, exemplo: c };
                    r.n++; pares.set(k, r);
                }
            }
        });
        return [...pares.values()];
    },

    // ----------------------------------------------------------------------
    // RENDER
    // ----------------------------------------------------------------------
    render() {
        const box = document.getElementById('gsPanel-familias');
        if (!box) return;
        try { Familias.garantir(); } catch (e) {}
        FamiliasUI._invalidar();

        const fams = [...(State.materialFamilies || [])]
            .sort((a, b) => (Number(a.prioridade) || 999) - (Number(b.prioridade) || 999));
        const sem  = FamiliasUI._semFamilia();
        const conf = FamiliasUI._conflitos();
        const totalCod = FamiliasUI._codigos().length;

        box.innerHTML =
            FamiliasUI._cabecalho(totalCod, sem, conf)
          + (FamiliasUI._filtroSemFamilia ? FamiliasUI._painelSemFamilia(sem) : '')
          + (conf.length ? FamiliasUI._painelConflitos(conf) : '')
          + `<div style="display:flex; flex-direction:column; gap:12px;">`
          +     fams.map(f => FamiliasUI._cartao(f)).join('')
          +     FamiliasUI._cartaoNC(sem)
          + `</div>`
          + FamiliasUI._rodape();
    },

    _cabecalho(totalCod, sem, conf) {
        return `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:14px; flex-wrap:wrap; margin-bottom:14px;">
            <div>
                <h3 style="margin:0 0 4px 0; color:var(--tpv-dark-blue);"><i class="fas fa-shapes"></i> Familias de Materiais</h3>
                <p style="margin:0; font-size:0.82rem; color:#64748b; max-width:640px; line-height:1.5;">
                    O <b>nome</b> que voce der aqui e o que aparece em todos os graficos do Dashboard.
                    O <b>padrao</b> identifica o formato do codigo; ao edita-lo, o sistema conta na hora
                    quantos codigos do estoque batem e mostra exemplos reais.
                    Quando dois padroes disputam o mesmo codigo, vence o de <b>menor prioridade</b>.
                </p>
            </div>
            <div style="display:flex; gap:7px; flex-wrap:wrap;">
                <button class="btn-3d btn-blue"  style="padding:8px 12px; font-size:0.78rem;" onclick="FamiliasUI.nova()"><i class="fas fa-plus"></i> NOVA</button>
                <button class="btn-3d btn-gray"  style="padding:8px 12px; font-size:0.78rem;" onclick="FamiliasUI.exportar()"><i class="fas fa-file-export"></i> EXPORTAR</button>
                <button class="btn-3d btn-gray"  style="padding:8px 12px; font-size:0.78rem;" onclick="FamiliasUI.importar()"><i class="fas fa-file-import"></i> IMPORTAR</button>
                <button class="btn-3d btn-green" style="padding:8px 12px; font-size:0.78rem;" onclick="FamiliasUI.salvar()"><i class="fas fa-save"></i> SALVAR</button>
            </div>
        </div>

        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:10px; margin-bottom:14px;">
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:7px; padding:10px 13px;">
                <div style="font-size:0.7rem; color:#64748b; font-weight:800; text-transform:uppercase;">Codigos no estoque</div>
                <div style="font-size:1.35rem; font-weight:900; color:var(--tpv-dark-blue);">${totalCod.toLocaleString('pt-BR')}</div>
            </div>
            <div style="background:${sem.length ? '#fffbeb' : '#f0fdf4'}; border:1px solid ${sem.length ? '#fde68a' : '#bbf7d0'}; border-radius:7px; padding:10px 13px; cursor:pointer;"
                 onclick="FamiliasUI.alternarSemFamilia()" title="Clique para ver a lista">
                <div style="font-size:0.7rem; color:${sem.length ? '#b45309' : '#15803d'}; font-weight:800; text-transform:uppercase;">
                    Sem familia <i class="fas fa-chevron-${FamiliasUI._filtroSemFamilia ? 'up' : 'down'}" style="font-size:0.65rem;"></i>
                </div>
                <div style="font-size:1.35rem; font-weight:900; color:${sem.length ? '#b45309' : '#15803d'};">${sem.length.toLocaleString('pt-BR')}</div>
            </div>
            <div style="background:${conf.length ? '#fef2f2' : '#f0fdf4'}; border:1px solid ${conf.length ? '#fecaca' : '#bbf7d0'}; border-radius:7px; padding:10px 13px;">
                <div style="font-size:0.7rem; color:${conf.length ? '#b91c1c' : '#15803d'}; font-weight:800; text-transform:uppercase;">Padroes em conflito</div>
                <div style="font-size:1.35rem; font-weight:900; color:${conf.length ? '#b91c1c' : '#15803d'};">${conf.length}</div>
            </div>
        </div>`;
    },

    _painelSemFamilia(sem) {
        const lista = sem.slice(0, 300).map(c =>
            `<code style="background:#fff; border:1px solid #fde68a; border-radius:4px; padding:2px 6px; font-size:0.78rem;">${Security.sanitize(c)}</code>`
        ).join(' ');
        return `
        <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:13px 15px; margin-bottom:14px;">
            <div style="font-weight:800; color:#b45309; margin-bottom:8px; font-size:0.85rem;">
                <i class="fas fa-triangle-exclamation"></i> ${sem.length} codigo(s) sem familia
                ${sem.length > 300 ? '<span style="font-weight:normal;"> — mostrando os 300 primeiros</span>' : ''}
            </div>
            <div style="max-height:190px; overflow:auto; line-height:2;">${lista || '<i>nenhum</i>'}</div>
            <div style="font-size:0.76rem; color:#92400e; margin-top:9px;">
                Estes caem em "Nao classificado" nos graficos. Crie um padrao que os cubra, ou deixe assim se forem poucos.
            </div>
        </div>`;
    },

    _painelConflitos(conf) {
        const linhas = conf.map(c => {
            const vence = (Number(c.a.prioridade) || 999) <= (Number(c.b.prioridade) || 999) ? c.a : c.b;
            return `<li style="margin-bottom:5px;">
                <b>${Security.sanitize(c.a.nome)}</b> e <b>${Security.sanitize(c.b.nome)}</b>
                disputam ${c.n} codigo(s) — ex.: <code>${Security.sanitize(c.exemplo)}</code>.
                Vence <b style="color:#15803d;">${Security.sanitize(vence.nome)}</b> (prioridade ${Number(vence.prioridade) || 999}).
            </li>`;
        }).join('');
        return `
        <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:13px 15px; margin-bottom:14px;">
            <div style="font-weight:800; color:#b91c1c; margin-bottom:8px; font-size:0.85rem;">
                <i class="fas fa-code-branch"></i> Padroes que se sobrepoem
            </div>
            <ul style="margin:0; padding-left:20px; font-size:0.82rem; color:#7f1d1d;">${linhas}</ul>
            <div style="font-size:0.76rem; color:#991b1b; margin-top:9px;">
                Nao e erro: e assim que a prioridade funciona. So ajuste se quem esta vencendo nao for quem voce quer.
            </div>
        </div>`;
    },

    _cartao(f) {
        const t = FamiliasUI._testar(f.regex || '');
        const id = Security.sanitize(f.id);
        const inativa = f.ativa === false;

        const exemplos = t.erro
            ? `<span style="color:#b91c1c;"><i class="fas fa-circle-xmark"></i> Padrao invalido: ${Security.sanitize(t.erro)}</span>`
            : (t.total === 0
                ? `<span style="color:#b45309;"><i class="fas fa-circle-exclamation"></i> Nenhum codigo do estoque bate com este padrao</span>`
                : `<span style="color:#15803d; font-weight:bold;"><i class="fas fa-circle-check"></i> ${t.total.toLocaleString('pt-BR')} codigo(s)</span>
                   <span style="color:#64748b;"> — ex.: </span>`
                  + t.exemplos.map(e => `<code style="background:#f1f5f9; border-radius:4px; padding:1px 5px; font-size:0.76rem;">${Security.sanitize(e)}</code>`).join(' '));

        const campo = (rotulo, html, larg) => `
            <div style="flex:${larg || '1'}; min-width:0;">
                <label style="display:block; font-size:0.68rem; font-weight:800; color:#64748b; text-transform:uppercase; margin-bottom:3px;">${rotulo}</label>
                ${html}
            </div>`;

        return `
        <div style="background:#fff; border:1px solid #e2e8f0; border-left:6px solid ${Security.sanitize(f.cor || '#94a3b8')}; border-radius:8px; padding:13px 15px; opacity:${inativa ? 0.55 : 1};">
            <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end;">
                ${campo('Nome da familia (aparece nos graficos)',
                    `<input id="fmNome_${id}" class="big-input" style="width:100%; padding:7px 10px; font-size:0.9rem; font-weight:bold;"
                            value="${Security.sanitize(f.nome || '')}" oninput="FamiliasUI.marcarSujo()">`, '2 1 260px')}
                ${campo('Padrao do codigo (regex)',
                    `<input id="fmRegex_${id}" class="big-input" style="width:100%; padding:7px 10px; font-size:0.84rem; font-family:'Roboto Mono',monospace;"
                            value="${Security.sanitize(f.regex || '')}" oninput="FamiliasUI.reavaliar('${id}')">`, '2 1 260px')}
                ${campo('Prioridade',
                    `<input id="fmPrio_${id}" type="number" min="1" max="999" class="big-input" style="width:100%; padding:7px 10px; font-size:0.88rem;"
                            value="${Number(f.prioridade) || 999}" oninput="FamiliasUI.marcarSujo()">`, '0 0 92px')}
                ${campo('Cor',
                    `<input id="fmCor_${id}" type="color" style="width:100%; height:36px; padding:2px; border:1px solid #cbd5e1; border-radius:5px; cursor:pointer;"
                            value="${Security.sanitize(f.cor || '#94a3b8')}" oninput="FamiliasUI.marcarSujo()">`, '0 0 64px')}
            </div>

            <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; margin-top:10px;">
                ${campo('Marcas / modelos que usam este padrao',
                    `<input id="fmMarcas_${id}" class="big-input" style="width:100%; padding:7px 10px; font-size:0.85rem;"
                            placeholder="ex.: Hisense, Hier, TCL" value="${Security.sanitize(f.marcas || '')}" oninput="FamiliasUI.marcarSujo()">`, '3 1 300px')}
                <div style="flex:0 0 auto; display:flex; gap:7px; align-items:center;">
                    <label style="display:flex; align-items:center; gap:6px; font-size:0.82rem; color:#334155; cursor:pointer; white-space:nowrap;">
                        <input type="checkbox" id="fmAtiva_${id}" ${inativa ? '' : 'checked'} onchange="FamiliasUI.marcarSujo()" style="width:16px; height:16px; cursor:pointer;">
                        Ativa
                    </label>
                    <button class="btn-3d btn-red" style="padding:7px 10px; font-size:0.74rem;" onclick="FamiliasUI.apagar('${id}')" title="Apagar esta familia">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </div>

            <div id="fmTeste_${id}" style="margin-top:9px; font-size:0.79rem; padding:7px 10px; background:#f8fafc; border-radius:5px;">${exemplos}</div>
        </div>`;
    },

    // ----------------------------------------------------------------------
    // CARTAO DO "NAO CLASSIFICADO"
    //
    // Ele nao esta em State.materialFamilies — e o resto, o que sobra de
    // todos os padroes — e por isso nao aparecia aqui e nao dava para mexer
    // em nada dele. Nao da para apagar (os codigos ficariam sem lugar) nem
    // para dar um padrao a ele (o padrao dele e "nenhum dos outros"), mas o
    // nome, a cor e a presenca nos graficos sao escolha do usuario.
    // ----------------------------------------------------------------------
    _cartaoNC(sem) {
        const c = Familias.configNC();
        const n = (sem || []).length;

        return `
        <div style="background:#fff; border:1px dashed #cbd5e1; border-left:6px solid ${Security.sanitize(c.cor)};
                    border-radius:8px; padding:13px 15px; opacity:${c.oculta ? 0.62 : 1};">
            <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end;">
                <div style="flex:2 1 260px; min-width:0;">
                    <label style="display:block; font-size:0.68rem; font-weight:800; color:#64748b; text-transform:uppercase; margin-bottom:3px;">
                        Nome nos graficos
                    </label>
                    <input id="fmNC_nome" class="big-input" style="width:100%; padding:7px 10px; font-size:0.9rem; font-weight:bold;"
                           value="${Security.sanitize(c.nome)}" maxlength="60"
                           placeholder="Nao classificado" oninput="FamiliasUI.marcarSujo()">
                </div>
                <div style="flex:2 1 260px; min-width:0;">
                    <label style="display:block; font-size:0.68rem; font-weight:800; color:#64748b; text-transform:uppercase; margin-bottom:3px;">
                        Padrao do codigo
                    </label>
                    <div style="padding:8px 10px; font-size:0.82rem; color:#94a3b8; background:#f8fafc;
                                border:1px dashed #e2e8f0; border-radius:5px; font-style:italic;">
                        nenhum — recebe o que sobra dos outros padroes
                    </div>
                </div>
                <div style="flex:0 0 64px;">
                    <label style="display:block; font-size:0.68rem; font-weight:800; color:#64748b; text-transform:uppercase; margin-bottom:3px;">Cor</label>
                    <input id="fmNC_cor" type="color" style="width:100%; height:36px; padding:2px; border:1px solid #cbd5e1; border-radius:5px; cursor:pointer;"
                           value="${Security.sanitize(c.cor)}" oninput="FamiliasUI.marcarSujo()">
                </div>
            </div>

            <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:center; margin-top:11px;">
                <label style="display:flex; align-items:center; gap:7px; font-size:0.84rem; color:#334155; cursor:pointer;">
                    <input type="checkbox" id="fmNC_oculta" ${c.oculta ? 'checked' : ''}
                           onchange="FamiliasUI.marcarSujo()" style="width:16px; height:16px; cursor:pointer;">
                    <b>Ocultar dos graficos do Dashboard</b>
                </label>
                <span style="font-size:0.78rem; color:#64748b;">
                    ${c.oculta
                        ? `os ${n.toLocaleString('pt-BR')} codigo(s) saem de todos os graficos e tambem dos totais`
                        : `aparece como uma familia normal, com ${n.toLocaleString('pt-BR')} codigo(s)`}
                </span>
            </div>

            <div style="margin-top:9px; font-size:0.79rem; padding:7px 10px; background:#f8fafc; border-radius:5px; color:#475569;">
                <i class="fas fa-lock" style="color:#94a3b8;"></i>
                Familia fixa: nao pode ser apagada, porque e ela que recolhe todo codigo que nao bate com nenhum padrao.
                Para esvazia-la, crie padroes que cubram esses codigos — clique em <b>Sem familia</b>, la em cima, para ver quais sao.
            </div>
        </div>`;
    },

    _rodape() {
        return `
        <div style="margin-top:16px; padding:12px 15px; background:#f1f5f9; border-radius:8px; font-size:0.79rem; color:#475569;">
            <b>"Nao classificado"</b> e uma familia fixa do sistema: recebe tudo o que nao bate com nenhum padrao.
            Ela nao pode ser apagada, mas voce pode <b>renomear</b>, trocar a <b>cor</b> ou <b>ocultar dos graficos</b> no ultimo cartao da lista.
            Ocultar tira os codigos dela dos graficos <b>e dos totais</b> do Dashboard — eles continuam no estoque e continuam
            aparecendo aqui, em "Sem familia".
            <br>Lembre de clicar em <b>SALVAR</b>: as alteracoes so vao para o banco (e para os outros PCs) depois disso.
        </div>`;
    },

    // ----------------------------------------------------------------------
    // INTERACAO
    // ----------------------------------------------------------------------

    marcarSujo() { FamiliasUI._sujo = true; },

    // Reavalia o padrao enquanto o usuario digita — sem redesenhar a tela
    // inteira, que faria o campo perder o foco a cada tecla.
    reavaliar(id) {
        FamiliasUI.marcarSujo();
        const inp = document.getElementById('fmRegex_' + id);
        const box = document.getElementById('fmTeste_' + id);
        if (!inp || !box) return;
        const t = FamiliasUI._testar(inp.value);
        if (t.erro) {
            box.innerHTML = `<span style="color:#b91c1c;"><i class="fas fa-circle-xmark"></i> Padrao invalido: ${Security.sanitize(t.erro)}</span>`;
        } else if (!t.total) {
            box.innerHTML = `<span style="color:#b45309;"><i class="fas fa-circle-exclamation"></i> Nenhum codigo do estoque bate com este padrao</span>`;
        } else {
            box.innerHTML = `<span style="color:#15803d; font-weight:bold;"><i class="fas fa-circle-check"></i> ${t.total.toLocaleString('pt-BR')} codigo(s)</span>`
                + `<span style="color:#64748b;"> — ex.: </span>`
                + t.exemplos.map(e => `<code style="background:#f1f5f9; border-radius:4px; padding:1px 5px; font-size:0.76rem;">${Security.sanitize(e)}</code>`).join(' ');
        }
    },

    alternarSemFamilia() {
        FamiliasUI._coletar();          // nao perde o que ja foi digitado
        FamiliasUI._filtroSemFamilia = !FamiliasUI._filtroSemFamilia;
        FamiliasUI.render();
    },

    // Le a tela e devolve para State.materialFamilies (sem gravar em disco)
    _coletar() {
        (State.materialFamilies || []).forEach(f => {
            const g = k => document.getElementById('fm' + k + '_' + f.id);
            const nome = g('Nome'), regex = g('Regex'), prio = g('Prio'),
                  cor = g('Cor'), marcas = g('Marcas'), ativa = g('Ativa');
            if (nome)   f.nome       = String(nome.value || '').trim() || f.nome;
            if (regex)  f.regex      = String(regex.value || '').trim();
            if (prio)   f.prioridade = Math.min(999, Math.max(1, parseInt(prio.value) || 999));
            if (cor)    f.cor        = cor.value;
            if (marcas) f.marcas     = String(marcas.value || '').trim();
            if (ativa)  f.ativa      = !!ativa.checked;
        });

        // o "Nao classificado" nao esta na lista acima: e lido a parte
        const nome = document.getElementById('fmNC_nome');
        const cor  = document.getElementById('fmNC_cor');
        const ocu  = document.getElementById('fmNC_oculta');
        if (nome || cor || ocu) {
            const atual = Familias.configNC();
            State.unclassified = {
                nome:   nome ? (String(nome.value || '').trim().slice(0, 60) || Familias.NC_PADRAO.nome) : atual.nome,
                cor:    cor  ? cor.value : atual.cor,
                oculta: ocu  ? !!ocu.checked : atual.oculta,
            };
        }
        FamiliasUI._invalidar();
    },

    async nova() {
        FamiliasUI._coletar();
        const nome = await Modal.prompt('Nova familia', 'Nome da familia (voce pode trocar depois):', 'ex.: Hisense');
        if (nome === null) return;
        const limpo = String(nome).trim();
        if (!limpo) { Toast.warn('Informe um nome.'); return; }
        const maxP = Math.max(0, ...(State.materialFamilies || []).map(f => Number(f.prioridade) || 0));
        State.materialFamilies.push({
            id: 'f' + Date.now().toString(36) + Math.floor(Math.random() * 999),
            nome: limpo, regex: '', marcas: '', cor: '#0066A1',
            prioridade: maxP + 10, ativa: true,
        });
        FamiliasUI._sujo = true;
        FamiliasUI.render();
        Toast.info('Familia criada. Preencha o padrao e clique em SALVAR.', 5000);
    },

    async apagar(id) {
        FamiliasUI._coletar();
        const f = (State.materialFamilies || []).find(x => x.id === id);
        if (!f) return;
        const t = FamiliasUI._testar(f.regex || '');
        const ok = await Modal.confirm('Apagar familia',
            `Apagar "${f.nome}"? ${t.total ? `Os ${t.total} codigo(s) que ela classifica passarao para outra familia ou para "Nao classificado".` : ''}`,
            'Apagar', true);
        if (!ok) return;
        State.materialFamilies = State.materialFamilies.filter(x => x.id !== id);
        FamiliasUI._sujo = true;
        FamiliasUI.render();
    },

    async salvar() {
        if (!DB.guard('Salvar familias')) return;
        FamiliasUI._coletar();

        // avisa sobre padrao invalido, mas nao bloqueia: a familia com regex
        // quebrada simplesmente nao classifica nada ate ser corrigida.
        const ruins = (State.materialFamilies || []).filter(f => {
            if (!f.regex) return false;
            try { new RegExp(f.regex); return false; } catch (e) { return true; }
        });
        if (ruins.length) {
            const ok = await Modal.confirm('Padrao invalido',
                `${ruins.length} familia(s) com padrao invalido (${ruins.map(f => f.nome).join(', ')}). `
                + `Elas serao ignoradas na classificacao ate o padrao ser corrigido. Salvar assim mesmo?`,
                'Salvar', true);
            if (!ok) return;
        }

        try {
            await DB.saveNow();
            FamiliasUI._sujo = false;
            Logs.log('FAMILIAS', 'Familias de materiais atualizadas (' + (State.materialFamilies || []).length + ')');
            Toast.success('Familias salvas. Os graficos do Dashboard ja usam os nomes novos.', 6000);
            FamiliasUI.render();
            // se o Dashboard estiver montado, redesenha com os nomes novos
            try { if (typeof DashMMT !== 'undefined' && document.getElementById('dashMmtArea')) DashMMT.render(); } catch (e) {}
        } catch (e) {
            Toast.error('Nao foi possivel salvar: ' + e.message, 8000);
        }
    },

    // ----------------------------------------------------------------------
    // EXPORTAR / IMPORTAR (levar a configuracao para outra maquina)
    // ----------------------------------------------------------------------
    exportar() {
        FamiliasUI._coletar();
        const txt = JSON.stringify({
            _formato: 'spare-parts-familias',
            _versao: 1,
            _exportadoEm: new Date().toISOString(),
            familias: State.materialFamilies || [],
            limites: State.stockLimits || null,
            naoClassificado: State.unclassified || null,
        }, null, 2);
        const blob = new Blob([txt], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'familias_materiais_' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        Toast.success('Arquivo de familias exportado.');
    },

    importar() {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.json,application/json';
        inp.onchange = async () => {
            const arq = inp.files && inp.files[0];
            if (!arq) return;
            try {
                const d = JSON.parse(await arq.text());
                const lista = Array.isArray(d) ? d : d.familias;
                if (!Array.isArray(lista)) throw new Error('o arquivo nao contem uma lista de familias');

                // valida antes de encostar no State: um arquivo torto nao pode
                // deixar o usuario sem nenhuma familia.
                const limpas = lista.filter(f => f && typeof f.nome === 'string').map((f, i) => ({
                    id:         String(f.id || ('f' + Date.now().toString(36) + i)),
                    nome:       String(f.nome).trim().slice(0, 60),
                    regex:      String(f.regex || ''),
                    marcas:     String(f.marcas || ''),
                    cor:        /^#[0-9a-fA-F]{6}$/.test(f.cor || '') ? f.cor : '#94a3b8',
                    prioridade: Math.min(999, Math.max(1, parseInt(f.prioridade) || 999)),
                    ativa:      f.ativa !== false,
                }));
                if (!limpas.length) throw new Error('nenhuma familia valida no arquivo');

                const ok = await Modal.confirm('Importar familias',
                    `Substituir as ${(State.materialFamilies || []).length} familia(s) atuais pelas ${limpas.length} do arquivo?`,
                    'Importar', true);
                if (!ok) return;

                State.materialFamilies = limpas;
                if (d.limites) State.stockLimits = d.limites;
                if (d.naoClassificado && typeof d.naoClassificado === 'object') {
                    const nc = d.naoClassificado;
                    State.unclassified = {
                        nome:   String(nc.nome || '').trim().slice(0, 60) || Familias.NC_PADRAO.nome,
                        cor:    /^#[0-9a-fA-F]{6}$/.test(nc.cor || '') ? nc.cor : Familias.NC_PADRAO.cor,
                        oculta: nc.oculta === true,
                    };
                }
                FamiliasUI._sujo = true;
                FamiliasUI.render();
                Toast.success(`${limpas.length} familia(s) importada(s). Confira e clique em SALVAR.`, 7000);
            } catch (e) {
                Toast.error('Arquivo invalido: ' + e.message, 8000);
            }
        };
        inp.click();
    },
};

window.FamiliasUI = FamiliasUI;
