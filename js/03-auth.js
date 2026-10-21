// ==========================================================================
// SPARE PARTS - 03-auth.js (extraido do v16.32)
// ==========================================================================

// ============================================================
// MODULO: AUTENTICACAO
// ============================================================
const Auth = {
    // Modo visualizador: acesso rapido sem login para ver o estoque.
    // So funciona apos importar o banco de dados.
    enterViewerMode() {
        if (!State.dbFileHandle) {
            Toast.warn('Importe o banco de dados primeiro.');
            return;
        }
        State.currentUser = {
            nome:     'Visualizador',
            matricula: 'VIEWER',
            isAdmin:  false,
            isViewer: true,   // perfil especial: so ve Gestao Estoque, somente leitura
        };
        State.sessionStartTime = Date.now();
        Auth._initSession();
        Toast.info('Modo visualizacao de estoque. Apenas leitura — sem permissao para editar.', 5000);
    },

    // Usuario admin embutido no codigo (funciona mesmo sem banco de dados ou banco vazio).
    // Matricula: ADMIN  |  Senha: admin123
    // Pode ser sobreposto por um usuario ADMIN cadastrado no banco de dados.
    _BUILTIN_ADMIN: {
        nome:         'Administrador',
        matricula:    'ADMIN',
        passwordHash: '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',
        isAdmin:      true,
        _builtin:     true,  // marca para nao salvar no banco
    },

    async attemptUserLogin() {
        if (Security.isLockedOut()) {
            Toast.error('Sistema bloqueado por excesso de tentativas. Aguarde.');
            return;
        }
        const mat  = document.getElementById('userMatricula').value.trim().toUpperCase();
        const pass = document.getElementById('userPass').value;
        const msg  = document.getElementById('userLoginMsg');

        if (!mat || !pass) { msg.textContent = 'Preencha todos os campos.'; return; }

        // Busca no banco de dados primeiro; se nao encontrar, verifica o usuario embutido
        let user = State.users.find(u => u.matricula === mat);
        if (!user && mat === Auth._BUILTIN_ADMIN.matricula) {
            user = Auth._BUILTIN_ADMIN;
        }

        if (!user) {
            Security.recordFailedAttempt();
            msg.textContent = 'Matricula nao cadastrada.';
            return;
        }

        // Primeiro acesso: sem senha definida (nao se aplica ao admin embutido)
        if (!user.passwordHash && !user._builtin) {
            State.currentUser = user;
            UI.showCard('firstAccessCard');
            return;
        }

        const ok = await Security.verifyPassword(pass, user.passwordHash);
        if (ok) {
            Security.resetAttempts();
            State.currentUser = { ...user };  // copia para nao mutar o objeto original
            State.sessionStartTime = Date.now();
            Auth._initUserSession();
        } else {
            Security.recordFailedAttempt();
            msg.textContent = 'Senha incorreta.';
        }
    },

    // attemptAdmLogin: removido — login de admin agora usa matricula+senha como qualquer usuario
    async attemptAdmLogin() { /* nao utilizado */ },

    async setNewPassword() {
        const p1 = document.getElementById('newPass1').value;
        const p2 = document.getElementById('newPass2').value;
        const msg = document.getElementById('firstAccessMsg');

        if (!p1 || !p2)         { msg.textContent = 'Preencha ambos os campos.'; return; }
        if (p1 !== p2)          { msg.textContent = 'As senhas nao coincidem.'; return; }
        if (p1.length < 4)      { msg.textContent = 'A senha deve ter no minimo 4 caracteres.'; return; }

        const user = State.users.find(u => u.matricula === State.currentUser.matricula);
        if (user) {
            user.passwordHash = await Security.hashPassword(p1);
            await DB.saveNow();
            State.sessionStartTime = Date.now();
            Auth._initUserSession();
            Toast.success('Senha definida com sucesso!');
        }
    },

    _initUserSession()  { Auth._initSession(); },
    _initAdminSession() { Auth._initSession(); },

    _initSession() {
        const user     = State.currentUser;
        const isAdmin  = user && user.isAdmin;
        const isViewer = user && user.isViewer;

        document.getElementById('loginWrapper').style.display = 'none';
        document.getElementById('mainApp').style.display      = 'block';
        document.getElementById('app').classList.add('visible');

        // Badge no header
        const viewerBadge = isViewer
            ? ' <span style="background:#f1f5f9; color:#64748b; font-size:0.68rem; padding:2px 8px; border-radius:10px; font-weight:700; margin-left:6px; vertical-align:middle;"><i class="fas fa-eye"></i> LEITURA</span>'
            : '';
        // Tier icon no header
        const rankAll  = RankingEngine.buildAllRanking();
        const myPos    = rankAll.findIndex(r => r.mat === user.matricula) + 1;
        const tierIcon = myPos > 0 ? RankingEngine.getTier(myPos).icon : '';
        const tierBadge = tierIcon
            ? ` <span title="${RankingEngine.getTier(myPos).label}" style="font-size:1rem;vertical-align:middle;margin-left:4px;">${tierIcon}</span>`
            : '';
        document.getElementById('userInfo').innerHTML  = (user ? user.nome : '--') + viewerBadge + tierBadge;
        document.getElementById('printUser').textContent = user ? user.nome : '--';

        // Aplica restricoes visuais do modo viewer
        document.querySelectorAll('.viewer-hidden').forEach(function(el) {
            el.style.display = isViewer ? 'none' : '';
        });
        // Operacional ve a aba Estoque, mas SEM controles de admin (carga mestra,
        // adicionar/excluir carro, adicionar/apagar locacao). So pode limpar material.
        document.querySelectorAll('.op-hidden').forEach(function(el) {
            el.style.display = Perms.can('act:stock_tools', user) ? '' : 'none';
        });
        const viewerExportRow = document.getElementById('viewerExportRow');
        if (viewerExportRow) viewerExportRow.style.display = isViewer ? 'block' : 'none';

        // Titulo da aba de estoque
        const stockTitle = document.getElementById('stockManageTitle');
        if (stockTitle) stockTitle.textContent = isViewer ? 'Gestao de Estoque (Visualizacao)' : (isAdmin ? 'Gestao de Estoque Completa' : 'Gestao de Estoque');

        // Constroi o nav baseado no perfil
        UI.buildNav();

        // Inicializa modulos
        StockAdmin.renderMapManager();
        if (!isViewer) HistoryModule.render();

        if (Perms.can('tab:users', user))         UserAdmin.renderList();
        if (Perms.can('tab:dashboard_adm', user)) AdminDash.update();
        if (isAdmin) {
            Toast.success('Bem-vindo, ' + user.nome + '! (Acesso Administrador)');
        } else if (isViewer) {
            Toast.info('Visualizacao de Estoque — modo somente leitura.', 4000);
        } else {
            Toast.success('Bem-vindo, ' + user.nome + '!');
        }

        if (!isViewer) Logs.log('LOGIN', (isAdmin ? 'Admin' : 'Operador') + ' ' + user.nome + ' entrou no sistema');

        // Backup diario de seguranca: primeiro login apos 07:00 dispara a copia na pasta.
        // Roda em background; se a pasta sumiu, exibe alerta no topo da tela.
        setTimeout(() => { try { AutoBackup.checkAndRun(); } catch (e) { console.error(e); } }, 1500);
    },

    logout() {
        // FIX: Limpa timers para evitar memory leak
        clearTimeout(State._syncTimer);
        clearTimeout(State._saveTimer);
        State.currentUser = null;
        State.dbFileHandle = null;
        location.reload();
    }
};

// ============================================================
// MODULO: ADMIN - USUARIOS
// ============================================================

// =========================================================================
// PERMISSOES GRANULARES  (v16.19)
// -------------------------------------------------------------------------
// Cada usuario tem um perfil base (Operacional / Administrador) que define
// o PADRAO de acesso. Em cima disso, o admin pode LIBERAR ou BLOQUEAR
// permissoes individuais por usuario (u.perms = { 'chave': true|false }).
// Efetivo = override do usuario (se existir) senao o padrao do perfil.
// =========================================================================
const Perms = {

    // Catalogo de tudo que pode ser liberado/bloqueado
    CATALOG: [
        { group: 'Telas (abas do sistema)', icon: 'fa-window-restore', items: [
            { key: 'tab:feeder',        label: 'Comparador',            desc: 'Aba de comparacao de feeders' },
            { key: 'tab:devolucao',     label: 'Devolucao',             desc: 'Aba de devolucao de material' },
            { key: 'tab:estoque',       label: 'Busca Avulsa',          desc: 'Consulta rapida de posicoes' },
            { key: 'tab:dashboard',     label: 'Historico',             desc: 'Historico de movimentacoes' },
            { key: 'tab:confirmacao',  label: 'Confirmacao',           desc: 'Confirmacao de conclusao das listas' },
            { key: 'tab:etiquetas',    label: 'Etiquetas',             desc: 'Impressao de etiquetas com o codigo da lista do MES' },
            { key: 'tab:ranking',       label: 'Ranking',               desc: 'Ranking / gamificacao' },
            { key: 'tab:stock_manage',  label: 'Estoque',               desc: 'Gestao de estoque (mapa dos carros)' },
            { key: 'tab:users',         label: 'Sistema',               desc: 'Usuarios, backups e manutencao' },
            { key: 'tab:adm-stockdash', label: 'Dashboard',             desc: 'Graficos de estoque' },
            { key: 'tab:dashboard_adm', label: 'ALERTA',   desc: 'Codigos sem movimentacao (obsoletos)' },
        ]},
        { group: 'Aba Estoque — coluna "Acoes"', icon: 'fa-pen-to-square', items: [
            { key: 'act:stock_edit',    label: 'Editar item (lapis)',   desc: 'Alterar codigo e quantidade da posicao' },
            { key: 'act:stock_clear',   label: 'Limpar material (vassoura)', desc: 'Esvaziar o material da posicao' },
            { key: 'act:stock_delloc',  label: 'Apagar locacao (lixeira)',   desc: 'Excluir a posicao do mapa do carro' },
        ]},
        { group: 'Aba Estoque — ferramentas de admin', icon: 'fa-screwdriver-wrench', items: [
            { key: 'act:stock_tools',   label: 'Criar/excluir carro e locacoes', desc: 'Barra de ferramentas do editor de mapa' },
            { key: 'act:stock_master',  label: 'Carga Mestra (importar Excel)',  desc: 'Substitui todo o estoque — cuidado' },
        ]},
        { group: 'Confirmacao de Listas — acoes de administrador', icon: 'fa-user-shield', items: [
            { key: 'act:list_force_done', label: 'Finalizar lista como administrador', desc: 'Encerra uma lista pendente / deixada para o proximo turno' },
            { key: 'act:list_reopen',     label: 'Reabrir lista concluida',            desc: 'Devolve para andamento uma lista ja finalizada' },
        ]},
        { group: 'Historico', icon: 'fa-rotate-left', items: [
            { key: 'act:history_undo',  label: 'Estornar (desfazer) baixas',     desc: 'Reverter operacoes ja registradas' },
        ]},
    ],

    // Padrao do perfil OPERACIONAL (tudo que nao estiver aqui = false)
    _OP_DEFAULT: {
        'tab:feeder': true, 'tab:devolucao': true, 'tab:estoque': true,
        'tab:dashboard': true, 'tab:ranking': true, 'tab:stock_manage': true,
        'tab:confirmacao': true,
        'tab:etiquetas': true,
        'act:stock_clear': true,
    },

    allKeys() {
        const out = [];
        Perms.CATALOG.forEach(g => g.items.forEach(i => out.push(i.key)));
        return out;
    },

    labelOf(key) {
        let lbl = key;
        Perms.CATALOG.forEach(g => g.items.forEach(i => { if (i.key === key) lbl = i.label; }));
        return lbl;
    },

    // Valor PADRAO da permissao conforme o perfil do usuario
    baseline(user, key) {
        if (!user) return false;
        if (user.isViewer) return key === 'tab:stock_manage';
        if (user.isAdmin)  return true;
        return !!Perms._OP_DEFAULT[key];
    },

    // Permissao efetiva (override do usuario tem prioridade)
    can(key, user) {
        const u = user || State.currentUser;
        if (!u) return false;
        if (u.isViewer) return Perms.baseline(u, key);
        const ov = u.perms ? u.perms[key] : undefined;
        if (ov === true)  return true;
        if (ov === false) return false;
        return Perms.baseline(u, key);
    },

    // Quantos ajustes manuais esse usuario tem
    countOverrides(user) {
        if (!user || !user.perms) return 0;
        return Object.keys(user.perms).filter(k => user.perms[k] === true || user.perms[k] === false).length;
    },

    // ---------------- Modal de edicao de permissoes ----------------
    open(matricula) {
        const user = State.users.find(u => u.matricula === matricula);
        if (!user) { Toast.error('Usuario nao encontrado.'); return; }
        Perms._draft = Object.assign({}, user.perms || {});
        Perms._mat   = matricula;

        const back = document.createElement('div');
        back.className = 'modal-backdrop';
        back.id = 'permsBackdrop';
        back.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.6); z-index:20000; display:flex; align-items:center; justify-content:center; padding:15px;';
        back.innerHTML = `
          <div style="background:#fff; border-radius:10px; width:100%; max-width:760px; max-height:88vh; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,0.35); overflow:hidden;">
            <div style="background:var(--ind-red,#dc2626); color:#fff; padding:14px 18px;">
                <div style="font-weight:800; font-size:1.02rem;"><i class="fas fa-user-shield"></i> Permissoes de Acesso</div>
                <div style="font-size:0.8rem; opacity:0.92; margin-top:3px;">
                    ${Security.sanitize(user.nome)} — Matricula ${Security.sanitize(user.matricula)}
                    &nbsp;|&nbsp; Perfil base: <b>${user.isAdmin ? 'ADMINISTRADOR' : 'OPERACIONAL'}</b>
                </div>
            </div>
            <div style="padding:12px 18px; background:#f8fafc; border-bottom:1px solid #e2e8f0; font-size:0.79rem; color:#475569; line-height:1.5;">
                <b>Padrao</b> = segue o perfil base &nbsp;•&nbsp; <b>Liberar</b> = concede mesmo sendo operacional &nbsp;•&nbsp; <b>Bloquear</b> = remove mesmo sendo admin.
            </div>
            <div id="permsBody" style="padding:16px 18px; overflow-y:auto; flex:1;"></div>
            <div style="padding:12px 18px; border-top:1px solid #e2e8f0; display:flex; gap:10px; background:#f8fafc;">
                <button class="btn-3d btn-gray" style="flex:1;" onclick="Perms.resetDraft()"><i class="fas fa-eraser"></i> Limpar ajustes</button>
                <button class="btn-3d btn-gray" style="flex:1;" onclick="Perms.close()">Cancelar</button>
                <button class="btn-3d btn-green" style="flex:2;" onclick="Perms.save()"><i class="fas fa-save"></i> SALVAR PERMISSOES</button>
            </div>
          </div>`;
        document.body.appendChild(back);
        back.onclick = function(e) { if (e.target === back) Perms.close(); };
        Perms._renderBody(user);
    },

    _renderBody(user) {
        const body = document.getElementById('permsBody');
        if (!body) return;
        body.innerHTML = Perms.CATALOG.map(g => `
            <div style="margin-bottom:18px;">
                <div style="font-weight:800; color:#334155; font-size:0.85rem; text-transform:uppercase; letter-spacing:0.4px; border-bottom:2px solid #e2e8f0; padding-bottom:6px; margin-bottom:8px;">
                    <i class="fas ${g.icon}" style="color:var(--ind-red,#dc2626);"></i> ${g.group}
                </div>
                ${g.items.map(it => {
                    const ov   = Perms._draft[it.key];
                    const base = Perms.baseline(user, it.key);
                    const eff  = (ov === true) ? true : (ov === false) ? false : base;
                    const mk = (val, txt, color) => {
                        const on = (val === 'default' && ov === undefined) || (val === 'allow' && ov === true) || (val === 'deny' && ov === false);
                        return `<button onclick="Perms.set('${it.key}','${val}')" style="flex:1; padding:5px 4px; font-size:0.7rem; font-weight:800; cursor:pointer; border:1px solid ${on?color:'#cbd5e1'}; background:${on?color:'#fff'}; color:${on?'#fff':'#64748b'}; border-radius:4px;">${txt}</button>`;
                    };
                    return `
                    <div style="display:flex; align-items:center; gap:10px; padding:7px 4px; border-bottom:1px dashed #f1f5f9;">
                        <div style="flex:1; min-width:0;">
                            <div style="font-weight:700; font-size:0.83rem; color:#1e293b;">
                                ${it.label}
                                <span style="font-size:0.66rem; font-weight:800; padding:1px 6px; border-radius:8px; margin-left:5px; background:${eff?'#dcfce7':'#fee2e2'}; color:${eff?'#166534':'#991b1b'};">${eff ? 'TEM ACESSO' : 'SEM ACESSO'}</span>
                            </div>
                            <div style="font-size:0.72rem; color:#94a3b8;">${it.desc}</div>
                        </div>
                        <div style="display:flex; gap:4px; width:230px; flex-shrink:0;">
                            ${mk('default','PADRAO','#64748b')}
                            ${mk('allow','LIBERAR','#16a34a')}
                            ${mk('deny','BLOQUEAR','#dc2626')}
                        </div>
                    </div>`;
                }).join('')}
            </div>`).join('');
    },

    set(key, mode) {
        if (mode === 'default') delete Perms._draft[key];
        else Perms._draft[key] = (mode === 'allow');
        const user = State.users.find(u => u.matricula === Perms._mat);
        Perms._renderBody(user);
    },

    resetDraft() {
        Perms._draft = {};
        const user = State.users.find(u => u.matricula === Perms._mat);
        Perms._renderBody(user);
    },

    close() {
        const b = document.getElementById('permsBackdrop');
        if (b) b.remove();
    },

    async save() {
        const user = State.users.find(u => u.matricula === Perms._mat);
        if (!user) { Perms.close(); return; }
        const clean = {};
        Object.keys(Perms._draft).forEach(k => {
            if (Perms._draft[k] === true || Perms._draft[k] === false) clean[k] = Perms._draft[k];
        });
        user.perms = clean;
        await DB.saveNow();
        Perms.close();
        UserAdmin.renderList();
        const n = Object.keys(clean).length;
        Toast.success('Permissoes de ' + user.nome + ' salvas (' + n + ' ajuste' + (n === 1 ? '' : 's') + ').');
        Logs.log('USER_PERMS', 'Permissoes ajustadas: ' + user.matricula + ' -> ' + (n ? JSON.stringify(clean) : 'padrao do perfil'));
        // Se o admin ajustou a si mesmo, reaplica a interface na hora
        if (State.currentUser && State.currentUser.matricula === user.matricula) {
            State.currentUser.perms = clean;
            Perms.applyUI();
        }
    },

    // Reaplica a interface conforme as permissoes do usuario logado
    applyUI() {
        const u = State.currentUser;
        if (!u) return;
        document.querySelectorAll('.op-hidden').forEach(function(el) {
            el.style.display = Perms.can('act:stock_tools', u) ? '' : 'none';
        });
        try { UI.buildNav(); } catch (e) {}
        try { StockAdmin.renderMapManager(); } catch (e) {}
    },
};
window.Perms = Perms;

// ============================================================
// MODULO: CONTROLE DE SESSAO (Derrubar Acessos)
// v16.14: grava um marcador no JSON compartilhado. Todos os outros
// PCs detectam no sync (_mergeFromDisk) e fazem logout automaticamente.
// Quem dispara NAO e desconectado.
// ============================================================
const SessionControl = {
    async kickAll() {
        if (!State.currentUser || !State.currentUser.isAdmin) {
            Toast.error('Apenas administradores podem derrubar acessos.');
            return;
        }
        if (!DB.guard('Derrubar Acessos')) return;

        const ok = await Modal.confirm(
            'Derrubar Todos os Acessos',
            'Todos os outros usuarios conectados serao DESCONECTADOS em ate alguns segundos.\n\nSeu proprio acesso NAO sera encerrado.\n\nUse isso quando precisar mexer no sistema sem interferencia.',
            'SIM, DERRUBAR ACESSOS', true
        );
        if (!ok) return;

        const now = Date.now();
        // Grava o marcador. A partir daqui, so este PC (matricula) fica imune,
        // pois sua sessionStartTime e o proprio "by" batem com o marcador.
        State.forceLogout = {
            ts: now,
            by: State.currentUser.matricula,
            byName: State.currentUser.nome,
        };
        // Garante que este PC nao se derrube: adianta o marco da sessao.
        State.sessionStartTime = now + 1;

        State.logs.unshift({
            matricula: State.currentUser.matricula, nome: State.currentUser.nome,
            action: 'FORCE_LOGOUT', refId: String(now), timestamp: now,
            details: Security.sanitize('Derrubou todos os acessos ao sistema (manutencao).'),
        });

        await DB.saveNow();
        Toast.success('Acessos derrubados. Os outros PCs serao desconectados em instantes.', 5000);
    },
};

window.SessionControl = SessionControl;
