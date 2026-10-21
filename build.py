# -*- coding: utf-8 -*-
"""
COSTURA — junta a pasta de volta num arquivo HTML unico.

PARA QUE SERVE
    Voce DESENVOLVE na pasta dividida (facil de achar e de versionar no Git) e
    DISTRIBUI o arquivo unico (facil de copiar e de mandar por e-mail).
    Os dois funcionam identicamente: o codigo e exatamente o mesmo.

COMO USAR
    python build.py
    -> gera dist/SPARE_PARTS_UNICO.html

NAO PRECISA de npm, node, nem de instalar nada. So o Python que ja vem no PC
(ou clique duas vezes no build.bat, que faz isso por voce).

IMPORTANTE: o arquivo unico gerado le a MESMA pasta de dados. Nao ha formato
diferente entre os dois — e so uma outra embalagem do mesmo sistema.
"""
import os, re, sys, io, datetime

AQUI = os.path.dirname(os.path.abspath(__file__))
ENTRADA = os.path.join(AQUI, 'index.html')
SAIDA_DIR = os.path.join(AQUI, 'dist')
SAIDA = os.path.join(SAIDA_DIR, 'SPARE_PARTS_UNICO.html')


def ler(caminho):
    with io.open(caminho, encoding='utf-8') as f:
        return f.read()


def main():
    if not os.path.exists(ENTRADA):
        print('ERRO: nao achei %s' % ENTRADA)
        return 1

    html = ler(ENTRADA)

    # --- CSS: cada <link href="css/..."> vira um <style> com o conteudo ---
    def troca_css(m):
        rel = m.group(1)
        caminho = os.path.join(AQUI, rel.replace('/', os.sep))
        if not os.path.exists(caminho):
            print('  ERRO: faltando %s' % rel)
            sys.exit(1)
        print('  css  %-26s %7d bytes' % (rel, os.path.getsize(caminho)))
        return '<style>\n/* ===== %s ===== */\n%s\n</style>' % (rel, ler(caminho))

    html, n_css = re.subn(r'[ \t]*<link rel="stylesheet" href="(css/[^"]+)">', troca_css, html)

    # --- JS: cada <script src="js/..."> vira um <script> com o conteudo ---
    def troca_js(m):
        rel = m.group(1)
        caminho = os.path.join(AQUI, rel.replace('/', os.sep))
        if not os.path.exists(caminho):
            print('  ERRO: faltando %s' % rel)
            sys.exit(1)
        codigo = ler(caminho)
        # uma tag de fechamento dentro de string quebraria o HTML; nao ocorre
        # hoje, mas a checagem evita uma surpresa silenciosa no futuro.
        if '</script' in codigo:
            print('  ERRO: %s contem "</script" e nao pode ser embutido.' % rel)
            sys.exit(1)
        print('  js   %-26s %7d bytes' % (rel, os.path.getsize(caminho)))
        return '<script>\n// ===== %s =====\n%s\n</script>' % (rel, codigo)

    html, n_js = re.subn(r'[ \t]*<script src="(js/[^"]+)"></script>', troca_js, html)

    if n_css == 0 or n_js == 0:
        print('ERRO: nenhum arquivo local foi embutido — o HTML mudou de formato?')
        return 1

    carimbo = datetime.datetime.now().strftime('%d/%m/%Y %H:%M')
    aviso = (u'<!-- ARQUIVO GERADO AUTOMATICAMENTE POR build.py EM %s\n'
             u'     NAO EDITE ESTE ARQUIVO. Edite os arquivos da pasta css/ e js/\n'
             u'     e rode o build.py de novo, senao sua alteracao sera perdida. -->\n' % carimbo)
    html = html.replace('<!DOCTYPE html>', '<!DOCTYPE html>\n' + aviso, 1)

    if not os.path.isdir(SAIDA_DIR):
        os.makedirs(SAIDA_DIR)
    with io.open(SAIDA, 'w', encoding='utf-8') as f:
        f.write(html)

    print('')
    print('  OK: %d css + %d js embutidos' % (n_css, n_js))
    print('  -> %s  (%.0f KB)' % (SAIDA, os.path.getsize(SAIDA) / 1024.0))
    print('')
    print('  Lembre: o arquivo unico NAO carrega a pasta css/ e js/ junto.')
    print('  Para distribuir, copie so o dist/SPARE_PARTS_UNICO.html.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
