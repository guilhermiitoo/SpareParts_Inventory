// ==========================================================================
// MODULO: FAMILIAS DE MATERIAIS  (v17.03)
// --------------------------------------------------------------------------
// Cada fabricante codifica o part number do seu jeito. Este modulo agrupa os
// codigos do estoque por PADRAO de codificacao, e esse agrupamento e o eixo
// de todos os graficos do Dashboard de Estoque MMT.
//
// COMO CLASSIFICA
//   Cada familia tem uma expressao regular e uma PRIORIDADE. O codigo e
//   testado contra as familias ativas em ordem de prioridade (menor numero
//   primeiro) e a PRIMEIRA que casar vence. E por isso que a prioridade
//   existe: quando dois padroes se sobrepoem, e ela que decide.
//
//   O que nao casa com nenhuma cai em "Nao classificado" — familia fixa,
//   que nao pode ser apagada e sempre existe.
//
// ONDE FICA GRAVADO
//   State.materialFamilies -> sistema.json, chave `materialFamilies`.
//   Banco antigo sem a chave abre normalmente: as sementes sao criadas na
//   primeira abertura, e nada no sistema quebra se a lista estiver vazia.
// ==========================================================================
const Familias = {

    // Familia fixa para o que nao casa com nenhum padrao. Nao entra na lista
    // de familias cadastradas porque ela e o RESTO — nao tem padrao proprio e
    // nao pode ser apagada: se sumisse, os codigos que ela recolhe ficariam
    // sem lugar nenhum. O que o usuario controla dela (nome, cor e se aparece
    // nos graficos) fica em State.unclassified.
    //
    // Este objeto e MUTAVEL mas NUNCA e trocado por outro: meia duzia de
    // pontos do sistema o comparam com ===, entao recriar o objeto quebraria
    // a classificacao em silencio.
    NAO_CLASSIFICADO: { id: '__nc', nome: 'Nao classificado', cor: '#94a3b8', fixa: true, oculta: false },

    NC_PADRAO: { nome: 'Nao classificado', cor: '#94a3b8', oculta: false },

    // Config gravada, ja com os defaults aplicados e os valores validados.
    configNC() {
        const c = State.unclassified || {};
        const p = Familias.NC_PADRAO;
        return {
            nome:   String(c.nome || '').trim().slice(0, 60) || p.nome,
            cor:    /^#[0-9a-fA-F]{6}$/.test(c.cor || '') ? c.cor : p.cor,
            oculta: c.oculta === true,
        };
    },

    // Reflete a config no objeto fixo, preservando a identidade dele.
    sincronizarNC() {
        const c = Familias.configNC();
        Familias.NAO_CLASSIFICADO.nome   = c.nome;
        Familias.NAO_CLASSIFICADO.cor    = c.cor;
        Familias.NAO_CLASSIFICADO.oculta = c.oculta;
        return c;
    },

    // ----------------------------------------------------------------------
    // SEMENTES — cadastradas na primeira abertura de um banco sem familias.
    // Os nomes sao genericos de proposito: descrevem o FORMATO do codigo,
    // porque o formato e o que da para afirmar olhando o part number. Renomeie
    // para a marca em Configuracoes do Sistema > Familias de Materiais.
    // ----------------------------------------------------------------------
    SEMENTES: [
        { nome: 'TPV SAP',                regex: '^C?\\d{3}\\.\\d{3}\\.\\d+$',                    cor: '#0066A1', prioridade: 10 },
        { nome: 'Ponto Longo',            regex: '^\\d{3}\\.[0-9A-Z]{5}\\.\\d{4}$',               cor: '#7c3aed', prioridade: 20 },
        { nome: 'Pontilhado Alfanumerico',regex: '^[0-9A-Z]{2}\\.[0-9A-Z]{5}\\.[0-9A-Z]{3}$',     cor: '#db2777', prioridade: 30 },
        { nome: 'Pontilhado Curto',       regex: '^\\d\\.\\d{4}\\.\\d{5}$',                       cor: '#0891b2', prioridade: 40 },
        { nome: 'Hifenado H',             regex: '^[0-9A-Z]{9}-[0-9A-Z]{3}-[A-Z]$',               cor: '#ea580c', prioridade: 50 },
        { nome: 'Hifenado C',             regex: '^C\\d{2}-\\d{5}-\\d{2}$',                       cor: '#b45309', prioridade: 60 },
        { nome: 'Numerico 18',            regex: '^\\d{18}$',                                     cor: '#16a34a', prioridade: 70 },
        { nome: 'Numerico 7',             regex: '^\\d{7}$',                                      cor: '#65a30d', prioridade: 80 },
        { nome: 'TPV Alfanumerico',       regex: '^\\d{3}[A-Z]',                                  cor: '#dc2626', prioridade: 90 },
    ],

    // Limites das faixas criticas (Grafico 4 e Top Criticos).
    // Configuraveis: ficam no banco, nao fixos no codigo.
    LIMITES_PADRAO: { critico: 100, atencao: 200, saudavel: 500 },

    limites() {
        const l = State.stockLimits || {};
        const p = Familias.LIMITES_PADRAO;
        return {
            critico:  Number(l.critico)  > 0 ? Number(l.critico)  : p.critico,
            atencao:  Number(l.atencao)  > 0 ? Number(l.atencao)  : p.atencao,
            saudavel: Number(l.saudavel) > 0 ? Number(l.saudavel) : p.saudavel,
        };
    },

    // ----------------------------------------------------------------------
    // CICLO DE VIDA
    // ----------------------------------------------------------------------

    // Cria as sementes se o banco ainda nao tem familias. Chamada na abertura.
    // Devolve true se criou algo (o chamador decide se grava).
    garantir() {
        if (Array.isArray(State.materialFamilies) && State.materialFamilies.length) return false;
        State.materialFamilies = Familias.SEMENTES.map((s, i) => ({
            id:        Familias._novoId(i),
            nome:      s.nome,
            regex:     s.regex,
            marcas:    '',
            cor:       s.cor,
            prioridade: s.prioridade,
            ativa:     true,
        }));
        Familias.invalidar();
        return true;
    },

    _novoId(seq) {
        return 'f' + Date.now().toString(36) + (seq != null ? seq : Math.floor(Math.random() * 999));
    },

    // Lista normalizada: so as ativas com regex valida, em ordem de prioridade.
    // Uma regex quebrada NAO derruba a classificacao — a familia e ignorada e
    // o aviso fica no console (a tela de cadastro mostra o erro ao usuario).
    ativas() {
        if (Familias._cacheAtivas) return Familias._cacheAtivas;
        const out = [];
        (State.materialFamilies || []).forEach(f => {
            if (!f || f.ativa === false || !f.regex) return;
            let re;
            try { re = new RegExp(f.regex); }
            catch (e) { console.warn('[Familias] regex invalida em "' + (f.nome || '?') + '":', e.message); return; }
            out.push({ ref: f, re });
        });
        out.sort((a, b) => (Number(a.ref.prioridade) || 999) - (Number(b.ref.prioridade) || 999));
        Familias._cacheAtivas = out;
        return out;
    },

    // Chamar SEMPRE que a lista de familias mudar.
    invalidar() {
        Familias._cacheAtivas = null;
        Familias._cacheCodigo = new Map();
        Familias.sincronizarNC();
    },

    _cacheAtivas: null,
    _cacheCodigo: new Map(),

    // ----------------------------------------------------------------------
    // CLASSIFICACAO
    // ----------------------------------------------------------------------

    // Devolve a familia de um codigo. O resultado e memorizado: o mesmo
    // codigo aparece muitas vezes e testar regex e caro.
    classificar(codigo) {
        const k = String(codigo || '').trim().toUpperCase();
        if (!k) return Familias.NAO_CLASSIFICADO;
        const memo = Familias._cacheCodigo.get(k);
        if (memo) return memo;

        let achou = Familias.NAO_CLASSIFICADO;
        const lista = Familias.ativas();
        for (let i = 0; i < lista.length; i++) {
            if (lista[i].re.test(k)) { achou = lista[i].ref; break; }   // menor prioridade vence
        }
        Familias._cacheCodigo.set(k, achou);
        return achou;
    },

    // Todas as familias que casam com um codigo — usada para apontar conflito
    // na tela de cadastro (um codigo batendo em duas familias).
    todasQueCasam(codigo) {
        const k = String(codigo || '').trim().toUpperCase();
        if (!k) return [];
        return Familias.ativas().filter(x => x.re.test(k)).map(x => x.ref);
    },

    // Nome e cor de uma familia, aceitando o id ou o proprio objeto.
    info(idOuObj) {
        if (!idOuObj) return Familias.NAO_CLASSIFICADO;
        if (typeof idOuObj === 'object') return idOuObj;
        if (idOuObj === Familias.NAO_CLASSIFICADO.id) return Familias.NAO_CLASSIFICADO;
        return (State.materialFamilies || []).find(f => f.id === idOuObj) || Familias.NAO_CLASSIFICADO;
    },

    // ----------------------------------------------------------------------
    // AGREGACAO DO ESTOQUE
    // ----------------------------------------------------------------------

    // Percorre o estoque uma unica vez e devolve tudo o que os graficos usam.
    // `excluirXP` tira os materiais que estao em carros marcados como XP.
    //
    // Devolve: {
    //   porFamilia: [{ id, nome, cor, qtd, codigos, itens:[{code,qty,car,loc}] }],
    //   totalQtd, totalCodigos, semFamilia:[codigos]
    // }
    agregarEstoque(excluirXP) {
        const tipos  = State.carMaterialType || {};
        const grupos = new Map();
        const vistos = new Map();       // code -> qtd somada (o mesmo codigo pode estar em varias locacoes)
        let totalQtd = 0;
        const ocultarNC = Familias.sincronizarNC().oculta;

        (State.inventory || []).forEach(i => {
            if (!i || !i.code) return;
            if (excluirXP && tipos[i.car] === 'XP') return;

            const fam = Familias.classificar(i.code);
            if (ocultarNC && fam === Familias.NAO_CLASSIFICADO) return;
            const qtd = Number(i.qty) || 0;

            let g = grupos.get(fam.id);
            if (!g) {
                g = { id: fam.id, nome: fam.nome, cor: fam.cor || '#94a3b8', qtd: 0, codigos: new Set(), itens: [] };
                grupos.set(fam.id, g);
            }
            g.qtd += qtd;
            g.codigos.add(i.code);
            g.itens.push({ code: i.code, qty: qtd, car: i.car, loc: i.loc });
            totalQtd += qtd;

            vistos.set(i.code, (vistos.get(i.code) || 0) + qtd);
        });

        const porFamilia = [...grupos.values()]
            .map(g => ({ ...g, codigos: g.codigos.size, _codigos: g.codigos }))
            .sort((a, b) => b.qtd - a.qtd);

        // Se o "Nao classificado" estiver oculto, os codigos dele nem chegaram
        // em `vistos`. A contagem e refeita do estoque para que a tela de
        // configuracao continue enxergando o que existe de verdade — esconder
        // do grafico nao pode virar esconder do usuario.
        const semFamilia = [];
        const fonte = ocultarNC ? (State.inventory || []) : null;
        if (fonte) {
            const unicos = new Set();
            fonte.forEach(i => {
                if (!i || !i.code) return;
                if (excluirXP && tipos[i.car] === 'XP') return;
                if (Familias.classificar(i.code) === Familias.NAO_CLASSIFICADO) unicos.add(i.code);
            });
            unicos.forEach(c => semFamilia.push(c));
        } else {
            vistos.forEach((_, code) => {
                if (Familias.classificar(code) === Familias.NAO_CLASSIFICADO) semFamilia.push(code);
            });
        }

        return { porFamilia, totalQtd, totalCodigos: vistos.size, semFamilia: semFamilia.sort() };
    },

    // Quantidade TOTAL por codigo (somando todas as locacoes), com a familia.
    // Base do Grafico 4 e do Top Criticos: a faixa critica e do CODIGO, nao
    // da locacao — o mesmo material espalhado em 3 locacoes nao esta critico
    // tres vezes; o que importa e o total dele no estoque.
    totaisPorCodigo(excluirXP) {
        const tipos = State.carMaterialType || {};
        const ocultarNC = Familias.sincronizarNC().oculta;
        const m = new Map();
        (State.inventory || []).forEach(i => {
            if (!i || !i.code) return;
            if (excluirXP && tipos[i.car] === 'XP') return;
            if (ocultarNC && Familias.classificar(i.code) === Familias.NAO_CLASSIFICADO) return;
            const r = m.get(i.code) || { code: i.code, qty: 0, locais: 0 };
            r.qty += Number(i.qty) || 0;
            r.locais++;
            m.set(i.code, r);
        });
        const out = [];
        m.forEach(r => { r.familia = Familias.classificar(r.code); out.push(r); });
        return out;
    },

    // Em qual faixa critica cai uma quantidade
    faixaDe(qtd) {
        const L = Familias.limites();
        if (qtd < L.critico)  return 'critico';
        if (qtd < L.atencao)  return 'atencao';
        if (qtd < L.saudavel) return 'observacao';
        return 'saudavel';
    },

    // As cores NAO sao escolha de gosto: foram medidas. O par Critico/Atencao
    // anterior (#dc2626 / #ea580c) ficava a uma distancia perceptual de 8,7 em
    // visao normal e 7,2 em deuteranopia — abaixo do minimo de 15 e de 8. Na
    // pratica o vermelho e o laranja viravam um bloco so no print da
    // apresentacao. Os valores atuais ficam em 20,7 (normal) e 15,3 (CVD).
    // `corTexto` existe porque rotulo branco sobre o amarelo e ilegivel.
    FAIXAS: [
        { id: 'critico',    rotulo: 'Critico',    cor: '#b91c1c', corTexto: '#ffffff' },
        { id: 'atencao',    rotulo: 'Atencao',    cor: '#f97316', corTexto: '#ffffff' },
        { id: 'observacao', rotulo: 'Observacao', cor: '#facc15', corTexto: '#1f2937' },
        { id: 'saudavel',   rotulo: 'Saudavel',   cor: '#15803d', corTexto: '#ffffff' },
    ],
};

window.Familias = Familias;
