// ==========================================================================
// SPARE PARTS - 16-boxscan.js (extraido do v16.32)
// ==========================================================================

// ============================================================================
// MODULO: SCANNER DE CAIXAS  (v16.29)
// ----------------------------------------------------------------------------
// FLUXO COMPLETO
//   1) O operador sobe a lista do MES no Comparador.
//   2) O sistema pergunta: "Tem itens em caixa para olhar?"
//   3) SIM -> abre este Scanner ja na aba REGRAS (formatacao do codigo lido,
//      normalmente os 18 primeiros caracteres).
//   4) O operador bipa os materiais que estao soltos nas caixas. Cada leitura
//      marca o item na lista e e GRAVADA no JSON — se o login cair ou o PC
//      fechar, ele volta pela aba "Confirmacao de Listas" e continua de onde
//      parou.
//   5) Ao FINALIZAR, tudo o que NAO foi achado nas caixas volta para o
//      Comparador, que procura esses itens nos carros e locacoes do estoque.
//
// O QUE FICA GRAVADO: apenas a lista da sessao (codigo, maquina, posicao e a
// marca de encontrado). Sessoes finalizadas sao apagadas em 3 dias; abertas,
// em 15 dias — o JSON nao incha.
// ============================================================================
const BoxScan = {

    RET_FINALIZADA_DIAS: 3,
    RET_ABERTA_DIAS:    15,

    _lastCode: '',
    _lastId:   null,
    _stack:    [],

    // ---------- utilitarios ----------
    _sess() { return (State.boxSessions || []).find(x => x.id === State._boxActiveId) || null; },

    _touch() {
        const ss = BoxScan._sess();
        if (ss) ss.updatedAt = Date.now();
        try { DB.scheduleSave(); } catch (e) {}
    },

    // sessoes abertas de uma linha especifica
    abertasDaLinha(linha) {
        const alvo = LINHAS.norm(linha);
        return BoxScan.abertas().filter(x => LINHAS.norm(x.line) === alvo);
    },

    // sessao (aberta) vinculada a uma lista ja baixada
    sessaoDaLista(h) {
        const id = h?.config?.boxSession;
        if (!id) return null;
        return (State.boxSessions || []).find(x => x.id === id && x.status === 'ABERTA') || null;
    },

    // sessoes abertas (para a aba Confirmacao de Listas)
    abertas() {
        return (State.boxSessions || [])
            .filter(x => x.status === 'ABERTA')
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },

    // limpeza antes de gravar no JSON
    pruneForSave() {
        const now = Date.now();
        const cutF = now - BoxScan.RET_FINALIZADA_DIAS * 86400 * 1000;
        const cutA = now - BoxScan.RET_ABERTA_DIAS     * 86400 * 1000;
        State.boxSessions = (State.boxSessions || []).filter(x => {
            if (!x || !x.updatedAt) return false;
            return x.status === 'ABERTA' ? x.updatedAt >= cutA : x.updatedAt >= cutF;
        });
        return State.boxSessions;
    },

    // ---------- criacao a partir da lista carregada ----------
    async startFromFeeder() {
        const cfg = State.feederConfig || {};
        const data = State.rawFeederData;
        if (!data || cfg.cCode === undefined) { Toast.error('Nao foi possivel ler a lista para o scanner.'); return; }

        const items = [];
        for (let i = cfg.startRow + 1; i < data.length; i++) {
            const r = data[i];
            if (!r) continue;
            const code = String(r[cfg.cCode] || '').trim();
            if (!code) continue;
            if (Feeder._skipByTrk(r))  continue;   // rodape da lista IA
            if (Feeder._skipByTray(r)) continue;   // material de bandeja
            items.push({
                r: i,
                c: code.toUpperCase(),
                m: String(r[cfg.cMach] || '').trim(),
                p: String(r[cfg.cPos]  || '').trim(),
                f: 0,
            });
        }

        if (!items.length) { Toast.warn('A lista nao tem materiais para conferir nas caixas.'); return; }

        // v16.30: TRAVA DE DUPLICIDADE — a mesma OP/maquina nao pode gerar duas
        // leituras de caixa. Se ja existe uma aberta, retoma; se ja foi concluida,
        // pede confirmacao antes de comecar outra.
        const chaveWo   = String(cfg.wo || '--').trim().toUpperCase();
        const chaveMach = String(cfg.machine || '').trim().toUpperCase();
        const mesma = (x) => String(x.wo || '').trim().toUpperCase() === chaveWo
                          && String(x.machine || '').trim().toUpperCase() === chaveMach;

        const jaAberta = (State.boxSessions || []).find(x => x.status === 'ABERTA' && mesma(x));
        if (jaAberta) {
            Toast.warn(`A OP ${chaveWo} ja tem uma leitura de caixas em andamento — continuando de onde parou.`, 7000);
            BoxScan.open(jaAberta.id, 'scanner');
            BoxScan._esconderComparador();
            return;
        }

        const jaFeita = (State.boxSessions || []).find(x => x.status === 'FINALIZADA' && mesma(x));
        if (jaFeita) {
            const refazer = await Modal.confirm(
                'Leitura ja concluida',
                `A OP ${chaveWo} ja teve a leitura de caixas concluida em ${new Date(jaFeita.finishedAt || jaFeita.updatedAt).toLocaleString('pt-BR')} por ${jaFeita.finishedBy || jaFeita.nome}. Deseja fazer uma nova leitura mesmo assim?`,
                'FAZER NOVA LEITURA', true
            );
            if (!refazer) return;
        }

        const u = State.currentUser || {};
        const ss = {
            id:        'BX' + Date.now(),
            wo:        cfg.wo || '--',
            line:      cfg.line || '--',
            machine:   cfg.machine || '',
            mode:      State.feederMode || 'SMT',
            mat:       u.matricula || '--',
            nome:      u.nome || '--',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            status:    'ABERTA',
            rules:     { off: 0, len: 18 },
            items,
        };

        State.boxSessions = State.boxSessions || [];
        State.boxSessions.push(ss);
        State._boxActiveId = ss.id;
        BoxScan._touch();

        BoxScan._esconderComparador();
        BoxScan.open(ss.id, 'regras');
        Toast.success(`Scanner de Caixas aberto — ${items.length} material(is) para conferir.`, 5000);
    },

    // v16.30: enquanto a leitura roda, o comparador some da tela e da lugar
    // ao painel de espera. So volta quando a leitura for finalizada.
    _esconderComparador() {
        const res  = document.getElementById('feederResults');
        const drop = document.getElementById('feederDrop');
        const map  = document.getElementById('feederMapper');
        const wait = document.getElementById('feederBoxWait');
        if (res)  res.style.display  = 'none';
        if (drop) drop.style.display = 'none';
        if (map)  map.style.display  = 'none';
        if (wait) wait.style.display = 'block';
        document.querySelectorAll('.bx-banner').forEach(el => el.remove());
        BoxScan._paintWait();
    },

    _paintWait() {
        const wait = document.getElementById('feederBoxWait');
        if (!wait || wait.style.display === 'none') return;
        const ss = BoxScan._sess() || (State.boxSessions || []).find(x => x.id === State._boxWaitId);
        if (!ss) { wait.style.display = 'none'; return; }
        State._boxWaitId = ss.id;
        const tot = ss.items.length, ok = ss.items.filter(i => i.f).length;
        document.getElementById('fbwInfo').textContent =
            `OP ${ss.wo} · Linha ${ss.line}${ss.machine ? ' · Maq ' + ss.machine : ''} · iniciada por ${ss.nome}`;
        document.getElementById('fbwProg').textContent = `${ok} de ${tot} materiais ja conferidos nas caixas · faltam ${tot - ok}`;
        document.getElementById('fbwBar').style.width  = tot ? Math.round((ok / tot) * 100) + '%' : '0%';
    },

    // botao do painel de espera
    continuarAtiva() {
        const id = State._boxWaitId;
        if (!id) { Toast.warn('Nenhuma leitura de caixas em andamento.'); return; }
        BoxScan.open(id, 'scanner');
    },

    // ---------- abrir / retomar ----------
    open(id, aba) {
        const ss = (State.boxSessions || []).find(x => x.id === id);
        if (!ss) { Toast.error('Sessao de leitura nao encontrada.'); return; }
        if (ss.status !== 'ABERTA') { Toast.warn('Essa leitura ja foi finalizada.'); return; }

        State._boxActiveId = id;
        BoxScan._lastCode = ''; BoxScan._lastId = null; BoxScan._stack = [];

        document.getElementById('bxRuleOff').value = ss.rules?.off ?? 0;
        document.getElementById('bxRuleLen').value = ss.rules?.len || '';

        const th = (ss.mode === 'IA') ? { a: 'Trk', b: 'Spec' } : { a: 'Maquina', b: 'Posicao' };
        document.getElementById('bxThA').textContent = th.a;
        document.getElementById('bxThB').textContent = th.b;

        document.getElementById('boxScanOverlay').style.display = 'block';
        BoxScan.tab(aba || 'scanner');
        BoxScan.refresh();
    },

    // sair sem perder nada
    sair() {
        const ss = BoxScan._sess();
        document.getElementById('boxScanOverlay').style.display = 'none';
        if (ss) State._boxWaitId = ss.id;
        State._boxActiveId = null;
        BoxScan._touch();
        BoxScan._paintWait();
        Toast.info('Leitura salva. Voce pode continuar pela aba "Confirmacao de Listas".', 6000);
        if (typeof ListConfirm !== 'undefined') { try { ListConfirm.render(); } catch (e) {} }
    },

    tab(name) {
        ['regras', 'scanner'].forEach(t => {
            const pane = document.getElementById('bxPane-' + t);
            const btn  = document.getElementById('bxTabBtn-' + t);
            if (pane) pane.style.display = (t === name) ? 'block' : 'none';
            if (btn)  btn.classList.toggle('active', t === name);
        });
        if (name === 'scanner') setTimeout(() => { const i = document.getElementById('bxScanInput'); if (i) i.focus(); }, 120);
    },

    // ---------- regras de leitura ----------
    _rules() {
        const off = parseInt(document.getElementById('bxRuleOff').value) || 0;
        const lenRaw = document.getElementById('bxRuleLen').value;
        const len = (lenRaw && parseInt(lenRaw) > 0) ? parseInt(lenRaw) : 0;
        return { off, len };
    },

    saveRules() {
        const ss = BoxScan._sess(); if (!ss) return;
        ss.rules = BoxScan._rules();
        BoxScan._touch();
        BoxScan.testRule();
        BoxScan._echo();
    },

    preset(off, len) {
        document.getElementById('bxRuleOff').value = off;
        document.getElementById('bxRuleLen').value = len || '';
        BoxScan.saveRules();
    },

    aplicar(code) {
        const { off, len } = BoxScan._rules();
        let out = String(code || '').trim().toUpperCase();
        if (off > 0 && out.length > off) out = out.substring(off);
        if (len > 0) out = out.substring(0, len);
        return out;
    },

    testRule() {
        const raw = document.getElementById('bxRuleTest').value;
        const out = document.getElementById('bxRuleOut');
        if (!raw) { out.innerHTML = 'Resultado: <b>--</b>'; return; }
        const tratado = BoxScan.aplicar(raw);
        out.innerHTML = `Lido: <b>${Security.sanitize(raw.trim().toUpperCase())}</b> (${raw.trim().length} car.)`
                      + ` &nbsp;&rarr;&nbsp; Usado na comparacao: <b style="color:var(--ind-green);">${Security.sanitize(tratado)}</b> (${tratado.length} car.)`;
    },

    _echo() {
        const { off, len } = BoxScan._rules();
        const el = document.getElementById('bxRuleEcho');
        if (el) el.textContent = `Regra ativa: ignorar ${off} | ler ${len > 0 ? len : 'tudo'}`;
    },

    // ---------- leitura ----------
    bip(raw) {
        const ss = BoxScan._sess(); if (!ss) return;
        const code = BoxScan.aplicar(raw);

        if (code.length < 5) {
            BoxScan._card('erro', 'CODIGO CURTO', `Leitura <b>${Security.sanitize(code)}</b> tem menos de 5 caracteres. Confira as regras.`, 'fa-shield-alt', '#64748b', '#f1f5f9');
            BoxScan._beep('erro');
            return;
        }

        // casa por conteudo nos dois sentidos (o codigo da lista pode ser menor)
        const matches = ss.items.filter(it => it.c.includes(code) || code.includes(it.c));

        if (!matches.length) {
            BoxScan._card('erro', 'NAO ESTA NA LISTA', `O codigo <b>${Security.sanitize(code)}</b> nao pertence a esta OP.`, 'fa-times-circle', 'var(--ind-red)', '#fef2f2');
            BoxScan._beep('erro');
            BoxScan._lastCode = code;
            BoxScan.refresh();
            return;
        }

        const pend = matches.filter(m => !m.f);

        if (pend.length) {
            const alvo = pend[0];
            alvo.f = 1;
            BoxScan._lastId = alvo.r;
            BoxScan._stack.push(alvo.r);
            BoxScan._card('ok', 'ACHADO NA CAIXA', `Codigo <b>${Security.sanitize(code)}</b> marcado.`, 'fa-check-circle', 'var(--ind-green)', '#f0fdf4');
            BoxScan._listaPos(matches, alvo.r, pend.length - 1);
            BoxScan._beep('ok');
        } else {
            BoxScan._lastId = matches[0].r;
            BoxScan._card('rep', 'JA CONFERIDO', `Todas as posicoes de <b>${Security.sanitize(matches[0].c)}</b> ja foram marcadas.`, 'fa-exclamation-triangle', '#f59e0b', '#fffbeb');
            BoxScan._listaPos(matches, null, 0);
            BoxScan._beep('rep');
        }

        BoxScan._lastCode = code;
        BoxScan._touch();
        BoxScan.refresh();
    },

    desfazer() {
        const ss = BoxScan._sess(); if (!ss) return;
        if (!BoxScan._stack.length) { Toast.info('Nada para desfazer nesta sessao.'); return; }
        const r = BoxScan._stack.pop();
        const it = ss.items.find(x => x.r === r);
        if (it) {
            it.f = 0;
            BoxScan._lastCode = '';
            BoxScan._lastId = null;
            BoxScan._card('undo', 'LEITURA DESFEITA', `Material <b>${Security.sanitize(it.c)}</b> voltou para pendente.`, 'fa-undo', '#64748b', '#f1f5f9');
            BoxScan._touch();
            BoxScan.refresh();
        }
    },

    _card(tipo, titulo, desc, icone, cor, fundo) {
        const box = document.getElementById('bxResult');
        box.style.background   = fundo;
        box.style.borderColor  = cor;
        document.getElementById('bxResIcon').innerHTML  = `<i class="fas ${icone}"></i>`;
        document.getElementById('bxResIcon').style.color = cor;
        document.getElementById('bxResTitle').textContent = titulo;
        document.getElementById('bxResTitle').style.color = cor;
        document.getElementById('bxResDesc').innerHTML   = desc;
        if (tipo !== 'ok') document.getElementById('bxResList').innerHTML = '';
    },

    // mostra todas as posicoes daquele material
    _listaPos(matches, alvoR, restantes) {
        const el = document.getElementById('bxResList');
        el.innerHTML = matches.map(m => {
            const cls = (m.r === alvoR) ? 'it now' : (m.f ? 'it done' : 'it');
            const ic  = (m.r === alvoR) ? '<i class="fas fa-check" style="color:#16a34a;"></i>'
                      : (m.f ? '<i class="fas fa-check-double" style="color:#3b82f6;"></i>'
                             : '<i class="far fa-circle" style="color:#f59e0b;"></i>');
            return `<div class="${cls}"><span>${Security.sanitize(m.p || '--')} <small style="color:#94a3b8;">(${Security.sanitize(m.m || '--')})</small></span>${ic}</div>`;
        }).join('')
        + (restantes > 0 ? `<div style="font-size:11.5px;color:#b45309;font-weight:800;margin-top:4px;">Ainda faltam ${restantes} rolo(s) deste mesmo codigo.</div>` : '');
    },

    // bip sonoro sem depender de internet
    _beep(tipo) {
        try {
            const ctx = BoxScan._ac || (BoxScan._ac = new (window.AudioContext || window.webkitAudioContext)());
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            const f = tipo === 'ok' ? 880 : tipo === 'rep' ? 520 : 200;
            o.frequency.value = f;
            o.type = 'square';
            g.gain.setValueAtTime(0.06, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
            o.start(); o.stop(ctx.currentTime + 0.17);
        } catch (e) {}
    },

    // ---------- telas ----------
    refresh() {
        const ss = BoxScan._sess(); if (!ss) return;
        const tot = ss.items.length;
        const ok  = ss.items.filter(i => i.f).length;

        document.getElementById('bxStTotal').textContent = tot;
        document.getElementById('bxStFound').textContent = ok;
        document.getElementById('bxStPend').textContent  = tot - ok;
        document.getElementById('bxProgTxt').textContent = `${ok} / ${tot} conferidos nas caixas`;
        document.getElementById('bxProgFill').style.width = tot ? Math.round((ok / tot) * 100) + '%' : '0%';
        document.getElementById('bxHeadInfo').textContent =
            `OP ${ss.wo} · LINHA ${ss.line}${ss.machine ? ' · MAQ ' + ss.machine : ''} · ${ss.nome}`;

        BoxScan._echo();
        BoxScan.renderList();
    },

    renderList() {
        const ss = BoxScan._sess(); if (!ss) return;
        const filtro = (document.getElementById('bxFilter').value || '').trim().toUpperCase();
        const tb = document.getElementById('bxTableBody');

        let arr = ss.items.filter(i =>
            !filtro || i.c.includes(filtro) || String(i.p).toUpperCase().includes(filtro) || String(i.m).toUpperCase().includes(filtro));

        // pendentes sempre no topo
        arr = arr.slice().sort((a, b) => (a.f - b.f));

        if (!arr.length) { tb.innerHTML = '<tr><td colspan="4" class="bx-empty">Nenhum material encontrado com esse filtro.</td></tr>'; return; }

        tb.innerHTML = arr.slice(0, 1500).map(i => {
            const cls = (i.r === BoxScan._lastId) ? 'last' : (i.f ? 'found' : '');
            const ic  = i.f ? '<i class="fas fa-check-circle" style="color:var(--ind-green);"></i>'
                            : '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#e2e8f0;"></span>';
            return `<tr id="bxrow-${i.r}" class="${cls}">
                <td style="text-align:center;">${ic}</td>
                <td>${Security.sanitize(i.m || '--')}</td>
                <td class="cd">${Security.sanitize(i.c)}</td>
                <td><b>${Security.sanitize(i.p || '--')}</b></td>
            </tr>`;
        }).join('');

        if (BoxScan._lastId !== null) {
            const row = document.getElementById('bxrow-' + BoxScan._lastId);
            if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    },

    // ---------- finalizacao ----------
    async finalizar() {
        const ss = BoxScan._sess(); if (!ss) return;
        const tot  = ss.items.length;
        const ok   = ss.items.filter(i => i.f).length;
        const pend = ss.items.filter(i => !i.f);

        // v16.30: fecha o scanner ANTES de perguntar — assim o aviso de
        // confirmacao aparece na tela sem precisar fechar nada na mao.
        const overlay = document.getElementById('boxScanOverlay');
        overlay.style.display = 'none';
        const voltarPraLeitura = () => { overlay.style.display = 'block'; BoxScan.tab('scanner'); };

        if (!pend.length) {
            const fim = await Modal.confirm(
                'Todos os itens estao nas caixas',
                `Os ${tot} materiais da OP ${ss.wo} foram encontrados nas caixas. Nao ha nada para procurar no estoque. Deseja encerrar a leitura?`,
                'ENCERRAR LEITURA'
            );
            if (!fim) { voltarPraLeitura(); return; }
        } else {
            const okGo = await Modal.confirm(
                'Finalizar leitura das caixas',
                `${ok} de ${tot} materiais foram achados nas caixas. Os ${pend.length} restantes serao enviados para o comparador, que vai mostrar o carro e a locacao de cada um no estoque. Depois de finalizar nao da mais para bipar nesta lista.`,
                'FINALIZAR E BUSCAR NO ESTOQUE'
            );
            if (!okGo) { voltarPraLeitura(); return; }
        }

        ss.status      = 'FINALIZADA';
        ss.finishedAt  = Date.now();
        ss.finishedBy  = (State.currentUser?.nome) || '--';
        ss.foundCount  = ok;
        ss.pendCount   = pend.length;
        BoxScan._touch();

        State._boxActiveId = null;
        State._boxWaitId   = null;
        const wait = document.getElementById('feederBoxWait');
        if (wait) wait.style.display = 'none';

        if (!pend.length) {
            Toast.success('Leitura encerrada — todos os materiais estavam nas caixas.', 7000);
            UI.navMain('confirmacao');
            return;
        }

        BoxScan._enviarParaComparador(ss, pend, ok);
    },

    // v16.30: a lista do comparador continua COMPLETA para a impressao.
    // O que foi achado na caixa entra com STATUS "CAIXA" e NAO e procurado
    // no estoque; so o que faltou e cruzado com os carros e locacoes.
    _enviarParaComparador(ss, pend, ok) {
        const cfg = State.feederConfig || {};
        const temOriginal = !!(State.rawFeederData && State.rawFeederData.length && cfg.cCode !== undefined);
        const achadosR = new Set(ss.items.filter(i => i.f).map(i => i.r));

        if (temOriginal) {
            // mesma planilha, mesmas colunas — nada e removido
            State._boxFoundRows = achadosR;
        } else {
            // sessao retomada depois de fechar o sistema: remonta a lista inteira
            State.feederMode = ss.mode || 'SMT';
            const head = [];
            head[0] = 'Equip. Name'; head[1] = 'Part No.'; head[2] = 'Position';
            const novos = new Set();
            const rows = ss.items.map((it, idx) => {
                const r = []; r[0] = it.m; r[1] = it.c; r[2] = it.p;
                if (it.f) novos.add(idx + 1);   // +1 por causa do cabecalho
                return r;
            });
            State.rawFeederData = [head].concat(rows);
            State.feederConfig  = {
                startRow: 0, cMach: 0, cCode: 1, cPos: 2, cTray: null,
                line: ss.line, wo: ss.wo, machine: ss.machine || '',
            };
            State._boxFoundRows = novos;
            document.getElementById('printLineDisplay').textContent = ss.line || '--';
            document.getElementById('printWODisplay').textContent   = ss.wo   || '--';
            const mw = document.getElementById('printMachineWrap');
            document.getElementById('printMachineDisplay').textContent = ss.machine || '--';
            if (mw) mw.style.display = ss.machine ? 'block' : 'none';
            document.getElementById('printUser').textContent = State.currentUser?.nome || '--';
            const now = new Date();
            document.getElementById('printDateTime').textContent =
                `${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`;
        }

        // guarda o vinculo da leitura no registro da baixa
        State.feederConfig = State.feederConfig || {};
        State.feederConfig.boxSession = ss.id;

        UI.navMain('feeder');
        document.getElementById('feederDrop').style.display    = 'none';
        document.getElementById('feederMapper').style.display  = 'none';
        document.getElementById('feederBoxWait').style.display = 'none';
        document.getElementById('feederResults').style.display = 'block';
        Feeder._setTypeBadge();
        Feeder.recalcMatches();

        BoxScan._banner(ss, ok, pend);
        Toast.success(`${ok} material(is) ja estao nas caixas. Buscando os ${pend.length} restantes no estoque.`, 8000);
    },

    // aviso fixo no comparador dizendo o que veio das caixas
    _banner(ss, ok, pend) {
        document.querySelectorAll('.bx-banner').forEach(el => el.remove());
        if (!ok) return;
        const div = document.createElement('div');
        div.className = 'bx-banner no-print';
        div.style.cssText = 'margin-bottom:15px;padding:14px 18px;background:#ecfdf5;border:1px solid #a7f3d0;border-left:6px solid var(--ind-green);border-radius:10px;color:#065f46;display:flex;align-items:center;gap:14px;flex-wrap:wrap;';
        div.innerHTML = `
            <i class="fas fa-box-open" style="font-size:1.8rem;color:var(--ind-green);"></i>
            <div style="flex:1;min-width:240px;">
                <div style="font-weight:900;font-size:1rem;">Leitura das caixas concluida — OP ${Security.sanitize(ss.wo)}</div>
                <div style="font-size:0.85rem;margin-top:3px;">
                    <b>${ok}</b> material(is) ja estavam nas caixas e foram retirados desta busca.
                    A lista abaixo mostra apenas os <b>${pend.length}</b> que precisam ser procurados nos carros.
                </div>
            </div>
            <button class="btn-3d btn-gray" onclick="BoxScan.verAchados('${ss.id}')"><i class="fas fa-list"></i> VER O QUE VEIO DA CAIXA</button>`;
        const res = document.getElementById('feederResults');
        if (res && res.parentElement) res.parentElement.insertBefore(div, res);
    },

    // popup com os itens que foram achados nas caixas
    verAchados(id) {
        const ss = (State.boxSessions || []).find(x => x.id === id);
        if (!ss) return;
        const achados = ss.items.filter(i => i.f);
        const linhas = achados.map(i => `
            <tr>
              <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;font-family:'Roboto Mono',monospace;font-weight:700;">${Security.sanitize(i.c)}</td>
              <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;">${Security.sanitize(i.m || '--')}</td>
              <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;font-weight:700;">${Security.sanitize(i.p || '--')}</td>
            </tr>`).join('');

        const bd = document.createElement('div');
        bd.className = 'modal-backdrop';
        bd.style.zIndex = '200600';
        bd.style.display = 'flex';
        bd.innerHTML = `
            <div class="modal-box" style="max-width:640px;max-height:88vh;display:flex;flex-direction:column;">
              <div class="modal-title" style="color:var(--ind-green);flex-shrink:0;">
                <i class="fas fa-box-open"></i> Achados nas caixas — ${achados.length} item(ns)
              </div>
              <div style="font-size:0.85rem;color:#64748b;margin-bottom:12px;flex-shrink:0;">
                OP ${Security.sanitize(ss.wo)} · Linha ${Security.sanitize(ss.line)} · conferido por ${Security.sanitize(ss.nome)}
              </div>
              <div style="flex:1;overflow:auto;border:1px solid #e2e8f0;border-radius:8px;">
                <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
                  <thead><tr style="background:#f1f5f9;">
                    <th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">Codigo</th>
                    <th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">Maquina</th>
                    <th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">Posicao</th>
                  </tr></thead>
                  <tbody>${linhas}</tbody>
                </table>
              </div>
              <button class="btn-3d btn-gray" style="width:100%;margin-top:14px;flex-shrink:0;" onclick="this.closest('.modal-backdrop').remove()">FECHAR</button>
            </div>`;
        document.body.appendChild(bd);
    },
};

// entrada do scanner: Enter dispara a leitura
function _bxBindScanner() {
    const inp = document.getElementById('bxScanInput');
    if (!inp) return;
    inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && inp.value.trim()) {
            BoxScan.bip(inp.value);
            inp.value = '';
        }
    });
    // clicar em qualquer area do scanner devolve o foco ao campo
    const pane = document.getElementById('bxPane-scanner');
    if (pane) pane.addEventListener('click', (e) => {
        if (['INPUT', 'BUTTON'].indexOf(e.target.tagName) === -1) inp.focus();
    });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _bxBindScanner);
else _bxBindScanner();
