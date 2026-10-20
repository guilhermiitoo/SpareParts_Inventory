// ==========================================================================
// SPARE PARTS - 10-feeder.js (extraido do v16.32)
// ==========================================================================

// ============================================================
// MODULO: COMPARADOR FEEDER (Lista de Alimentadores)
// ============================================================
const Feeder = {
    reset() {
        State.rawFeederData = null;
        State.currentMatchedIds = [];
        State._reprintMode = false; // libera lock de reimpressao
        document.getElementById('feederDrop').style.display = 'block';
        document.getElementById('feederMapper').style.display = 'none';
        document.getElementById('feederResults').style.display = 'none';
        document.getElementById('feederProcessSuccess').style.display = 'none';
        document.getElementById('feederRulesBar').style.display = 'flex';
        // v16.20.1: restaura o botao de baixa (ficava travado em "Processando..."
        // quando o usuario subia uma nova lista logo apos baixar/imprimir a anterior)
        const _btnChk = document.getElementById('btnCheckoutFeeder');
        if (_btnChk) {
            _btnChk.style.display = 'block';
            _btnChk.disabled  = false;
            _btnChk.innerHTML = '<i class="fas fa-check-circle"></i> BAIXAR E IMPRIMIR';
        }
        document.getElementById('feederFileInput').value = '';
        const btnNF = document.getElementById('btnNotFoundFeeder'); if (btnNF) btnNF.style.display = 'none';
        State._feederNotFound = [];
        State.feederMode = 'SMT';                                     // v16.17
        const badge = document.getElementById('feederTypeBadge'); if (badge) badge.innerHTML = '';
        // v16.29: limpa o aviso das caixas e a pergunta pendente
        State._boxWanted = false;
        State._boxFoundRows = null;
        if (State.feederConfig) delete State.feederConfig.boxSession;
        State._boxWaitId = null;
        const _fbw = document.getElementById('feederBoxWait'); if (_fbw) _fbw.style.display = 'none';
        document.querySelectorAll('.bx-banner').forEach(el => el.remove());
    },

    processFile(file) {
        Feeder.reset();
        const reader = new FileReader();
        reader.onload = async (e) => {
            const data = new Uint8Array(e.target.result);
            const wb   = XLSX.read(data, { type: 'array' });
            const ws   = wb.Sheets[wb.SheetNames[0]];
            State.rawFeederData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

            // v16.29: ANTES de cruzar com o estoque, pergunta se ha itens em caixa.
            // Se sim, abre o Scanner de Caixas para o operador conferir primeiro o
            // que ja esta em maos e so depois procurar o restante nos carros.
            State._boxWanted = await Modal.confirm(
                'Tem itens em caixa para olhar?',
                'Se voce tem caixas com material ainda nao devolvido para os carros, o sistema abre o Scanner de Caixas para voce bipar e conferir o que ja esta em maos. Depois, o que faltar e procurado no estoque normalmente.',
                'SIM, tenho caixas'
            );

            Feeder._autoDetect();
        };
        reader.readAsArrayBuffer(file);
    },

    // v16.29: chamado sempre que uma lista termina de carregar com sucesso.
    // Se o operador respondeu SIM na pergunta das caixas, abre o Scanner.
    _afterLoad() {
        if (!State._boxWanted) return;
        State._boxWanted = false;
        setTimeout(() => { try { BoxScan.startFromFeeder(); } catch (e) { console.error(e); } }, 250);
    },

    // Procura um label em qualquer celula de qualquer linha e retorna {row, col}
    // Normaliza texto para comparacao: remove pontos, espacos, hifens, underscores e caixa
    // "Equip. Name" -> "equipname"  |  "Part No." -> "partno"  |  "W/O:" -> "wo"
    _norm(str) {
        return String(str).toLowerCase().replace(/[\s.\-_/:,;()]+/g, '');
    },

    // Busca uma celula cujo texto normalizado corresponda ao label normalizado.
    // Varre todas as linhas do arquivo (sem limite).
    // Retorna { row, col } ou null.
    _findCell(label) {
        const needle = Feeder._norm(label);
        if (!needle) return null;
        const data = State.rawFeederData;
        // PERF v16.16: labels de cabecalho sempre ficam no topo do arquivo.
        // Varrer a planilha inteira (milhares de linhas x ~20 labels) era o
        // principal gargalo do PROCESSAR. Limita a busca as primeiras 40 linhas.
        const maxScan = Math.min(data.length, 40);
        for (let r = 0; r < maxScan; r++) {
            const row = data[r] || [];
            for (let c = 0; c < row.length; c++) {
                const cell = Feeder._norm(row[c]);
                if (cell === needle) return { row: r, col: c };
            }
        }
        return null;
    },

    // Busca parcial: retorna a primeira celula cujo texto normalizado CONTEM o needle.
    // Usado como fallback quando a busca exata falha.
    _findCellPartial(label) {
        const needle = Feeder._norm(label);
        if (!needle) return null;
        const data = State.rawFeederData;
        const maxScan = Math.min(data.length, 40); // PERF v16.16
        for (let r = 0; r < maxScan; r++) {
            const row = data[r] || [];
            for (let c = 0; c < row.length; c++) {
                const cell = Feeder._norm(row[c]);
                if (cell && cell.includes(needle)) return { row: r, col: c };
            }
        }
        return null;
    },

    // Le o valor na celula imediatamente a direita do label (busca exata, depois parcial).
    // Tambem tenta 2 e 3 celulas a direita caso a primeira esteja vazia.
    _readRight(label) {
        const pos = Feeder._findCell(label) || Feeder._findCellPartial(label);
        if (!pos) return '';
        const row = State.rawFeederData[pos.row] || [];
        // Tenta ate 3 celulas a direita (ignora celulas vazias intermediarias)
        for (let offset = 1; offset <= 3; offset++) {
            const val = String(row[pos.col + offset] || '').trim();
            if (val) return val;
        }
        return '';
    },

    // Busca coluna por lista de labels (exato primeiro, depois parcial)
    _findColumn(labels) {
        for (const lbl of labels) {
            const pos = Feeder._findCell(lbl);
            if (pos) return { col: pos.col, headerRow: pos.row };
        }
        for (const lbl of labels) {
            const pos = Feeder._findCellPartial(lbl);
            if (pos) return { col: pos.col, headerRow: pos.row };
        }
        return null;
    },

    // ========================================================
    // v16.17 — MODO IA (armarios PTH)
    // A OP identifica o tipo de lista:
    //   "1141972-SMT" / "-SMT-T" / "-SMT-B"  -> lista de alimentadores (SMT)
    //   "1141972-AI"                          -> lista da IA (armarios PTH)
    // Na lista da IA os materiais ficam abaixo de "Main materials",
    // a descricao abaixo de "Spec" e a posicao/locacao abaixo de "Trk".
    // ========================================================
    IA_LABELS: {
        code: ['Main materials', 'Main material', 'MainMaterials'],
        desc: ['Spec', 'Specification', 'Especificacao'],
        pos:  ['Trk', 'Track', 'Trilha'],
    },

    // true se a OP termina com "-AI"
    _isIAWo(wo) {
        return /-\s*ai\s*$/i.test(String(wo || '').trim());
    },

    // Varredura profunda (cabecalhos da lista da IA podem ficar mais abaixo)
    _findCellDeep(label) {
        const needle = Feeder._norm(label);
        if (!needle) return null;
        const data = State.rawFeederData;
        const maxScan = Math.min(data.length, 200);
        for (let r = 0; r < maxScan; r++) {
            const row = data[r] || [];
            for (let c = 0; c < row.length; c++) {
                if (Feeder._norm(row[c]) === needle) return { row: r, col: c };
            }
        }
        for (let r = 0; r < maxScan; r++) {
            const row = data[r] || [];
            for (let c = 0; c < row.length; c++) {
                const cell = Feeder._norm(row[c]);
                if (cell && cell.includes(needle)) return { row: r, col: c };
            }
        }
        return null;
    },

    _findColumnDeep(labels) {
        for (const lbl of labels) {
            const pos = Feeder._findCellDeep(lbl);
            if (pos) return { col: pos.col, headerRow: pos.row };
        }
        return null;
    },

    // ========================================================
    // v16.19 — CORTE PELA COLUNA "Trk" (lista IA)
    // Na lista da IA, abaixo dos materiais existem linhas de rodape
    // ("First PCB", "Last PCB", "Operator/Foreman", "QC Confirm"...)
    // que NAO sao material. A regra de ouro: so e material a linha que
    // tem NUMERO na coluna "Trk" (a locacao). Sem numero no Trk, ignora.
    // ========================================================
    _isTrkValid(valor) {
        const v = String(valor == null ? '' : valor).trim();
        if (!v) return false;
        // Aceita: 19 | 20 | 7-1 | 12/2 | 003 . Rejeita qualquer texto.
        return /^\d{1,4}([\-\/\.]\d{1,4})?$/.test(v);
    },

    // true quando a linha deve ser IGNORADA por nao ter locacao no Trk.
    // So vale para o modo IA e so quando a coluna Trk foi realmente localizada.
    _skipByTrk(r) {
        if (State.feederMode !== 'IA') return false;
        const cfg = State.feederConfig || {};
        if (cfg.cMach === undefined || cfg.cMach === null) return false;
        if (cfg.cMach === cfg.cCode) return false;   // Trk nao foi encontrado -> nao filtra
        return !Feeder._isTrkValid(r[cfg.cMach]);
    },

    // ========================================================
    // v16.27 — CORTE DE MATERIAIS "TRAY" (coluna "Feeder spec")
    // Materiais com "TRAY" na coluna "Feeder spec" vem em bandeja e NAO
    // sao buscados pelo MMT. Essas linhas sao removidas da lista antes do
    // cruzamento com o estoque — nem aparecem na tabela nem na impressao.
    // ========================================================
    TRAY_LABELS: ['Feeder spec', 'Feederspec', 'Feeder Spec.', 'Feeder specification'],

    // Localiza a coluna "Feeder spec" (retorna o indice ou null)
    _findTrayCol() {
        const res = Feeder._findColumnDeep(Feeder.TRAY_LABELS);
        return res ? res.col : null;
    },

    // true quando a linha deve ser IGNORADA por ser material de bandeja (TRAY)
    _skipByTray(r) {
        const cfg = State.feederConfig || {};
        if (cfg.cTray === undefined || cfg.cTray === null) return false;
        const v = String(r[cfg.cTray] == null ? '' : r[cfg.cTray]).trim().toUpperCase();
        return v.includes('TRAY');
    },

    // Rotulos das 2 primeiras colunas da tabela de resultados, conforme o modo
    _heads() {
        return (State.feederMode === 'IA')
            ? { c1: 'Trk (Locacao)', c2: 'Descricao (Spec)' }
            : { c1: 'Maquina',       c2: 'Posicao' };
    },

    _setTypeBadge() {
        const badge = document.getElementById('feederTypeBadge');
        if (!badge) return;
        badge.innerHTML = (State.feederMode === 'IA')
            ? `<span style="font-size:0.72rem; background:#7c3aed; color:#fff; padding:3px 10px; border-radius:20px; font-weight:900; letter-spacing:1px; vertical-align:middle;"><i class="fas fa-archive"></i> LISTA IA — ARMARIOS</span>`
            : `<span style="font-size:0.72rem; background:var(--tpv-blue); color:#fff; padding:3px 10px; border-radius:20px; font-weight:900; letter-spacing:1px; vertical-align:middle;"><i class="fas fa-microchip"></i> LISTA SMT — ALIMENTADORES</span>`;
    },

    // Mapeia as colunas da lista da IA e dispara o cruzamento
    _autoDetectIA(lineVal, woVal, machVal) {
        const codeResult = Feeder._findColumnDeep(Feeder.IA_LABELS.code);
        const descResult = Feeder._findColumnDeep(Feeder.IA_LABELS.desc);
        const posResult  = Feeder._findColumnDeep(Feeder.IA_LABELS.pos);

        if (!codeResult) {
            Feeder._showManualMapper();
            Toast.warn('Lista da IA detectada, mas a coluna "Main materials" nao foi encontrada. Configure manualmente.');
            return;
        }

        // startRow = linha do cabecalho "Main materials" (os dados comecam na linha seguinte)
        const dataStartRow = Math.max(
            codeResult.headerRow,
            descResult ? descResult.headerRow : 0,
            posResult  ? posResult.headerRow  : 0
        );

        State.feederConfig = {
            startRow: dataStartRow,
            cMach: posResult  ? posResult.col  : codeResult.col,   // Trk  -> 1a coluna
            cPos:  descResult ? descResult.col : codeResult.col,   // Spec -> 2a coluna
            cCode: codeResult.col,                                  // Main materials
            cTray: Feeder._findTrayCol(),   // v16.27: coluna "Feeder spec"
            line:  lineVal,
            wo:    woVal,
            machine: machVal || '',   // v16.20
        };

        document.getElementById('feederDrop').style.display    = 'none';
        document.getElementById('feederResults').style.display = 'block';
        Feeder._setTypeBadge();
        Feeder.recalcMatches();

        const faltando = [!posResult && '"Trk"', !descResult && '"Spec"'].filter(Boolean).join(', ');
        if (faltando) Toast.warn(`Lista IA carregada, mas ${faltando} nao foi localizado(a). Os materiais foram cruzados normalmente.`, 6000);
        else Toast.success(`Lista da IA carregada! W/O: ${woVal}${machVal ? ' | Maquina: ' + machVal : ''}`);

        // v16.19: informa o corte automatico pela coluna Trk
        if (posResult) {
            Toast.info('Corte automatico ativo: apenas linhas com numero na coluna "Trk" sao tratadas como material.', 6000);
        }

        Feeder._afterLoad();   // v16.29
    },

    // v16.24: painel vermelho padrao de bloqueio do comparador
    _blockWarn(titulo, corpoHTML, comoResolver) {
        document.querySelectorAll('.wo-block-warn').forEach(el => el.remove());
        Toast.error('BLOQUEIO: ' + titulo, 8000);
        const drop = document.getElementById('feederDrop');
        if (drop) drop.style.display = 'block';
        const warn = document.createElement('div');
        warn.className = 'wo-block-warn';
        warn.style.cssText = 'margin-top:15px; padding:20px; background:#fef2f2; border:3px solid var(--ind-red); border-radius:10px; color:#991b1b; font-weight:800; text-align:center; font-size:1rem;';
        warn.innerHTML = `
            <i class="fas fa-ban" style="font-size:2.5rem; display:block; margin-bottom:10px; color:var(--ind-red);"></i>
            <div style="font-size:1.25rem; margin-bottom:8px;">${titulo}</div>
            <div style="font-size:0.95rem; font-weight:700; margin-bottom:6px;">${corpoHTML}</div>
            <div style="font-size:0.85rem; font-weight:600; color:#b91c1c;">${Security.sanitize(comoResolver)}</div>
            <button onclick="this.parentElement.remove(); Feeder.reset();" style="margin-top:12px; padding:8px 20px; background:var(--ind-red); color:white; border:none; border-radius:6px; font-weight:bold; cursor:pointer; font-size:0.9rem;">
                <i class="fas fa-times"></i> Fechar e carregar outra lista
            </button>`;
        if (drop && drop.parentElement) drop.parentElement.insertBefore(warn, drop.nextSibling);
        setTimeout(() => { if (warn.parentElement) warn.remove(); }, 25000);
    },

    _autoDetect() {
        if (!State.rawFeederData || State.rawFeederData.length < 2) {
            Toast.error('Arquivo vazio ou invalido.');
            return;
        }

        // Listas de labels aceitos para cada coluna (normalizados internamente)
        const LABELS = {
            mach: ['Equip. Name', 'Equip.Name', 'Equipment Name', 'EquipName', 'Machine', 'Maquina', 'Equip'],
            pos:  ['Position', 'Posicao', 'Pos', 'Slot', 'Feeder Position', 'Feeder'],
            code: ['Part No.', 'Part No', 'PartNo', 'Part Number', 'PartNumber', 'Codigo', 'Code', 'PN', 'Part'],
        };

        const machResult = Feeder._findColumn(LABELS.mach);
        const posResult  = Feeder._findColumn(LABELS.pos);
        const codeResult = Feeder._findColumn(LABELS.code);

        // Le Line e W/O: busca exata e parcial, ate 3 celulas a direita
        const lineVal = Feeder._readRight('Line') || Feeder._readRight('Linha') || Feeder._readRight('LN') || '--';
        const woVal   = Feeder._readRight('W/O')  || Feeder._readRight('WO')
                      || Feeder._readRight('OP')   || Feeder._readRight('Work Order')
                      || Feeder._readRight('Order') || '--';

        // v16.20: le a MAQUINA (celula a direita de "Machine:") — ex.: RL132 / AV131
        const machVal = Feeder._readRight('Machine') || Feeder._readRight('Maquina') || '';

        // ================================================================
        // v16.24 — TRAVAS DE RASTREIO
        //  1) Nunca aceitar lista SEM OP/W-O  -> perde o rastreio
        //  2) Nunca aceitar lista SEM LINHA   -> perde o rastreio
        //  3) So entra OP nova na linha se a anterior estiver FINALIZADA ou PAUSADA
        // ================================================================
        const _semWo   = (!woVal   || woVal   === '--' || String(woVal).trim()   === '');
        const _semLine = (!lineVal || lineVal === '--' || String(lineVal).trim() === '');
        if (_semWo || _semLine) {
            const faltou = [_semWo && 'OP / W/O', _semLine && 'LINHA'].filter(Boolean).join(' e ');
            Feeder._blockWarn(
                'LISTA SEM ' + faltou,
                `A lista carregada nao tem <b>${Security.sanitize(faltou)}</b> preenchido(a). Sem esse dado o sistema perde o rastreio da baixa.`,
                'Confira a feeder list original (celulas "Line" e "W/O Code") e carregue novamente.'
            );
            return;
        }

        // Trava 3 — vale para as listas SMT (listas da IA nao baixam estoque)
        if (!Feeder._isIAWo(woVal)) {
            const ativa = (typeof ListConfirm !== 'undefined') ? ListConfirm.listaAtivaDaLinha(lineVal) : null;
            if (ativa && String(ativa.config?.wo || '').trim() !== String(woVal).trim()) {
                const st = ListConfirm._conf(ativa).status === 'PENDENTE' ? 'pendente de troca de turno' : 'em andamento';
                Feeder._blockWarn(
                    'LINHA ' + Security.sanitize(String(lineVal).toUpperCase()) + ' JA TEM LISTA EM ABERTO',
                    `A OP <b>${Security.sanitize(ativa.config?.wo || '--')}</b> ainda esta <b>${st}</b> nessa linha.`,
                    'Va na aba "Confirmacao de Listas", FINALIZE o carro ou PAUSE a lista (com o motivo) para liberar a linha.'
                );
                return;
            }
        }

        // Aviso (nao bloqueia) quando a linha lida nao e uma das linhas oficiais
        if (!LINHAS.ehOficial(lineVal)) {
            Toast.warn(`Atencao: a linha "${lineVal}" nao esta na lista oficial (A01-A03 / S01A-S10). Confira a feeder list.`, 7000);
        }

        // ---- BLOQUEIO DE W/O DUPLICADA (agora W/O + MAQUINA) ----
        // v16.20: a mesma OP pode ter listas distintas por maquina (IA: RL132 e AV131).
        // Bloqueia somente se a OP JA foi baixada PARA A MESMA MAQUINA.
        // v16.20.1: listas da IA (OP terminada em "-AI") NAO travam — os itens de
        // armario nao sao baixados do estoque, entao a mesma OP pode ser carregada
        // quantas vezes for preciso. A trava continua valendo para as listas SMT.
        if (woVal && woVal !== '--' && !Feeder._isIAWo(woVal)) {
            const normWo   = String(woVal).trim();
            const normMach = String(machVal || '').trim().toUpperCase();
            const alreadyCheckedOut = State.checkoutHistory.some(h =>
                h.type === 'CHECKOUT' && h.config
                && String(h.config.wo).trim() === normWo
                && String(h.config.machine || '').trim().toUpperCase() === normMach
            );
            if (alreadyCheckedOut) {
                // Limpa qualquer aviso anterior
                document.querySelectorAll('.wo-block-warn').forEach(el => el.remove());
                Toast.error(`BLOQUEIO: A OP/W/O "${normWo}"${normMach ? ' (Maquina ' + normMach + ')' : ''} ja foi baixada!`, 8000);
                document.getElementById('feederDrop').style.display = 'block';
                const warn = document.createElement('div');
                warn.className = 'wo-block-warn';
                warn.style.cssText = 'margin-top:15px; padding:20px; background:#fef2f2; border:3px solid var(--ind-red); border-radius:10px; color:#991b1b; font-weight:800; text-align:center; font-size:1rem; animation:slideDown 0.3s ease-out;';
                warn.innerHTML = `
                    <i class="fas fa-ban" style="font-size:2.5rem; display:block; margin-bottom:10px; color:var(--ind-red);"></i>
                    <div style="font-size:1.3rem; margin-bottom:6px;">OP/W/O <strong style="font-family:'Roboto Mono',monospace; background:#fecaca; padding:2px 10px; border-radius:4px;">${Security.sanitize(normWo)}</strong> JA FOI BAIXADA!</div>
                    ${normMach ? `<div style="font-size:1rem; margin-bottom:6px;">Maquina: <strong style="font-family:'Roboto Mono',monospace; background:#fecaca; padding:2px 10px; border-radius:4px;">${Security.sanitize(normMach)}</strong></div>` : ''}
                    <div style="font-size:0.85rem; font-weight:600; color:#b91c1c;">Para reimprimir, use o Historico de Baixas. Para estornar, contate o supervisor (Admin).</div>
                    <button onclick="this.parentElement.remove(); Feeder.reset();" style="margin-top:12px; padding:8px 20px; background:var(--ind-red); color:white; border:none; border-radius:6px; font-weight:bold; cursor:pointer; font-size:0.9rem;">
                        <i class="fas fa-times"></i> Fechar e carregar outra lista
                    </button>
                `;
                const drop = document.getElementById('feederDrop');
                drop.parentElement.insertBefore(warn, drop.nextSibling);
                // Auto-remove apos 20s
                setTimeout(() => { if (warn.parentElement) warn.remove(); }, 20000);
                return;
            }
        }

        // Preenche o cabecalho de impressao
        document.getElementById('printLineDisplay').textContent = lineVal;
        document.getElementById('printWODisplay').textContent   = woVal;
        // v16.20: exibe a maquina no cabecalho apenas quando ela existe na lista
        const _machWrap = document.getElementById('printMachineWrap');
        document.getElementById('printMachineDisplay').textContent = machVal || '--';
        if (_machWrap) _machWrap.style.display = machVal ? 'block' : 'none';
        document.getElementById('printUser').textContent        = State.currentUser?.nome || '--';
        const now = new Date();
        document.getElementById('printDateTime').textContent    = `${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`;

        // v16.17: se a OP termina com "-AI", a lista e da IA (armarios PTH)
        if (Feeder._isIAWo(woVal)) {
            State.feederMode = 'IA';
            Feeder._autoDetectIA(lineVal, woVal, machVal);
            return;
        }
        State.feederMode = 'SMT';
        Feeder._setTypeBadge();

        if (machResult && posResult && codeResult) {
            const dataStartRow = Math.max(machResult.headerRow, posResult.headerRow, codeResult.headerRow);
            State.feederConfig = {
                startRow: dataStartRow,
                cMach: machResult.col,
                cPos:  posResult.col,
                cCode: codeResult.col,
                cTray: Feeder._findTrayCol(),   // v16.27: coluna "Feeder spec"
                line:  lineVal,
                wo:    woVal,
                machine: machVal || '',   // v16.20
            };
            document.getElementById('feederDrop').style.display    = 'none';
            document.getElementById('feederResults').style.display = 'block';
            Feeder.recalcMatches();

            const info = [];
            if (lineVal !== '--') info.push(`Linha: ${lineVal}`);
            if (woVal   !== '--') info.push(`W/O: ${woVal}`);
            if (machVal) info.push(`Maquina: ${machVal}`);
            Toast.success(`Lista carregada! ${info.join(' | ')}`);
            Feeder._afterLoad();   // v16.29
        } else {
            const missing = [
                !machResult && '"Equip. Name"',
                !posResult  && '"Position"',
                !codeResult && '"Part No."',
            ].filter(Boolean).join(', ');
            Feeder._showManualMapper();
            Toast.warn(`Colunas nao identificadas automaticamente: ${missing}. Configure manualmente.`);
        }
    },

    _showManualMapper() {
        document.getElementById('feederDrop').style.display = 'none';
        document.getElementById('feederMapper').style.display = 'block';
        Feeder.updateCols();
    },

    updateCols() {
        if (!State.rawFeederData) return;
        const startRow = parseInt(document.getElementById('feedStartRow').value) || 0;
        const headers  = State.rawFeederData[startRow] || [];
        const opts     = headers.map((h, i) => `<option value="${i}">${Security.sanitize(String(h))} (Col ${i+1})</option>`).join('');
        ['feedColMach','feedColPos','feedColCode'].forEach(id => document.getElementById(id).innerHTML = opts);
    },

    confirmLoad() {
        const startRow = (parseInt(document.getElementById('feedStartRow').value) || 1) - 1;
        State.feederConfig = {
            startRow,
            cMach: parseInt(document.getElementById('feedColMach').value),
            cPos:  parseInt(document.getElementById('feedColPos').value),
            cCode: parseInt(document.getElementById('feedColCode').value),
            cTray: Feeder._findTrayCol(),   // v16.27: coluna "Feeder spec"
        };
        document.getElementById('feederMapper').style.display  = 'none';
        document.getElementById('feederResults').style.display = 'block';
        Feeder._setTypeBadge();   // v16.17
        Feeder.recalcMatches();
        Feeder._afterLoad();   // v16.29
    },

    // PERF v16.16: debounce de 300ms para os campos de regra — antes, cada
    // tecla digitada recruzava a lista inteira contra o estoque, travando a UI.
    recalcDebounced() {
        clearTimeout(Feeder._recalcTimer);
        Feeder._recalcTimer = setTimeout(() => Feeder.recalcMatches(), 300);
    },

    recalcMatches(overrideStock = null) {
        if (!State.rawFeederData) return;

        // Restaura cabecalho padrao
        const _h = Feeder._heads();   // v16.17: rotulos conforme SMT ou IA
        document.querySelector('#resTable thead').innerHTML = `<tr><th>${_h.c1}</th><th>${_h.c2}</th><th>Codigo</th><th>LOCAL ESTOQUE <i class="fas fa-lock" style="color:#94a3b8; margin-left:5px;"></i></th><th style="text-align:center;">Status</th></tr>`;

        State.currentMatchedIds = [];
        const offset    = parseInt(document.getElementById('ruleOffset').value) || 0;
        const length    = parseInt(document.getElementById('ruleLength').value) || 999;
        const useHyphen = document.getElementById('ruleHyphen').checked;
        const _rulesEl = document.getElementById('rulesDisplay');
        const _rulesTxt = `Ignorar: ${offset}, Ler: ${length}, Hifen: ${useHyphen?'Sim':'Nao'}`;
        if (_rulesEl) _rulesEl.textContent = _rulesTxt;

        const stockSource = overrideStock || State.inventory;
        const stockMap    = {};

        stockSource.forEach(item => {
            let code = String(item.raw || item.code || '').trim();
            if (useHyphen) code = code.replace(/-/g, ' ');
            code = code.substring(offset, offset + length).trim();
            if (code) {
                if (!stockMap[code]) stockMap[code] = [];
                stockMap[code].push({ ...item });
            }
        });

        // Para cada chave, ordena por quantidade decrescente — o primeiro sempre será o de maior estoque
        Object.keys(stockMap).forEach(k => {
            stockMap[k].sort((a, b) => (Number(b.qty) || 0) - (Number(a.qty) || 0));
        });

        const tbody = document.querySelector('#resTable tbody');
        tbody.innerHTML = '';
        const rows = [];
        let _ignoradasTrk = 0;   // v16.19: linhas descartadas por nao ter Trk
        let _ignoradasTray = 0;  // v16.27: materiais TRAY (bandeja) descartados
        // v16.28 — LISTAS DA IA (OP terminada em "-AI"):
        //  1) o MESMO local pode ser mostrado mais de uma vez (nao consome o
        //     estoque), pois os itens de armario nao sao baixados;
        //  2) codigo repetido na lista aparece UMA UNICA VEZ (basta uma busca).
        const _isIA = (State.feederMode === 'IA');
        const _iaSeen = new Set();
        let _ignoradasDup = 0;
        // v16.30: linhas ja conferidas na CAIXA — entram na tabela com status
        // "CAIXA" e nao sao cruzadas com o estoque (o material ja esta em maos).
        const _boxRows = State._boxFoundRows || null;
        let _emCaixa = 0;

        for (let i = State.feederConfig.startRow + 1; i < State.rawFeederData.length; i++) {
            const r    = State.rawFeederData[i];
            if (!r) continue;

            // codeDisplay: código original da planilha, exibido na tabela e impresso
            const codeDisplay = Security.sanitize(String(r[State.feederConfig.cCode] || '').trim());
            if (!codeDisplay) continue;

            // v16.19: na lista IA, so e material se houver NUMERO na coluna Trk.
            // Corta automaticamente o rodape (First PCB / Operator / QC Confirm...).
            if (Feeder._skipByTrk(r)) { _ignoradasTrk++; continue; }

            // v16.27: material de bandeja (TRAY na coluna "Feeder spec") sai da lista
            if (Feeder._skipByTray(r)) { _ignoradasTray++; continue; }

            // v16.28: na lista da IA, codigo repetido nao precisa aparecer de novo
            if (_isIA) {
                const dupKey = codeDisplay.trim().toUpperCase();
                if (_iaSeen.has(dupKey)) { _ignoradasDup++; continue; }
                _iaSeen.add(dupKey);
            }

            // codeMatch: código processado pelas regras (offset/length/hyphen), usado SO para cruzamento
            // NUNCA aparece na tabela — o usuario ve sempre o codigo original da planilha
            let codeMatch = codeDisplay;
            if (useHyphen) codeMatch = codeMatch.replace(/-/g, ' ');
            codeMatch = codeMatch.substring(offset, offset + length).trim();

            // PERF v16.16: usa ponteiro de consumo em vez de shift() (que
            // reindexa o array inteiro a cada chamada)
            // v16.30: item que veio da caixa — nao procura no estoque
            if (_boxRows && _boxRows.has(i)) {
                _emCaixa++;
                const trBox = document.createElement('tr');
                trBox.className = 'box-row';
                trBox.style.background = '#f0fdf4';
                trBox.innerHTML = `
                    <td>${Security.sanitize(String(r[State.feederConfig.cMach] || ''))}</td>
                    <td>${Security.sanitize(String(r[State.feederConfig.cPos] || ''))}</td>
                    <td style="font-weight:bold;">${codeDisplay}</td>
                    <td><span style="color:#15803d; font-weight:bold;"><i class="fas fa-box-open"></i> EM MAOS</span></td>
                    <td style="text-align:center;"><span class="badge" style="background:var(--ind-green); border-color:#15803d;">CAIXA</span></td>
                `;
                rows.push({ match: null, box: true, element: trBox, originalIndex: i });
                continue;
            }

            const bucket = stockMap[codeMatch];
            let match = null;
            if (bucket) {
                if (_isIA) {
                    // v16.28: IA nao consome a posicao — sempre mostra o local
                    // com maior estoque, mesmo que o codigo se repita.
                    match = bucket[0];
                } else {
                    bucket._ptr = bucket._ptr || 0;
                    if (bucket._ptr < bucket.length) match = bucket[bucket._ptr++];
                }
            }
            const tr    = document.createElement('tr');

            if (match) {
                State.currentMatchedIds.push(match);
                tr.className = 'matched-row';
                tr.dataset.matchId = String(match.id);
                tr.dataset.car     = Security.sanitize(match.car);
                tr.dataset.loc     = Security.sanitize(match.loc);
                const qtyBadge = (match.qty > 0)
                    ? `<span style="font-size:0.7rem; background:var(--ind-yellow); color:#000; padding:2px 6px; border-radius:4px; font-weight:bold; margin-left:6px;"><i class="fas fa-star"></i> ${match.qty} un</span>`
                    : '';
                tr.innerHTML = `
                    <td>${Security.sanitize(String(r[State.feederConfig.cMach] || ''))}</td>
                    <td>${Security.sanitize(String(r[State.feederConfig.cPos] || ''))}</td>
                    <td style="font-weight:bold;">${codeDisplay}${qtyBadge}</td>
                    <td class="hidden-loc-cell"><span style="background:#e2e8f0; color:#64748b; padding:4px 8px; border-radius:4px; font-weight:bold; letter-spacing:2px;">***</span></td>
                    <td style="text-align:center;"><span class="badge" style="background:#64748b; border-color:#475569;"><i class="fas fa-lock"></i> OCULTO</span></td>
                `;
            } else {
                tr.innerHTML = `
                    <td>${Security.sanitize(String(r[State.feederConfig.cMach] || ''))}</td>
                    <td>${Security.sanitize(String(r[State.feederConfig.cPos] || ''))}</td>
                    <td style="font-weight:bold;">${codeDisplay}</td>
                    <td><span style="color:#cbd5e1;">-</span></td>
                    <td style="text-align:center;"><span class="badge bg-err">FALTA</span></td>
                `;
            }
            rows.push({ match, element: tr, originalIndex: i });
        }

        // Ordenacao de rota de picking (por carro depois por locacao)
        rows.sort((a, b) => {
            // v16.30: itens da caixa sempre no fim (nao fazem parte da rota de busca)
            if (a.box && !b.box) return 1;
            if (!a.box && b.box) return -1;
            if (a.match && !b.match) return -1;
            if (!a.match && b.match) return 1;
            if (!a.match && !b.match) return a.originalIndex - b.originalIndex;
            const cmp = a.match.car.localeCompare(b.match.car, undefined, {numeric:true, sensitivity:'base'});
            if (cmp !== 0) return cmp;
            return a.match.loc.localeCompare(b.match.loc, undefined, {numeric:true, sensitivity:'base'});
        });

        // FIX: Usa DocumentFragment para melhor performance de render
        const frag = document.createDocumentFragment();
        rows.forEach(row => frag.appendChild(row.element));
        tbody.appendChild(frag);

        // v16.19: informa quantas linhas foram descartadas pelo corte do Trk
        if (_rulesEl) {
            _rulesEl.textContent = _rulesTxt
                + (_ignoradasTrk > 0 ? `  |  ${_ignoradasTrk} linha(s) sem Trk ignorada(s)` : '')
                + (_ignoradasTray > 0 ? `  |  ${_ignoradasTray} material(is) TRAY removido(s)` : '')
                + (_ignoradasDup  > 0 ? `  |  ${_ignoradasDup} codigo(s) repetido(s) agrupado(s)` : '')
                + (_emCaixa       > 0 ? `  |  ${_emCaixa} item(ns) ja conferido(s) na CAIXA` : '');
        }

        // Atualiza botao NAO ENCONTRADOS
        const notFoundRows = rows.filter(r => !r.match && !r.box);   // v16.30: caixa nao e falta
        const btnNF = document.getElementById('btnNotFoundFeeder');
        if (btnNF) {
            if (notFoundRows.length > 0) {
                btnNF.style.display = 'inline-flex';
                btnNF.innerHTML = `<i class="fas fa-exclamation-triangle"></i> NAO ENCONTRADOS (${notFoundRows.length})`;
            } else {
                btnNF.style.display = 'none';
            }
        }
        // Guarda lista para uso no popup
        State._feederNotFound = notFoundRows.map(r => ({
            mach: Security.sanitize(String(State.rawFeederData[r.originalIndex][State.feederConfig.cMach] || '')),
            pos:  Security.sanitize(String(State.rawFeederData[r.originalIndex][State.feederConfig.cPos]  || '')),
            code: Security.sanitize(String(State.rawFeederData[r.originalIndex][State.feederConfig.cCode] || '')),
        }));
    },

    showNotFound() {
        const list = State._feederNotFound || [];
        if (list.length === 0) { Toast.info('Todos os itens foram encontrados no estoque!'); return; }

        const rows = list.map(i =>
            `<tr>
                <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; font-family:'Roboto Mono',monospace; font-size:0.82rem;">${i.mach}</td>
                <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; font-family:'Roboto Mono',monospace; font-size:0.82rem;">${i.pos}</td>
                <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; font-weight:900; color:var(--ind-red); font-family:'Roboto Mono',monospace; font-size:0.88rem;">${i.code}</td>
            </tr>`
        ).join('');
        const _h2 = Feeder._heads();   // v16.17
        const txtLines = list.map(i => i.code + '\t' + i.mach + '\t' + i.pos).join('\n');
        const header   = `Codigo\t${_h2.c1}\t${_h2.c2}\n`;


        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        backdrop.style.zIndex = '200001';
        backdrop.innerHTML = `
            <div class="modal-box" style="max-width:600px; max-height:90vh; display:flex; flex-direction:column;">
                <div class="modal-title" style="color:var(--ind-red); flex-shrink:0;">
                    <i class="fas fa-exclamation-triangle"></i> Nao Encontrados — ${list.length} item(ns)
                </div>
                <div style="font-size:0.85rem; color:#64748b; margin-bottom:14px; flex-shrink:0; line-height:1.5;">
                    Estes codigos nao foram localizados no estoque. Podem ter <b>opcionais</b> — use a aba <b>Busca Avulsa</b> para verificar.
                </div>
                <div style="flex:1; overflow-y:auto; border:1px solid #e2e8f0; border-radius:6px; min-height:0;">
                    <table style="width:100%; border-collapse:collapse; margin:0;">
                        <thead>
                            <tr style="background:#334155; color:white; position:sticky; top:0;">
                                <th style="padding:10px; text-align:left; font-size:0.8rem;">${_h2.c1}</th>
                                <th style="padding:10px; text-align:left; font-size:0.8rem;">${_h2.c2}</th>
                                <th style="padding:10px; text-align:left; font-size:0.8rem;">Codigo</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
                <div style="display:flex; gap:10px; margin-top:16px; flex-shrink:0; flex-wrap:wrap;">
                    <button class="btn-3d btn-blue" style="flex:1;" id="_nfCopy"><i class="fas fa-copy"></i> COPIAR (colar no Excel)</button>
                    <button class="btn-3d btn-green" style="flex:1;" id="_nfXlsx"><i class="fas fa-file-excel"></i> EXPORTAR EXCEL</button>
                    <button class="btn-3d btn-gray" style="flex:1;" id="_nfClose">FECHAR</button>
                </div>
            </div>`;
        document.body.appendChild(backdrop);

        backdrop.querySelector('#_nfClose').onclick = () => document.body.removeChild(backdrop);

        backdrop.querySelector('#_nfCopy').onclick = () => {
            navigator.clipboard.writeText(header + txtLines).then(() => {
                Toast.success('Copiado! Cole direto no Excel (Ctrl+V).', 3000);
            }).catch(() => {
                // fallback: textarea
                const ta = document.createElement('textarea');
                ta.value = header + txtLines;
                document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
                Toast.success('Copiado!', 2000);
            });
        };

        backdrop.querySelector('#_nfXlsx').onclick = () => {
            if (!window.XLSX) { Toast.warn('Biblioteca XLSX nao carregada.'); return; }
            const data = list.map(i => ({ 'Codigo': i.code, [_h2.c1]: i.mach, [_h2.c2]: i.pos }));
            const ws = XLSX.utils.json_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Nao Encontrados');
            XLSX.writeFile(wb, `TPV_NaoEncontrados_${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.xlsx`);
            Toast.success('Excel gerado!');
        };
    },

    async checkout() {
        if (!DB.guard('Baixar Lista Feeder')) return;
        if (State.currentMatchedIds.length === 0) {
            Toast.warn('Nenhum item encontrado no estoque para baixar.');
            return;
        }

        Commitment.open(async () => {
            const btn = document.getElementById('btnCheckoutFeeder');
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Processando...';

            const itemsToRemove = State.currentMatchedIds.map(m => ({ ...m }));
            const idsToRemove   = itemsToRemove.map(m => String(m.id));

            // Revela posicoes na tabela
            document.querySelectorAll('.matched-row').forEach(tr => {
                tr.querySelector('.hidden-loc-cell').innerHTML = `<span style="color:var(--tpv-blue); font-weight:bold; font-size:1.1rem;">${Security.sanitize(tr.dataset.car)} - ${Security.sanitize(tr.dataset.loc)}</span>`;
                tr.querySelector('.badge').outerHTML = `<span class="badge bg-ok">BAIXADO</span>`;
            });

            // Snapshot HTML da tabela para reimprimir
            const tableHTML = document.querySelector('#resTable tbody').innerHTML;

            // v16.17.1: itens de ARMARIO (IA) sao FIXOS — nunca saem do estoque.
            // Aparecem no relatorio e sao impressos, mas a posicao permanece ocupada.
            const _fixos = itemsToRemove.filter(m => PTHCabinets.isCabinet(m.car)).length;
            State.inventory = State.inventory.filter(i =>
                PTHCabinets.isCabinet(i.car) || !idsToRemove.includes(String(i.id))
            );
            if (_fixos > 0) Toast.info(`${_fixos} item(ns) de armario (IA) foram impressos mas NAO baixados — posicao fixa.`, 6000);

            const now = new Date();
            const histId = `${Date.now()}`;
            // Garante que line/wo do feederConfig estao salvos para bloqueio de WO
            const cfg = {
                ...State.feederConfig,
                line: document.getElementById('printLineDisplay').textContent || State.feederConfig.line || '--',
                wo:   document.getElementById('printWODisplay').textContent   || State.feederConfig.wo   || '--',
                machine: State.feederConfig.machine || '',   // v16.20
            };
            State.checkoutHistory.unshift({
                id: histId, removedItems: itemsToRemove, type: 'CHECKOUT',
                tableHTML,
                tableHead: `<tr><th>${Feeder._heads().c1}</th><th>${Feeder._heads().c2}</th><th>Codigo</th><th>LOCAL ESTOQUE</th><th style="text-align:center;">Status</th></tr>`,
                config: cfg,
                printUser: State.currentUser.nome,
                printDate: now.toLocaleString('pt-BR'),
                user: State.currentUser.nome,
                matricula: State.currentUser.matricula, timestamp: Date.now(),
            });

            await DB.saveNow();
            await Logs.log('CHECKOUT', `Baixou ${itemsToRemove.length} itens via Lista de Alimentadores`, histId);

            document.getElementById('feederProcessSuccess').style.display = 'block';
            document.getElementById('btnCheckoutFeeder').style.display    = 'none';

            document.getElementById('printDateTime').innerHTML = `${now.toLocaleDateString('pt-BR')} - ${now.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}`;

            Toast.success(`${itemsToRemove.length} itens baixados com sucesso!`);
            // Aguarda o DOM terminar de atualizar antes de abrir o dialogo de impressao
            // para garantir que o feederProcessSuccess e outros elementos no-print
            // ja estejam corretamente marcados antes do print ser capturado
            setTimeout(() => {
                window.print();
            }, 700);
        });
    },
};

// ============================================================
// MODULO: VOZ ASIATICA (OK / NG) via Web Speech API
// ============================================================
const VoiceFeedback = {
    _voices: [],
    _ready: false,

    init() {
        if (!('speechSynthesis' in window)) return;
        const load = () => {
            VoiceFeedback._voices = window.speechSynthesis.getVoices();
            VoiceFeedback._ready = true;
        };
        window.speechSynthesis.onvoiceschanged = load;
        load();
    },

    // Seleciona a melhor voz asiatica disponivel.
    // gender: 'female' tenta vozes femininas (pitch alto), 'male' tenta masculinas (pitch baixo).
    // Fallback em cascata: ja -> zh -> ko -> en -> qualquer.
    _pickVoice(gender) {
        const ASIAN_LANGS = ['ja', 'zh', 'ko'];
        const ALL_LANGS   = [...ASIAN_LANGS, 'en-GB', 'en-US', 'en'];

        const femaleHints = ['female', 'woman', 'girl', 'kyoko', 'haruka', 'mei', 'sin-ji', 'ting-ting', 'yu-shu', 'google 日本語'];
        const maleHints   = ['male', 'man', 'otoya', 'daniel', 'reed', 'george', 'hattori'];

        const hints = gender === 'female' ? femaleHints : maleHints;

        // 1a tentativa: voz asiatica com hint de genero
        for (const lang of ASIAN_LANGS) {
            const v = VoiceFeedback._voices.find(v =>
                v.lang.startsWith(lang) && hints.some(h => v.name.toLowerCase().includes(h))
            );
            if (v) return v;
        }
        // 2a tentativa: qualquer voz asiatica
        for (const lang of ASIAN_LANGS) {
            const v = VoiceFeedback._voices.find(v => v.lang.startsWith(lang));
            if (v) return v;
        }
        // 3a tentativa: hint de genero em qualquer lingua
        for (const lang of ALL_LANGS) {
            const v = VoiceFeedback._voices.find(v =>
                v.lang.startsWith(lang) && hints.some(h => v.name.toLowerCase().includes(h))
            );
            if (v) return v;
        }
        // Fallback: primeira disponivel
        return VoiceFeedback._voices[0] || null;
    },

    _speak(text, pitch, rate, gender) {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const utt  = new SpeechSynthesisUtterance(text);
        utt.voice  = VoiceFeedback._pickVoice(gender);
        utt.pitch  = pitch;   // 0.0 = grave / 2.0 = agudo
        utt.rate   = rate;    // 0.1 = devagar / 10 = rapido
        utt.volume = 1;
        window.speechSynthesis.speak(utt);
    },

    // OK  -> voz masculina, rapida, tom grave
    playOK() {
        VoiceFeedback._speak('O.K.', 0.3, 1.9, 'male');
        VoiceFeedback._showBadge('OK', 'ok-badge');
    },

    // NG  -> voz feminina, muito rapida, tom agudo/fino
    playNG() {
        VoiceFeedback._speak('N.G.', 2.0, 2.2, 'female');
        VoiceFeedback._showBadge('NG', 'ng-badge');
    },

    _showBadge(text, cls) {
        const badge = document.getElementById('devVoiceBadge');
        if (!badge) return;
        badge.textContent = text;
        badge.className   = `dev-voice-badge ${cls} show`;
        setTimeout(() => { badge.classList.remove('show'); }, 800);
    },
};
