// ==========================================================================
// SPARE PARTS - 01-core.js (extraido do v16.32)
// ==========================================================================

// ============================================================
// MODULO: SEGURANCA (Hashing e Sanitizacao)
// ============================================================
const Security = {
    // FIX CRITICO: Senha nunca mais em texto plano. Usa SHA-256 via SubtleCrypto.
    async hashPassword(password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },

    async verifyPassword(plain, hash) {
        const plainHash = await this.hashPassword(plain);
        return plainHash === hash;
    },

    // FIX: sanitizeInput corrigido para nao criar vetores de XSS secundario
    sanitize(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/\//g, '&#x2F;');
    },

    // Numero maximo de tentativas de login
    MAX_LOGIN_ATTEMPTS: 5,
    _loginAttempts: 0,
    _lockoutUntil: 0,

    isLockedOut() {
        return Date.now() < this._lockoutUntil;
    },

    recordFailedAttempt() {
        this._loginAttempts++;
        UI.updateAttemptDots(this._loginAttempts, this.MAX_LOGIN_ATTEMPTS);
        if (this._loginAttempts >= this.MAX_LOGIN_ATTEMPTS) {
            this._lockoutUntil = Date.now() + 60_000; // 60s de bloqueio
            Toast.error('Muitas tentativas. Aguarde 60 segundos.');
            this._loginAttempts = 0;
        }
    },

    resetAttempts() {
        this._loginAttempts = 0;
        this._lockoutUntil = 0;
        UI.updateAttemptDots(0, this.MAX_LOGIN_ATTEMPTS);
    }
};

// ============================================================
// MODULO: TOAST NOTIFICATIONS (substitui todos os alert())
// ============================================================
// ============================================================
// v17.01 — LIMPEZA DE SENHA EM TEXTO PURO
//
// Versoes antigas do sistema gravavam, alem do passwordHash, um campo
// `password` com a senha LEGIVEL dentro de sistema.json. O codigo atual
// nao grava mais isso, mas os bancos ja existentes carregam o resido —
// e um arquivo numa pasta de rede que varias pessoas enxergam.
//
// Estas funcoes sao a UNICA fonte de verdade sobre o que e senha em texto
// puro. Rodam na abertura (limpa o que existe) e na gravacao (impede que
// volte por qualquer caminho, inclusive por um import de banco antigo).
// ============================================================
const SenhaLimpa = {

    // Campos que NUNCA podem ir para o disco
    CAMPOS: ['password', 'senha', 'passwordPlain', 'pass'],

    // Remove os campos proibidos de UM objeto. Devolve quantos tirou.
    doObjeto(obj) {
        if (!obj || typeof obj !== 'object') return 0;
        let n = 0;
        SenhaLimpa.CAMPOS.forEach(c => {
            if (Object.prototype.hasOwnProperty.call(obj, c)) { delete obj[c]; n++; }
        });
        return n;
    },

    // Limpa State.users + State.adminConfig. Chamada na abertura do banco.
    // Devolve quantos campos foram removidos (0 = banco ja estava limpo).
    migrar() {
        let n = 0;
        (State.users || []).forEach(u => { n += SenhaLimpa.doObjeto(u); });
        n += SenhaLimpa.doObjeto(State.adminConfig);
        return n;
    },

    // Copia higienizada, usada na hora de gravar. NAO altera o State:
    // devolve objetos novos, sem os campos proibidos.
    paraGravar(users, adminConfig) {
        const u = (users || []).map(x => {
            const copia = { ...x };
            SenhaLimpa.doObjeto(copia);
            return copia;
        });
        const a = { ...(adminConfig || {}) };
        SenhaLimpa.doObjeto(a);
        return { users: u, adminConfig: a };
    },
};

const Toast = {
    icons: { success: 'fa-check-circle', error: 'fa-times-circle', warn: 'fa-exclamation-triangle', info: 'fa-info-circle' },

    show(message, type = 'info', duration = 4000) {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <i class="fas ${this.icons[type]} toast-icon"></i>
            <span class="toast-msg">${Security.sanitize(message)}</span>
            <i class="fas fa-times toast-close" onclick="this.parentElement.remove()"></i>
        `;
        container.appendChild(toast);

        if (duration > 0) {
            setTimeout(() => {
                toast.style.animation = 'toastOut 0.3s forwards';
                toast.addEventListener('animationend', () => toast.remove());
            }, duration);
        }
    },

    success: (msg, dur) => Toast.show(msg, 'success', dur),
    error:   (msg, dur) => Toast.show(msg, 'error', 6000),
    warn:    (msg, dur) => Toast.show(msg, 'warn', dur),
    info:    (msg, dur) => Toast.show(msg, 'info', dur),
};

// ============================================================
// MODULO: MODAL GENERICO (substitui confirm() e prompt() nativos)
// ============================================================
const Modal = {
    _resolve: null,

    // Exibe um dialogo de confirmacao (substitui confirm())
    confirm(title, body, confirmLabel = 'Confirmar', isDanger = false) {
        return new Promise(resolve => {
            this._resolve = resolve;
            const box = document.getElementById('genericModalBox');
            if (isDanger) box.classList.add('modal-danger');
            else box.classList.remove('modal-danger');

            document.getElementById('genericModalTitle').textContent = title;
            document.getElementById('genericModalBody').textContent = body;
            document.getElementById('genericModalInput').style.display = 'none';

            const confirmBtn = document.getElementById('genericModalConfirm');
            confirmBtn.textContent = confirmLabel;
            confirmBtn.className = `btn-3d ${isDanger ? 'btn-red' : 'btn-blue'}`;

            document.getElementById('genericModal').style.display = 'flex';

            const onConfirm = () => { this._cleanup(); resolve(true); };
            const onCancel  = () => { this._cleanup(); resolve(false); };

            confirmBtn.onclick = onConfirm;
            document.getElementById('genericModalCancel').onclick = onCancel;
        });
    },

    // v17.12: dialogo com varios botoes. botoes = [{ valor, rotulo, classe }]
    // Retorna o `valor` do botao clicado (null se fechar pelo Cancelar).
    escolher(title, body, botoes, isDanger = false) {
        return new Promise(resolve => {
            const box = document.getElementById('genericModalBox');
            box.classList.toggle('modal-danger', !!isDanger);
            document.getElementById('genericModalTitle').textContent = title;
            document.getElementById('genericModalBody').textContent = body;
            document.getElementById('genericModalInput').style.display = 'none';
            const acoes = document.getElementById('genericModalActions');
            const originais = [...acoes.children];
            originais.forEach(b => { b.style.display = 'none'; });
            const fim = v => {
                acoes.querySelectorAll('.modal-extra').forEach(b => b.remove());
                originais.forEach(b => { b.style.display = ''; });
                document.getElementById('genericModal').style.display = 'none';
                resolve(v);
            };
            botoes.forEach(b => {
                const el = document.createElement('button');
                el.className = 'btn-3d modal-extra ' + (b.classe || 'btn-blue');
                el.textContent = b.rotulo;
                el.onclick = () => fim(b.valor);
                acoes.appendChild(el);
            });
            document.getElementById('genericModal').style.display = 'flex';
        });
    },

    // Exibe um dialogo de input (substitui prompt())
    prompt(title, body, placeholder = '', defaultValue = '') {
        return new Promise(resolve => {
            this._resolve = resolve;
            document.getElementById('genericModalTitle').textContent = title;
            document.getElementById('genericModalBody').textContent = body;

            const input = document.getElementById('genericModalInput');
            input.placeholder = placeholder;
            input.value = defaultValue;
            input.style.display = 'block';
            setTimeout(() => input.focus(), 100);

            document.getElementById('genericModal').style.display = 'flex';

            // v17.12: le o valor ANTES de limpar — antes o _cleanup() apagava o campo
            // primeiro e o prompt sempre devolvia vazio.
            const onConfirm = () => { const v = input.value.trim(); this._cleanup(); resolve(v); };
            const onCancel  = () => { this._cleanup(); resolve(null); };

            document.getElementById('genericModalConfirm').onclick = onConfirm;
            document.getElementById('genericModalCancel').onclick = onCancel;

            input.onkeydown = (e) => { if (e.key === 'Enter') onConfirm(); if (e.key === 'Escape') onCancel(); };
        });
    },

    _cleanup() {
        document.getElementById('genericModal').style.display = 'none';
        document.getElementById('genericModalInput').value = '';
    },
};

// ============================================================
// MODULO: LOGS E HISTORICO
// ============================================================
const Logs = {
    async log(action, details, refId = null) {
        const entry = {
            matricula:  State.currentUser ? State.currentUser.matricula : 'SISTEMA',
            nome:       State.currentUser ? State.currentUser.nome : 'AUTO',
            action,
            details:    Security.sanitize(details),
            refId,
            timestamp:  Date.now(),
        };
        State.logs.unshift(entry);
        await DB.saveNow();
    }
};

// ============================================================
// MODULO: PAGINADOR  (v17.02)
// ------------------------------------------------------------
// Telas que desenham MILHARES de linhas de uma vez travam o navegador:
// ele precisa montar, posicionar e pintar cada uma. Este modulo corta a
// lista em paginas e devolve os controles prontos.
//
// Cada tela tem a sua CHAVE, entao a pagina em que voce estava no
// Historico nao interfere na do Estoque. A escolha de "quantos por
// pagina" fica no localStorage: o operador configura uma vez por PC.
// ============================================================
const Paginador = {

    TAMANHOS: [50, 100, 200],
    PADRAO:   50,

    _estado: {},   // chave -> { pagina, tamanho }

    estado(chave) {
        if (!Paginador._estado[chave]) {
            let tam = Paginador.PADRAO;
            try {
                const salvo = parseInt(localStorage.getItem('sp_pag_' + chave));
                if (salvo > 0) tam = Math.min(salvo, 5000);
            } catch (e) {}
            Paginador._estado[chave] = { pagina: 1, tamanho: tam };
        }
        return Paginador._estado[chave];
    },

    // Corta a lista e devolve so o pedaco da pagina atual.
    // Se a lista encolheu (um filtro, por exemplo), volta para uma pagina valida
    // em vez de mostrar uma tela vazia sem explicacao.
    fatiar(chave, lista) {
        const e     = Paginador.estado(chave);
        const total = lista.length;
        const paginas = Math.max(1, Math.ceil(total / e.tamanho));
        if (e.pagina > paginas) e.pagina = paginas;
        if (e.pagina < 1)       e.pagina = 1;
        const ini = (e.pagina - 1) * e.tamanho;
        const fim = Math.min(ini + e.tamanho, total);
        return {
            itens: lista.slice(ini, fim),
            pagina: e.pagina, paginas, total,
            primeiro: total ? ini + 1 : 0, ultimo: fim,
            tamanho: e.tamanho,
        };
    },

    ir(chave, pagina, recarregar) {
        const e = Paginador.estado(chave);
        e.pagina = Math.max(1, parseInt(pagina) || 1);
        Paginador._recarregar(recarregar);
    },

    setTamanho(chave, valor, recarregar) {
        const e = Paginador.estado(chave);
        const n = parseInt(valor);
        if (!(n > 0)) return;
        e.tamanho = Math.min(n, 5000);
        e.pagina  = 1;                 // troca de tamanho volta para o inicio
        try { localStorage.setItem('sp_pag_' + chave, String(e.tamanho)); } catch (err) {}
        Paginador._recarregar(recarregar);
    },

    // Aceita "Modulo.metodo" e chama com seguranca (sem eval solto no onclick)
    _recarregar(nome) {
        try {
            const partes = String(nome || '').split('.');
            let alvo = window;
            for (const pt of partes) { if (!alvo) return; alvo = alvo[pt]; }
            if (typeof alvo === 'function') alvo();
        } catch (e) { console.warn('[Paginador] nao consegui recarregar:', e.message); }
    },

    // Barra de controles. `recarregar` e o nome da funcao que redesenha a tela.
    controles(chave, info, recarregar) {
        if (!info.total) return '';
        const r    = Security.sanitize(recarregar);
        const k    = Security.sanitize(chave);
        const pers = !Paginador.TAMANHOS.includes(info.tamanho);
        const opts = Paginador.TAMANHOS
            .map(t => `<option value="${t}" ${t === info.tamanho ? 'selected' : ''}>${t}</option>`).join('')
            + `<option value="__custom" ${pers ? 'selected' : ''}>Outro${pers ? ' (' + info.tamanho + ')' : ''}...</option>`;

        const btn = (rotulo, destino, ativo, titulo) =>
            `<button class="btn-3d btn-gray" title="${titulo}" ${ativo ? '' : 'disabled'}
                style="padding:5px 9px; font-size:0.78rem; ${ativo ? '' : 'opacity:.35; cursor:default;'}"
                onclick="Paginador.ir('${k}', ${destino}, '${r}')">${rotulo}</button>`;

        const temAntes  = info.pagina > 1;
        const temDepois = info.pagina < info.paginas;

        return `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;
                    background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:8px 12px; margin-bottom:10px;">
            <div style="display:flex; align-items:center; gap:8px; font-size:0.8rem; color:#475569;">
                <span>Mostrar</span>
                <select class="big-input" style="width:auto; padding:4px 8px; font-size:0.8rem;"
                    onchange="Paginador._trocaTamanho('${k}', this, '${r}')">${opts}</select>
                <span>por pagina</span>
            </div>
            <div style="font-size:0.8rem; color:#64748b; font-family:'Roboto Mono',monospace;">
                ${info.primeiro}–${info.ultimo} de <b>${info.total}</b>
            </div>
            <div style="display:flex; align-items:center; gap:5px;">
                ${btn('<i class="fas fa-angle-double-left"></i>', 1, temAntes, 'Primeira pagina')}
                ${btn('<i class="fas fa-angle-left"></i>', info.pagina - 1, temAntes, 'Pagina anterior')}
                <span style="font-size:0.8rem; color:#475569; padding:0 6px; white-space:nowrap;">
                    Pag. <b>${info.pagina}</b> de ${info.paginas}
                </span>
                ${btn('<i class="fas fa-angle-right"></i>', info.pagina + 1, temDepois, 'Proxima pagina')}
                ${btn('<i class="fas fa-angle-double-right"></i>', info.paginas, temDepois, 'Ultima pagina')}
            </div>
        </div>`;
    },

    // "Outro..." abre o campo para digitar a quantidade
    async _trocaTamanho(chave, sel, recarregar) {
        if (sel.value !== '__custom') { Paginador.setTamanho(chave, sel.value, recarregar); return; }
        const atual = Paginador.estado(chave).tamanho;
        const v = await Modal.prompt('Itens por pagina',
            'Quantos itens exibir por pagina? (1 a 5000)', String(atual), String(atual));
        if (v === null) { Paginador._recarregar(recarregar); return; }   // cancelou: redesenha com o valor antigo
        const n = parseInt(v);
        if (!(n > 0)) { Toast.warn('Informe um numero maior que zero.'); Paginador._recarregar(recarregar); return; }
        Paginador.setTamanho(chave, n, recarregar);
    },
};

// ============================================================
// MODULO: UI (Navegacao e Utilitarios Visuais)
// ============================================================
const UI = {
    // navMain: navegacao unificada — prefixos "tab-" e "adm-" unificados
    navUser(tab)  { UI.navMain(tab); },
    navAdm(tab)   { UI.navMain(tab); },

    navMain(tab) {
        document.querySelectorAll('#mainNav .nav-item').forEach(el => {
            el.classList.toggle('active', el.dataset && el.dataset.tab === tab);
        });
        document.querySelectorAll('#mainApp .section').forEach(s => {
            s.style.display = 'none';
            s.classList.remove('active');
        });
        // Resolve o ID correto do elemento: tenta tab-X, adm-X, ou o proprio ID direto
        var resolvedId = tab === 'dashboard_adm' ? 'adm-dashboard' : tab;
        var el = document.getElementById('tab-' + resolvedId)
               || document.getElementById('adm-' + resolvedId)
               || document.getElementById(resolvedId);
        if (el) { el.style.display = 'block'; el.classList.add('active'); }
        // v17.05 — a aba que ABRE se atualiza aqui. Assim o triggerRefresh pode
        // redesenhar SO o que esta na tela (veja o comentario la embaixo) sem
        // risco de o usuario trocar de aba e encontrar dado velho.
        if (tab === 'stock_manage') {
            setTimeout(function() { try { StockAdmin.renderMapManager(); } catch (e) {} }, 40);
        }
        if (tab === 'dashboard') {
            setTimeout(function() { try { HistoryModule.render(); } catch (e) {} }, 40);
        }
        if (tab === 'users') {
            setTimeout(function() { try { UserAdmin.renderList(); } catch (e) {} }, 40);
        }
        if (tab === 'devolucao') {
            setTimeout(() => { Devolucao.reset(); const inp = document.getElementById('devSingleInput'); if (inp) inp.focus(); }, 50);
        }
        if (tab === 'adm-stockdash') {
            setTimeout(function() {
                // Cada um em seu try: um erro nos graficos novos nao pode
                // derrubar os KPIs e a ocupacao por carro, que ja funcionavam.
                try { if (typeof StockDash !== 'undefined') StockDash.update(); }
                catch (e) { console.warn('[StockDash]', e.message); }
                try { if (typeof DashMMT !== 'undefined') DashMMT.render(); }
                catch (e) { console.warn('[DashMMT]', e.message); }
            }, 80);
        }
        if (tab === 'ranking') {
            setTimeout(function() { if (typeof Ranking !== 'undefined') Ranking.render(); }, 80);
        }
        if (tab === 'confirmacao') {
            setTimeout(function() { if (typeof ListConfirm !== 'undefined') ListConfirm.render(); }, 80);
        }
        if (tab === 'consumo') {   // v17.07: so calcula quando a aba e aberta
            setTimeout(function() { if (typeof Consumo !== 'undefined') Consumo.render(); }, 80);
        }
        if (tab === 'etiquetas') {
            setTimeout(function() { if (typeof Etiquetas !== 'undefined') Etiquetas.render(); }, 80);
        }
        if (tab === 'dashboard_adm') {
            setTimeout(function() { if (typeof AdminDash !== 'undefined') AdminDash.update(); }, 80);
        }
    },

    // Avisa UMA vez que a biblioteca de graficos nao carregou. Sem isto o
    // usuario ve a tela sem grafico e nao tem como saber que o problema e a
    // internet bloqueada, nao o sistema.
    _avisarGraficoIndisponivel(e) {
        if (UI._jaAvisouGrafico) return;
        if (typeof Chart !== 'undefined') return;   // era outro erro, nao a falta da lib
        UI._jaAvisouGrafico = true;
        try {
            Toast.warn('Os graficos nao carregaram: a biblioteca vem da internet e este PC parece sem acesso. ' +
                       'O resto do sistema funciona normalmente.', 9000);
        } catch (err) {}
    },

    buildNav() {
        const isAdmin  = State.currentUser && State.currentUser.isAdmin;
        const isViewer = State.currentUser && State.currentUser.isViewer;
        const nav = document.getElementById('mainNav');
        if (!nav) return;
        UI._menuLateral();   // v17.06: abas na barra lateral

        // Modo viewer: apenas a aba Gestao Estoque
        if (isViewer) {
            nav.innerHTML = '';
            nav.style.gridTemplateColumns = '1fr';
            const div = document.createElement('div');
            div.className   = 'nav-item active';
            div.dataset.tab = 'stock_manage';
            div.innerHTML   = '<i class="fas fa-boxes"></i><span>Gestao de Estoque</span>';
            div.onclick     = function() { UI.navMain('stock_manage'); };
            nav.appendChild(div);
            UI.navMain('stock_manage');
            return;
        }

        const tabs = [
            { tab: 'feeder',        icon: 'fa-list-check',     label: 'Comparador',     admin: false },
            { tab: 'devolucao',     icon: 'fa-dolly',           label: 'Devolucao',      admin: false },
            { tab: 'estoque',       icon: 'fa-search-location', label: 'Busca Avulsa',   admin: false },
            { tab: 'dashboard',     icon: 'fa-chart-pie',       label: 'Historico',      admin: false },
            { tab: 'confirmacao',   icon: 'fa-clipboard-check', label: 'Confirmacao',    admin: false },
            { tab: 'etiquetas',     icon: 'fa-barcode',         label: 'Etiquetas',      admin: false },
            { tab: 'ranking',       icon: 'fa-trophy',           label: 'Ranking',        admin: false },
            { tab: 'stock_manage',  icon: 'fa-boxes',           label: 'Estoque',        admin: false },
            { tab: 'users',         icon: 'fa-users-cog',       label: 'Sistema',        admin: true  },
            { tab: 'adm-stockdash', icon: 'fa-chart-bar',       label: 'Dashboard',      admin: true  },
            { tab: 'dashboard_adm', icon: 'fa-exclamation-triangle', label: 'ALERTA', admin: true  },
            { tab: 'consumo',       icon: 'fa-scale-balanced',  label: 'Consumo',        admin: true  },
        ];
        nav.innerHTML = '';
        const visible = tabs.filter(function(t) { return Perms.can('tab:' + t.tab); });
        nav.style.gridTemplateColumns = 'repeat(' + visible.length + ', 1fr)';
        var firstTab = null;
        var temSep = false;
        visible.forEach(function(t) {
            if (!firstTab) firstTab = t.tab;
            // v17.06: rotulo separando as abas de administrador
            if (t.admin && !temSep) {
                temSep = true;
                const sep = document.createElement('div');
                sep.className = 'nav-sep';
                sep.textContent = 'Administracao';
                nav.appendChild(sep);
            }
            const div = document.createElement('div');
            div.title = t.label;   // com o menu recolhido, o nome aparece no mouse
            div.className = 'nav-item' + (t.admin ? ' admin-only' : '');
            div.dataset.tab = t.tab;
            div.innerHTML = '<i class="fas ' + t.icon + '"></i><span>' + t.label + '</span>';
            div.onclick = (function(tab){ return function(){ UI.navMain(tab); }; })(t.tab);
            nav.appendChild(div);
        });
        UI.navMain(firstTab || 'feeder');
    },

    // ==================================================================
    // v17.06 — MENU LATERAL (css/05-menu-lateral.css)
    // Liga a barra lateral e cria, uma unica vez, o botao redondo que
    // recolhe/expande. F9 faz o mesmo. A escolha fica lembrada neste PC.
    // ==================================================================
    _menuLateral() {
        document.body.classList.add('com-menu');
        if (document.getElementById('btnRecolherMenu')) return;
        const CHAVE = 'sp_menu_recolhido';
        const btn = document.createElement('button');
        btn.id = 'btnRecolherMenu'; btn.type = 'button'; btn.className = 'no-print';
        const aplicar = (recolhido) => {
            document.body.classList.toggle('menu-recolhido', recolhido);
            btn.innerHTML = '<i class="fas fa-chevron-' + (recolhido ? 'right' : 'left') + '"></i>';
            btn.title = recolhido ? 'Mostrar o menu (F9)' : 'Recolher o menu (F9)';
            try { localStorage.setItem(CHAVE, recolhido ? '1' : '0'); } catch (e) {}
        };
        btn.onclick = () => aplicar(!document.body.classList.contains('menu-recolhido'));
        document.addEventListener('keydown', e => { if (e.key === 'F9') { e.preventDefault(); btn.onclick(); } });
        let recolhido = window.innerWidth <= 768;
        try { const v = localStorage.getItem(CHAVE); if (v !== null && window.innerWidth > 768) recolhido = v === '1'; } catch (e) {}
        aplicar(recolhido);
        document.body.appendChild(btn);
    },

    showCard(id) {
        ['userLoginCard','firstAccessCard'].forEach(c => {
            document.getElementById(c).style.display = c === id ? 'block' : 'none';
        });
    },

    showAdmLogin() { /* removido - login ADM unificado com usuarios */ },
    hideAdmLogin() { /* removido */ },
    closeUserDetailModal() { document.getElementById('userDetailModal').style.display = 'none'; },

    updateAttemptDots(used, max) {
        const container = document.getElementById('loginAttemptDots');
        if (!container) return;
        container.innerHTML = Array.from({length: max}, (_, i) =>
            `<div class="attempt-dot ${i < used ? 'used' : ''}"></div>`
        ).join('');
    },

    unlockLoginStep() {
        const dbStep = document.getElementById('dbStepContainer');
        dbStep.style.borderColor = 'var(--ind-green)';
        dbStep.style.background  = '#ecfdf5';
        document.getElementById('dbStatusIcon').className = 'fas fa-check-circle';
        document.getElementById('dbStatusIcon').style.color = 'var(--ind-green)';

        const btnDb = document.getElementById('btnImportDb');
        btnDb.className = 'btn-3d btn-green';
        btnDb.innerHTML = '<i class="fas fa-check"></i> CONECTADO COM SUCESSO';
        btnDb.style.pointerEvents = 'none';

        const loginStep = document.getElementById('loginStepContainer');
        loginStep.style.opacity = '1';
        loginStep.style.pointerEvents = 'auto';
        document.getElementById('loginStepTitle').style.color = 'var(--tpv-dark-blue)';

        // Habilita o botao "VER ESTOQUE" apos conectar o banco
        const btnViewer = document.getElementById('btnViewerAccess');
        if (btnViewer) {
            btnViewer.style.opacity = '1';
            btnViewer.style.pointerEvents = 'auto';
            btnViewer.title = 'Acessar o estoque sem login';
        }

        document.getElementById('userMatricula').focus();
    },

    copyDbPath() {
        const val = document.getElementById('dbPathInput').value;
        navigator.clipboard.writeText(val).then(() => {
            Toast.success('Endereco copiado!', 2000);
        }).catch(() => {
            Toast.warn('Falha ao copiar. Copie manualmente.');
        });
    },

    _checkFileSize() { /* removido */ },
    showFileSizeHelp() { /* removido */ },

    showSaveIndicator(msg = '<i class="fas fa-sync fa-spin"></i> Salvando...', isError = false) {
        const ind = document.getElementById('saveIndicator');
        ind.innerHTML = msg;
        ind.style.background = isError ? 'var(--ind-red)' : 'var(--ind-dark)';
        ind.style.display = 'block';
        setTimeout(() => ind.style.display = 'none', 2500);
    },

    populateAuditCarSelect() {
        const sel = document.getElementById('auditBulkCarSelect');
        if (!sel) return;
        const cars = [...new Set(State.validLocations.map(l => l.car))].sort((a,b) => a.localeCompare(b,undefined,{numeric:true}));
        sel.innerHTML = '<option value="">-- Selecione --</option>' + cars.map(c => `<option value="${c}">${c}</option>`).join('');
    },

    // Qual aba esta na tela agora (ou null)
    _abaAtual() {
        const el = document.querySelector('#mainNav .nav-item.active');
        return el && el.dataset ? el.dataset.tab : null;
    },

    // ==================================================================
    // triggerRefresh — roda a CADA sincronismo, ou seja, toda vez que
    // QUALQUER PC grava qualquer coisa.
    //
    // Antes redesenhava TUDO: o mapa do estoque, o historico, a lista de
    // usuarios e o dashboard — mesmo as abas que ninguem estava olhando.
    // Com varios PCs trabalhando, isso deixava o sistema arrastado o tempo
    // todo, sem nada aparecendo na tela em troca.
    //
    // Agora redesenha SO a aba visivel. As outras se atualizam quando sao
    // abertas (veja navMain), entao ninguem ve dado velho.
    // ==================================================================
    triggerRefresh(skipFeeder = false) {
        const isViewer = State.currentUser && State.currentUser.isViewer;
        const aba = UI._abaAtual();

        if (aba === 'stock_manage' || isViewer) {
            try {
                if (State.selectedMapCar) StockAdmin.renderLocEditor(State.selectedMapCar);
                StockAdmin.renderMapManager();
            } catch (e) { console.warn('[triggerRefresh] estoque:', e.message); }
        }

        if (aba === 'dashboard' && !isViewer) {
            try { HistoryModule.render(); } catch (e) { console.warn('[triggerRefresh] historico:', e.message); }
        }

        if (!State.isKittingRevealed) {
            const sc = document.getElementById('searchResultsContainer');
            if (sc && sc.style.display === 'block') Kitting.execute(true);
        }

        if (aba === 'users' && Perms.can('tab:users')) {
            try { UserAdmin.renderList(); } catch (e) {}
        }

        // v17.02 — ISOLAMENTO DE FALHA.
        // O AdminDash desenha com a Chart.js, que vem de CDN. Num PC sem
        // internet `Chart` nao existe, o update() lancava "Chart is not
        // defined" e MATAVA o resto desta funcao: o Comparador parava de
        // recalcular e o contador de online congelava, sem ninguem entender
        // por que. Cada etapa agora falha sozinha, sem derrubar as outras.
        try {
            if (aba === 'dashboard_adm' && Perms.can('tab:dashboard_adm')) AdminDash.update();
        } catch (e) {
            console.warn('[triggerRefresh] AdminDash falhou (segue o resto):', e.message);
            UI._avisarGraficoIndisponivel(e);
        }

        try {
            if (aba === 'feeder' && State.rawFeederData && !skipFeeder && !State._reprintMode) Feeder.recalcMatches();
        } catch (e) { console.warn('[triggerRefresh] Feeder falhou:', e.message); }

        // Atualiza contador de usuarios online (atividade nos ultimos 30 minutos)
        try { UI._updateOnlineUsers(); } catch (e) {}
    },

    _updateOnlineUsers() {
        const indicator = document.getElementById('onlineUsersIndicator');
        const countEl   = document.getElementById('onlineUsersCount');
        if (!indicator || !countEl) return;
        const CUT = Date.now() - 30 * 60 * 1000; // 30 minutos
        const activeMatriculas = new Set(
            (State.logs || [])
                .filter(l => l.timestamp >= CUT && l.matricula && l.matricula !== 'SISTEMA')
                .map(l => l.matricula)
        );
        const count = activeMatriculas.size;
        countEl.textContent = count;
        indicator.style.display = State.isConnected ? 'inline-block' : 'none';
        indicator.title = count === 1
            ? '1 usuario ativo nos ultimos 30 minutos'
            : count + ' usuarios ativos nos ultimos 30 minutos';
    },
};
