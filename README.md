# Spare Parts Inventory — MMT

Sistema de controle do estoque de Spare Parts da MMT (TPV Vision).
Desenvolvido por Guilherme Fernandes.

**Versão atual: v17.28**

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
- **Duas versões no GitHub:**
  - `main` → **fábrica** (sistema real, pede a pasta do banco).
  - `claude/brave-allen-9k8wup` → **testes** (site do GitHub Pages, abre com dados fictícios; login `ADMIN` / `admin123`).

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
  - 261: `Material`, `Quantidade`, `Data do documento`, `Montante em MI`
  - 315: `Material`, `Quantidade`, `Data do documento`
  - Preço por peça = soma do Montante em MI ÷ soma da Quantidade.
- **Sub-abas:** Importar SAP · Mensal (mês ou período livre) · Semanal (uma ou mais semanas) · Alertas e Compras (Excel por lista) · Dashboards.

---

## Últimas mudanças

| Versão | O que mudou |
|---|---|
| **v17.28** | Versão aparece na tela de login. Escolher a pasta `dados` mostra "escolha a pasta de CIMA". |
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
