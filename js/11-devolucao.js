// ==========================================================================
// SPARE PARTS - 11-devolucao.js (extraido do v16.32)
// ==========================================================================

// ============================================================
// MODULO: DEVOLUCAO (QR Code Poka-Yoke 3 etapas)
// ============================================================
const Devolucao = {

    // Regras de validacao centralizadas (unica fonte de verdade)
    RULES: {
        // v16.23.2: novos materiais possuem codigo de 7 caracteres — minimo baixado de 10 para 7
        CODE_MIN: 7,
        CODE_MAX: 44,
        QTY_MAX:  49999,
        QTY_CHARS: 5,
    },

    reset() {
        State.devState        = 'LOC';
        State.pendingDevCar   = '';
        State.pendingDevLocName = '';
        State.pendingDevCode  = '';
        State.pendingDevQty   = 0;

        const inp = document.getElementById('devSingleInput');
        if (inp) { inp.value = ''; inp.className = 'dev-main-input'; inp.placeholder = 'Aguardando leitura...'; }

        Devolucao._setStep(1);
        Devolucao._setLabel('LOC');
        Devolucao._clearCells();
        Devolucao._clearMessages();

        // btnConfirmDev removido do fluxo (Enter do scanner auto-commita)
        ['btnCancelDev','btnConfirmDev','btnDevBack'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        document.getElementById('devOccupiedWarning').style.display = 'none';
        const _dcd = document.getElementById('devCatalogDesc'); if (_dcd) _dcd.style.display = 'none';
        document.getElementById('devLiveValidation').textContent    = '';

        setTimeout(() => inp && inp.focus(), 80);
    },

    goBack() {
        if (State.devState === 'CODE') {
            State.devState        = 'LOC';
            State.pendingDevCar   = '';
            State.pendingDevLocName = '';
            Devolucao._setStep(1);
            Devolucao._setLabel('LOC');
            Devolucao._clearCells();
            Devolucao._clearMessages();
            document.getElementById('devOccupiedWarning').style.display = 'none';
            document.getElementById('btnDevBack').style.display  = 'none';
            document.getElementById('btnCancelDev').style.display = 'none';
            document.getElementById('btnConfirmDev').style.display = 'none';
            const inp = document.getElementById('devSingleInput');
            inp.value = ''; inp.className = 'dev-main-input';
            document.getElementById('devLiveValidation').textContent = '';
            setTimeout(() => inp.focus(), 80);

        } else if (State.devState === 'QTY') {
            State.devState        = 'CODE';
            State.pendingDevCode  = '';
            Devolucao._setStep(2);
            Devolucao._setLabel('CODE');
            document.getElementById('devCellCode').className = 'dev-info-cell active';
            document.getElementById('devCellCodeVal').textContent = '\u2014';
            document.getElementById('devCellQty').className  = 'dev-info-cell';
            document.getElementById('devCellQtyVal').textContent  = '\u2014';
            document.getElementById('btnConfirmDev').style.display = 'none';
            const inp = document.getElementById('devSingleInput');
            inp.value = ''; inp.className = 'dev-main-input';
            document.getElementById('devLiveValidation').textContent = '';
            setTimeout(() => inp.focus(), 80);
        }
    },

    // Feedback em tempo real enquanto digita/bipa
    onInputChange(val) {
        const lv = document.getElementById('devLiveValidation');
        const inp = document.getElementById('devSingleInput');
        if (!val) { lv.textContent = ''; inp.className = 'dev-main-input'; return; }

        if (State.devState === 'CODE') {
            const len = val.trim().length;
            const { CODE_MIN, CODE_MAX } = Devolucao.RULES;
            if (len < CODE_MIN) {
                lv.innerHTML = `<span style="color:var(--ind-yellow);">${len} / min ${CODE_MIN} caracteres</span>`;
                inp.className = 'dev-main-input';
            } else if (len > CODE_MAX) {
                lv.innerHTML = `<span style="color:var(--ind-red);">EXCEDE ${CODE_MAX} caracteres (${len})</span>`;
                inp.className = 'dev-main-input state-ng';
            } else {
                lv.innerHTML = `<span style="color:var(--ind-green);"><i class="fas fa-check"></i> ${len} caracteres &mdash; OK para confirmar</span>`;
                inp.className = 'dev-main-input state-ok';
            }
        } else if (State.devState === 'QTY') {
            const strVal = val.trim();
            const num    = parseInt(strVal);
            const { QTY_MAX, QTY_CHARS } = Devolucao.RULES;
            if (strVal.length > QTY_CHARS || isNaN(num) || num < 1 || num > QTY_MAX) {
                lv.innerHTML = `<span style="color:var(--ind-red);">Valor invalido (1 a ${QTY_MAX.toLocaleString()})</span>`;
                inp.className = 'dev-main-input state-ng';
            } else {
                lv.innerHTML = `<span style="color:var(--ind-green);"><i class="fas fa-check"></i> Quantidade: ${num}</span>`;
                inp.className = 'dev-main-input state-qty';
            }
        } else {
            inp.className = 'dev-main-input';
            lv.textContent = '';
        }
    },

    handleInput(forceConfirm = false) {
        const inp = document.getElementById('devSingleInput');
        const val = inp.value.trim().toUpperCase();
        if (!val) return;

        Devolucao._clearMessages();

        // ===== ETAPA 1: POSICAO =====
        if (State.devState === 'LOC') {
            // v16.17.1: armarios PTH (IA) sao posicoes FIXAS — nao entram por devolucao.
            // A unica forma de incluir/remover material e pela aba Estoque > Acoes > Editar.
            if (/^IA[\s_-]*\d{2}/i.test(val)) {
                Devolucao._showError('Posicoes de ARMARIO (IA) sao fixas. Use a aba Estoque > Acoes > Editar para incluir ou apagar materiais.');
                VoiceFeedback.playNG();
                return;
            }
            const parts = val.split('-');
            if (parts.length < 2) {
                Devolucao._showError('Formato invalido. Use: CARRO-POSICAO  (Ex: C10-005)');
                VoiceFeedback.playNG();
                return;
            }
            const car = parts[0];
            const loc = parts.slice(1).join('-');
            const isValid = State.validLocations.some(l => l.car === car && l.loc === loc);
            if (!isValid) {
                Devolucao._showError(`Posicao "${Security.sanitize(val)}" nao encontrada no mapa de carros.`);
                VoiceFeedback.playNG();
                return;
            }

            State.pendingDevCar     = car;
            State.pendingDevLocName = loc;
            State.devState          = 'CODE';

            const existing = State.inventory.find(i => i.car === car && i.loc === loc);
            if (existing && existing.code) {
                document.getElementById('devOccupiedWarning').style.display = 'block';
                document.getElementById('devOccupiedCode').textContent       = existing.code;
            } else {
                document.getElementById('devOccupiedWarning').style.display = 'none';
            }

            document.getElementById('devCellLoc').className    = 'dev-info-cell filled';
            document.getElementById('devCellLocVal').textContent = Security.sanitize(val);
            document.getElementById('devCellCode').className   = 'dev-info-cell active';

            Devolucao._setStep(2);
            Devolucao._setLabel('CODE');
            document.getElementById('btnDevBack').style.display   = 'block';
            document.getElementById('btnCancelDev').style.display = 'block';
            inp.value = ''; inp.className = 'dev-main-input';
            document.getElementById('devLiveValidation').textContent = '';
            setTimeout(() => inp.focus(), 60);

        // ===== ETAPA 2: CODIGO DO MATERIAL =====
        } else if (State.devState === 'CODE') {
            // Trunca para max 18 chars e remove espacos finais (padrao de codigo de material)
            const CODE_STORE_MAX = 18;
            const rawCode = val;
            const code    = rawCode.substring(0, CODE_STORE_MAX).trimEnd();
            const { CODE_MIN, CODE_MAX } = Devolucao.RULES;

            if (code.length < CODE_MIN) {
                Devolucao._showError(`Codigo muito curto: ${code.length} caracteres. Minimo: ${CODE_MIN}. Tente novamente.`);
                inp.className = 'dev-main-input state-ng';
                VoiceFeedback.playNG();
                // Fica na mesma etapa: limpa o campo mas NAO avanca
                inp.value = '';
                document.getElementById('devLiveValidation').textContent = '';
                setTimeout(() => { inp.className = 'dev-main-input'; inp.focus(); }, 400);
                return;
            }
            if (code.length > CODE_MAX) {
                Devolucao._showError(`Codigo muito longo: ${code.length} caracteres. Maximo: ${CODE_MAX}. Tente novamente.`);
                inp.className = 'dev-main-input state-ng';
                VoiceFeedback.playNG();
                inp.value = '';
                document.getElementById('devLiveValidation').textContent = '';
                setTimeout(() => { inp.className = 'dev-main-input'; inp.focus(); }, 400);
                return;
            }

            State.pendingDevCode = code;
            State.devState       = 'QTY';

            // Busca descricao no catalogo e exibe em tempo real
            const catEntry = (State.catalog || []).find(c => c.code && c.code.trim().toUpperCase() === code.trim().toUpperCase());
            const descEl   = document.getElementById('devCatalogDesc');
            const descText = document.getElementById('devCatalogDescText');
            if (catEntry && catEntry.desc && descEl && descText) {
                descText.textContent = Security.sanitize(catEntry.desc);
                descEl.style.display = 'block';
            } else if (descEl) {
                descEl.style.display = 'none';
            }

            // Feedback visual: mostra o codigo truncado e avisa se houve corte
            const wasTruncated = rawCode.length > CODE_STORE_MAX;
            document.getElementById('devCellCode').className    = 'dev-info-cell filled';
            document.getElementById('devCellCodeVal').textContent = Security.sanitize(code) + (wasTruncated ? ' ✂' : '');
            if (wasTruncated) {
                document.getElementById('devLiveValidation').innerHTML =
                    `<span style="color:var(--ind-yellow);">Codigo truncado para ${CODE_STORE_MAX} caracteres: <b>${Security.sanitize(code)}</b></span>`;
            }
            document.getElementById('devCellQty').className     = 'dev-info-cell active';

            Devolucao._setStep(3);
            Devolucao._setLabel('QTY');
            // Botao de confirmacao oculto: o Enter do scanner ja faz o commit automaticamente
            document.getElementById('btnConfirmDev').style.display = 'none';
            inp.value = ''; inp.className = 'dev-main-input state-qty'; inp.placeholder = 'Bipe ou digite a quantidade...';
            document.getElementById('devLiveValidation').textContent = '';
            setTimeout(() => inp.focus(), 60);

        // ===== ETAPA 3: QUANTIDADE -> auto-commit no Enter do scanner =====
        } else if (State.devState === 'QTY') {
            const { QTY_MAX, QTY_CHARS } = Devolucao.RULES;
            const strVal = val;
            const qty    = parseInt(strVal);

            if (strVal.length > QTY_CHARS) {
                Devolucao._showError(`${strVal.length} digitos. Maximo permitido: ${QTY_CHARS}. Tente novamente.`);
                inp.className = 'dev-main-input state-ng';
                VoiceFeedback.playNG();
                // Fica na etapa QTY: limpa, nao avanca
                inp.value = '';
                document.getElementById('devLiveValidation').textContent = '';
                setTimeout(() => { inp.className = 'dev-main-input state-qty'; inp.focus(); }, 400);
                return;
            }
            if (isNaN(qty) || qty < 1) {
                Devolucao._showError('Quantidade invalida. Digite um numero maior que zero. Tente novamente.');
                inp.className = 'dev-main-input state-ng';
                VoiceFeedback.playNG();
                inp.value = '';
                document.getElementById('devLiveValidation').textContent = '';
                setTimeout(() => { inp.className = 'dev-main-input state-qty'; inp.focus(); }, 400);
                return;
            }
            if (qty > QTY_MAX) {
                Devolucao._showError(`Quantidade ${qty.toLocaleString()} excede o limite de ${QTY_MAX.toLocaleString()}. Tente novamente.`);
                inp.className = 'dev-main-input state-ng';
                VoiceFeedback.playNG();
                inp.value = '';
                document.getElementById('devLiveValidation').textContent = '';
                setTimeout(() => { inp.className = 'dev-main-input state-qty'; inp.focus(); }, 400);
                return;
            }

            // Tudo valido -> commit IMEDIATO (scanner ja deu Enter, nao precisa de segundo clique)
            State.pendingDevQty = qty;
            document.getElementById('devCellQty').className    = 'dev-info-cell filled';
            document.getElementById('devCellQtyVal').textContent = String(qty);
            document.getElementById('devLiveValidation').innerHTML = '<span style="color:var(--ind-green); font-weight:900;"><i class="fas fa-check-double"></i> Registrando...</span>';
            Devolucao._commit();
        }
    },

    async _commit() {
        if (!DB.guard('Devolucao')) return;
        const car  = State.pendingDevCar;
        const loc  = State.pendingDevLocName;
        const code = State.pendingDevCode;
        const qty  = State.pendingDevQty;
        if (!car || !loc || !code || qty < 1) return;

        const inp = document.getElementById('devSingleInput');
        if (inp) { inp.disabled = true; inp.placeholder = 'Registrando...'; }

        // v16.32: TRAVA DE MUTACAO. A partir daqui o State ja esta alterado em
        // memoria mas ainda nao gravado — o sync nao pode aplicar o disco por
        // cima. A trava so e liberada no finally, depois do save (ou do undo).
        State._mutating++;

        // v16.32: snapshot do slot ANTES de alterar, para desfazer sem destruir.
        // O rollback antigo apagava a posicao inteira, mesmo quando ela ja tinha
        // material antes da devolucao.
        const prev = State.inventory.find(i => i.car === car && i.loc === loc);
        const snapshot = prev
            ? { existia: true, code: prev.code, qty: prev.qty, timestamp: prev.timestamp }
            : { existia: false };
        const locJaExistia = State.validLocations.some(l => l.car === car && l.loc === loc);

        try {

        // PASSO 1: Muta State.inventory SEM gravar ainda (noSave=true)
        const ok = await Inventory.updateItem(car, loc, code, qty, true);
        if (!ok) {
            VoiceFeedback.playNG();
            if (inp) { inp.disabled = false; inp.className = 'dev-main-input state-ng'; inp.focus(); }
            Devolucao._showError('Falha ao registrar. Tente novamente.');
            return;
        }

        // PASSO 2: Muta State.checkoutHistory SEM gravar ainda
        const histId = `${Date.now()}`;
        State.checkoutHistory.unshift({
            id: histId, type: 'RETURN',
            returnedItems: [{ car, loc, code, qty }],
            user: State.currentUser.nome,
            matricula: State.currentUser.matricula,
            timestamp: Date.now(),
        });

        // PASSO 3: Muta State.logs SEM gravar ainda (inline, sem chamar Logs.log que faz save)
        State.logs.unshift({
            matricula:  State.currentUser.matricula,
            nome:       State.currentUser.nome,
            action:     'RETURN',
            details:    Security.sanitize(`Devolveu ${code} x${qty} para ${car}-${loc}`),
            refId:      histId,
            timestamp:  Date.now(),
        });

        // PASSO 4: UMA ÚNICA gravação com todo o estado já mutado
        // saveNow() garante gravação imediata, sem debounce, sem fila
        try {
            await DB.saveNow();
            // Sucesso: atualiza UI e feedback
            UI.triggerRefresh();
            State.devSessionLog.unshift({ car, loc, code, qty, time: new Date().toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit',second:'2-digit'}) });
            if (State.devSessionLog.length > 10) State.devSessionLog.pop();
            Devolucao._renderSessionLog();
            VoiceFeedback.playOK();
            Toast.success(`${code} x${qty} registrado em ${car}-${loc}!`, 3000);
            if (inp) { inp.disabled = false; inp.className = 'dev-main-input state-ok'; inp.placeholder = 'OK! Registrado com sucesso.'; }
            setTimeout(() => Devolucao.reset(), 1400);
        } catch (e) {
            // Erro de gravação: desfaz as mutações para manter consistência
            console.error('[_commit save error]', e);

            // v16.32: ROLLBACK NAO-DESTRUTIVO. Restaura o que a posicao tinha
            // antes da devolucao, em vez de apagar a posicao inteira.
            const itemIdx = State.inventory.findIndex(i => i.car === car && i.loc === loc);
            if (snapshot.existia) {
                if (itemIdx >= 0) {
                    State.inventory[itemIdx].code      = snapshot.code;
                    State.inventory[itemIdx].qty       = snapshot.qty;
                    State.inventory[itemIdx].timestamp = snapshot.timestamp;
                }
            } else if (itemIdx >= 0) {
                State.inventory.splice(itemIdx, 1); // a posicao estava vazia mesmo
            }
            // Se a locacao foi criada agora por updateItem, remove tambem
            if (!locJaExistia) {
                const li = State.validLocations.findIndex(l => l.car === car && l.loc === loc);
                if (li >= 0) State.validLocations.splice(li, 1);
            }

            // Desfaz history e log — so se forem mesmo os registros desta devolucao
            if (State.checkoutHistory[0] && State.checkoutHistory[0].id === histId) State.checkoutHistory.shift();
            const lgIdx = State.logs.findIndex(l => l.refId === histId);
            if (lgIdx >= 0) State.logs.splice(lgIdx, 1);

            VoiceFeedback.playNG();
            if (inp) { inp.disabled = false; inp.placeholder = 'Bipe o material novamente'; inp.className = 'dev-main-input state-ng'; inp.focus(); }
            Devolucao._showError('NAO GRAVOU. Verifique a rede e bipe novamente.');
            Toast.error('Falha ao salvar devolucao. O material NAO foi registrado — bipe novamente.', 8000);
        }

        } finally {
            // v16.32: libera a trava de mutacao SEMPRE (sucesso, erro ou return)
            State._mutating = Math.max(0, State._mutating - 1);
        }
    },

    _renderSessionLog() {
        const container = document.getElementById('devRecentLog');
        const list      = document.getElementById('devRecentItems');
        if (!container || !list) return;
        if (State.devSessionLog.length === 0) { container.style.display = 'none'; return; }

        container.style.display = 'block';
        list.innerHTML = State.devSessionLog.map(entry => `
            <div class="dev-recent-item">
                <i class="fas fa-check-circle" style="color:var(--ind-green); font-size:1.1rem; flex-shrink:0;"></i>
                <div style="flex:1;">
                    <span style="font-weight:900; color:var(--tpv-blue);">${Security.sanitize(entry.code)}</span>
                    <span style="color:#64748b; font-size:0.8rem;"> &times;${entry.qty}</span>
                    <span style="color:#94a3b8; font-size:0.8rem;"> &rarr; ${Security.sanitize(entry.car)}-${Security.sanitize(entry.loc)}</span>
                </div>
                <span style="color:#94a3b8; font-size:0.75rem; flex-shrink:0;">${Security.sanitize(entry.time)}</span>
            </div>
        `).join('');
    },

    _setStep(step) {
        // Atualiza visuais da barra de progresso
        for (let s = 1; s <= 3; s++) {
            const el   = document.getElementById(`devStep${s}`);
            const conn = document.getElementById(`devConn${s}`);
            if (!el) continue;
            if (s < step)       { el.className = 'dev-step done'; if (conn) conn.className = 'dev-step-connector done'; }
            else if (s === step) { el.className = 'dev-step active'; if (conn) conn.className = 'dev-step-connector active'; }
            else                { el.className = 'dev-step'; if (conn) conn.className = 'dev-step-connector'; }
        }
    },

    _setLabel(state) {
        const labelEl = document.getElementById('devInputLabelText');
        const tagsEl  = document.getElementById('devRulesTags');
        const inp     = document.getElementById('devSingleInput');
        const { CODE_MIN, CODE_MAX, QTY_MAX } = Devolucao.RULES;

        const configs = {
            LOC:     { icon: 'fa-qrcode', text: 'Bipe o QR Code da Posicao (Ex: C10-005)', tags: [], placeholder: 'Aguardando leitura do QR...' },
            CODE:    { icon: 'fa-barcode', text: 'Bipe o Codigo do Material', placeholder: 'Aguardando leitura do codigo...',
                       tags: [`<span class="dev-rules-tag"><i class="fas fa-ruler"></i> Min ${CODE_MIN} caracteres</span>`,
                              `<span class="dev-rules-tag"><i class="fas fa-ruler"></i> Max ${CODE_MAX} caracteres</span>`] },
            QTY:     { icon: 'fa-hashtag', text: 'Digite ou Bipe a Quantidade', placeholder: 'Digite a quantidade...',
                       tags: [`<span class="dev-rules-tag"><i class="fas fa-arrow-up"></i> Max ${QTY_MAX.toLocaleString()}</span>`,
                              `<span class="dev-rules-tag"><i class="fas fa-keyboard"></i> Max 5 digitos</span>`] },
            CONFIRM: { icon: 'fa-check-double', text: 'Revise e Confirme a Entrada', placeholder: '', tags: [] },
        };
        const cfg = configs[state] || configs['LOC'];

        if (labelEl) labelEl.innerHTML = `<i class="fas ${cfg.icon}"></i> ${cfg.text}`;
        if (tagsEl)  tagsEl.innerHTML  = (cfg.tags || []).join('');
        if (inp && cfg.placeholder !== undefined) inp.placeholder = cfg.placeholder;
    },

    _clearCells() {
        ['devCellLoc','devCellCode','devCellQty'].forEach((id, i) => {
            const el = document.getElementById(id);
            if (el) el.className = i === 0 ? 'dev-info-cell active' : 'dev-info-cell';
        });
        ['devCellLocVal','devCellCodeVal','devCellQtyVal'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '\u2014';
        });
    },

    _clearMessages() {
        const err = document.getElementById('devErrorMsg');
        if (err) err.style.display = 'none';
    },

    _showError(msg) {
        const el = document.getElementById('devErrorMsg');
        const tx = document.getElementById('devErrorText');
        if (el && tx) { tx.textContent = msg; el.style.display = 'block'; }
        const inp = document.getElementById('devSingleInput');
        if (inp) setTimeout(() => { inp.value = ''; inp.focus(); }, 300);
        setTimeout(() => { if (el) el.style.display = 'none'; }, 4000);
    },
};
