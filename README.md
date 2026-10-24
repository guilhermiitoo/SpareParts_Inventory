# Spare Parts Inventory — MMT

Sistema de controle do estoque de Spare Parts da MMT (TPV Vision).
Desenvolvido por Guilherme Fernandes.

**Versão atual: v17.37**

---

## Como está o sistema hoje

- **Um arquivo só:** `index.html` (HTML + CSS + JavaScript juntos). Basta copiar para o PC e abrir no **Chrome ou Edge**.
- **Pasta fixa do sistema:** `S:\MMT\49. JOÃO - ARQUIVOS HTML\GUILHERME FERNANDES\2 - SpareParts_Inventory`.
  O endereço aparece na tela de login (botão de copiar). Outra pasta é recusada sem criar nada.
  Como o navegador não informa o caminho completo, a conferência é pelo **nome da pasta** + existência do banco dentro dela.
- **Atalho:** dois cliques em `CRIAR ATALHO NA AREA DE TRABALHO.bat` (na pasta do sistema).

### Estrutura da pasta
```
2 - SpareParts_Inventory/
├── SPARE_PARTS.html          ← o sistema
├── SPARE_PARTS_PASTA_DO_SISTEMA.json  ← confirma que esta é a pasta oficial (não apague)
├── backups/                  ← Excel do backup diário
└── dados/
    ├── banco/                ← catalogo, estoque, sistema, ranking, caixas, indice
    │   └── bak/              ← cópias .bak desses arquivos
    ├── movimentos/           ← histórico
    ├── logs/                 ← logs
    ├── consumo/              ← dados do SAP
    ├── estoque_diario/       ← estoque salvo no 1º acesso de cada dia
    └── backups_import/       ← cópias feitas antes de um "Importar Banco"
```
### O que fica guardado (e por quanto tempo)
| O que | Tempo | Onde |
|---|---|---|
| Estoque, catálogo, usuários | sempre | `dados/banco/` |
| Histórico (listas com códigos, posições e OP) | **90 dias** | `dados/movimentos/` (1 arquivo por PC por dia) |
| Histórico enxuto (código, qtd, OP) após 90 dias | sempre | `dados/movimentos/arquivo/AAAA-MM.jsonl` (usado no gráfico de 12 meses) |
| Logs | **90 dias** | `dados/logs/` |
| Ranking | 45 dias | `dados/banco/ranking.json` |
| Caixas finalizadas / abertas | 3 / 15 dias | `dados/banco/caixas.json` |
| Estoque do dia | sempre | `dados/estoque_diario/` |

- **Reimpressão:** a lista é montada **na hora** a partir dos códigos guardados. Nenhum HTML/PDF fica salvo. Funciona para qualquer lista dos últimos 90 dias.
- **Histórico na tela:** filtro **Período** (7 / 30 / 60 / 90 dias). 7 dias fica em memória; os outros são lidos da pasta só quando escolhidos.
- **Logs:** botão **EXCEL DOS LOGS** no Histórico (usa o mesmo período). O backup diário também leva 90 dias de logs.
- **Limpeza automática:** 1x por dia, 20 s depois de abrir, cada PC apaga o que passou de 90 dias.

- **Uma versão só no GitHub:** `main` e `claude/brave-allen-9k8wup` têm o mesmo arquivo da **fábrica** (sistema real, pede a pasta do banco). O modo de testes com dados fictícios foi retirado na v17.36.

### Abas
| Aba | Para que serve |
|---|---|
| Comparador | Cruza a lista do MES com o estoque e baixa os itens |
| Devolução | Devolve material para a posição (bloqueia leitura do LPN `BRS`+ano) |
| Busca Avulsa | Busca e baixa itens soltos |
| Histórico | Movimentações, estorno e reimpressão |
| Confirmação | Andamento das listas; "Voltar para leitura" sem baixar estoque de novo |
| Etiquetas | Etiqueta 50x25 mm com o código da lista do MES (código de barras) |
| Ranking | Ranking dos operadores |
| Estoque | Mapa dos carros e posições |
| Sistema *(admin)* | Usuários, banco de dados, catálogo, configurações, famílias |
| Dashboard *(admin)* | Gráficos do estoque |
| ALERTA *(admin)* | Códigos sem movimentação |
| **Consumo** *(admin)* | Consumo real x apontamento do SAP (relatório para a Controladoria) |

### Aba Consumo — como funciona
- **Uso = Est. Inicial + Entradas (SAP 315) − Est. Final**, por componente (todos os rolos somados, sem armários IA/PTH).
- **% Uso = Uso ÷ Apontamento (SAP 261)**. O % geral é soma ÷ soma.
- **Est. Inicial:** estoque salvo no **dia de início** do período, na pasta `dados/estoque_diario`. Se esse dia não tiver estoque salvo, aparece o aviso **"Sem estoque inicial salvo para este período"** e nada é calculado.
- **Est. Final (atual):** se o período vai até hoje, é o **estoque atual do sistema**; num período passado, é o estoque salvo do dia seguinte ao fim.
- **Estoque diário:** o primeiro acesso de cada dia salva `dados/estoque_diario/Estoque dd.mm.aaaa - HHhMM (primeiro acesso).json`.
- **Importar SAP:** o Excel do SAP como ele vem.
  - 261: `Material`, `Quantidade`, `Data do documento`, `Montante em MI` (+ `Ordem`, se existir)
  - 315: `Material`, `Quantidade`, `Data do documento`
  - Preço por peça = soma do Montante em MI ÷ soma da Quantidade.
- **Dashboards** usam o mesmo filtro do Mensal: mês ou **período (opcional)**.
- **Sub-abas:** Importar SAP · Mensal (mês ou período livre) · Semanal (uma ou mais semanas) · Alertas e Compras (Excel por lista) · Dashboards · OPs.
- **OPs em linha (apontamento incompleto)** (fica na sub-aba **OPs**): o admin digita as OPs que ainda estão rodando (`dados/consumo/ops_em_linha.json`). Enquanto a OP está na lista:
  - o que saiu do estoque para ela (lista MES + busca avulsa) volta para o cálculo como **estoque de antes da saída** (coluna "Em linha");
  - o **apontamento 261** dela fica fora (coluna "261 fora"; precisa da coluna `Ordem` no SAP);
  - o componente aparece com a etiqueta **EM LINHA**.
  - Quando a OP fecha e o material volta, o admin tira a OP da lista (×) e ela entra no cálculo.
- **Aguardando apontamento:** % Uso **acima do limite** (padrão **10%**, ajustado em **Sistema › Configurações › Consumo x SAP**, lembrado por PC) mostra **AGUARDANDO APONTAMENTO** no lugar do %, sai do % geral, do consumo e do valor dos cards e do Top 5 do dashboard. Card com a quantidade de itens aguardando. Mostrar/ocultar e as colunas opcionais também ficam em Sistema › Configurações (não aparecem na tela do Consumo); oculto = cálculo completo como antes.
- **OP = 7 números.** `1234567`, `1234567-SMT`, `-SMT-T` e `-SMT-B` são a mesma OP (lista do MES, busca avulsa e coluna Ordem do SAP).
- **Sub-aba OPs:** por OP, itens/peças que saíram pela **lista MES**, pela **busca avulsa (completar lista)** e **(requisição/retrabalho)**, e o apontamento 261. Exporta Excel.

### Busca Avulsa
- **OP obrigatória** (7 números, ou com `-SMT`, `-SMT-T`, `-SMT-B`) e **Para:** Completar lista ou Requisição / Retrabalho.
- Sem isso o botão **LIBERAR POSIÇÕES E BAIXAR** fica travado. Formato errado mostra **"OP não existe"**.

---

## Últimas mudanças

| Versão | O que mudou |
|---|---|
| **v17.37** | Busca Avulsa: o aviso só aparece ao clicar em baixar. Sem OP e motivo: "Informe a OP que esse material será usado e o Motivo"; só sem motivo: "Selecione o motivo da baixa"; só sem OP: "Selecione a OP que esse material será usado". |
| v17.36 | Busca Avulsa: o botão **LIBERAR POSICOES E BAIXAR** fica sempre ativo. Um aviso vermelho mostra antes o que falta (OP e/ou Para), e o clique sem isso dá erro e destaca o campo. Campo da OP agora diz "Digite a OP". Main e branch ficam iguais (sem modo de testes). |
| v17.35 | Quadro "OPs em linha" só na sub-aba **OPs**. Cabeçalho do período mais simples (Est. Inicial: data · Est. Final: ESTOQUE ATUAL · dias salvos). |
| v17.34 | Ajustes do Consumo (aguardando apontamento, limite %, colunas) saem da tela do Consumo e vão para **Sistema › Configurações**. |
| v17.33 | Limite do "Aguardando apontamento" = **10%** (editável). Filtro de **período** também nos Dashboards. |
| v17.32 | "Aguardando apontamento" passa a valer para **todo uso acima de 100%**: o % do item some, ele sai dos totais e entra no card "Aguardando apontamento". |
| v17.31 | Etiqueta **AGUARDANDO APONTAMENTO** quando o % Uso passa de 110%, com botão para mostrar/ocultar; coluna Observação no Excel. |
| v17.30 | Busca Avulsa com **OP obrigatória** + destino (completar lista / requisição). Consumo: **OPs em linha** (material volta como estoque de antes da saída e o 261 da OP fica fora), coluna **Ordem** do SAP 261, sub-aba **OPs**. |
| v17.29 | Histórico e logs guardados por **90 dias** (limpeza automática). Reimpressão montada na hora para qualquer lista dos 90 dias. Filtro de Período no Histórico e botão Excel dos Logs. |
| v17.28 | Versão aparece na tela de login. Escolher a pasta `dados` mostra "escolha a pasta de CIMA". |
| v17.27 | Removido o botão de atalho da tela de login (a janela de salvar podia sobrescrever o `SPARE_PARTS.html`). Atalho só pelo `.bat`. |
| v17.26 | Trava também no núcleo (abertura do banco): sem o arquivo de confirmação, nada é lido nem gravado, por qualquer caminho. Aviso **PASTA BLOQUEADA** na tela de login. |
| v17.25 | Trava pelo arquivo `SPARE_PARTS_PASTA_DO_SISTEMA.json` na pasta oficial (colocado à mão; o sistema não cria). Sem ele, a pasta é recusada. |
| v17.24 | A pasta é conferida ANTES de o navegador pedir permissão de edição; pasta lembrada com nome errado é descartada. |
| v17.23 | Pasta do sistema renomeada para `2 - SpareParts_Inventory`. |
| v17.22 | Cartão **BD CONECTADO** sozinho no canto superior direito. |
| v17.21 | Sai o cabeçalho de cima das abas; nome do usuário, status do banco e **SAIR** ficam no rodapé da barra lateral. |
| v17.20 | Pasta fixa `2 - SpareParts_Inventory` (recusa outra pasta). Pasta `dados` organizada em subpastas (arquivos soltos movidos sozinhos). Botão de atalho na área de trabalho. |
| v17.19 | Cabeçalho das tabelas do Consumo fica **fixo** ao rolar. Filtros (mês, período, busca, colunas) ficam **acima** das sub-abas. Este README. |
| v17.18 | Sem estoque salvo no **dia de início** do período → aviso, sem calcular (não troca a data sozinho). |
| v17.17 | Tela mostra de onde vem o Est. Inicial / Final e os dias com estoque salvo. |
| v17.16 | Coluna e card **"Est. Final (atual)"** = estoque atual do sistema; o mês atual vai sempre até hoje. |
| v17.15 | Estoque diário em **um arquivo por dia**; período livre no Mensal e nos Alertas; Excel em cada lista de Alertas. |
| v17.14 | Sistema em **um arquivo só**; confirmação do **Importar Banco** corrigida (mostrava código em vez da tabela). |
| v17.13 | Removida a trava da pasta e o link "criar banco novo"; conecta na pasta normalmente. |
| v17.12 | Corrigida a caixa de digitar texto (Nova família, Itens por página). |
| v17.11 | Preço por peça = Montante em MI ÷ Quantidade. |
| v17.10 | Importação do SAP pelas colunas do relatório; dashboards 2 x 2. |
| v17.09 | Cards reorganizados; semanas com múltipla seleção; gráficos novos (tendência, pizza, top 5 % de uso). |
| v17.08 | Correção de cache do navegador. |
| v17.07 | Nova aba **Consumo**; colunas opcionais; janela de Dashboards. |
| v17.06 | Menu lateral recolhível (botão ou F9). |
| v16.33–v16.39 | Etiquetas, ALERTA, Voltar para leitura, bloqueio de LPN, regravação em conflito entre PCs. |
