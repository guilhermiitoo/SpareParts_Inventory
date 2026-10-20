// ==========================================================================
// SPARE PARTS - 30-admin.js (extraido do v16.32)
// ==========================================================================

const UserAdmin = {
    async addUser() {
        const name = document.getElementById('newUserName').value.trim();
        const mat  = document.getElementById('newUserMat').value.trim().toUpperCase();
        if (!name || !mat) { Toast.warn('Preencha nome e matricula.'); return; }
        if (mat.length > 5) { Toast.warn('Matricula deve ter no maximo 5 caracteres.'); return; }
        if (State.users.some(u => u.matricula === mat)) { Toast.error('Matricula ja cadastrada.'); return; }

        const roleRadio = document.querySelector('input[name="newUserRole"]:checked');
        const isAdmin   = roleRadio ? roleRadio.value === 'admin' : false;
        State.users.push({ nome: Security.sanitize(name), matricula: Security.sanitize(mat), passwordHash: null, isAdmin });
        await DB.saveNow();
        UserAdmin.renderList();
        document.getElementById('newUserName').value = '';
        document.getElementById('newUserMat').value  = '';
        Toast.success(`Usuario ${name} criado! No primeiro acesso, ele definira sua senha.`);
        Logs.log('USER_CREATED', `Admin criou usuario: ${name} (${mat})`);
    },

    async changeAdmPassword() {
        const newPass = document.getElementById('newAdmPass').value;
        if (!newPass || newPass.length < 4) { Toast.warn('Senha deve ter pelo menos 4 caracteres.'); return; }
        const ok = await Modal.confirm('Alterar Senha ADM', 'Confirma a alteracao da senha administrativa?', 'Alterar', true);
        if (!ok) return;

        State.adminConfig.passwordHash = await Security.hashPassword(newPass);
        delete State.adminConfig.password; // Remove senha legada em texto plano se existir
        await DB.saveNow();
        document.getElementById('newAdmPass').value = '';
        Toast.success('Senha ADM alterada com sucesso!');
        Logs.log('ADM_PASS_CHANGE', 'Senha administrativa alterada');
    },

    renderList() {
        const listDiv = document.getElementById('userList');
        if (!listDiv) return;
        if (State.users.length === 0) {
            listDiv.innerHTML = '<div style="color:#94a3b8; text-align:center; font-style:italic;">Nenhum usuario cadastrado.</div>';
            return;
        }
        listDiv.innerHTML = State.users.map(u => {
            const isAdm  = u.isAdmin;
            const badge  = isAdm
                ? '<span style="background:var(--ind-red); color:white; padding:2px 8px; border-radius:10px; font-size:0.7rem; font-weight:800; margin-left:6px;"><i class="fas fa-shield-alt"></i> ADMIN</span>'
                : '<span style="background:var(--tpv-blue); color:white; padding:2px 8px; border-radius:10px; font-size:0.7rem; font-weight:800; margin-left:6px;"><i class="fas fa-user"></i> OPERACIONAL</span>';
            const _nPerm = Perms.countOverrides(u);
            const _permBadge = _nPerm
                ? `<span title="${_nPerm} permissao(oes) ajustada(s) manualmente" style="background:#166534; color:white; padding:2px 8px; border-radius:10px; font-size:0.7rem; font-weight:800; margin-left:6px;"><i class="fas fa-user-shield"></i> ${_nPerm} AJUSTE${_nPerm>1?'S':''}</span>`
                : '';
            const toggleLabel = isAdm ? 'Tornar Operacional' : 'Tornar Admin';
            const toggleColor = isAdm ? 'btn-blue' : 'btn-red';
            const toggleIcon  = isAdm ? 'fa-user' : 'fa-shield-alt';
            return `
            <div class="user-card" style="align-items:flex-start;">
                <div style="flex:1;">
                    <div style="font-weight:bold; display:flex; align-items:center; flex-wrap:wrap; gap:4px;">
                        ${Security.sanitize(u.nome)} ${badge}${_permBadge}
                    </div>
                    <div style="font-size:0.8rem; color:#64748b; margin-top:3px;">
                        Matricula: ${Security.sanitize(u.matricula)} |
                        Senha: ${u.passwordHash ? '<span style="color:var(--ind-green);">DEFINIDA</span>' : '<span style="color:var(--ind-yellow);">PENDENTE</span>'}
                    </div>
                </div>
                <div style="display:flex; gap:5px; flex-wrap:wrap; margin-top:4px;">
                    <button class="btn-3d btn-green" style="padding:5px 8px; font-size:0.7rem;" title="Ajustar permissoes de telas e acoes"
                        onclick="Perms.open('${Security.sanitize(u.matricula)}')">
                        <i class="fas fa-user-shield"></i> Permissoes
                    </button>
                    <button class="btn-3d ${toggleColor}" style="padding:5px 8px; font-size:0.7rem;" title="${toggleLabel}"
                        onclick="UserAdmin.toggleRole('${Security.sanitize(u.matricula)}')">
                        <i class="fas ${toggleIcon}"></i> ${toggleLabel}
                    </button>
                    <button class="btn-3d btn-yellow" style="padding:5px 8px; font-size:0.75rem;" title="Redefinir Senha"
                        onclick="UserAdmin.resetPass('${Security.sanitize(u.matricula)}')">
                        <i class="fas fa-key"></i>
                    </button>
                    <button class="btn-3d btn-red" style="padding:5px 8px; font-size:0.75rem;" title="Excluir"
                        onclick="UserAdmin.deleteUser('${Security.sanitize(u.matricula)}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>`;
        }).join('');
    },

    async toggleRole(matricula) {
        const user = State.users.find(u => u.matricula === matricula);
        if (!user) return;
        const newRole  = !user.isAdmin;
        const label    = newRole ? 'ADMINISTRADOR' : 'OPERACIONAL';
        const ok = await Modal.confirm(
            'Alterar Perfil',
            'Alterar o perfil de ' + Security.sanitize(user.nome) + ' para ' + label + '?',
            'Confirmar Alteracao', newRole
        );
        if (!ok) return;
        user.isAdmin = newRole;
        await DB.saveNow();
        UserAdmin.renderList();
        Toast.success('Perfil de ' + user.nome + ' alterado para ' + label + '.');
        Logs.log('USER_ROLE_CHANGE', 'Perfil alterado: ' + user.matricula + ' -> ' + label);
    },

    async resetPass(matricula) {
        const ok = await Modal.confirm('Redefinir Senha', `Redefinir a senha de ${matricula}? O usuario tera que criar uma nova no proximo acesso.`, 'Redefinir', true);
        if (!ok) return;
        const user = State.users.find(u => u.matricula === matricula);
        if (user) { user.passwordHash = null; await DB.saveNow(); UserAdmin.renderList(); Toast.success('Senha redefinida. Usuario deve criar nova senha no proximo login.'); }
    },

    async deleteUser(matricula) {
        const ok = await Modal.confirm('Excluir Usuario', `Excluir o usuario ${matricula} permanentemente?`, 'Excluir', true);
        if (!ok) return;
        State.users = State.users.filter(u => u.matricula !== matricula);
        await DB.saveNow(); UserAdmin.renderList();
        Toast.success('Usuario excluido.');
    },

    // -------------------------------------------------------
    // Exportar Banco Compacto: estoque + usuarios + historico recente
    // -------------------------------------------------------
    async exportCleanDB() {
        const statusEl = document.getElementById('exportDbStatus');

        if (!window.showSaveFilePicker) {
            Toast.error('Seu navegador nao suporta File System Access API. Use Chrome ou Edge.');
            return;
        }

        const totalSlots = (State.validLocations || []).length;
        const totalItens = (State.inventory || []).filter(i => i.code).length;

        const ok = await Modal.confirm(
            'Exportar Banco Compacto',
            `Sera gerado um novo arquivo com:\n\n• Estoque completo (${totalItens} posicoes preenchidas de ${totalSlots} total)\n• ${State.users.length} usuarios (senhas preservadas)\n• Historico zerado (sem registros anteriores)\n• Logs zerados\n\nO arquivo sera salvo no formato compacto (menor tamanho).`,
            'Exportar', false
        );
        if (!ok) return;

        try {
            if (statusEl) { statusEl.style.color = 'var(--tpv-blue)'; statusEl.textContent = 'Abrindo seletor de arquivo...'; }

            const handle = await window.showSaveFilePicker({
                suggestedName: `TPV_Estoque_${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.json`,
                types: [{ description: 'JSON Database', accept: { 'application/json': ['.json'] } }],
            });

            // Gera slots compactos com estoque atual (igual ao _buildPayload mas sem historico)
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

            const cleanPayload = {
                slots,
                users:            State.users,
                logs:             [],
                checkoutHistory:  [],
                adminConfig:      State.adminConfig,
                componentCatalog: State.componentCatalog || [],
                _meta: {
                    exportedAt:    new Date().toISOString(),
                    exportedBy:    State.currentUser?.nome || 'ADM',
                    totalSlots:    slots.length,
                    filledSlots:   slots.filter(s => s.k).length,
                },
            };

            const json = JSON.stringify(cleanPayload);

            if (statusEl) statusEl.textContent = 'Gravando arquivo...';
            const writable = await handle.createWritable();
            await writable.write(json);
            await writable.close();

            const cleanKb = Math.round(json.length / 1024);

            if (statusEl) {
                statusEl.style.color = 'var(--ind-green)';
                statusEl.textContent = `Exportado com sucesso! Tamanho: ${cleanKb} KB (historico zerado)`;
            }

            Toast.success(`Banco exportado! ${cleanKb} KB — estoque completo, historico zerado.`);
            Logs.log('EXPORT_CLEAN_DB', `Exportou banco compacto sem historico (${cleanKb}KB)`);

        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error(e);
                if (statusEl) { statusEl.style.color = 'var(--ind-red)'; statusEl.textContent = 'Erro: ' + e.message; }
                Toast.error('Erro ao exportar: ' + e.message);
            }
        }
    },

    // -------------------------------------------------------
    // Criar Banco em Branco: apenas usuarios e senha ADM
    // -------------------------------------------------------
    async createBlankDB() {
        const ok = await Modal.confirm(
            'Criar Banco em Branco',
            'Sera criado um arquivo JSON novo e vazio. Os logins e a senha ADM atual serao copiados. Estoque e historico NAO serao incluidos. Apos criar, o sistema sera recarregado.',
            'Criar em Branco', true
        );
        if (!ok) return;

        try {
            if (!window.showSaveFilePicker) {
                Toast.error('Seu navegador nao suporta File System Access API. Use Chrome ou Edge.');
                return;
            }

            const handle = await window.showSaveFilePicker({
                suggestedName: `TPV_Novo_${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.json`,
                types: [{ description: 'JSON Database', accept: { 'application/json': ['.json'] } }],
            });

            // Mantem usuarios e config ADM. Zera todo o resto.
            const blankPayload = {
                inventory:       [],
                validLocations:  [],
                users:           State.users.map(u => ({ ...u })), // copia profunda
                logs:            [],
                checkoutHistory: [],
                adminConfig:     { ...State.adminConfig },
                _meta: {
                    createdAt: new Date().toISOString(),
                    createdBy: State.currentUser?.nome || 'ADM',
                    note: 'Banco em branco criado via TPV Vision',
                },
            };

            const json = JSON.stringify(blankPayload);
            const writable = await handle.createWritable();
            await writable.write(json);
            await writable.close();

            Toast.success('Banco em branco criado! O sistema sera recarregado em 3 segundos...');
            Logs.log('CREATE_BLANK_DB', 'Criou novo banco em branco (so usuarios preservados)');
            setTimeout(() => location.reload(), 3000);

        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error(e);
                Toast.error('Erro ao criar banco: ' + e.message);
            }
        }
    },
};

// ============================================================
// MODULO: GESTAO DO SISTEMA — controle de sub-abas
// ============================================================
// ============================================================
// IMPORTAR BANCO NO FORMATO ANTIGO (.json de arquivo unico)
// Usado para trazer uma base que ainda rodava no formato antigo, ou para
// VOLTAR um backup. E destrutivo, entao a tela mostra o que vai entrar e o
// que vai sair ANTES de perguntar, e a copia de seguranca e automatica.
// ============================================================
const ImportarBanco = {

    async escolherArquivo() {
        if (!DB.guard('Importar banco')) return;
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.json,application/json';
        inp.onchange = () => {
            const arq = inp.files && inp.files[0];
            if (arq) ImportarBanco._processar(arq);
        };
        inp.click();
    },

    _status(html, cor) {
        const el = document.getElementById('importDbStatus');
        if (el) { el.innerHTML = html; el.style.color = cor || '#64748b'; }
    },

    async _processar(arq) {
        ImportarBanco._status('<i class="fas fa-spinner fa-spin"></i> Lendo ' + Security.sanitize(arq.name) + '...', '#0369a1');

        let dados;
        try {
            dados = JSON.parse(await arq.text());
        } catch (e) {
            ImportarBanco._status('<i class="fas fa-circle-xmark"></i> Arquivo ilegivel: ' + Security.sanitize(e.message), '#b91c1c');
            return;
        }

        const check = Store.inspecionarBancoAntigo(dados);
        if (!check.ok) {
            ImportarBanco._status('<i class="fas fa-circle-xmark"></i> ' + Security.sanitize(check.erro), '#b91c1c');
            Toast.error('Este arquivo nao e um banco valido do Spare Parts.', 7000);
            return;
        }

        // Compara o que ESTA na pasta com o que VEM no arquivo, para a decisao
        // ser informada e nao um "confirma?" no escuro.
        const r = check.resumo;
        const atual = {
            locacoes:    (State.validLocations || []).length,
            comMaterial: (State.inventory || []).filter(i => i && i.code).length,
            usuarios:    (State.users || []).length,
            catalogo:    (State.componentCatalog || []).length,
            movimentos:  (State.checkoutHistory || []).length,
            carros:      Object.keys(State.carMaterialType || {}).length,
        };
        const linha = (rot, a, b) => {
            const dif = b - a;
            const cor = dif > 0 ? '#15803d' : dif < 0 ? '#b91c1c' : '#64748b';
            const sinal = dif > 0 ? '+' + dif : dif < 0 ? String(dif) : '=';
            return `<tr>
                <td style="padding:3px 10px 3px 0;">${rot}</td>
                <td style="padding:3px 10px; text-align:right; color:#64748b;">${a.toLocaleString('pt-BR')}</td>
                <td style="padding:3px 10px; text-align:center; color:#cbd5e1;">&rarr;</td>
                <td style="padding:3px 10px; text-align:right; font-weight:bold;">${b.toLocaleString('pt-BR')}</td>
                <td style="padding:3px 0 3px 10px; text-align:right; color:${cor}; font-weight:bold;">${sinal}</td>
            </tr>`;
        };

        const corpo = `
            <div style="font-size:0.86rem; line-height:1.5;">
                Arquivo: <b>${Security.sanitize(arq.name)}</b>
                ${r.backupEm ? `<br>Backup de: <b>${Security.sanitize(r.backupEm)}</b>` : ''}
            </div>
            <table style="width:100%; font-size:0.84rem; margin:12px 0; border-collapse:collapse;">
                <tr style="color:#64748b; font-size:0.72rem; text-transform:uppercase;">
                    <th style="text-align:left; padding-bottom:4px;"></th>
                    <th style="text-align:right; padding-bottom:4px;">agora</th><th></th>
                    <th style="text-align:right; padding-bottom:4px;">depois</th>
                    <th style="text-align:right; padding-bottom:4px;">dif.</th>
                </tr>
                ${linha('Locacoes',        atual.locacoes,    r.locacoes)}
                ${linha('Com material',    atual.comMaterial, r.comMaterial)}
                ${linha('Usuarios',        atual.usuarios,    r.usuarios)}
                ${linha('Itens no catalogo', atual.catalogo,  r.catalogo)}
                ${linha('Carros tipados',  atual.carros,      r.carros)}
            </table>
            <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:6px; padding:10px 13px; font-size:0.82rem; color:#92400e; line-height:1.5;">
                <b>O estoque, os usuarios e o catalogo da pasta serao SUBSTITUIDOS.</b><br>
                Os ${r.movimentos.toLocaleString('pt-BR')} movimentos do arquivo sao <b>acrescentados</b> ao historico — nenhum movimento e apagado.<br>
                Uma copia do estado atual e guardada em <code>dados/_antes_do_import_...</code>.
            </div>`;

        const ok = await Modal.confirm('Importar banco', corpo, 'IMPORTAR E SUBSTITUIR', true);
        if (!ok) { ImportarBanco._status('Importacao cancelada.', '#64748b'); return; }

        ImportarBanco._status('<i class="fas fa-spinner fa-spin"></i> Importando... nao feche a janela.', '#0369a1');
        try {
            const res = await Store.importarBancoAntigo(dados);

            // recarrega o State a partir do que acabou de ser gravado
            DB._applyParsed(await Store.montarPayloadCompleto());
            Familias.invalidar();
            try { FamiliasUI._invalidar(); } catch (e) {}
            UI.buildNav();
            UI.triggerRefresh(true);

            ImportarBanco._status(
                `<i class="fas fa-circle-check"></i> Importado. ${res.movimentosNovos} movimento(s) novo(s). `
                + `Copia de seguranca em <code>${Security.sanitize(res.seguranca.pasta)}</code>.`, '#15803d');
            Logs.log('IMPORT_BANCO', 'Banco importado de arquivo (' + res.resumo.locacoes + ' locacoes, '
                     + res.resumo.usuarios + ' usuarios)');
            Toast.success('Banco importado. Os outros PCs vao pegar a atualizacao no proximo sincronismo.', 9000);
        } catch (e) {
            ImportarBanco._status('<i class="fas fa-circle-xmark"></i> ' + Security.sanitize(e.message), '#b91c1c');
            Toast.error('Falha ao importar: ' + e.message, 10000);
        }
    },
};

window.ImportarBanco = ImportarBanco;

const GestaoSistema = {
    showTab(tab) {
        ['usuarios', 'banco', 'catalogo', 'config', 'familias'].forEach(t => {
            const panel = document.getElementById('gsPanel-' + t);
            const btn   = document.getElementById('gsTab' + t.charAt(0).toUpperCase() + t.slice(1));
            if (panel) panel.style.display = t === tab ? 'block' : 'none';
            if (btn) {
                if (t === tab) {
                    btn.style.borderBottomColor = 'var(--ind-red)';
                    btn.style.background        = '#fef2f2';
                    btn.style.color             = 'var(--ind-red)';
                } else {
                    btn.style.borderBottomColor = 'transparent';
                    btn.style.background        = '#fff';
                    btn.style.color             = '#64748b';
                }
            }
        });
        if (tab === 'catalogo') Catalog.render();
        if (tab === 'config')   SysConfig.renderCarList();
        if (tab === 'banco')    { AutoBackup.statusUI(); }
        if (tab === 'familias') FamiliasUI.render();
    },
};

// ============================================================
// MODULO: CONFIGURACOES DO SISTEMA
// ============================================================

const SysConfig = {
    MATERIAL_TYPES: ['NXT', 'XP', 'PTH'],

    renderCarList() {
        const container = document.getElementById('sysConfigCarList');
        if (!container) return;
        const cars = [...new Set((State.validLocations || []).map(l => l.car))]
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        if (cars.length === 0) {
            container.innerHTML = '<div style="color:#94a3b8; font-style:italic;">Nenhum carro cadastrado.</div>';
            return;
        }
        container.innerHTML = cars.map(car => {
            const current = (State.carMaterialType || {})[car] || '';
            const opts = ['', ...SysConfig.MATERIAL_TYPES].map(v =>
                `<option value="${v}" ${v === current ? 'selected' : ''}>${v === '' ? '— Nao definido —' : v}</option>`
            ).join('');
            return `
            <div style="background:white; border:1px solid #e2e8f0; border-radius:6px; padding:12px 14px; display:flex; align-items:center; gap:10px;">
                <div style="font-family:'Roboto Mono',monospace; font-weight:900; color:var(--tpv-dark-blue); min-width:60px;">${Security.sanitize(car)}</div>
                <select id="sysCarType_${Security.sanitize(car)}" class="big-input" style="flex:1; padding:7px 10px; font-size:0.88rem;">
                    ${opts}
                </select>
            </div>`;
        }).join('');
    },

    async saveCarTypes() {
        if (!DB.guard('Salvar Configuracoes')) return;
        const cars = [...new Set((State.validLocations || []).map(l => l.car))];
        const map = {};
        cars.forEach(car => {
            const sel = document.getElementById('sysCarType_' + car);
            if (sel && sel.value) map[car] = sel.value;
        });
        State.carMaterialType = map;
        await DB.saveNow();
        Toast.success('Configuracoes salvas!');
    },
};

window.SysConfig = SysConfig;

// ============================================================
// MODULO: CATALOGO DE COMPONENTES
// ============================================================
const Catalog = {
    // Normaliza codigo: upper, sem espacos extras
    _norm(code) { return (code || '').trim().toUpperCase(); },

    add() {
        if (!DB.guard()) return;
        const code = this._norm(document.getElementById('catCode')?.value || '');
        const desc = (document.getElementById('catDesc')?.value || '').trim();
        if (!code) { Toast.warn('Informe o codigo do componente.'); return; }
        if (!desc) { Toast.warn('Informe a descricao do componente.'); return; }

        State.componentCatalog = State.componentCatalog || [];
        const existing = State.componentCatalog.find(c => c.code === code);
        if (existing) {
            existing.description = desc;
            Toast.success('Descricao atualizada: ' + code);
        } else {
            State.componentCatalog.push({ code, description: desc });
            Toast.success('Componente cadastrado: ' + code);
        }
        State.componentCatalog.sort((a, b) => a.code.localeCompare(b.code));
        DB.invalidateCatalogCache();
        document.getElementById('catCode').value = '';
        document.getElementById('catDesc').value = '';
        DB.save();
        this.render();
    },

    remove(code) {
        State.componentCatalog = (State.componentCatalog || []).filter(c => c.code !== code);
        DB.invalidateCatalogCache();
        DB.save();
        this.render();
        Toast.success('Componente removido.');
    },

    // Importa todos os codigos unicos do estoque que ainda nao estao no catalogo
    importFromStock() {
        if (!DB.guard()) return;
        const catalog = State.componentCatalog || [];
        const existing = new Set(catalog.map(c => c.code));
        const stockCodes = [...new Set((State.inventory || []).map(i => this._norm(i.code)).filter(Boolean))];
        const toAdd = stockCodes.filter(c => !existing.has(c));
        if (toAdd.length === 0) { Toast.info('Todos os codigos do estoque ja estao no catalogo.'); return; }
        toAdd.forEach(code => State.componentCatalog.push({ code, description: '' }));
        State.componentCatalog.sort((a, b) => a.code.localeCompare(b.code));
        DB.invalidateCatalogCache();
        DB.save();
        this.render();
        Toast.success(toAdd.length + ' codigos importados do estoque. Adicione as descricoes.');
    },

    // Importa codigos e descricoes de um Excel (colunas "Material" e "Texto breve material")
    importFromXlsx(input) {
        if (!DB.guard()) { input.value = ''; return; }
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
                if (!rows.length) { Toast.warn('Planilha vazia.'); input.value = ''; return; }

                // Localiza colunas de forma flexivel (aceita variacoes de nome)
                const keys = Object.keys(rows[0]);
                const findKey = (aliases) => keys.find(k => {
                    const n = k.toString().trim().toLowerCase();
                    return aliases.some(a => n === a || n.includes(a));
                });
                const codeKey = findKey(['material', 'codigo', 'código']);
                const descKey = findKey(['texto breve material', 'texto breve', 'descricao', 'descrição', 'texto']);

                if (!codeKey) { Toast.error('Coluna "Material" nao encontrada na planilha.'); input.value = ''; return; }

                State.componentCatalog = State.componentCatalog || [];
                const map = new Map(State.componentCatalog.map(c => [c.code, c]));
                let added = 0, updated = 0;

                rows.forEach(r => {
                    const code = this._norm(r[codeKey]);
                    if (!code) return;
                    const desc = descKey ? (r[descKey] || '').toString().trim() : '';
                    if (map.has(code)) {
                        if (desc) { map.get(code).description = desc; updated++; }
                    } else {
                        const obj = { code, description: desc };
                        map.set(code, obj);
                        State.componentCatalog.push(obj);
                        added++;
                    }
                });

                State.componentCatalog.sort((a, b) => a.code.localeCompare(b.code));
                DB.invalidateCatalogCache();
                DB.save();
                this.render();
                Toast.success(added + ' adicionados, ' + updated + ' atualizados do Excel.');
            } catch (err) {
                Toast.error('Erro ao ler o Excel: ' + err.message);
            }
            input.value = '';
        };
        reader.onerror = () => { Toast.error('Falha ao ler o arquivo.'); input.value = ''; };
        reader.readAsArrayBuffer(file);
    },

    exportXlsx() {
        const catalog = State.componentCatalog || [];
        if (catalog.length === 0) { Toast.warn('Catalogo vazio.'); return; }
        const ws = XLSX.utils.json_to_sheet(catalog.map(c => ({ 'CODIGO': c.code, 'DESCRICAO': c.description || '' })));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Catalogo');
        XLSX.writeFile(wb, 'Catalogo_Componentes_MMT.xlsx');
        Toast.success('Exportado com sucesso.');
    },

    // Busca um componente pelo codigo — retorna objeto ou null
    findByCode(code) {
        const norm = this._norm(code);
        return (State.componentCatalog || []).find(c => c.code === norm) || null;
    },

    // Busca por descricao ou codigo — retorna array de matches
    search(query) {
        if (!query) return State.componentCatalog || [];
        const q = query.trim().toLowerCase();
        return (State.componentCatalog || []).filter(c =>
            c.code.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q)
        );
    },

    render() {
        const catalog = State.componentCatalog || [];
        const countEl = document.getElementById('catalogCount');
        if (countEl) countEl.textContent = catalog.length;

        const query   = (document.getElementById('catSearch')?.value || '');
        const rows    = this.search(query);
        const tbody   = document.getElementById('catalogTableBody');
        if (!tbody) return;

        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#94a3b8; padding:30px;">' +
                (query ? 'Nenhum componente encontrado para "' + Security.sanitize(query) + '".' : 'Catalogo vazio. Cadastre componentes ou importe do estoque.') +
                '</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(c => `
            <tr>
                <td style="font-family:'Roboto Mono',monospace; font-weight:800; color:var(--tpv-blue);">${Security.sanitize(c.code)}</td>
                <td style="color:#334155;">${c.description ? Security.sanitize(c.description) : '<span style="color:#94a3b8; font-style:italic;">sem descricao</span>'}</td>
                <td style="text-align:center;">
                    <button onclick="Catalog._editInline('${c.code.replace(/'/g,"\\'")}', this)" style="background:none; border:none; color:var(--tpv-blue); cursor:pointer; font-size:0.85rem; font-weight:700; margin-right:6px;" title="Editar"><i class="fas fa-edit"></i></button>
                    <button onclick="Catalog.remove('${c.code.replace(/'/g,"\\'")}');" style="background:none; border:none; color:var(--ind-red); cursor:pointer; font-size:0.85rem; font-weight:700;" title="Remover"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('');
    },

    _editInline(code, btn) {
        const row  = btn.closest('tr');
        const td   = row.querySelector('td:nth-child(2)');
        const item = (State.componentCatalog || []).find(c => c.code === this._norm(code));
        if (!item || !td) return;
        const oldDesc = item.description || '';
        td.innerHTML = `<input type="text" value="${Security.sanitize(oldDesc)}" style="width:100%; padding:6px 10px; font-size:0.9rem; border:2px solid var(--tpv-blue); border-radius:4px; font-family:Roboto,sans-serif;" onkeydown="if(event.key==='Enter'){ Catalog._saveInline('${code.replace(/'/g,"\\'")}', this); } if(event.key==='Escape') Catalog.render();">`;
        td.querySelector('input').focus();
        td.querySelector('input').select();
    },

    _saveInline(code, input) {
        const item = (State.componentCatalog || []).find(c => c.code === this._norm(code));
        if (!item) return;
        item.description = input.value.trim();
        DB.save();
        this.render();
        Toast.success('Descricao atualizada.');
    },
};
