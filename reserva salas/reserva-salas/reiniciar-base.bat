@echo off
cd /d "%~dp0"
title ReservaLab - Reiniciar base de datos
echo ATENCION: se borraran las reservas hechas y se cargaran los datos de database\seed.sql
set /p OK=Escribe S y presiona Enter para continuar: 
if /i not "%OK%"=="S" exit /b
where node >/dev/null 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instalalo desde https://nodejs.org ^(version LTS^)
  pause
  exit /b
)
if not exist "node_modules\express\package.json" (
  echo Instalando lo necesario por primera vez. Espera uno o dos minutos...
  call npm install
  if not exist "node_modules\express\package.json" (
    echo.
    echo No se pudo instalar. Revisa tu conexion a internet y vuelve a intentarlo.
    pause
    exit /b
  )
)
echo.
echo La pagina se abrira en tu navegador: http://localhost:3000
echo Para apagarla, cierra esta ventana.
echo.
start "" cmd /c "timeout /t 4 >/dev/null & start http://localhost:3000"
call npm run reset-db
pause
