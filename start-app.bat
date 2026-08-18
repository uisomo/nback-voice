@echo off
setlocal
title 音声N-back ランチャー

REM node_modules は WSL 側でインストールされており、Linux 専用のネイティブ
REM バイナリ (lightningcss 等) を含む。Windows の node から直接叩くと web の
REM バンドルで落ちるため、すべて WSL 経由で実行する。
set PROJECT=/mnt/c/Projects/nback-voice

:menu
cls
echo ============================================================
echo   音声N-back  ランチャー
echo ============================================================
echo.
echo   [1] ブラウザで遊ぶ        (Chrome / Edge, 実機不要)
echo   [2] iPhone で遊ぶ          (開発ビルド済みの端末が必要)
echo   [3] テストを実行           (287 tests)
echo   [4] 型チェック
echo   [5] 終了
echo.
echo ------------------------------------------------------------
set /p CHOICE=  番号を入力して Enter:

if "%CHOICE%"=="1" goto web
if "%CHOICE%"=="2" goto device
if "%CHOICE%"=="3" goto test
if "%CHOICE%"=="4" goto typecheck
if "%CHOICE%"=="5" goto end
echo.
echo   1-5 のいずれかを入力してください。
timeout /t 2 >nul
goto menu

:web
cls
echo ============================================================
echo   ブラウザで起動
echo ============================================================
echo.
echo   ブラウザが開いたらマイクの使用を許可してください。
echo   音声認識に対応しているのは Chrome と Edge だけです。
echo   Firefox / Safari では回答を聞き取れません。
echo.
echo   止めるときは Ctrl+C。
echo ------------------------------------------------------------
echo.
wsl.exe -e bash -lc "cd %PROJECT% && npx expo start --web"
goto done

:device
cls
echo ============================================================
echo   iPhone で起動
echo ============================================================
echo.
echo   iPhone に開発ビルドがインストール済みであること。
echo   まだなら先に  eas build --profile development --platform ios
echo   PC と iPhone が同じ Wi-Fi にいることを確認してください。
echo.
echo   表示された QR を iPhone のカメラで読み取ります。
echo   止めるときは Ctrl+C。
echo ------------------------------------------------------------
echo.
wsl.exe -e bash -lc "cd %PROJECT% && npx expo start --dev-client"
goto done

:test
cls
echo ============================================================
echo   テスト
echo ============================================================
echo.
wsl.exe -e bash -lc "cd %PROJECT% && npm test"
goto done

:typecheck
cls
echo ============================================================
echo   型チェック
echo ============================================================
echo.
wsl.exe -e bash -lc "cd %PROJECT% && npx tsc --noEmit && echo '型エラーなし'"
goto done

:done
echo.
echo ============================================================
echo   終了しました。
echo ============================================================
echo.
pause
goto menu

:end
endlocal
