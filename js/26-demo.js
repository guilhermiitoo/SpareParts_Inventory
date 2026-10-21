// ==========================================================================
// SPARE PARTS - 26-demo.js   (v17.07)
// ==========================================================================

// ============================================================================
// MODULO: MODO DEMONSTRACAO
// ----------------------------------------------------------------------------
// Para testar o sistema sem a pasta da rede (ex.: no GitHub Pages).
// Usa a pasta PRIVADA do navegador (OPFS — navigator.storage.getDirectory),
// que tem a mesma API de uma pasta real. Assim a demonstracao passa pelo
// MESMO codigo de gravacao/leitura do sistema verdadeiro, sem simulacao.
//
// - Sem faixa nem campos preenchidos: a tela fica igual a do sistema real,
//   so pula a escolha da pasta. Login: ADMIN / admin123 (ou OP01 / 1234).
// - Cada navegador tem a sua propria copia: nada vai para a rede da empresa.
// - Dados 100% ficticios, criados na primeira abertura.
// - A pasta demo nunca e "lembrada" como pasta oficial deste PC.
// - Liga sozinho em *.github.io ou com ?demo=1 no endereco; em qualquer
//   outro lugar so pelo botao da tela de login.
// ============================================================================
const Demo = {
    PASTA: 'spare_parts_demo',
    ativo: false,

    disponivel() { return !!(navigator.storage && navigator.storage.getDirectory); },
    automatico() {
        return /\.github\.io$/i.test(location.hostname) || /[?&]demo=1\b/.test(location.search);
    },

    async iniciar() {
        if (!Demo.disponivel()) { Toast.error('Este navegador nao suporta o modo demonstracao. Use Chrome ou Edge atualizados.'); return; }
        try {
            const root = await navigator.storage.getDirectory();
            const dh = await root.getDirectoryHandle(Demo.PASTA, { create: true });
            const nova = !(await Store.verificarPasta(dh)).ok;
            State.dbDirHandle = dh;
            Demo.ativo = true;
            await DB._finishInitialConnect({ criar: true, aceitarOutra: true, demo: true });
            if (nova) await Demo._semear();
            else {
                // demo criada por uma versao anterior: refaz so os dados do Consumo
                let v = null; try { v = localStorage.getItem('sp_demo_semente'); } catch (e) {}
                if (v !== Demo.SEMENTE_CONSUMO) await Demo._semearConsumo();
            }
            const m = document.getElementById('userMatricula');
            if (m) m.focus();
        } catch (e) {
            console.error('[Demo]', e);
            Toast.error('Nao foi possivel abrir a demonstracao: ' + e.message, 8000);
        }
    },

    // Apaga a copia de teste e recomeca do zero
    async recomecar() {
        const ok = await Modal.confirm('Recomecar demonstracao', 'Apaga TODOS os dados de teste deste navegador e cria dados ficticios novos.', 'Recomecar', true);
        if (!ok) return;
        const root = await navigator.storage.getDirectory();
        try { await root.removeEntry(Demo.PASTA, { recursive: true }); } catch (e) {}
        location.reload();
    },

    // ------------------------------------------------------------------
    // Dados ficticios
    // ------------------------------------------------------------------
    async _semear() {
        const agora = Date.now(), DIA = 86400000;
        const hash = await Security.hashPassword('1234');
        State.users = (State.users || []).concat([
            { nome: 'Operador Teste', matricula: 'OP01', passwordHash: hash, isAdmin: false },
            { nome: 'Lider Teste',    matricula: 'LID01', passwordHash: hash, isAdmin: true },
        ]);

        const comps = [
            ['RC0603FR-0710KL', 'Resistor 10K 0603'], ['RC0402JR-07100RL', 'Resistor 100R 0402'],
            ['CL10A106KP8NNNC', 'Capacitor 10uF 0603'], ['GRM155R71C104KA88', 'Capacitor 100nF 0402'],
            ['BAT54C-7-F', 'Diodo Schottky BAT54C'], ['MMBT3904LT1G', 'Transistor NPN 3904'],
            ['LM358DR2G', 'Amp. operacional LM358'], ['STM32F030C8T6', 'Microcontrolador STM32'],
            ['LTST-C191KRKT', 'LED vermelho 0603'], ['BLM18PG221SN1D', 'Ferrite 220R 0603'],
            ['TPS62130RGTR', 'Regulador buck TPS62130'], ['AO3401A', 'MOSFET P AO3401'],
            ['ECS-160-20-3X', 'Cristal 16MHz'], ['SN74LVC1G08DBVR', 'Porta AND 1G08'],
            ['B2B-PH-K-S', 'Conector JST PH 2 vias'],
        ];
        State.componentCatalog = comps.map(([code, description]) => ({ code, description }));

        const cars = ['01', '02', '03'];
        State.carMaterialType = { '01': 'NXT', '02': 'NXT', '03': 'XP' };
        State.validLocations = []; State.inventory = [];
        let n = 0;
        cars.forEach(car => {
            for (let i = 1; i <= 24; i++) {
                const loc = String.fromCharCode(65 + Math.floor((i - 1) / 8)) + String(((i - 1) % 8) + 1).padStart(2, '0');
                State.validLocations.push({ car, loc, id: `demo_${car}_${loc}` });
                if (i % 5 === 0) continue;                        // algumas posicoes vazias
                const c = comps[n++ % comps.length][0];
                State.inventory.push({ id: `demo_i_${car}_${loc}`, code: c, car, loc,
                    qty: [500, 1000, 2000, 3000, 5000, 10000][n % 6], timestamp: agora - (n % 7) * 15 * DIA });
            }
        });

        // historico: listas, buscas avulsas e devolucoes dos ultimos dias
        const ops = [['Operador Teste', 'OP01'], ['Lider Teste', 'LID01']];
        State.checkoutHistory = [];
        for (let d = 6; d >= 0; d--) {
            const [nome, mat] = ops[d % 2];
            const it = State.inventory[(d * 3) % State.inventory.length];
            State.checkoutHistory.unshift(
                { id: `demo_h_${d}_c`, type: 'CHECKOUT', removedItems: [{ car: it.car, loc: it.loc, code: it.code, qty: it.qty }],
                  config: { line: 'L0' + (d % 3 + 1), wo: 'OP' + (500100 + d) + '-SMT', machine: '' }, user: nome, matricula: mat,
                  printUser: nome, timestamp: agora - d * DIA - 3600000 },
                { id: `demo_h_${d}_r`, type: 'RETURN', returnedItems: [{ car: it.car, loc: it.loc, code: it.code, qty: Math.round(it.qty * 0.6) }],
                  user: nome, matricula: mat, timestamp: agora - d * DIA - 1800000 });
        }
        await DB.saveNow();

        await Demo._semearConsumo();
    },

    // Consumo do mes: uma foto de saldo POR DIA (como o sistema real faz) e
    // apontamentos espalhados nos dias, com ritmo diferente em cada semana —
    // assim os graficos de tendencia mostram algo parecido com a realidade.
    SEMENTE_CONSUMO: '2',
    async _semearConsumo() {
        try {
            const hj = Consumo._hoje(), ym = hj.slice(0, 7), d1 = ym + '-01', agora = Date.now();
            const dias = [];
            for (let d = d1; d <= hj; d = Consumo._maisDias(d, 1)) dias.push(d);
            const peso = dias.map((d, k) => { const dw = new Date(d + 'T12:00:00').getDay(); return dw === 0 ? 0.1 : dw === 6 ? 0.4 : 1 + 0.6 * Math.sin(k / 2); });
            const acum = []; peso.reduce((a, p, k) => (acum[k] = a + p, a + p), 0);
            const totPeso = acum[acum.length - 1] || 1;

            const saldo = Consumo.saldoAtual(), ini = {}, ent = {}, s261 = [], s315 = [];
            Object.keys(saldo).forEach((c, i) => {
                ini[c] = saldo[c] + (i % 4 + 1) * 1500;               // havia mais no inicio do mes
                if (i % 3 === 0) { ent[c] = 2000; s315.push([c, 2000, d1]); }
            });
            ini['AO3401A'] = 0; ent['AO3401A'] = 0;                   // forca um uso negativo
            const fotos = { dias: {} };
            dias.forEach((d, k) => {
                const frac = k === 0 ? 0 : acum[k - 1] / totPeso;     // consumo ate o INICIO do dia
                const sd = {};
                Object.keys(ini).forEach(c => {
                    const uso = ini[c] + (ent[c] || 0) - saldo[c];
                    sd[c] = Math.round(ini[c] + (k > 0 ? (ent[c] || 0) : 0) - (uso > 0 ? uso * frac : 0));
                });
                fotos.dias[d] = { t: agora, pc: 'DEMO', s: sd };
            });
            Object.keys(saldo).forEach((c, i) => {
                if (i % 5 === 4) return;                              // um sem apontamento a cada 5
                const total = (i + 2) * 40000;
                dias.forEach((d, k) => { const q = Math.round(total * peso[k] / totPeso); if (q > 0) s261.push([c, q, d]); });
            });
            s261.push(['XC7A35T-1CSG324C', 15000, hj]);               // usado e sem estoque

            await Store._gravarTexto(await Consumo._pastaFotos(), ym + '.json', JSON.stringify(fotos));
            const precos = {};
            Object.keys(saldo).forEach((c, i) => { if (i % 6) precos[c] = +(0.002 + i * 0.013).toFixed(4); });
            const imp = { em: agora, por: 'Demonstracao', arquivo: 'dados_ficticios.xlsx', de: d1, ate: hj };
            await Store._gravarTexto(await Consumo._pasta(), Consumo.ARQ_SAP, JSON.stringify({ s261, s315, precos,
                imp: { s261: { ...imp, n: s261.length }, s315: { ...imp, n: s315.length }, precos: { em: agora, por: 'Demonstracao', n: Object.keys(precos).length } } }));
            Consumo._fotoFeitaEm = hj;   // a foto de hoje ja esta no arquivo
            try { localStorage.setItem('sp_demo_semente', Demo.SEMENTE_CONSUMO); } catch (e) {}
        } catch (e) { console.warn('[Demo] consumo:', e.message); }
    },
};
window.Demo = Demo;

// Botao na tela de login + inicio automatico no GitHub Pages
document.addEventListener('DOMContentLoaded', function () {
    if (!Demo.disponivel()) return;
    const ref = document.getElementById('btnImportDb');
    if (ref && !document.getElementById('btnDemo')) {
        const b = document.createElement('button');
        b.id = 'btnDemo'; b.type = 'button'; b.className = 'btn-3d btn-yellow';
        b.style.cssText = 'width:100%; padding:10px; margin-top:8px;';
        b.innerHTML = '<i class="fas fa-flask"></i> MODO DEMONSTRACAO (dados ficticios)';
        b.onclick = () => Demo.iniciar();
        ref.insertAdjacentElement('afterend', b);
    }
    if (Demo.automatico()) setTimeout(() => { if (!State.isConnected) Demo.iniciar(); }, 400);
});
