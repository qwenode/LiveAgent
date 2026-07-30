@echo off
setlocal EnableExtensions

rem Build the LiveAgent Windows x64 installers (NSIS .exe and MSI .msi).
rem Run this file from anywhere; paths are resolved relative to build.bat.

set "ROOT_DIR=%~dp0"
set "GUI_DIR=%ROOT_DIR%crates\agent-gui"
set "TARGET=x86_64-pc-windows-msvc"
set "RUSTUP_TOOLCHAIN=stable"
set "TAURI_CONFIG=src-tauri\tauri.windows.conf.json"
set "CARGO_TARGET_DIR=%ROOT_DIR%target"
set "BUNDLE_DIR=%CARGO_TARGET_DIR%\%TARGET%\release\bundle"
set "OUTPUT_DIR=%ROOT_DIR%dist\windows"
set "VERSION_CONFIG=%CARGO_TARGET_DIR%\tauri.windows.local-version.conf.json"
set "PROTOC_VERSION=34.0"
set "PROTOC_HOME=%LOCALAPPDATA%\LiveAgentBuildTools\protoc-%PROTOC_VERSION%"
set "PROTOC_URL=https://github.com/protocolbuffers/protobuf/releases/download/v%PROTOC_VERSION%/protoc-%PROTOC_VERSION%-win64.zip"
set "PROTOC_ZIP=%TEMP%\liveagent-protoc-%PROTOC_VERSION%-win64.zip"

if /I not "%OS%"=="Windows_NT" (
  echo [ERROR] This script must be run on Windows.
  goto :fail
)

if not exist "%GUI_DIR%\package.json" (
  echo [ERROR] Desktop project not found: "%GUI_DIR%"
  goto :fail
)

echo ============================================================
echo  LiveAgent Windows x64 installer build
echo ============================================================
echo.

call :require_command node "Install Node.js 22 or run: mise install"
if errorlevel 1 goto :fail

where pnpm >nul 2>&1
if errorlevel 1 (
  echo [INFO] pnpm was not found. Trying to enable pnpm 10.32.1 with Corepack...
  where corepack >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] pnpm and Corepack are not installed.
    echo         Install pnpm with: npm install -g pnpm@10.32.1
    goto :fail
  )
  call corepack enable
  if errorlevel 1 goto :fail
  call corepack prepare pnpm@10.32.1 --activate
  if errorlevel 1 goto :fail
)

call :require_command cargo "Install the Rust MSVC toolchain from https://rustup.rs/"
if errorlevel 1 goto :fail
call :require_command rustup "Install Rust through rustup from https://rustup.rs/"
if errorlevel 1 goto :fail
call :ensure_protoc
if errorlevel 1 goto :fail

echo [1/5] Updating the stable Rust toolchain...
rustup update stable
if errorlevel 1 goto :fail

echo.
echo [2/5] Ensuring Rust target %TARGET% is installed...
rustup target list --installed | findstr /X /C:"%TARGET%" >nul
if errorlevel 1 (
  rustup target add %TARGET%
  if errorlevel 1 goto :fail
)

echo.
echo [3/5] Preparing an MSI-compatible local app version...
pushd "%GUI_DIR%"
for /f "delims=" %%V in ('node -p "require('./package.json').version.split('-')[0]"') do set "APP_VERSION=%%V"
if not defined APP_VERSION (
  echo [ERROR] Could not read the app version from package.json.
  popd
  goto :fail
)
if not exist "%CARGO_TARGET_DIR%" mkdir "%CARGO_TARGET_DIR%"
> "%VERSION_CONFIG%" echo {"version":"%APP_VERSION%"}
set "LIVEAGENT_APP_VERSION=%APP_VERSION%"
echo [INFO] Installer version: %APP_VERSION%

echo.
echo [4/5] Installing frontend dependencies...
call pnpm install --frozen-lockfile
if errorlevel 1 (
  popd
  goto :fail
)

echo.
echo [5/5] Building NSIS and MSI installers...
call pnpm tauri build --config "%TAURI_CONFIG%" --config "%VERSION_CONFIG%" --target %TARGET%
if errorlevel 1 (
  popd
  goto :fail
)
popd

if not exist "%BUNDLE_DIR%" (
  echo [ERROR] Build finished but the bundle directory was not found:
  echo         "%BUNDLE_DIR%"
  goto :fail
)

if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"
set "FOUND_INSTALLER=0"

for %%F in ("%BUNDLE_DIR%\msi\LiveAgent_%APP_VERSION%_*.msi") do if exist "%%~fF" (
  copy /Y "%%~fF" "%OUTPUT_DIR%\%%~nxF" >nul
  echo [OK] MSI:  "%OUTPUT_DIR%\%%~nxF"
  set "FOUND_INSTALLER=1"
)

for %%F in ("%BUNDLE_DIR%\nsis\LiveAgent_%APP_VERSION%_*setup.exe") do if exist "%%~fF" (
  copy /Y "%%~fF" "%OUTPUT_DIR%\%%~nxF" >nul
  echo [OK] EXE:  "%OUTPUT_DIR%\%%~nxF"
  set "FOUND_INSTALLER=1"
)

if "%FOUND_INSTALLER%"=="0" (
  echo [ERROR] No .msi or installer .exe was found under:
  echo         "%BUNDLE_DIR%"
  goto :fail
)

echo.
echo ============================================================
echo  Build completed successfully.
echo  Installers: "%OUTPUT_DIR%"
echo ============================================================
echo.
if not defined CI pause
exit /b 0

:require_command
where %~1 >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Required command not found: %~1
  echo         %~2
  exit /b 1
)
exit /b 0

:ensure_protoc
where protoc >nul 2>&1
if not errorlevel 1 exit /b 0

if exist "%PROTOC_HOME%\bin\protoc.exe" (
  set "PATH=%PROTOC_HOME%\bin;%PATH%"
  exit /b 0
)

call :require_command powershell "PowerShell is required to download protoc automatically."
if errorlevel 1 exit /b 1

echo [INFO] protoc was not found. Downloading protoc %PROTOC_VERSION%...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $null = New-Item -ItemType Directory -Force -Path (Split-Path $env:PROTOC_HOME); Invoke-WebRequest -Uri $env:PROTOC_URL -OutFile $env:PROTOC_ZIP; if (Test-Path $env:PROTOC_HOME) { Remove-Item -Recurse -Force $env:PROTOC_HOME }; Expand-Archive -Path $env:PROTOC_ZIP -DestinationPath $env:PROTOC_HOME -Force; Remove-Item -Force $env:PROTOC_ZIP"
if errorlevel 1 (
  echo [ERROR] Failed to download protoc from:
  echo         %PROTOC_URL%
  exit /b 1
)
set "PATH=%PROTOC_HOME%\bin;%PATH%"
where protoc >nul 2>&1
if errorlevel 1 (
  echo [ERROR] protoc.exe was not found after extraction: "%PROTOC_HOME%\bin"
  exit /b 1
)
exit /b 0

:fail
echo.
echo ============================================================
echo  Build failed. Review the error messages above.
echo.
echo  Windows builds also require:
echo    - Visual Studio 2022 Build Tools with Desktop development with C++
echo    - Microsoft Edge WebView2 Runtime
echo ============================================================
echo.
if not defined CI pause
exit /b 1
