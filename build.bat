@echo off
REM Costura a pasta de volta num arquivo HTML unico (dist\SPARE_PARTS_UNICO.html)
REM Basta dar dois cliques neste arquivo.
chcp 65001 >nul
cd /d "%~dp0"
python build.py
if errorlevel 1 (
  echo.
  echo Se aparecer "python nao e reconhecido", instale o Python
  echo ou use: py build.py
  py build.py
)
echo.
pause
