// ==========================================================================
// MODULO: BANCO DE DADOS  (v17.00)
// ----------------------------------------------------------------------
// A logica de negocio deste modulo NAO mudou. O que mudou foi o meio
// fisico: onde antes havia UM arquivo JSON, agora ha uma PASTA gerida
// pelo Store (js/02-store.js).
//
// _buildPayload() e _applyParsed() continuam produzindo e consumindo o
// MESMO formato de objeto de sempre. E por isso que os outros 28 modulos
// do sistema nao precisaram de nenhuma alteracao.
// ==========================================================================
// ============================================================
// MODULO: BANCO DE DADOS (File System Access API)
// ============================================================
const DB = {
    // SYNC LOOP: metadata polling de 800ms.
    // Custo por ciclo (caso tipico - sem mudanca):
    //   getFile() = ~1ms (so metadados do OS, sem I/O de rede real)
    //   comparacao lastModified = 0ms
    //   Total: praticamente zero impacto
    // Custo por ciclo (quando outro usuario salva):
    //   file.text() = leitura real do JSON (~5-20ms na rede local)
    //   JSON.parse + UI refresh = ~10-30ms
    //   Total: imperceptivel para o usuario
    // ======================================================================
    // SYNC LOOP (v17) — le APENAS dados/indice.json (~1KB) por ciclo.
    //
    // Antes: a cada gravacao de QUALQUER PC, todos os outros baixavam o JSON
    // inteiro (~800KB) pela rede. Agora o ciclo le o manifesto; se a versao
    // de algum dominio mudou, so AQUELE arquivo e relido. Uma devolucao no
    // PC A nao faz mais o PC B baixar o catalogo de 7.900 itens.
    // ======================================================================
    async startAutoSync() {
        if (!State.dbFileHandle) {
            State._syncTimer = setTimeout(() => DB.startAutoSync(), State._syncInterval);
            return;
        }

        // Se ha saves na fila, pula a leitura para nao ler um indice pela metade
        if (State._queueDepth > 0) {
            State._syncTimer = setTimeout(() => DB.startAutoSync(), State._syncInterval);
            return;
        }

        // v16.32 (mantido): operacao critica em andamento (ex.: devolucao ja
        // aplicada em memoria, aguardando gravacao). Nao le o disco agora.
        if (State._mutating > 0) {
            State._syncTimer = setTimeout(() => DB.startAutoSync(), 300);
            return;
        }

        const cycleStart = performance.now();

        try {
            // Checagem baratissima: so o lastModified do indice (1KB).
            if (await Store.indiceMudou()) {
                DB._setSyncStatus('syncing', 'Lendo atualizacao...');

                // lerMudancas() devolve um payload PARCIAL — apenas os dominios
                // cuja versao mudou, mais a cauda nova dos shards de movimento.
                const parcial = await Store.lerMudancas();

                if (parcial) {
                    State._ultimaAtividade = Date.now();   // teve movimento: acelera
                    // v17: aplicamos SEMPRE, mesmo se uma operacao critica comecou
                    // durante a leitura. No formato antigo isso era perigoso porque
                    // o disco SOBRESCREVIA o estado; aqui _mergeFromDisk faz merge
                    // de 3 vias por slot (mudanca local vence) e merge por id no
                    // historico — nada local e perdido.
                    DB._mergeFromDisk(parcial);
                    DB._scheduleSyncRefresh();

                    const ms = Math.round(performance.now() - cycleStart);
                    DB._setSyncStatus('ok', `Atualizado (${ms}ms)`);
                    DB._flashSyncUpdate();
                }
            }

            State._syncErrorCount = 0;

            // Se estava desconectado e o sync voltou, reconecta silenciosamente
            if (!State.isConnected) {
                State.isConnected = true;
                DB._setSyncStatus('ok', 'Reconectado automaticamente');
                Toast.success('Conexao com a pasta do banco de dados restaurada automaticamente!', 4000);
            }

            if (!State._lastSyncLabelUpdate || Date.now() - State._lastSyncLabelUpdate > 3000) {
                const elapsed = Math.round(performance.now() - cycleStart);
                const now = new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
                DB._setSyncStatus('ok', `Sync ${now} (${elapsed}ms)`);
                State._lastSyncLabelUpdate = Date.now();
            }

        } catch (e) {
            State._syncErrorCount = (State._syncErrorCount || 0) + 1;

            // Detecta erro de permissao/cache: para o sync e avisa
            const emsg = (e.message || '').toLowerCase();
            const isPermErr = emsg.includes('state cache')
                || emsg.includes('permission')
                || emsg.includes('not allowed')
                || emsg.includes('handle is closed')
                || e.name === 'SecurityError'
                || e.name === 'NotAllowedError';

            if (isPermErr) {
                console.warn('[sync] Permissao expirada, tentando renovar silenciosamente...');
                const renewed = await DB._tryRenewPermission();
                if (renewed) {
                    console.log('[sync] Permissao renovada. Retomando sync.');
                    State._syncErrorCount = 0;
                } else {
                    // Não conseguiu renovar silenciosamente — aguarda e tenta de novo no próximo ciclo
                    DB._setSyncStatus('error', 'Aguardando permissao...');
                }
                State._syncTimer = setTimeout(() => DB.startAutoSync(), 3000);
                return;
            }

            if (State._syncErrorCount >= 3) {
                DB._setSyncStatus('error', 'Erro de conexao com BD');
            }
        }

        // ==============================================================
        // RITMO ADAPTATIVO DO SYNC (v17.05)
        //
        // Cada ciclo e uma ida ao servidor de arquivos. Com varios PCs
        // ligados o dia inteiro, perguntar "mudou?" a cada 1,5s mesmo com
        // ninguem mexendo entope a rede sem entregar nada.
        //
        // Agora: RAPIDO enquanto ha movimento (o operador precisa ver a
        // devolucao do colega na hora), e LENTO quando a pasta esta parada.
        // Qualquer alteracao, minha ou de outro PC, volta ao ritmo rapido.
        // ==============================================================
        let interval;
        if (State._syncErrorCount > 2) {
            interval = Math.min(State._syncInterval * Math.pow(1.5, State._syncErrorCount - 2), 8000);
        } else {
            const paradoHa = Date.now() - (State._ultimaAtividade || Date.now());
            interval = paradoHa > 45000 ? 5000            // pasta parada ha 45s
                     : paradoHa > 12000 ? 2500            // parada ha 12s
                     : State._syncInterval;               // movimento recente
        }

        State._syncTimer = setTimeout(() => DB.startAutoSync(), interval);
    },

    // Debounce do redesenho disparado pelo sync entre maquinas.
    // Agrupa rajadas de atualizacoes (varios PCs salvando) em um unico
    // triggerRefresh, evitando travar a UI com N redesenhos por segundo.
    _scheduleSyncRefresh() {
        clearTimeout(State._syncRefreshTimer);
        State._syncRefreshTimer = setTimeout(() => {
            UI.triggerRefresh(true); // skipFeeder=true: nao recruza a lista no sync
        }, 250);
    },

    // Atualiza o indicador de status no header (sem usar Toast - seria spam a cada 800ms)
    _setSyncStatus(state, label) {
        const dot    = document.getElementById('syncDot');
        const lbl    = document.getElementById('syncLabel');
        const detail = document.getElementById('syncDetails');
        const conn   = document.getElementById('connectionStatus');
        const btnR   = document.getElementById('headerReconnectBtn');
        if (!dot) return;

        dot.className = 'sync-dot';
        if (state === 'syncing') { dot.classList.add('syncing'); }
        if (state === 'writing') { dot.classList.add('writing'); }
        if (state === 'error' || state === 'disconnected') {
            dot.classList.add('error');
            if (conn) conn.className = 'mode-indicator mode-offline';
            if (lbl)  lbl.textContent = state === 'disconnected' ? 'DESCONECTADO' : 'Erro de Conexao';
            if (btnR) btnR.style.display = 'inline-flex';
        }
        if (state === 'ok') {
            if (conn) conn.className = 'mode-indicator mode-online';
            if (lbl)  lbl.textContent = 'BD Conectado';
            if (btnR) btnR.style.display = 'none';
        }
        if (detail && label) detail.textContent = label;
    },

    // Pulso visual discreto no dot quando recebe update de outro usuario
    _flashSyncUpdate() {
        const dot = document.getElementById('syncDot');
        if (!dot) return;
        dot.classList.add('syncing');
        // Breve flash azul e volta para verde
        setTimeout(() => { dot.classList.remove('syncing'); }, 700);
    },

    _applyParsed(parsed) {
        // Suporte ao novo formato compacto v13.3: 'slots' (funde inventory+validLocations)
        // Retrocompatível: se vier no formato antigo (inventory+validLocations), converte automaticamente.
        if (parsed.slots) {
            // Novo formato: slots = [{c, l, k?, q?, t?}]
            State.validLocations = parsed.slots.map(s => ({ car: s.c, loc: s.l, id: s.c + '_' + s.l }));
            State.inventory      = parsed.slots
                .filter(s => s.k)
                .map(s => ({ id: s.c + '_' + s.l, car: s.c, loc: s.l, code: s.k, qty: s.q || 0, timestamp: s.t || 0 }));
        } else {
            // Formato antigo: mantém funcionando normalmente
            State.inventory      = parsed.inventory      || [];
            State.validLocations = parsed.validLocations || [];
        }
        State.users           = parsed.users           || [];
        State.logs            = parsed.logs            || [];
        State.checkoutHistory = parsed.checkoutHistory || [];

        // v16.16: PURGA AO ABRIR. Se o sistema ficou fechado e o usuario volta
        // depois, verifica na hora quais listas do historico passaram de 1h e
        // remove os dados pesados (tableHTML/removedItems) imediatamente,
        // agendando a regravacao do JSON — assim o arquivo nunca fica inchado
        // esperando a proxima baixa para ser limpo.
        (() => {
            const cut1h = Date.now() - 1 * 3600 * 1000;
            let purged = false;
            State.checkoutHistory.forEach(h => {
                if (h.timestamp && h.timestamp < cut1h) {
                    if (h.tableHTML || h.tableHead) {
                        delete h.tableHTML; delete h.tableHead; purged = true;
                    }
                    if (h.removedItems && h.removedItems.length > 0) {
                        h._itemCount = h._itemCount || h.removedItems.length;
                        h._totalQty  = h._totalQty  || h.removedItems.reduce((s, i) => s + (Number(i.qty) || 0), 0);
                        delete h.removedItems; purged = true;
                    }
                    if (h.returnedItems && h.returnedItems.length > 0) {
                        h._returnCount    = h._returnCount    || h.returnedItems.length;
                        h._totalReturnQty = h._totalReturnQty || h.returnedItems.reduce((s, i) => s + (Number(i.qty) || 0), 0);
                        delete h.returnedItems; purged = true;
                    }
                }
            });
            if (purged && State.dbFileHandle) DB.scheduleSave();
        })();

        if (parsed.adminConfig)      State.adminConfig      = parsed.adminConfig;

        // v17.01 — MIGRACAO DE SEGURANCA: apaga a senha em texto puro que as
        // versoes antigas gravavam. Roda ANTES de qualquer tela usar os dados.
        // Nao mexe no passwordHash, entao ninguem perde o login.
        (() => {
            const n = SenhaLimpa.migrar();
            if (n > 0) {
                console.warn('[seguranca] ' + n + ' senha(s) em texto puro removidas do banco.');
                // regrava o sistema.json ja limpo
                if (State.dbFileHandle) DB.scheduleSave();
            }
        })();
        if (parsed.sdSnapshot)       State.sdSnapshot       = parsed.sdSnapshot;
        if (parsed.componentCatalog) { State.componentCatalog = parsed.componentCatalog; DB.invalidateCatalogCache(); }
        if (parsed.carMaterialType)  State.carMaterialType  = parsed.carMaterialType;

        // v17.03 — familias de materiais. Banco antigo nao tem a chave: as
        // sementes sao criadas aqui, uma unica vez, e gravadas no proximo save.
        if (Array.isArray(parsed.materialFamilies)) State.materialFamilies = parsed.materialFamilies;
        if (parsed.stockLimits)                     State.stockLimits      = parsed.stockLimits;
        if (parsed.unclassified)                    State.unclassified     = parsed.unclassified;
        try {
            Familias.invalidar();
            if (Familias.garantir() && State.dbFileHandle) DB.scheduleSave();
        } catch (e) { console.warn('[Familias] nao consegui preparar as familias:', e.message); }
        if (parsed.weeklyStats)      State.weeklyStats      = parsed.weeklyStats;   // v16.28
        if (parsed.boxSessions)      State.boxSessions      = parsed.boxSessions;   // v16.29
        if (parsed.lastAutoBackupDate) State.lastAutoBackupDate = parsed.lastAutoBackupDate;
        if (parsed.lastBackupInfo)     State.lastBackupInfo     = parsed.lastBackupInfo;

        // v16.17: garante que os armarios PTH (posicoes fixas) sempre existam
        if (typeof PTHCabinets !== 'undefined') PTHCabinets.ensure();
    },

    // _buildPayload: prune automatico para manter o JSON leve.
    // v13.3: formato compacto 'slots' funde inventory+validLocations (economia ~60%).
    //        Chaves curtas: c=car, l=loc, k=code, q=qty, t=timestamp.
    //        Snapshot NAO salvo no JSON. Logs: max 50. Historico: max 30 dias/500 entradas (7 dias completos para ranking).
    _buildPayload() {
        // v16.28: consolida os numeros da semana ANTES de podar o historico,
        // garantindo que o ranking semanal sobreviva a purga de 7 dias.
        try { if (typeof WeeklyStats !== 'undefined') WeeklyStats.sync(); } catch (e) {}
        const now     = Date.now();
        // v16.16: janela de reimpressao reduzida de 2h para 1h.
        // Apos 1h, o snapshot pesado (tableHTML/removedItems) e removido do JSON
        // para manter o arquivo leve e o sistema rapido. O registro da baixa
        // (contadores, W/O, usuario) permanece por 7 dias para o ranking e o
        // bloqueio de W/O duplicada.
        const CUT_1H  = now -        1 * 3600 * 1000;
        const CUT_7D  = now - Store.DIAS_MEMORIA * 86400 * 1000;

        // Logs: max 50
        const prunedLogs = (State.logs || []).slice(0, 50);

        // Historico no JSON: APENAS 7 dias (janela do ranking semanal).
        // O historico longo fica preservado no BACKUP DIARIO de seguranca
        // (Excel completo salvo 1x/dia na pasta de rede) — cada registro e
        // copiado ~7x antes de sair do JSON. O JSON guarda so o necessario
        // para o tempo real e o ranking, mantendo o arquivo leve e estavel.
        //   - Dentro de 1h: mantem tableHTML/tableHead para reimpressao
        //   - Apos 1h: compacta removedItems -> _itemCount (economiza ~90%)
        //   - Acima de 7 dias: descartado do JSON (continua no Excel)
        const allHist = (State.checkoutHistory || [])
            .filter(h => h.timestamp >= CUT_7D)
            .sort((a, b) => b.timestamp - a.timestamp);

        const prunedHistory = allHist.map(h => {
            // Snapshot da tabela (tableHTML/tableHead): preserva por 1h para reimpressao
            let base;
            if (h.timestamp >= CUT_1H) {
                base = { ...h }; // mantem tableHTML/tableHead dentro de 1h
            } else {
                const { tableHTML, tableHead, ...rest } = h;
                base = rest;
            }

            if (h.type === 'AUDIT_CLEAR') {
                const { removedItems, ...rest } = base;
                return rest;
            }

            // Compacta removedItems -> _itemCount (economiza ~90% do espaco por entrada)
            // PRESERVA a lista completa por 1h para consulta no historico
            const compact = { ...base };
            // Calcula contadores SEMPRE (mesmo mantendo a lista completa)
            if (compact.removedItems && compact.removedItems.length > 0) {
                compact._itemCount = compact.removedItems.length;
                compact._totalQty  = compact.removedItems.reduce((s, i) => s + (Number(i.qty) || 0), 0);
                if (h.timestamp < CUT_1H) delete compact.removedItems; // so compacta apos 1h
            }
            if (compact.returnedItems && compact.returnedItems.length > 0) {
                compact._returnCount = compact.returnedItems.length;
                compact._totalReturnQty = compact.returnedItems.reduce((s, i) => s + (Number(i.qty) || 0), 0);
                if (h.timestamp < CUT_1H) delete compact.returnedItems; // so compacta apos 1h
            }

            return compact;
        });

        // Formato compacto: funde validLocations + inventory em 'slots'
        // Cria mapa de inventory por car+loc para lookup O(1)
        const invMap = {};
        (State.inventory || []).forEach(i => { if (i.car && i.loc) invMap[i.car + '|' + i.loc] = i; });

        const slots = (State.validLocations || []).map(vl => {
            const slot = { c: vl.car, l: vl.loc };
            const inv  = invMap[vl.car + '|' + vl.loc];
            if (inv && inv.code) {
                slot.k = inv.code;
                slot.q = inv.qty || 0;
                if (inv.timestamp) slot.t = inv.timestamp;
            }
            return slot;
        });

        return {
            slots,
            users:            State.users,
            logs:             prunedLogs,
            checkoutHistory:  prunedHistory,
            adminConfig:      State.adminConfig,
            componentCatalog: State.componentCatalog || [],
            carMaterialType:  State.carMaterialType  || {},
            // v17.03
            materialFamilies: State.materialFamilies || [],
            stockLimits:      State.stockLimits      || null,
            unclassified:     State.unclassified     || null,
            // v16.28: consolidado semanal do ranking (so numeros, 45 dias)
            weeklyStats:      State.weeklyStats      || {},
            // v16.29: sessoes de leitura de caixas (abertas + finalizadas recentes)
            boxSessions:      (typeof BoxScan !== 'undefined') ? BoxScan.pruneForSave() : (State.boxSessions || []),
            // v16.13: marcador do backup diario gravado no JSON COMPARTILHADO.
            // Todos os PCs leem a mesma data -> o backup e pedido/feito apenas
            // 1x por dia no sistema inteiro, nao 1x por PC.
            lastAutoBackupDate: State.lastAutoBackupDate || null,
            lastBackupInfo:     State.lastBackupInfo     || null,
            // v16.14: marcador de "derrubar acessos". Quando o admin dispara,
            // grava um timestamp aqui; todos os outros PCs detectam no sync e
            // fazem logout. Guardamos tambem a matricula de quem disparou.
            forceLogout:        State.forceLogout        || null,
        };
    },

    // ================================================================
    // v16.22 — SERIALIZACAO OTIMIZADA DO CATALOGO
    //
    // Problema: _buildPayload() montava o objeto inteiro e o JSON.stringify
    // percorria os ~7.900 itens do componentCatalog a CADA gravacao, mesmo
    // sem nenhuma mudanca no catalogo. Medido: 62ms com catalogo, 9ms sem.
    //
    // Solucao: serializa o catalogo uma unica vez e guarda a string pronta.
    // Nas gravacoes seguintes, injeta a string cacheada no lugar de um
    // marcador. O JSON gravado no disco fica IDENTICO ao de antes — mesma
    // ordem de chaves, mesmo conteudo. Nenhuma mudanca de formato.
    // ================================================================

    // Invalida o cache. Chamar SEMPRE que State.componentCatalog mudar.
    invalidateCatalogCache() {
        State._catalogJSONCache = null;
    },

    _catalogJSON() {
        if (State._catalogJSONCache === null) {
            State._catalogJSONCache = JSON.stringify(State.componentCatalog || []);
        }
        return State._catalogJSONCache;
    },

    // Gera o JSON final do payload reaproveitando o catalogo cacheado.
    _buildPayloadJSON() {
        const MARK = '"__CATALOG_PLACEHOLDER__"';
        const payload = DB._buildPayload();
        const realCatalog = payload.componentCatalog;
        payload.componentCatalog = '__CATALOG_PLACEHOLDER__';

        let json;
        try {
            json = JSON.stringify(payload);
            const idx = json.indexOf(MARK);
            if (idx === -1) throw new Error('marcador do catalogo nao encontrado');
            json = json.slice(0, idx) + DB._catalogJSON() + json.slice(idx + MARK.length);
        } catch (e) {
            // Rede de seguranca: qualquer imprevisto -> volta ao metodo antigo.
            console.warn('[_buildPayloadJSON] fallback para serializacao completa:', e.message);
            payload.componentCatalog = realCatalog;
            json = JSON.stringify(payload);
        }
        return json;
    },

    // save(): enfileira um save em background.
    // Nunca descarta — cada chamada garante que seu estado sera gravado.
    // A fila executa os saves em ordem, um de cada vez.
    // v16.32 — CORRECAO CRITICA: antes, o .catch() ficava no MESMO encadeamento
    // devolvido ao chamador, transformando qualquer falha de gravacao em
    // "sucesso". A devolucao mostrava OK verde sem ter gravado nada.
    // Agora: a FILA continua viva mesmo se um save falhar (catch proprio),
    // mas o CHAMADOR recebe a rejeicao de verdade.
    save(silent = false) {
        if (!State.dbFileHandle) return Promise.resolve();
        State._queueDepth++;
        const attempt = State._writeQueue.then(() => DB._doWrite(silent));
        // ramo interno: so mantem a fila andando, nunca some com o erro do chamador
        State._writeQueue = attempt
            .catch(e => { console.warn('[save queue]', e); })
            .finally(() => { State._queueDepth = Math.max(0, State._queueDepth - 1); });
        return attempt;
    },

    // saveNow(): mesmo que save(), mas cancela o debounce pendente e
    // aguarda a fila completar antes de retornar (comportamento síncrono).
    // v16.32: nao espera mais a fila INTEIRA esvaziar (o loop antigo de ate 5s
    // fazia a devolucao aguardar auto-saves de outras telas). Agora aguarda
    // apenas a propria gravacao e, se ela falhar, tenta 3x rapido.
    // Se as 3 falharem, LANCA o erro — o chamador tem que avisar o operador.
    async saveNow(tentativas = 3) {
        if (!State.dbFileHandle) return;
        clearTimeout(State._saveTimer); // cancela auto-save agendado
        let ultimoErro = null;
        for (let i = 1; i <= tentativas; i++) {
            try {
                await DB.save(false);
                return; // gravou de verdade
            } catch (e) {
                ultimoErro = e;
                console.warn(`[saveNow] tentativa ${i}/${tentativas} falhou:`, e.message);
                if (i < tentativas) await new Promise(r => setTimeout(r, 150 * i));
            }
        }
        throw ultimoErro || new Error('Falha ao gravar no banco de dados');
    },

    // ================================================================
    // _doWrite — nucleo de gravacao com protecao total contra race condition.
    //
    // CORRECAO 1 (race condition): SEMPRE rele o arquivo do disco antes de
    // gravar, independente do lastModified. Assim, se outro PC gravou entre
    // nossa ultima leitura e agora, incorporamos os dados dele antes de escrever.
    //
    // CORRECAO 2 (lastModified falso): apos gravar, chama getFile() para obter
    // o timestamp real definido pelo SO — nao usamos Date.now() como estimativa.
    //
    // CORRECAO 3 (gap SMB): mantem gap minimo de 50ms entre writes para redes
    // SMB/UNC, onde o lock do arquivo demora mais para ser liberado.
    // ================================================================
    // ================================================================
    // _doWrite (v17) — grava POR DOMINIO, somente o que mudou.
    //
    // Antes: montava o JSON inteiro (~800KB, catalogo incluso) e reescrevia
    // o arquivo a cada save. Agora o Store compara cada dominio com o que ja
    // esta no disco e grava apenas os arquivos realmente alterados — um save
    // sem mudanca nenhuma nao faz NENHUMA escrita em disco.
    //
    // O read-before-write continua existindo (e o que elimina o race condition
    // entre PCs), mas custa a leitura de 1KB de indice em vez do arquivo todo.
    // ================================================================
    async _doWrite(silent) {
        DB._setSyncStatus('writing', 'Salvando...' + (State._queueDepth > 1 ? ' (' + State._queueDepth + ' na fila)' : ''));
        const t0 = performance.now();

        try {
            // Gap minimo entre writes em rede SMB/UNC (lock demora a liberar)
            const msSinceLastWrite = Date.now() - (State._lastWriteTime || 0);
            if (msSinceLastWrite < 50) {
                await new Promise(r => setTimeout(r, 50 - msSinceLastWrite));
            }

            // ==========================================================
            // READ -> MERGE -> GRAVA, com nova tentativa em caso de conflito.
            //
            // O Store recusa gravar se outro PC tocou no mesmo dominio entre
            // a nossa leitura e a escrita (ele compara o token do indice).
            // Quando isso acontece nao perdemos nada: lemos de novo, refazemos
            // o merge com o dado do colega e tentamos outra vez.
            //
            // Sem este laco, a devolucao de quem gravou primeiro era apagada
            // pela de quem gravou depois.
            // ==========================================================
            let escritos = [];
            const MAX_TENTATIVAS = 5;
            for (let t = 1; ; t++) {
                try {
                    const parcial = await Store.lerMudancas();
                    if (parcial) DB._mergeFromDisk(parcial);
                } catch (readErr) {
                    console.warn('[_doWrite] nao conseguiu ler antes de gravar:', readErr.message);
                    throw new Error('read-before-write falhou: ' + readErr.message);
                }

                try {
                    escritos = await Store.gravar(DB._buildPayload());
                    break;
                } catch (e) {
                    if (!e.conflito) throw e;
                    if (t >= MAX_TENTATIVAS) {
                        // 5 colisoes seguidas: a rede esta muito disputada.
                        // Propaga para o operador refazer, NUNCA grava por cima.
                        throw new Error('nao foi possivel salvar: outro PC alterou '
                            + (e.dominios || []).join(', ') + ' ao mesmo tempo. Refaca a operacao.');
                    }
                    console.warn(`[_doWrite] conflito com outro PC (${e.dominios}), tentativa ${t}/${MAX_TENTATIVAS}`);
                    DB._setSyncStatus('writing', 'Outro PC gravou junto — refazendo...');
                    // espera curta e aleatoria: sem isso os dois PCs colidem
                    // de novo no mesmo instante, indefinidamente
                    await new Promise(r => setTimeout(r, 60 + Math.random() * 140 * t));
                }
            }

            State._lastWriteTime   = Date.now();
            State.lastModifiedTime = Store._idxMtime || Date.now();
            if (escritos.length) State._ultimaAtividade = Date.now();

            // Nada mudou de verdade: nenhum arquivo foi tocado.
            if (!escritos.length) {
                DB._setSyncStatus('ok', 'Sincronizado');
                State._saveErrorCount = 0;
                return;
            }

            const ms = Math.round(performance.now() - t0);
            if (!silent) UI.showSaveIndicator();
            DB._setSyncStatus('ok', `Salvo (${ms}ms) — ${escritos.join(', ')}`);
            State._saveErrorCount = 0;
        } catch (e) {
            console.error('[DB._doWrite]', e);
            State._saveErrorCount = (State._saveErrorCount || 0) + 1;

            // Detecta erros de permissao/cache do FileSystem Access API
            // Esses erros NAO se resolvem com retry — exigem reconexao manual
            const msg = (e.message || '').toLowerCase();
            const isPermissionError = msg.includes('state cache')
                || msg.includes('permission')
                || msg.includes('not allowed')
                || msg.includes('security error')
                || msg.includes('handle is closed')
                || msg.includes('activationless')
                || e.name === 'SecurityError'
                || e.name === 'NotAllowedError';

            if (isPermissionError) {
                console.warn('[DB] Permissao expirada no _doWrite, tentando renovar...');
                const renewed = await DB._tryRenewPermission();
                if (renewed) {
                    console.log('[DB] Permissao renovada.');
                    if (silent) setTimeout(() => DB.save(true), 200);
                } else {
                    DB._setSyncStatus('error', 'Aguardando permissao — salve novamente em instantes');
                    if (silent) setTimeout(() => DB.save(true), 3000);
                }
                // v16.32: ESTA gravacao nao aconteceu. O chamador precisa saber.
                // (o retry automatico so vale para o auto-save de fundo)
                throw e;
            }

            // Erro de rede/arquivo: retry com limite de 5 tentativas
            UI.showSaveIndicator('<i class="fas fa-exclamation-triangle"></i> Erro ao salvar. Tentando novamente...', true);
            DB._setSyncStatus('error', 'Falha (' + State._saveErrorCount + 'x) — ' + (e.message?.slice(0,40) || 'erro'));

            if (State._saveErrorCount >= 5) {
                // Limite atingido: para o retry, avisa e aguarda intervencao
                State._saveErrorCount = 0;
                DB._setSyncStatus('error', 'Erro persistente — verifique a rede');
                UI.showSaveIndicator('<i class="fas fa-exclamation-triangle"></i> Nao foi possivel salvar. Verifique a rede.', true);
                Toast.error('Nao foi possivel salvar apos 5 tentativas. Verifique a conexao de rede.', 8000);
                console.error('[DB] Abortando retries apos 5 falhas consecutivas.');
                throw e; // v16.32: propaga — NAO reagenda mais retry
            }

            // Retry automatico com backoff so para o auto-save de fundo (silent).
            // As operacoes criticas fazem o proprio retry dentro de saveNow().
            if (silent) {
                const baseDelay = Math.min(200 * Math.pow(2, State._saveErrorCount - 1), 3000);
                const jitter    = Math.random() * 150;
                setTimeout(() => DB.save(true), baseDelay + jitter);
            }

            // v16.32: sempre propaga. Quem chamou precisa saber que NAO gravou.
            throw e;

        } finally {
            // Nada a fazer: a fila Promise cuida da sequencia automaticamente
        }
    },

    // Merge inteligente: incorpora dados do disco sem perder mudancas locais.
    // inventory/validLocations/users/adminConfig: disco ganha (fonte de verdade fisica)
    // checkoutHistory/logs: merge por id, removendo duplicatas
    _mergeFromDisk(diskData) {
        // FIX v16.16 (BUG CRITICO DE ACURACIDADE): o JSON e salvo no formato
        // compacto 'slots' (v13.3), mas este merge so entendia o formato antigo
        // (inventory/validLocations). Resultado: no read-before-write, o estoque
        // do disco era IGNORADO e o estado local (desatualizado) era gravado por
        // cima — itens baixados no comparador "voltavam" para o estoque geral.
        //
        // Solucao: MERGE DE 3 VIAS por slot (car+loc):
        //   base   = ultimo estado do disco que este PC conhecia (lastKnownFileContent)
        //   local  = estado atual em memoria (pode conter a baixa recem-feita)
        //   remoto = estado atual do disco (pode conter mudancas de outros PCs)
        // Regra por slot: se o LOCAL mudou em relacao a BASE, o local ganha
        // (preserva a baixa que este PC acabou de fazer); caso contrario o
        // DISCO ganha (incorpora baixas/devolucoes feitas em outros PCs).
        if (diskData.slots) {
            let baseSlots = null;
            try {
                const b = JSON.parse(Store._brutoAnterior.estoque || 'null');
                if (b && b.slots) baseSlots = b.slots;
            } catch (_) { baseSlots = null; }

            const keyOf = s => s.c + '|' + s.l;
            const sigOf = s => s ? `${s.k || ''}|${s.q || 0}|${s.t || 0}` : '__VAZIO__';

            const baseMap = {};
            (baseSlots || []).forEach(s => { baseMap[keyOf(s)] = s; });
            const remoteMap = {};
            diskData.slots.forEach(s => { remoteMap[keyOf(s)] = s; });

            // Constroi o mapa LOCAL no mesmo formato de slot
            const invMap = {};
            (State.inventory || []).forEach(i => { if (i.car && i.loc) invMap[i.car + '|' + i.loc] = i; });
            const localMap = {};
            (State.validLocations || []).forEach(vl => {
                const k   = vl.car + '|' + vl.loc;
                const inv = invMap[k];
                localMap[k] = (inv && inv.code)
                    ? { c: vl.car, l: vl.loc, k: inv.code, q: inv.qty || 0, t: inv.timestamp || 0 }
                    : { c: vl.car, l: vl.loc };
            });

            const allKeys = new Set([...Object.keys(remoteMap), ...Object.keys(localMap)]);
            const merged  = [];
            allKeys.forEach(k => {
                const L = localMap[k], R = remoteMap[k], B = baseMap[k];
                let win;
                if (baseSlots === null)            win = R || L; // sem base conhecida: disco ganha
                else if (sigOf(L) !== sigOf(B))    win = L;      // mudanca local -> local ganha
                else                               win = R;      // sem mudanca local -> disco ganha
                if (win) merged.push(win);
            });

            State.validLocations = merged.map(s => ({ car: s.c, loc: s.l, id: s.c + '_' + s.l }));
            State.inventory      = merged
                .filter(s => s.k)
                .map(s => ({ id: s.c + '_' + s.l, car: s.c, loc: s.l, code: s.k, qty: s.q || 0, timestamp: s.t || 0 }));
        
            // v16.17: reaplica os armarios PTH apos o merge
            if (typeof PTHCabinets !== 'undefined') PTHCabinets.ensure();
        }
        if (diskData.inventory)        State.inventory        = diskData.inventory;
        if (diskData.validLocations)   State.validLocations   = diskData.validLocations;
        if (diskData.users)            State.users            = diskData.users;
        if (diskData.adminConfig)      State.adminConfig      = diskData.adminConfig;
        if (diskData.componentCatalog) { State.componentCatalog = diskData.componentCatalog; DB.invalidateCatalogCache(); }
        // v17.03: familias e limites vem do disco (o admin pode ter mexido em outro PC)
        if (Array.isArray(diskData.materialFamilies)) { State.materialFamilies = diskData.materialFamilies; Familias.invalidar(); }
        if (diskData.stockLimits)                       State.stockLimits      = diskData.stockLimits;
        if (diskData.unclassified)                    { State.unclassified     = diskData.unclassified; Familias.invalidar(); }
        // v16.29: sessoes de leitura de caixas — vence a versao mais recente (updatedAt).
        if (diskData.boxSessions) {
            const byId = {};
            (State.boxSessions || []).forEach(x => { byId[x.id] = x; });
            diskData.boxSessions.forEach(R => {
                const L = byId[R.id];
                if (!L || (R.updatedAt || 0) > (L.updatedAt || 0)) byId[R.id] = R;
            });
            // a sessao aberta NESTE PC nunca e sobrescrita durante a leitura
            if (State._boxActiveId && byId[State._boxActiveId]) {
                const mine = (State.boxSessions || []).find(x => x.id === State._boxActiveId);
                if (mine) byId[State._boxActiveId] = mine;
            }
            State.boxSessions = Object.values(byId);
        }

        // v16.28: consolidado semanal — merge por MAIOR valor entre disco e local,
        // assim nenhum PC apaga os numeros gravados por outro.
        if (diskData.weeklyStats) {
            State.weeklyStats = State.weeklyStats || {};
            Object.keys(diskData.weeklyStats).forEach(k => {
                const R = diskData.weeklyStats[k];
                const L = State.weeklyStats[k];
                if (!L) { State.weeklyStats[k] = R; return; }
                Object.keys(R.u || {}).forEach(mat => {
                    const ru = R.u[mat], lu = L.u[mat];
                    if (!lu) { L.u[mat] = ru; return; }
                    L.u[mat] = {
                        n: lu.n || ru.n,
                        d: Math.max(lu.d||0, ru.d||0),
                        b: Math.max(lu.b||0, ru.b||0),
                        l: Math.max(lu.l||0, ru.l||0),
                        m: Math.max(lu.m||0, ru.m||0),
                    };
                    L.u[mat].p = L.u[mat].d + L.u[mat].b;
                });
            });
            try { WeeklyStats.prune(); } catch (e) {}
        }
        if (diskData.lastAutoBackupDate) State.lastAutoBackupDate = diskData.lastAutoBackupDate;
        if (diskData.lastBackupInfo)     State.lastBackupInfo     = diskData.lastBackupInfo;

        // v16.14: derrubar acessos. Se o disco tem um marcador de forceLogout mais
        // recente do que o momento em que este PC entrou, e nao foi este PC que
        // disparou, faz logout imediato.
        if (diskData.forceLogout) {
            State.forceLogout = diskData.forceLogout;
            const fl = diskData.forceLogout;
            const myMat = State.currentUser ? State.currentUser.matricula : null;
            const iAmSource = fl.by && myMat && String(fl.by) === String(myMat);
            const isNew = fl.ts && fl.ts > (State.sessionStartTime || 0);
            if (isNew && !iAmSource && !State._beingKicked && State.currentUser) {
                State._beingKicked = true;
                try { Toast.warn('Um administrador encerrou os acessos ao sistema. Voce sera desconectado.', 4000); } catch (e) {}
                setTimeout(function() {
                    try { clearTimeout(State._syncTimer); } catch (e) {}
                    try { clearTimeout(State._saveTimer); } catch (e) {}
                    State.currentUser  = null;
                    State.dbFileHandle = null;
                    location.reload();
                }, 1500);
            }
        }

        if (diskData.checkoutHistory) {
            // Janela de 7 dias: consistente com _buildPayload. O historico longo
            // e preservado no BACKUP DIARIO de seguranca (Excel completo, 1x/dia),
            // que captura cada registro varias vezes antes de sair desta janela.
            const CUT_7D = Date.now() - Store.DIAS_MEMORIA * 86400 * 1000;
            const diskIds = new Set((diskData.checkoutHistory || []).map(h => String(h.id)));
            const local   = (State.checkoutHistory || []).filter(h => !diskIds.has(String(h.id)));
            State.checkoutHistory = [...local, ...(diskData.checkoutHistory || [])]
                .filter(h => h.timestamp >= CUT_7D)
                .sort((a, b) => b.timestamp - a.timestamp);
        }
        if (diskData.logs) {
            const diskKeys = new Set((diskData.logs || []).map(l => `${l.timestamp}_${l.matricula}`));
            const local    = (State.logs || []).filter(l => !diskKeys.has(`${l.timestamp}_${l.matricula}`));
            State.logs = [...local, ...(diskData.logs || [])]
                .sort((a, b) => b.timestamp - a.timestamp).slice(0, 200);
        }
    },


    // scheduleSave: auto-save passivo em background (click/change globais).
    // Usa debounce de 800ms — nao precisa ser imediato, e so backup.
    // Operacoes criticas chamam saveNow() diretamente.
    scheduleSave() {
        clearTimeout(State._saveTimer);
        // Com a fila Promise, nao precisa checar se esta gravando:
        // o novo save simplesmente entra no final da fila
        State._saveTimer = setTimeout(() => DB.save(true), 800);
    },

    // ================================================================
    // guard(): checa se o BD esta conectado antes de operacoes criticas.
    // Retorna true se pode prosseguir, false se bloqueado.
    // Uso: if (!DB.guard()) return;
    // ================================================================
    guard(actionName = 'esta operacao') {
        if (!State.dbFileHandle) {
            Toast.warn('Banco de dados nao conectado. Selecione a pasta do sistema primeiro.');
            return false;
        }
        return true;
    },

    _showLock(errorMsg) { /* overlay removido */ },

    _hideLock() { /* overlay removido */ },

    // Tenta renovar a permissão silenciosamente usando requestPermission().
    // Retorna true se conseguiu, false se falhou (ex: sem interação do usuário).
    // Tenta renovar a permissao da PASTA silenciosamente (requestPermission).
    // Uma unica permissao cobre todos os arquivos do banco.
    async _tryRenewPermission() {
        const dh = State.dbDirHandle;
        if (!dh) return false;
        try {
            const perm = await dh.requestPermission({ mode: 'readwrite' });
            if (perm === 'granted') {
                State.isConnected = true;
                DB._setSyncStatus('ok', 'Permissao renovada');
                return true;
            }
            return false;
        } catch (e) {
            console.warn('[_tryRenewPermission]', e.message);
            return false;
        }
    },

    // ============================================================
    // Reconexao a PASTA do banco, sem recarregar a pagina.
    // ============================================================
    async reconnect() {
        const reconnBtn = document.getElementById('dbLockReconnecting');
        if (reconnBtn) reconnBtn.style.display = 'block';

        try {
            if (!window.showDirectoryPicker) {
                Toast.error('Seu navegador nao suporta a File System Access API. Use Chrome ou Edge.');
                if (reconnBtn) reconnBtn.style.display = 'none';
                return;
            }

            clearTimeout(State._syncTimer);   // para o sync antes de trocar o handle

            const dh = await window.showDirectoryPicker({ id: 'spare-parts-db', mode: 'readwrite' });
            State.dbDirHandle = dh;
            await DB._abrirPasta(dh);

            State.isConnected     = true;
            State._syncErrorCount = 0;
            Store.lembrarPasta(dh);

            DB._hideLock();
            DB._setSyncStatus('ok', 'Reconectado');
            DB.startAutoSync();

            UI.triggerRefresh(true);
            Toast.success('Pasta do banco de dados reconectada com sucesso!');

        } catch (e) {
            if (reconnBtn) reconnBtn.style.display = 'none';
            if (e.name !== 'AbortError') Toast.error('Falha ao reconectar: ' + e.message);
        }
    },

    // ============================================================
    // MEMORIA DA PASTA — delegada ao Store (IndexedDB deste PC).
    // E o que permite reabrir o sistema com ZERO cliques: o navegador
    // lembra a pasta autorizada e o sync sobe sozinho.
    // ============================================================
    _handleGuardar(dh) { return Store.lembrarPasta(dh);  },
    _handleLembrado()  { return Store.pastaLembrada();   },
    _handleEsquecer()  { return Store.esquecerPasta();   },

    // Mostra/esconde o botao verde "Reconectar" da tela de conexao
    _reconnBtnLoginUI(mostrar) {
        const btn = document.getElementById('btnReconnectDb');
        if (btn) btn.style.display = mostrar ? 'block' : 'none';
    },

    // ============================================================
    // _abrirPasta: conecta o Store na pasta, migra o formato antigo se for
    // o caso, e carrega TUDO para a memoria no mesmo formato de sempre.
    // ============================================================
    async _abrirPasta(dh) {
        const r = await Store.conectar(dh);

        if (r.estado === 'migrado') {
            Toast.success(
                `Banco convertido para o formato de pasta (${r.registros} movimentos preservados). ` +
                `O arquivo antigo continua na pasta como _MIGRADO_*.bak.`, 10000);
        } else if (r.estado === 'novo') {
            // Pasta vazia: cria a estrutura com o administrador padrao.
            const hash = await Security.hashPassword('admin123');
            State.users       = [{ nome: 'Administrador', matricula: 'ADMIN', passwordHash: hash, isAdmin: true }];
            State.adminConfig = { passwordHash: '', attempts: 0 };
            State.inventory = []; State.validLocations = [];
            State.logs = [];      State.checkoutHistory = [];
            await Store.gravar(DB._buildPayload());
            Toast.warn('Banco de dados novo criado nesta pasta. Entre com a matricula ADMIN e a senha admin123.', 12000);
        }

        // Mesmo formato de objeto do JSON antigo -> _applyParsed nao mudou.
        DB._applyParsed(await Store.montarPayloadCompleto());

        // indice.json e o "batimento" do banco: e sempre o ULTIMO arquivo
        // gravado, entao vigiar o lastModified dele detecta qualquer mudanca.
        // Mante-lo em State.dbFileHandle preserva todos os guards do sistema
        // (`if (!State.dbFileHandle)`) sem alterar uma linha dos outros modulos.
        State.dbDirHandle      = dh;
        State.dbFileHandle     = await Store._dados.getFileHandle(Store.INDICE, { create: true });
        State.lastModifiedTime = (await State.dbFileHandle.getFile()).lastModified;
        Store._idxMtime        = State.lastModifiedTime;
    },

    // Logica comum a 1a conexao e a reconexao, com a pasta ja escolhida.
    async _finishInitialConnect() {
        await DB._abrirPasta(State.dbDirHandle);

        State.isConnected = true;
        DB.startAutoSync();
        DB._setSyncStatus('ok', 'Conectado');
        Store.lembrarPasta(State.dbDirHandle);   // memoriza para a proxima vez
        DB._reconnBtnLoginUI(false);
        try { AutoBackup.reconectar(); } catch (_) {}
        UI.unlockLoginStep();
    },

    // Reconexao de 1 clique a partir do botao verde da tela de login
    async reconnectFromMemory() {
        const dh = await Store.pastaLembrada();
        if (!dh) { DB._reconnBtnLoginUI(false); return; }
        try {
            let perm = await dh.queryPermission({ mode: 'readwrite' });
            if (perm !== 'granted') perm = await dh.requestPermission({ mode: 'readwrite' });
            if (perm !== 'granted') return;   // usuario negou — botao continua visivel
            State.dbDirHandle = dh;
            await DB._finishInitialConnect();
        } catch (e) {
            // pasta movida/renomeada/rede fora: esquece e volta ao fluxo normal
            await Store.esquecerPasta();
            DB._reconnBtnLoginUI(false);
            const msg = document.getElementById('dbErrorMsg');
            if (msg) msg.textContent = 'Nao foi possivel reconectar (pasta movida ou rede fora). Selecione a pasta novamente.';
            Toast.warn('Nao foi possivel reconectar. Selecione a pasta do sistema novamente.');
        }
    },

    // Roda na abertura da pagina: reconecta sozinho ou exibe o botao verde
    async tryAutoReconnect() {
        if (!window.showDirectoryPicker || !window.indexedDB) return;
        const dh = await Store.pastaLembrada();
        if (!dh) return;                        // nunca conectou: fluxo normal
        try {
            const perm = await dh.queryPermission({ mode: 'readwrite' });
            if (perm === 'granted') {
                State.dbDirHandle = dh;
                await DB._finishInitialConnect();   // ZERO cliques
                return;
            }
        } catch (e) { /* deixa o botao tentar */ }
        DB._reconnBtnLoginUI(true);             // 1 clique
    },

    // ============================================================
    // PRIMEIRA CONEXAO — o usuario escolhe a PASTA do sistema.
    // Uma unica autorizacao cobre TODOS os arquivos do banco: nao existe
    // "autorizar cada JSON". Depois disso este PC nunca mais pergunta.
    // ============================================================
    async loadFile() {
        try {
            if (!window.showDirectoryPicker) {
                Toast.error('Seu navegador nao suporta a File System Access API. Use Chrome ou Edge.');
                return;
            }

            const dh = await window.showDirectoryPicker({ id: 'spare-parts-db', mode: 'readwrite' });

            const perm = await dh.requestPermission({ mode: 'readwrite' });
            if (perm !== 'granted') {
                const msg = document.getElementById('dbErrorMsg');
                if (msg) msg.textContent = 'Permissao de gravacao negada para a pasta.';
                return;
            }

            State.dbDirHandle = dh;
            await DB._finishInitialConnect();

        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error(e);
                const msg = document.getElementById('dbErrorMsg');
                if (msg) msg.textContent = 'Erro ao abrir a pasta: ' + e.message;
            }
        }
    },

    // ============================================================
    // BANCO NOVO — cria a estrutura dentro de uma pasta vazia.
    // (Se a pasta ja tiver um JSON antigo, _abrirPasta migra em vez de criar.)
    // ============================================================
    async createNew() {
        try {
            if (!window.showDirectoryPicker) {
                Toast.error('Seu navegador nao suporta a File System Access API. Use Chrome ou Edge.');
                return;
            }

            const dh = await window.showDirectoryPicker({ id: 'spare-parts-db', mode: 'readwrite' });
            const perm = await dh.requestPermission({ mode: 'readwrite' });
            if (perm !== 'granted') { Toast.error('Permissao de gravacao negada para a pasta.'); return; }

            State.dbDirHandle = dh;
            State.inventory = []; State.validLocations = [];
            State.logs = [];      State.checkoutHistory = [];

            await DB._finishInitialConnect();
            Toast.success('Estrutura do banco criada na pasta escolhida.', 6000);

        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error(e);
                Toast.error('Erro ao criar o banco: ' + e.message);
            }
        }
    },
};
