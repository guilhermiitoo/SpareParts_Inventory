// ==========================================================================
// SPARE PARTS - 40-backup.js (extraido do v16.32)
// ==========================================================================

// ============================================================================
// MODULO: BACKUP DIARIO DE SEGURANCA (salvamento extra, direto na pasta de rede)
// ----------------------------------------------------------------------------
// LOGICA:
//   - Roda 1x por dia, apos as 07:00, no PRIMEIRO login depois desse horario.
//   - Salva um .xlsx (estoque + historico + logs COMPLETOS) DIRETO na pasta de
//     rede vinculada (handle proprio, memorizado no IndexedDB deste PC).
//   - NAO abre picker, NAO apaga nada do JSON. E uma copia EXTRA de seguranca.
//   - Marca a data dentro do proprio arquivo do dia (nome com a data) + no State,
//     entao nao repete no mesmo dia mesmo que varias pessoas loguem.
//   - Se a pasta nao estiver vinculada / tiver sido movida ou renomeada,
//     exibe um ALERTA no topo da tela pedindo para vincular de novo.
// ============================================================================
const AutoBackup = {
    _stateKey: 'lastAutoBackupDate',          // ultima data salva (YYYY-MM-DD)
    PREFIXO: 'BACKUP_SEGURANCA_SPARE_PARTS_', // prefixo do arquivo diario na pasta

    _hoje() { return new Date().toISOString().slice(0, 10); }, // YYYY-MM-DD local-ish

    _alreadyDoneToday() {
        return State[AutoBackup._stateKey] === AutoBackup._hoje();
    },

    _pastSevenAM() {
        return new Date().getHours() >= 7;
    },

    // ===== HANDLE DA PASTA DE SEGURANCA (memorizado por PC no IndexedDB) =====
    _dirHandle: null,
    _IDB_KEY: 'segdir',   // chave propria no mesmo IndexedDB (nao colide com 'xlsxdir')

    async _dirGuardar(dh) {
        try {
            const db = await DB._idbAbrir();
            await new Promise((res, rej) => {
                const tx = db.transaction(DB._IDB_STORE, 'readwrite');
                tx.objectStore(DB._IDB_STORE).put(dh, AutoBackup._IDB_KEY);
                tx.oncomplete = res; tx.onerror = () => rej(tx.error);
            });
        } catch (e) {}
    },
    async _dirLembrado() {
        try {
            const db = await DB._idbAbrir();
            return await new Promise((res, rej) => {
                const req = db.transaction(DB._IDB_STORE, 'readonly').objectStore(DB._IDB_STORE).get(AutoBackup._IDB_KEY);
                req.onsuccess = () => res(req.result || null);
                req.onerror   = () => rej(req.error);
            });
        } catch (e) { return null; }
    },
    async _dirEsquecer() {
        try {
            const db = await DB._idbAbrir();
            await new Promise((res, rej) => {
                const tx = db.transaction(DB._IDB_STORE, 'readwrite');
                tx.objectStore(DB._IDB_STORE).delete(AutoBackup._IDB_KEY);
                tx.oncomplete = res; tx.onerror = () => rej(tx.error);
            });
        } catch (e) {}
    },

    // ---- pega o handle da PASTA DE SEGURANCA e valida acesso ----
    async _obterPastaValida() {
        let dh = AutoBackup._dirHandle;
        if (!dh) { try { dh = await AutoBackup._dirLembrado(); } catch (_) {} }
        if (!dh) return null;
        try {
            let perm = await dh.queryPermission({ mode: 'readwrite' });
            if (perm !== 'granted') perm = await dh.requestPermission({ mode: 'readwrite' });
            if (perm !== 'granted') return null;       // sem permissao concedida
            // Testa se a pasta ainda existe / esta acessivel (pode ter sido movida)
            await dh.getFileHandle(AutoBackup.PREFIXO + '_probe.tmp', { create: true })
                    .then(h => dh.removeEntry(h.name).catch(() => {}))
                    .catch(() => { throw new Error('inacessivel'); });
            AutoBackup._dirHandle = dh;                 // garante em memoria
            return dh;
        } catch (e) {
            return null;                               // pasta sumiu / sem acesso
        }
    },

    // ---- status visual do card da Pasta 2 ----
    statusUI() {
        const txt  = document.getElementById('seg-pasta-status');
        const btnV = document.getElementById('btn-vincular-seg');
        const btnD = document.getElementById('btn-desvincular-seg');
        if (!txt) return;
        if (AutoBackup._dirHandle) {
            txt.innerHTML = '<i class="fas fa-folder-open" style="color:#15803d;"></i> Pasta de seguranca vinculada: <b>' + AutoBackup._dirHandle.name + '</b>';
            txt.style.color = '#15803d';
            if (btnV) btnV.style.display = 'none';
            if (btnD) btnD.style.display = '';
        } else {
            txt.innerHTML = '<i class="fas fa-folder-open"></i> Nenhuma pasta vinculada. O backup de seguranca nao esta ativo.';
            txt.style.color = '#94a3b8';
            if (btnV) btnV.style.display = '';
            if (btnD) btnD.style.display = 'none';
        }
    },

    // ---- vincular a pasta de seguranca (clique manual no card) ----
    async vincularPasta() {
        if (!window.showDirectoryPicker) { Toast.warn('Use Chrome ou Edge para vincular a pasta de rede.'); return; }
        try {
            const dh = await window.showDirectoryPicker({ id: 'seg-spare-parts', mode: 'readwrite' });
            let perm = await dh.queryPermission({ mode: 'readwrite' });
            if (perm !== 'granted') perm = await dh.requestPermission({ mode: 'readwrite' });
            if (perm !== 'granted') { Toast.warn('Permissao negada para a pasta.'); return; }
            AutoBackup._dirHandle = dh;
            await AutoBackup._dirGuardar(dh);
            AutoBackup.statusUI();
            AutoBackup.esconderAlerta();
            Toast.success('Pasta de seguranca vinculada: ' + dh.name);
        } catch (e) { if (e.name !== 'AbortError') console.error('[AutoBackup] vincular:', e); }
    },

    // ---- desvincular a pasta de seguranca ----
    async desvincularPasta() {
        if (!confirm('Desvincular a pasta de backup de seguranca? O backup diario deixara de ser salvo.')) return;
        AutoBackup._dirHandle = null;
        await AutoBackup._dirEsquecer();
        AutoBackup.statusUI();
    },

    // ---- reconexao automatica (chamada no boot) ----
    async reconectar() {
        let dh = await AutoBackup._dirLembrado();

        // v17: se ninguem vinculou uma pasta a mao, usa <pasta do banco>/backups.
        // Como a permissao ja foi dada para a pasta inteira, isso funciona sem
        // nenhum clique extra — some o passo manual de "vincular pasta".
        if (!dh) {
            try {
                if (typeof Store !== 'undefined' && Store._raiz) {
                    dh = await Store.pastaBackup();
                    if (dh) AutoBackup._dirGuardar(dh);
                }
            } catch (e) {}
        }

        if (!dh) { AutoBackup.statusUI(); return; }
        try {
            const perm = await dh.queryPermission({ mode: 'readwrite' });
            if (perm === 'granted') AutoBackup._dirHandle = dh;
        } catch (e) {}
        AutoBackup.statusUI();
    },

    // ---- alerta no topo da tela ----
    mostrarAlerta(msg) {
        const box = document.getElementById('backupDiarioAlerta');
        if (!box) return;
        if (msg) {
            const m = document.getElementById('backupDiarioAlertaMsg');
            if (m) m.textContent = msg;
        }
        box.style.display = 'block';
    },
    esconderAlerta() {
        const box = document.getElementById('backupDiarioAlerta');
        if (box) box.style.display = 'none';
    },

    // ---- botao do alerta: revincula a pasta de seguranca ----
    async vincularPastaAlerta() {
        await AutoBackup.vincularPasta();
        const dh = await AutoBackup._obterPastaValida();
        if (dh) {
            AutoBackup.esconderAlerta();
            Toast.success('Pasta revinculada. Backup diario de seguranca reativado.');
            await AutoBackup.checkAndRun();            // tenta rodar o de hoje se faltar
        }
    },

    // ---- chamado no login: decide se roda o backup do dia ----
    async checkAndRun() {
        if (!State.dbFileHandle) return;               // sem banco conectado
        if (AutoBackup._alreadyDoneToday()) { AutoBackup.esconderAlerta(); return; } // ja foi hoje
        if (!AutoBackup._pastSevenAM()) { AutoBackup.esconderAlerta(); return; }     // antes das 07:00

        const dh = await AutoBackup._obterPastaValida();
        if (!dh) {
            // Pasta nao vinculada ou perdida -> alerta no topo, nao roda
            AutoBackup.mostrarAlerta('A pasta de rede do backup diario nao esta vinculada ou foi movida/renomeada. Vincule novamente para retomar a copia automatica de seguranca e evitar perda de dados.');
            return;
        }

        AutoBackup.esconderAlerta();
        console.log('[AutoBackup] Rodando backup diario de seguranca na pasta...');
        await AutoBackup.run(true);                     // silencioso
    },

    // ---- monta o workbook completo (snapshot integral, sem cortar nada) ----
    _montarWorkbook(histCompleto) {
        const wb = XLSX.utils.book_new();

        const invRows = (State.inventory || []).map(i => ({
            Carro: i.car, Posicao: i.loc, Codigo: i.code, Quantidade: i.qty,
            UltimaMovimentacao: i.timestamp ? new Date(i.timestamp).toLocaleString('pt-BR') : '',
        }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(invRows.length ? invRows : [{ info: 'Estoque vazio' }]), 'Estoque');

        // v17: o historico do backup vem do ARQUIVO (que guarda tudo), nao mais
        // so da janela de 7 dias que fica em memoria. Se a leitura falhar, cai
        // para a memoria — o backup nunca deixa de ser gerado por causa disso.
        const histFonte = (histCompleto && histCompleto.length) ? histCompleto : (State.checkoutHistory || []);
        const histRows = histFonte.map(h => ({
            ID: h.id, Tipo: h.type, Usuario: h.user, Matricula: h.matricula,
            DataHora: new Date(h.timestamp).toLocaleString('pt-BR'),
            WO: h.config?.wo || '',
            Itens: (h.removedItems || h.returnedItems || []).map(i => `${i.code}(${i.car}-${i.loc})`).join('; '),
        }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(histRows.length ? histRows : [{ info: 'Sem historico' }]), 'Historico');

        const logRows = (State.logs || []).map(l => ({
            Matricula: l.matricula, Nome: l.nome, Acao: l.action,
            DataHora: new Date(l.timestamp).toLocaleString('pt-BR'), Detalhes: l.details || '',
        }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(logRows.length ? logRows : [{ info: 'Sem logs' }]), 'Logs');

        return wb;
    },

    // ---- escreve o arquivo do dia DIRETO na pasta (atomico: .tmp -> rename) ----
    async _gravarNaPasta(dh, fileName, blob) {
        const tmpName = fileName + '.tmp';
        const tmp = await dh.getFileHandle(tmpName, { create: true });
        const w = await tmp.createWritable();
        await w.write(blob);
        await w.close();
        // Le o tmp e regrava no nome final, depois remove o tmp (rename atomico)
        const finalH = await dh.getFileHandle(fileName, { create: true });
        const fw = await finalH.createWritable();
        await fw.write(blob);
        await fw.close();
        await dh.removeEntry(tmpName).catch(() => {});
    },

    // ---- execucao do backup diario ----
    // silent=true: automatico no login. silent=false: botao manual.
    async run(silent = false) {
        if (!window.XLSX) { Toast.warn('Biblioteca XLSX nao carregada. Backup cancelado.'); return; }

        const today    = AutoBackup._hoje();
        const fileName = AutoBackup.PREFIXO + today + '.xlsx';

        const dh = await AutoBackup._obterPastaValida();
        if (!dh) {
            AutoBackup.mostrarAlerta('A pasta de rede do backup diario nao esta vinculada ou foi movida/renomeada. Vincule novamente para retomar a copia automatica de seguranca.');
            if (!silent) Toast.error('Nenhuma pasta de rede vinculada. Vincule a pasta no alerta no topo da tela.', 6000);
            return;
        }

        // Ja existe o arquivo de hoje na pasta? entao nao repete.
        try {
            await dh.getFileHandle(fileName, { create: false });
            State[AutoBackup._stateKey] = today;       // sincroniza o marcador
            try { await DB.saveNow(); } catch (_) {}   // grava no JSON: todos os PCs ficam sabendo
            AutoBackup.esconderAlerta();
            if (!silent) Toast.info('O backup de seguranca de hoje ja existe na pasta.', 5000);
            console.log('[AutoBackup] Backup de hoje ja existe:', fileName);
            return;
        } catch (_) { /* nao existe -> segue e cria */ }

        try {
            if (!silent) Toast.info('Gerando backup diario de seguranca...', 4000);

            // Le TODO o historico do arquivo (antes so existiam os 7 dias da memoria)
            let histCompleto = null;
            try {
                if (typeof Store !== 'undefined' && Store._mov) {
                    histCompleto = await Store.lerHistoricoPeriodo(0, Date.now());
                }
            } catch (e) { console.warn('[AutoBackup] historico completo indisponivel:', e.message); }

            const wb       = AutoBackup._montarWorkbook(histCompleto);
            const xlsxData = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const blob     = new Blob([xlsxData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

            await AutoBackup._gravarNaPasta(dh, fileName, blob);

            State[AutoBackup._stateKey] = today;        // marca como feito hoje
            // Registra no JSON compartilhado ONDE/QUANDO/QUEM fez o backup do dia.
            // Assim qualquer PC que abrir o sistema ve que o backup ja foi feito
            // e em qual pasta, sem pedir de novo.
            State.lastBackupInfo = {
                pasta:   dh.name,
                arquivo: fileName,
                usuario: State.currentUser?.nome || 'ADM',
                quando:  new Date().toLocaleString('pt-BR'),
            };
            try { await DB.saveNow(); } catch (_) {}     // persiste o marcador (NAO apaga dados)
            AutoBackup.esconderAlerta();

            Toast.success(`Backup diario de seguranca salvo na pasta: "${fileName}".`, 6000);
            console.log('[AutoBackup] Concluido:', fileName);

        } catch (e) {
            // Falha de gravacao -> pasta provavelmente perdida durante o processo
            AutoBackup.mostrarAlerta('Falha ao gravar o backup na pasta de rede — ela pode ter sido movida ou ficou indisponivel. Vincule a pasta novamente.');
            Toast.error('Erro ao salvar backup na pasta: ' + e.message, 7000);
            console.error('[AutoBackup]', e);
        }
    },
};

window.AutoBackup = AutoBackup;
