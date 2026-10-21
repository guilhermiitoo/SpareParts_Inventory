// ==========================================================================
// MODULO: STORE  (v17.00) — A PASTA E O BANCO DE DADOS
// --------------------------------------------------------------------------
// SUBSTITUI o arquivo JSON unico por uma PASTA com varios arquivos.
//
// POR QUE:
//   No arquivo unico, gravar 1 devolucao reescrevia TUDO — inclusive os
//   ~7.900 itens do catalogo (~600KB) que nao mudam ha semanas. E todo PC
//   da rede baixava o arquivo inteiro a cada alteracao de qualquer colega.
//
// COMO FICOU:
//   Cada assunto tem seu proprio arquivo e so e gravado quando ELE muda.
//   O historico e os logs viraram append-only: grava so a linha nova.
//
//   dados/
//     indice.json       <- manifesto (1KB). E o unico arquivo que o sync le.
//     catalogo.json     <- ~600KB, muda 1x por mes
//     estoque.json      <- slots + tipo de material por carro
//     sistema.json      <- usuarios, permissoes, adminConfig
//     ranking.json      <- weeklyStats
//     caixas.json       <- boxSessions
//     movimentos/2026-09-17__PC-a1b2c3.jsonl   <- 1 arquivo por PC por dia
//     logs/2026-09-17__PC-a1b2c3.jsonl
//
// A REGRA DE OURO DO SHARD:
//   Cada PC so escreve nos arquivos que levam o SEU identificador. Dois PCs
//   nunca disputam o mesmo arquivo de historico — a colisao deixa de ser
//   "improvavel" e passa a ser IMPOSSIVEL, por construcao. Ler e so juntar
//   as partes. (O que mantem escrita compartilhada — estoque, sistema — usa
//   o read-before-write + merge que ja existia no DB.)
//
// AUTORIZACAO:
//   E pedida UMA VEZ, para a PASTA. Todos os arquivos dentro dela ficam
//   acessiveis sem nenhum prompt adicional. O handle fica memorizado no
//   IndexedDB deste PC, entao nas proximas aberturas sao ZERO cliques.
//
// COMPATIBILIDADE:
//   Este modulo produz e consome EXATAMENTE o mesmo formato de objeto que o
//   JSON antigo (_buildPayload / _applyParsed). Por isso nenhum dos outros
//   modulos do sistema precisou ser alterado.
// ==========================================================================
const Store = {

    ESQUEMA:      17,
    PASTA_DADOS: 'dados',
    PASTA_MOV:   'movimentos',
    PASTA_LOGS:  'logs',
    INDICE:      'indice.json',

    // Dominios de ESTADO: arquivo JSON reescrito inteiro, mas so quando muda.
    DOMINIOS: ['catalogo', 'estoque', 'sistema', 'ranking', 'caixas'],
    ARQ: {
        catalogo: 'catalogo.json',
        estoque:  'estoque.json',
        sistema:  'sistema.json',
        ranking:  'ranking.json',
        caixas:   'caixas.json',
    },

    // Quantos dias de historico ficam CARREGADOS EM MEMORIA.
    // Identico ao comportamento antigo (7 dias) para nao alterar ranking nem
    // dashboards. O ARQUIVO guarda tudo para sempre — quem quiser um periodo
    // maior usa Store.lerHistoricoPeriodo(), sem mexer neste numero.
    DIAS_MEMORIA: 7,

    // ---- handles ----
    _raiz:  null,   // pasta escolhida pelo usuario (SPARE_PARTS)
    _dados: null,   // dados/
    _mov:   null,   // dados/movimentos/
    _logs:  null,   // dados/logs/

    // ---- controle ----
    _indice:  null,          // objeto do indice como esta no disco
    _bruto:   {},            // ultimo JSON conhecido de cada dominio (dedup)
    // Conteudo ANTERIOR de cada dominio. E a "base" do merge de 3 vias do DB:
    // precisa ser o que este PC conhecia ANTES da leitura atual, senao o merge
    // confunde "mudanca do colega" com "mudanca minha" e descarta a do colega.
    _brutoAnterior: {},
    _pcId:    null,
    _movEscrito: new Map(),  // id do movimento -> JSON da ultima linha gravada
    _logEscrito: new Set(),  // chave de log ja gravado por este PC
    _lido:    {},            // shard -> bytes ja consumidos
    _resto:   {},            // shard -> linha incompleta pendente
    _ultimoBak: {},          // arquivo -> quando a ultima copia .bak foi feita
    _movArquivo: new Map(),  // id -> registro COMO ESTA no arquivo (versao mais rica)
    _movCache: new Map(),    // id -> { _s, rec }  (tudo que ja veio do disco)
    _seqTk: 0,               // sequencia local, para dois writes no mesmo ms

    // ======================================================================
    // TOKEN DE GRAVACAO — a marca que diz "esta e a versao X do arquivo".
    //
    // ANTES ERA UM CONTADOR (v1, v2, v3...) INCREMENTADO POR CADA PC, e isso
    // causava PERDA DE DADOS SILENCIOSA:
    //   PC-A e PC-B leem v2, os dois gravam, os dois escrevem "v3".
    //   Como o numero bate, o sync de cada um conclui "nada mudou" e NUNCA
    //   mais rele aquele arquivo. Os dois ficam divergentes para sempre.
    //
    // O token carrega o PC e uma sequencia, entao duas maquinas NUNCA produzem
    // o mesmo valor. Token diferente = conteudo diferente = tem de reler.
    // ======================================================================
    _novoToken() {
        Store._seqTk = (Store._seqTk + 1) % 100000;
        return Date.now().toString(36) + '-' + Store.pcId() + '-' + Store._seqTk;
    },

    // Token de um dominio dentro de um indice. Aceita o formato antigo ({v:N})
    // para que uma pasta gravada pela versao anterior continue abrindo.
    _tokenDe(indice, dom) {
        const a = (indice && indice.arquivos && indice.arquivos[dom]) || {};
        return a.tk || ('v' + (a.v || 0));
    },

    // ======================================================================
    // IDENTIFICADOR DESTE PC
    // ======================================================================
    pcId() {
        if (Store._pcId) return Store._pcId;
        let id = null;
        try { id = localStorage.getItem('sp_pc_id'); } catch (e) {}
        if (!id) {
            id = 'PC-' + Math.random().toString(36).slice(2, 8).toUpperCase();
            try { localStorage.setItem('sp_pc_id', id); } catch (e) {}
        }
        Store._pcId = id;
        return id;
    },

    // Nome amigavel que o admin pode definir (aparece no nome dos arquivos)
    renomearPc(nome) {
        const limpo = String(nome || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20);
        if (!limpo) return false;
        try { localStorage.setItem('sp_pc_id', limpo); } catch (e) {}
        Store._pcId = limpo;
        return true;
    },

    _hoje() {
        const d = new Date(), p = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    },

    _shardHoje(prefixo) { return Store._hoje() + '__' + Store.pcId() + '.jsonl'; },

    // ======================================================================
    // PRIMITIVAS DE ARQUIVO
    // ======================================================================
    async _lerTexto(dir, nome) {
        try {
            const fh = await dir.getFileHandle(nome);
            return await (await fh.getFile()).text();
        } catch (e) {
            if (e.name === 'NotFoundError') return null;
            throw e;
        }
    },

    // Gravacao com verificacao. Em rede SMB a falha tipica e o arquivo sair
    // TRUNCADO — por isso conferimos o tamanho depois de gravar, e mantemos
    // a versao anterior em .bak para dar de onde voltar.
    // bak=false pula a copia de seguranca (usado no indice, que e reconstruivel).
    async _gravarTexto(dir, nome, txt, bak = true, semVerificar = false) {
        const bytes = new TextEncoder().encode(txt).length;

        // Copia de seguranca da versao anterior — no maximo 1x a cada 5 min por
        // arquivo. Sem esse limite, o .bak DOBRARIA os bytes de toda gravacao,
        // desfazendo justamente a economia que este modulo existe para dar.
        const agoraBak = Date.now();
        const deveBak  = bak && (agoraBak - (Store._ultimoBak[nome] || 0) > 5 * 60 * 1000);
        try {
            const antigo = deveBak ? await Store._lerTexto(dir, nome) : null;
            if (antigo && antigo !== txt) {
                const bh = await dir.getFileHandle(nome + '.bak', { create: true });
                const bw = await bh.createWritable();
                await bw.write(antigo);
                await bw.close();
                Store._ultimoBak[nome] = agoraBak;
            }
        } catch (e) { /* .bak e opcional, nunca impede a gravacao */ }

        const fh = await dir.getFileHandle(nome, { create: true });
        const w  = await fh.createWritable();
        await w.write(txt);
        await w.close();

        // Verificacao de integridade. So vale quando temos exclusividade: sem
        // a trava, outro PC pode ter sobrescrito o arquivo entre o nosso write
        // e esta leitura, e o erro apontaria "gravacao incompleta" quando na
        // verdade houve escrita concorrente — diagnostico errado.
        if (!semVerificar) {
            const conf = await fh.getFile();
            if (conf.size !== bytes) {
                throw new Error(`gravacao incompleta em ${nome} (${conf.size} de ${bytes} bytes)`);
            }
        }
        return bytes;
    },

    // Append puro: escreve SO os bytes novos no fim do arquivo.
    // Como o arquivo e exclusivo deste PC, nao existe disputa.
    async _anexar(dir, nome, txt) {
        const fh  = await dir.getFileHandle(nome, { create: true });
        const f   = await fh.getFile();
        const pos = f.size;
        const w   = await fh.createWritable({ keepExistingData: true });
        await w.seek(pos);
        await w.write(txt);
        await w.close();
        return pos + new TextEncoder().encode(txt).length;
    },

    // ======================================================================
    // TRAVA DE ESCRITA (dados/.lock)
    //
    // POR QUE PRECISA EXISTIR
    //   Os arquivos de dominio (estoque, sistema, ranking...) sao escritos por
    //   TODOS os PCs. Comparar versoes antes de gravar reduz a janela, mas nao
    //   a elimina: se dois PCs conferem no mesmo instante, os dois passam e os
    //   dois escrevem — um apaga a alteracao do outro, e ainda da para ler um
    //   arquivo pela metade. Foi exatamente o que acontecia quando duas pessoas
    //   faziam uma devolucao no mesmo segundo.
    //
    // COMO FUNCIONA (escreve-e-confere)
    //   Nao existe "criar se nao existir" atomico na File System Access API.
    //   Entao: escrevemos a nossa marca no .lock, esperamos um instante e
    //   RELEMOS. Se a marca que ficou no arquivo e a nossa, a trava e nossa —
    //   quando dois PCs escrevem juntos, o servidor de arquivos serializa e o
    //   ultimo vence; o outro le uma marca alheia e espera a vez.
    //
    //   Trava com mais de LOCK_VALIDADE e considerada abandonada (o PC pode
    //   ter travado ou perdido a rede), senao um micro travado pararia a
    //   fabrica inteira.
    // ======================================================================
    LOCK: '.lock',
    LOCK_VALIDADE: 8000,        // ms — depois disso a trava e dada como orfa
    LOCK_ESPERA_MAX: 6000,      // ms — quanto tempo tentamos pegar a trava

    async _obterLock() {
        const meu = Store.pcId() + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
        const inicio = Date.now();
        const pausa = (ms) => new Promise(r => setTimeout(r, ms));

        while (Date.now() - inicio < Store.LOCK_ESPERA_MAX) {
            // alguem tem a trava e ela ainda esta viva?
            const atual = await Store._lerTexto(Store._dados, Store.LOCK);
            if (atual) {
                let o = null;
                try { o = JSON.parse(atual); } catch (e) { o = null; }
                if (o && o.id !== meu && (Date.now() - (o.ts || 0)) < Store.LOCK_VALIDADE) {
                    await pausa(40 + Math.random() * 90);
                    continue;
                }
            }

            // marca como nossa e confere quem ficou
            await Store._gravarTexto(Store._dados, Store.LOCK,
                JSON.stringify({ id: meu, pc: Store.pcId(), ts: Date.now() }), false, true);
            await pausa(25 + Math.random() * 45);

            const conf = await Store._lerTexto(Store._dados, Store.LOCK);
            try { if (JSON.parse(conf).id === meu) return meu; } catch (e) {}
            await pausa(40 + Math.random() * 120);   // perdemos a disputa: tenta de novo
        }
        return null;
    },

    async _liberarLock(meu) {
        try {
            const atual = await Store._lerTexto(Store._dados, Store.LOCK);
            // so apaga se a trava ainda for NOSSA: se expirou e outro PC pegou,
            // apagar aqui derrubaria a trava dele
            if (atual && JSON.parse(atual).id === meu) {
                await Store._dados.removeEntry(Store.LOCK);
            }
        } catch (e) { /* trava ja removida ou ilegivel: segue */ }
    },

    // ======================================================================
    // CONEXAO E MIGRACAO
    // ======================================================================
    // Diz se a pasta ja tem um banco (dados/indice.json). NAO cria nada.
    async _temIndiceAntigo(dh) {
        try {
            const dados = await dh.getDirectoryHandle(Store.PASTA_DADOS);   // SEM create
            await dados.getFileHandle(Store.INDICE);
            return true;
        } catch (e) { return false; }
    },

    async conectar(dirHandle) {
        Store._raiz  = dirHandle;
        Store._dados = await dirHandle.getDirectoryHandle(Store.PASTA_DADOS, { create: true });
        Store._mov   = await Store._dados.getDirectoryHandle(Store.PASTA_MOV,  { create: true });
        Store._logs  = await Store._dados.getDirectoryHandle(Store.PASTA_LOGS, { create: true });

        const txtIdx = await Store._lerTexto(Store._dados, Store.INDICE);

        if (txtIdx) {
            Store._indice = JSON.parse(txtIdx);
            if ((Store._indice.schema || 0) > Store.ESQUEMA) {
                throw new Error('Esta pasta foi criada por uma versao MAIS NOVA do sistema. Atualize o SPARE_PARTS.html deste PC.');
            }
            return { estado: 'aberto' };
        }

        // Sem indice: ou e a primeira vez, ou existe um JSON no formato antigo.
        const legado = await Store._acharLegado();
        if (legado) {
            await Store._migrar(legado.dados, legado.dir, legado.nome);
            return { estado: 'migrado', origem: legado.nome, registros: (legado.dados.checkoutHistory || []).length };
        }

        await Store._criarVazio();
        return { estado: 'novo' };
    },

    // Procura um JSON no formato antigo, na raiz e em dados/.
    async _acharLegado(pastas) {
        for (const dir of (pastas || [Store._raiz, Store._dados])) {
            if (!dir) continue;
            try {
                for await (const [nome, h] of dir.entries()) {
                    if (h.kind !== 'file' || !nome.toLowerCase().endsWith('.json')) continue;
                    if (nome === Store.INDICE || nome.includes('_MIGRADO_')) continue;
                    if (Object.values(Store.ARQ).includes(nome)) continue;
                    try {
                        const txt = await (await h.getFile()).text();
                        if (!txt.trim()) continue;
                        const d = JSON.parse(txt);
                        // assinatura do banco antigo
                        if ((d.slots || d.inventory) && d.users) return { dados: d, dir, nome };
                    } catch (e) { /* nao era o nosso JSON */ }
                }
            } catch (e) { /* pasta ilegivel: tenta a proxima */ }
        }
        return null;
    },

    // Explode o JSON antigo na estrutura nova. NAO apaga nada: o arquivo
    // original e apenas renomeado para _MIGRADO_<data>.json.bak.
    async _migrar(d, dirOrigem, nomeOrigem) {
        const agora = Date.now();

        await Store._gravarDominio('catalogo', { componentCatalog: d.componentCatalog || [] });
        await Store._gravarDominio('estoque',  {
            slots:           d.slots || null,
            inventory:       d.slots ? undefined : (d.inventory || []),
            validLocations:  d.slots ? undefined : (d.validLocations || []),
            carMaterialType: d.carMaterialType || {},
        });
        // v17.01: o JSON antigo pode trazer senha em texto puro — nao repassa.
        await Store._gravarDominio('sistema',
            SenhaLimpa.paraGravar(d.users || [], d.adminConfig || { passwordHash: '', attempts: 0 }));
        await Store._gravarDominio('ranking',  { weeklyStats: d.weeklyStats || {} });
        await Store._gravarDominio('caixas',   { boxSessions: d.boxSessions || [] });

        // historico e logs vao para o shard de hoje deste PC
        const hist = (d.checkoutHistory || []).filter(h => h && h.id);
        if (hist.length) {
            const linhas = hist.map(h => JSON.stringify(Store._linhaMov(h, agora))).join('\n') + '\n';
            const nome = Store._shardHoje();
            const fim  = await Store._anexar(Store._mov, nome, linhas);
            Store._lido[nome] = fim;
            hist.forEach(h => {
                Store._movEscrito.set(String(h.id), Store._canonico(h));
                // COPIA: o _applyParsed poda os registros de State.checkoutHistory
                // em memoria. Guardar a mesma referencia aqui faria a poda apagar
                // tambem a versao "do arquivo" — e o arquivo perderia os itens.
                Store._movArquivo.set(String(h.id), { ...h });
                // IMPORTANTE: marcamos o shard como ja lido acima, entao os
                // registros precisam entrar no cache aqui — senao a primeira
                // leitura apos a migracao volta com o historico VAZIO.
                Store._movCache.set(String(h.id), { _s: agora, rec: h });
            });
        }
        const logs = (d.logs || []).filter(l => l && l.timestamp);
        if (logs.length) {
            const linhas = logs.map(l => JSON.stringify(l)).join('\n') + '\n';
            const nome = Store._shardHoje();
            await Store._anexar(Store._logs, nome, linhas);
            logs.forEach(l => Store._logEscrito.add(l.timestamp + '_' + l.matricula));
        }

        Store._indice = Store._indiceNovo();
        Store._indice.lastAutoBackupDate = d.lastAutoBackupDate || null;
        Store._indice.lastBackupInfo     = d.lastBackupInfo     || null;
        Store._indice.migradoDe          = nomeOrigem;
        Store._indice.migradoEm          = agora;
        await Store._gravarIndice();

        // renomeia o legado (copia + remove) para nao ser migrado de novo
        try {
            const txt  = JSON.stringify(d);
            const novo = '_MIGRADO_' + Store._hoje() + '__' + nomeOrigem + '.bak';
            await Store._gravarTexto(dirOrigem, novo, txt);
            await dirOrigem.removeEntry(nomeOrigem);
        } catch (e) {
            console.warn('[Store] legado preservado, mas nao foi possivel renomear:', e.message);
        }
    },

    async _criarVazio() {
        await Store._gravarDominio('catalogo', { componentCatalog: [] });
        await Store._gravarDominio('estoque',  { slots: [], carMaterialType: {} });
        await Store._gravarDominio('sistema',  { users: [], adminConfig: { passwordHash: '', attempts: 0 } });
        await Store._gravarDominio('ranking',  { weeklyStats: {} });
        await Store._gravarDominio('caixas',   { boxSessions: [] });
        Store._indice = Store._indiceNovo();
        await Store._gravarIndice();
    },

    _indiceNovo() {
        const idx = { schema: Store.ESQUEMA, ts: Date.now(), arquivos: {}, movimentos: {}, logs: {} };
        Store.DOMINIOS.forEach(d => { idx.arquivos[d] = { tk: Store._novoToken(), t: Date.now() }; });
        return idx;
    },

    // ======================================================================
    // IMPORTAR UM BANCO NO FORMATO ANTIGO (.json de arquivo unico)
    //
    // Para que serve: trocar o conteudo da pasta pelo de um .json — seja para
    // trazer a base de producao que ainda rodava no formato antigo, seja para
    // VOLTAR um backup depois de um acidente.
    //
    // E DESTRUTIVO: substitui estoque, usuarios, catalogo e configuracoes.
    // Por isso, antes de escrever qualquer coisa, os arquivos atuais sao
    // copiados para dados/_antes_do_import_<data-hora>/ — se o arquivo
    // importado estiver errado, da para voltar.
    //
    // O historico do .json NAO substitui os movimentos ja gravados: ele e
    // ACRESCENTADO ao shard deste PC. Movimento nenhum se perde, nem os que ja
    // estavam na pasta, nem os que vem no arquivo.
    // ======================================================================

    // Confere se o objeto tem cara de banco do sistema, e resume o que vem.
    // Devolve { ok, erro, resumo } — a tela mostra o resumo ANTES de confirmar.
    inspecionarBancoAntigo(d) {
        if (!d || typeof d !== 'object') return { ok: false, erro: 'o arquivo nao e um objeto JSON' };
        const temEstoque = Array.isArray(d.slots) || Array.isArray(d.inventory);
        if (!temEstoque)         return { ok: false, erro: 'nao encontrei "slots" nem "inventory" — este nao parece um banco do Spare Parts' };
        if (!Array.isArray(d.users)) return { ok: false, erro: 'nao encontrei a lista de usuarios' };
        if (!d.users.length)     return { ok: false, erro: 'o arquivo nao tem nenhum usuario: ninguem conseguiria entrar' };

        const slots = d.slots || [];
        return {
            ok: true,
            resumo: {
                locacoes:   Array.isArray(d.slots) ? d.slots.length : (d.validLocations || []).length,
                comMaterial: Array.isArray(d.slots) ? slots.filter(x => x && x.k).length
                                                    : (d.inventory || []).filter(i => i && i.code).length,
                usuarios:   d.users.length,
                catalogo:   (d.componentCatalog || []).length,
                movimentos: (d.checkoutHistory || []).length,
                carros:     Object.keys(d.carMaterialType || {}).length,
                backupEm:   d.lastAutoBackupDate || null,
            },
        };
    },

    // Guarda os arquivos atuais antes de sobrescrever.
    async _copiaDeSeguranca() {
        const carimbo = Store._hoje() + '_' + new Date().toTimeString().slice(0, 5).replace(':', 'h');
        const nome = '_antes_do_import_' + carimbo;
        const destino = await Store._dados.getDirectoryHandle(nome, { create: true });
        let n = 0;
        for (const dom of Store.DOMINIOS) {
            const txt = await Store._lerTexto(Store._dados, Store.ARQ[dom]);
            if (txt === null) continue;
            await Store._gravarTexto(destino, Store.ARQ[dom], txt, false);
            n++;
        }
        const idx = await Store._lerTexto(Store._dados, Store.INDICE);
        if (idx !== null) { await Store._gravarTexto(destino, Store.INDICE, idx, false); n++; }
        return { pasta: nome, arquivos: n };
    },

    async importarBancoAntigo(d) {
        const check = Store.inspecionarBancoAntigo(d);
        if (!check.ok) throw new Error(check.erro);

        const lock = await Store._obterLock();
        if (!lock) throw new Error('a pasta esta ocupada por outro PC. Peca para fecharem o sistema e tente de novo.');

        try {
            const seguranca = await Store._copiaDeSeguranca();

            // --- dominios de estado ---
            await Store._gravarDominio('catalogo', { componentCatalog: d.componentCatalog || [] });
            await Store._gravarDominio('estoque', {
                slots:           d.slots || null,
                inventory:       d.slots ? undefined : (d.inventory || []),
                validLocations:  d.slots ? undefined : (d.validLocations || []),
                carMaterialType: d.carMaterialType || {},
            });
            await Store._gravarDominio('sistema', Object.assign(
                SenhaLimpa.paraGravar(d.users || [], d.adminConfig || { passwordHash: '', attempts: 0 }),
                { materialFamilies: d.materialFamilies || State.materialFamilies || [],
                  stockLimits:      d.stockLimits      || State.stockLimits      || null,
                  unclassified:     d.unclassified     || State.unclassified     || null }));
            await Store._gravarDominio('ranking', { weeklyStats: d.weeklyStats || {} });
            await Store._gravarDominio('caixas',  { boxSessions: d.boxSessions || [] });

            // --- historico: ACRESCENTA, nunca substitui ---
            const agora = Date.now();
            const hist = (d.checkoutHistory || []).filter(h => h && h.id);
            const novos = hist.filter(h => !Store._movArquivo.has(String(h.id)));
            if (novos.length) {
                const linhas = novos.map(h => JSON.stringify(Store._linhaMov(h, agora))).join('\n') + '\n';
                const nome = Store._shardHoje();
                const fim = await Store._anexar(Store._mov, nome, linhas);
                Store._lido[nome] = fim;
                (Store._indice.movimentos = Store._indice.movimentos || {})[nome] = fim;
                novos.forEach(h => {
                    const id = String(h.id);
                    Store._movEscrito.set(id, Store._canonico(h));
                    Store._movArquivo.set(id, { ...h });
                    Store._movCache.set(id, { _s: agora, rec: h });
                });
            }

            // --- indice com tokens NOVOS: todos os PCs vao detectar e reler ---
            Store.DOMINIOS.forEach(dom => {
                Store._indice.arquivos[dom] = { tk: Store._novoToken(), t: Date.now() };
            });
            Store._indice.schema = Store.ESQUEMA;
            Store._indice.ts = Date.now();
            Store._indice.importadoEm = agora;
            if (d.lastAutoBackupDate) Store._indice.lastAutoBackupDate = d.lastAutoBackupDate;
            if (d.lastBackupInfo)     Store._indice.lastBackupInfo     = d.lastBackupInfo;
            await Store._gravarIndice();

            return { seguranca, movimentosNovos: novos.length, resumo: check.resumo };

        } finally {
            await Store._liberarLock(lock);
        }
    },

    // ======================================================================
    // LEITURA
    // ======================================================================
    async _lerDominio(dom) {
        const txt = await Store._lerTexto(Store._dados, Store.ARQ[dom]);
        if (txt === null) return {};
        try {
            Store._brutoAnterior[dom] = Store._bruto[dom];   // base para o merge de 3 vias
            Store._bruto[dom] = txt;
            return JSON.parse(txt);
        } catch (e) {
            // arquivo corrompido: tenta a copia de seguranca
            console.warn(`[Store] ${Store.ARQ[dom]} ilegivel, tentando .bak`, e.message);
            const bak = await Store._lerTexto(Store._dados, Store.ARQ[dom] + '.bak');
            if (bak) {
                try {
                    const d = JSON.parse(bak);
                    Toast.warn(`Arquivo ${Store.ARQ[dom]} estava corrompido e foi recuperado da copia de seguranca.`, 8000);
                    return d;
                } catch (e2) { /* .bak tambem perdido */ }
            }
            throw new Error(`Arquivo ${Store.ARQ[dom]} corrompido e sem copia valida.`);
        }
    },

    // Monta o payload COMPLETO, no mesmo formato do JSON antigo.
    // E isto que permite chamar DB._applyParsed() sem alterar nada.
    async montarPayloadCompleto() {
        const out = {};
        for (const dom of Store.DOMINIOS) Object.assign(out, await Store._lerDominio(dom));

        const corte = Date.now() - Store.DIAS_MEMORIA * 86400 * 1000;
        out.checkoutHistory = await Store._lerMovimentos(corte, true);
        out.logs            = await Store._lerLogs(200);

        const idx = Store._indice || {};
        out.lastAutoBackupDate = idx.lastAutoBackupDate || null;
        out.lastBackupInfo     = idx.lastBackupInfo     || null;
        out.forceLogout        = idx.forceLogout        || null;
        return out;
    },

    // Le os shards de movimento. `desde` = timestamp minimo.
    // `registrarPos` = true guarda ate onde leu, para as proximas leituras
    // so pegarem o que foi acrescentado (leitura incremental de cauda).
    async _lerMovimentos(desde, registrarPos) {
        const porId = Store._movCache;
        for await (const [nome, h] of Store._mov.entries()) {
            if (h.kind !== 'file' || !nome.endsWith('.jsonl')) continue;
            // o nome comeca com a data: descarta shards anteriores a janela
            const dia = nome.slice(0, 10);
            if (desde && dia < new Date(desde).toISOString().slice(0, 10)) continue;
            await Store._consumirShard(h, nome, porId, registrarPos);
        }
        const out = [];
        porId.forEach(v => { if (!desde || (v.rec.timestamp || 0) >= desde) out.push(v.rec); });
        return out.sort((a, b) => b.timestamp - a.timestamp);
    },

    // Le um shard a partir de onde parou. Nunca processa linha pela metade:
    // se o arquivo estiver sendo escrito agora, o pedaco incompleto fica
    // guardado e e completado na proxima passada.
    async _consumirShard(fh, nome, porId, registrarPos) {
        const f    = await fh.getFile();
        const de   = Store._lido[nome] || 0;
        if (f.size <= de) return 0;

        const txt  = (Store._resto[nome] || '') + await f.slice(de).text();
        const corteN = txt.lastIndexOf('\n');
        if (corteN < 0) { Store._resto[nome] = txt; if (registrarPos) Store._lido[nome] = f.size; return 0; }

        const usavel = txt.slice(0, corteN);
        Store._resto[nome] = txt.slice(corteN + 1);
        if (registrarPos) Store._lido[nome] = f.size;

        let n = 0;
        for (const linha of usavel.split('\n')) {
            if (!linha.trim()) continue;
            let rec;
            try { rec = JSON.parse(linha); } catch (e) { continue; }  // linha torta: ignora
            if (!rec || !rec.id) continue;
            const id  = String(rec.id);
            const seq = rec._s || rec.timestamp || 0;
            const ja  = porId.get(id);
            // LEITURA MONOTONICA: uma linha mais nova NUNCA apaga campos que uma
            // linha mais antiga tinha. Sem isso, bastava um PC gravar a versao
            // ja podada de uma lista (sem removedItems) para a lista de itens
            // sumir do arquivo permanente — e ela nao voltaria nunca mais.
            if (!ja) {
                porId.set(id, { _s: seq, rec });
                n++;
            } else if (seq >= ja._s) {
                porId.set(id, { _s: seq, rec: Store._enriquecer(rec, ja.rec) });
                n++;
            } else {
                // linha mais antiga chegando depois (outro shard): so completa
                ja.rec = Store._enriquecer(ja.rec, rec);
            }
            const antes = Store._movArquivo.get(id);
            Store._movArquivo.set(id, Store._enriquecer(porId.get(id).rec, antes));
        }
        return n;
    },

    async _lerLogs(limite) {
        const todos = [];
        for await (const [nome, h] of Store._logs.entries()) {
            if (h.kind !== 'file' || !nome.endsWith('.jsonl')) continue;
            const txt = await (await h.getFile()).text();
            for (const linha of txt.split('\n')) {
                if (!linha.trim()) continue;
                try { todos.push(JSON.parse(linha)); } catch (e) {}
            }
        }
        return todos.sort((a, b) => b.timestamp - a.timestamp).slice(0, limite || 200);
    },

    // ----------------------------------------------------------------------
    // HISTORICO COMPLETO — o arquivo guarda tudo, sem limite de dias.
    // (No formato antigo, o que passava de 7 dias era DESCARTADO do JSON.)
    // ----------------------------------------------------------------------
    async lerHistoricoPeriodo(de, ate) {
        const dDe  = new Date(de ).toISOString().slice(0, 10);
        const dAte = new Date(ate).toISOString().slice(0, 10);
        const porId = new Map();
        for await (const [nome, h] of Store._mov.entries()) {
            if (h.kind !== 'file' || !nome.endsWith('.jsonl')) continue;
            const dia = nome.slice(0, 10);
            if (dia < dDe || dia > dAte) continue;
            const txt = await (await h.getFile()).text();
            for (const linha of txt.split('\n')) {
                if (!linha.trim()) continue;
                try {
                    const rec = JSON.parse(linha);
                    if (!rec || !rec.id) continue;
                    const seq = rec._s || rec.timestamp || 0;
                    const ja  = porId.get(String(rec.id));
                    // mesma regra monotonica da leitura incremental
                    if (!ja)                 porId.set(String(rec.id), { _s: seq, rec });
                    else if (seq >= ja._s)   porId.set(String(rec.id), { _s: seq, rec: Store._enriquecer(rec, ja.rec) });
                    else                     ja.rec = Store._enriquecer(ja.rec, rec);
                } catch (e) {}
            }
        }
        const out = [];
        porId.forEach(v => { if (v.rec.timestamp >= de && v.rec.timestamp <= ate) out.push(v.rec); });
        return out.sort((a, b) => b.timestamp - a.timestamp);
    },

    // ======================================================================
    // SYNC — le APENAS o indice (1KB) e devolve so o que mudou
    // ======================================================================
    async indiceMudou() {
        try {
            const fh = await Store._dados.getFileHandle(Store.INDICE);
            const f  = await fh.getFile();
            if (f.lastModified === Store._idxMtime) return false;
            Store._idxMtime = f.lastModified;
            return true;
        } catch (e) { return false; }
    },

    // Devolve um payload PARCIAL — so os dominios cuja versao mudou.
    // Vai para DB._mergeFromDisk(), que ja trata objetos parciais.
    async lerMudancas() {
        const txt = await Store._lerTexto(Store._dados, Store.INDICE);
        if (!txt) return null;

        let novo;
        try { novo = JSON.parse(txt); } catch (e) { return null; }  // indice sendo escrito agora
        const velho = Store._indice || { arquivos: {} };
        const out = {};
        let mudou = false;

        for (const dom of Store.DOMINIOS) {
            if (Store._tokenDe(novo, dom) !== Store._tokenDe(velho, dom)) {
                Object.assign(out, await Store._lerDominio(dom));
                mudou = true;
            }
        }

        // movimentos/logs: le so a cauda dos shards que cresceram
        const novos = await Store._lerCaudas(novo);
        if (novos.movimentos.length) { out.checkoutHistory = novos.movimentos; mudou = true; }
        if (novos.logs.length)       { out.logs            = novos.logs;       mudou = true; }

        if (novo.forceLogout)        { out.forceLogout        = novo.forceLogout; mudou = true; }
        if (novo.lastAutoBackupDate) out.lastAutoBackupDate = novo.lastAutoBackupDate;
        if (novo.lastBackupInfo)     out.lastBackupInfo     = novo.lastBackupInfo;

        Store._indice = novo;
        return mudou ? out : null;
    },

    async _lerCaudas(idx) {
        const movs = [], logs = [];
        const meu = Store.pcId();

        const partes = (idx.movimentos || {});
        for (const nome of Object.keys(partes)) {
            if (nome.includes('__' + meu + '.')) continue;          // o nosso ja esta em memoria
            if ((Store._lido[nome] || 0) >= partes[nome]) continue; // nao cresceu
            try {
                const h = await Store._mov.getFileHandle(nome);
                const porId = new Map();
                await Store._consumirShard(h, nome, porId, true);
                porId.forEach(v => {
                    const id = String(v.rec.id);
                    Store._movCache.set(id, v);
                    // Marca como JA GRAVADO: sem isto o nosso PC reescreveria
                    // o movimento do colega dentro do NOSSO shard, duplicando
                    // a linha em disco a cada save.
                    Store._movEscrito.set(id, Store._canonico(v.rec));
                    movs.push(v.rec);
                });
            } catch (e) { /* shard some: ignora */ }
        }

        const pl = (idx.logs || {});
        for (const nome of Object.keys(pl)) {
            if (nome.includes('__' + meu + '.')) continue;
            const chave = 'L:' + nome;
            if ((Store._lido[chave] || 0) >= pl[nome]) continue;
            try {
                const h = await Store._logs.getFileHandle(nome);
                const f = await h.getFile();
                const txt = await f.slice(Store._lido[chave] || 0).text();
                Store._lido[chave] = f.size;
                const corteN = txt.lastIndexOf('\n');
                if (corteN < 0) continue;
                for (const linha of txt.slice(0, corteN).split('\n')) {
                    if (!linha.trim()) continue;
                    try { logs.push(JSON.parse(linha)); } catch (e) {}
                }
            } catch (e) {}
        }
        return { movimentos: movs, logs };
    },

    // ======================================================================
    // GRAVACAO
    // ======================================================================

    // Serializacao estavel de um movimento, para saber se ele MUDOU.
    // tableHTML/tableHead ficam de fora: sao pesados e valem so 1h (reimpressao).
    // Assinatura do movimento, para saber se ele MUDOU de verdade.
    // Ficam de fora:
    //   tableHTML/tableHead -> pesados, valem so 1h (reimpressao)
    //   _s/_w               -> carimbos de escrita
    //   _itemCount & cia    -> contadores DERIVADOS de removedItems, que o
    //                          _buildPayload acrescenta na poda de 1h. Sem
    //                          ignora-los, toda lista ganhava uma 2a linha no
    //                          arquivo so por ter sido podada em memoria.
    _canonico(h) {
        const { tableHTML, tableHead, _s, _w,
                _itemCount, _totalQty, _returnCount, _totalReturnQty, ...resto } = h;
        return JSON.stringify(resto);
    },

    // ----------------------------------------------------------------------
    // A PODA NAO PODE APAGAR O ARQUIVO.
    //
    // _buildPayload() enxuga o historico de propósito: depois de 1h ele joga
    // fora removedItems/returnedItems para o registro nao pesar em memoria.
    // Como o arquivo e append-only e "a ultima linha vence", gravar a versao
    // podada APAGARIA a lista de itens do arquivo permanente.
    //
    // Aqui reunimos as duas: os campos novos (ex.: h.confirm, preenchido na
    // Confirmacao de Listas) vem do registro atual; os campos ricos que a poda
    // tirou voltam da versao que ja esta no arquivo. O arquivo so cresce em
    // informacao, nunca perde.
    // ----------------------------------------------------------------------
    _enriquecer(h, anterior) {
        const pleno = { ...h };
        if (!anterior) return pleno;
        ['removedItems', 'returnedItems'].forEach(campo => {
            const temAgora = Array.isArray(pleno[campo]) && pleno[campo].length > 0;
            const tinha    = Array.isArray(anterior[campo]) && anterior[campo].length > 0;
            if (!temAgora && tinha) pleno[campo] = anterior[campo];
        });
        return pleno;
    },

    _linhaMov(h, agora) {
        const { tableHTML, tableHead, ...resto } = h;
        resto._s = agora;          // carimbo de escrita: desempata entre PCs
        resto._w = Store.pcId();
        return resto;
    },

    // Recebe o MESMO payload que _buildPayload() sempre produziu e distribui
    // pelos arquivos. So grava o que realmente mudou.
    async gravar(payload) {
        const escritos = [];
        const idx = Store._indice || Store._indiceNovo();
        idx.arquivos  = idx.arquivos  || {};
        idx.movimentos = idx.movimentos || {};
        idx.logs       = idx.logs       || {};

        const fatias = {
            catalogo: { componentCatalog: payload.componentCatalog || [] },
            estoque:  { slots: payload.slots || [], carMaterialType: payload.carMaterialType || {} },
            // v17.01: a fatia de sistema passa SEMPRE pela higienizacao. Mesmo que
            // um banco antigo seja importado ou algum codigo futuro escorregue,
            // senha em texto puro nao chega ao disco.
            sistema:  Object.assign(
                          SenhaLimpa.paraGravar(payload.users, payload.adminConfig),
                          { materialFamilies: payload.materialFamilies || [],
                            stockLimits:      payload.stockLimits      || null,
                            unclassified:     payload.unclassified     || null }),
            ranking:  { weeklyStats: payload.weeklyStats || {} },
            caixas:   { boxSessions: payload.boxSessions || [] },
        };

        // Serializa primeiro, SEM gravar: precisamos saber quais dominios vao
        // mudar antes de checar conflito.
        const paraGravar = [];
        for (const dom of Store.DOMINIOS) {
            // o catalogo reusa a string ja serializada (otimizacao da v16.22)
            const txt = (dom === 'catalogo')
                ? '{"componentCatalog":' + DB._catalogJSON() + '}'
                : JSON.stringify(fatias[dom]);
            if (txt === Store._bruto[dom]) continue;   // nada mudou: zero I/O
            paraGravar.push({ dom, txt });
        }

        // ==================================================================
        // TRAVA CONTRA PERDA DE DADOS.
        //
        // Entre o momento em que incorporamos o disco (read-before-write) e
        // este instante, outro PC pode ter gravado. Se escrevermos assim, a
        // alteracao dele e apagada — foi exatamente o que acontecia quando
        // duas pessoas faziam uma devolucao no mesmo segundo.
        //
        // Relemos o indice (1KB) e conferimos o token de cada dominio que
        // vamos tocar. Token diferente = alguem gravou no meio. Nesse caso
        // ABORTAMOS sem escrever nada e avisamos o chamador, que refaz o
        // merge com o dado novo e tenta de novo.
        // ==================================================================
        // Nada mudou em nenhum dominio de estado: nem pega a trava.
        let lock = null;
        if (paraGravar.length) {
            lock = await Store._obterLock();
            if (!lock) {
                const err = new Error('a pasta esta ocupada por outro PC ha mais de '
                                    + Math.round(Store.LOCK_ESPERA_MAX / 1000) + 's');
                err.conflito = true;
                err.dominios = paraGravar.map(g => g.dom);
                throw err;
            }

            // JA COM A TRAVA: agora a conferencia vale de verdade. Se outro PC
            // gravou antes de nos travarmos, abortamos SEM ESCREVER e o
            // chamador refaz o merge com o dado dele.
            const txtAgora = await Store._lerTexto(Store._dados, Store.INDICE);
            if (txtAgora) {
                let discoIdx = null;
                try { discoIdx = JSON.parse(txtAgora); } catch (e) { discoIdx = null; }
                if (discoIdx) {
                    const brigando = paraGravar
                        .filter(g => Store._tokenDe(discoIdx, g.dom) !== Store._tokenDe(Store._indice, g.dom))
                        .map(g => g.dom);
                    if (brigando.length) {
                        await Store._liberarLock(lock);
                        const err = new Error('outro PC gravou ' + brigando.join(', ') + ' enquanto salvavamos');
                        err.conflito = true;
                        err.dominios = brigando;
                        throw err;
                    }
                }
            }
        }

        try {

        for (const { dom, txt } of paraGravar) {
            await Store._gravarTexto(Store._dados, Store.ARQ[dom], txt);
            Store._brutoAnterior[dom] = Store._bruto[dom];
            Store._bruto[dom] = txt;
            idx.arquivos[dom] = { tk: Store._novoToken(), t: Date.now() };
            escritos.push(dom);
        }

        // ---- movimentos: acrescenta so o que e novo ou foi alterado ----
        const agora = Date.now();
        const linhas = [];
        (payload.checkoutHistory || []).forEach(h => {
            if (!h || !h.id) return;
            const id    = String(h.id);
            const pleno = Store._enriquecer(h, Store._movArquivo.get(id));
            const can   = Store._canonico(pleno);
            if (Store._movEscrito.get(id) === can) return;   // identico: nao regrava
            Store._movEscrito.set(id, can);
            Store._movArquivo.set(id, { ...pleno });          // copia so do arquivo
            Store._movCache.set(id, { _s: agora, rec: pleno }); // versao de memoria
            linhas.push(JSON.stringify(Store._linhaMov(pleno, agora)));
        });
        if (linhas.length) {
            const nome = Store._shardHoje();
            const fim  = await Store._anexar(Store._mov, nome, linhas.join('\n') + '\n');
            Store._lido[nome]     = fim;
            idx.movimentos[nome]  = fim;
            escritos.push('movimentos(' + linhas.length + ')');
        }

        // ---- logs ----
        const novosLogs = [];
        (payload.logs || []).forEach(l => {
            if (!l || !l.timestamp) return;
            const k = l.timestamp + '_' + l.matricula;
            if (Store._logEscrito.has(k)) return;
            Store._logEscrito.add(k);
            novosLogs.push(JSON.stringify(l));
        });
        if (novosLogs.length) {
            const nome = Store._shardHoje();
            const fim  = await Store._anexar(Store._logs, nome, novosLogs.join('\n') + '\n');
            Store._lido['L:' + nome] = fim;
            idx.logs[nome] = fim;
            escritos.push('logs(' + novosLogs.length + ')');
        }

        // ---- flags globais + indice (SEMPRE por ultimo) ----
        idx.schema = Store.ESQUEMA;
        idx.ts     = Date.now();
        if (payload.forceLogout)        idx.forceLogout        = payload.forceLogout;
        if (payload.lastAutoBackupDate) idx.lastAutoBackupDate = payload.lastAutoBackupDate;
        if (payload.lastBackupInfo)     idx.lastBackupInfo     = payload.lastBackupInfo;

        if (escritos.length) {
            Store._indice = idx;
            await Store._gravarIndice();
        }
        return escritos;

        } finally {
            // A trava SEMPRE e devolvida, mesmo se a gravacao falhar no meio.
            // Sem isto, um erro de rede deixaria a pasta travada ate expirar.
            if (lock) await Store._liberarLock(lock);
        }
    },

    async _gravarDominio(dom, obj) {
        const txt = JSON.stringify(obj);
        await Store._gravarTexto(Store._dados, Store.ARQ[dom], txt);
        Store._brutoAnterior[dom] = Store._bruto[dom];
        Store._bruto[dom] = txt;
    },

    async _gravarIndice() {
        const txt = JSON.stringify(Store._indice, null, 1);
        await Store._gravarTexto(Store._dados, Store.INDICE, txt, false);
        try {
            const fh = await Store._dados.getFileHandle(Store.INDICE);
            Store._idxMtime = (await fh.getFile()).lastModified;
        } catch (e) {}
    },

    // ======================================================================
    // MEMORIA DO HANDLE DA PASTA (IndexedDB) — e o que da os "zero cliques"
    // ======================================================================
    _IDB_NOME:  'spare_parts_inventory_mmt',
    _IDB_STORE: 'handles',
    _IDB_CHAVE: 'dbdir',

    _idb() {
        return new Promise((res, rej) => {
            const req = indexedDB.open(Store._IDB_NOME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(Store._IDB_STORE)) db.createObjectStore(Store._IDB_STORE);
            };
            req.onsuccess = () => res(req.result);
            req.onerror   = () => rej(req.error);
        });
    },

    async lembrarPasta(dh) {
        try {
            const db = await Store._idb();
            await new Promise((res, rej) => {
                const tx = db.transaction(Store._IDB_STORE, 'readwrite');
                tx.objectStore(Store._IDB_STORE).put(dh, Store._IDB_CHAVE);
                tx.oncomplete = res; tx.onerror = () => rej(tx.error);
            });
        } catch (e) { /* sem IndexedDB: funciona, so nao lembra */ }
    },

    async pastaLembrada() {
        try {
            const db = await Store._idb();
            return await new Promise((res, rej) => {
                const req = db.transaction(Store._IDB_STORE, 'readonly')
                              .objectStore(Store._IDB_STORE).get(Store._IDB_CHAVE);
                req.onsuccess = () => res(req.result || null);
                req.onerror   = () => rej(req.error);
            });
        } catch (e) { return null; }
    },

    async esquecerPasta() {
        try {
            const db = await Store._idb();
            await new Promise((res, rej) => {
                const tx = db.transaction(Store._IDB_STORE, 'readwrite');
                tx.objectStore(Store._IDB_STORE).delete(Store._IDB_CHAVE);
                tx.oncomplete = res; tx.onerror = () => rej(tx.error);
            });
        } catch (e) {}
    },

    // Pasta para o backup diario, automatica: <pasta>/backups
    async pastaBackup() {
        if (!Store._raiz) return null;
        try { return await Store._raiz.getDirectoryHandle('backups', { create: true }); }
        catch (e) { return null; }
    },

    // Resumo para a tela de manutencao
    async diagnostico() {
        const out = { pc: Store.pcId(), esquema: Store.ESQUEMA, arquivos: [], totalBytes: 0 };
        if (!Store._dados) return out;
        const add = async (dir, nome, rotulo) => {
            try {
                const f = await (await dir.getFileHandle(nome)).getFile();
                out.arquivos.push({ nome: rotulo || nome, bytes: f.size, em: f.lastModified });
                out.totalBytes += f.size;
            } catch (e) {}
        };
        await add(Store._dados, Store.INDICE);
        for (const d of Store.DOMINIOS) await add(Store._dados, Store.ARQ[d]);
        let nMov = 0, bMov = 0;
        for await (const [nome, h] of Store._mov.entries()) {
            if (h.kind !== 'file') continue;
            nMov++; bMov += (await h.getFile()).size;
        }
        out.arquivos.push({ nome: `movimentos/ (${nMov} arquivos)`, bytes: bMov, em: Date.now() });
        out.totalBytes += bMov;
        return out;
    },
};

window.Store = Store;
