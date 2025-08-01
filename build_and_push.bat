@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM 獲取當前資料夾名稱作為 Docker 映像檔名稱
for %%i in ("%~dp0.") do set DOCKER_IMAGE_NAME=%%~ni

echo ========================================
echo Docker Build ^& Push - !DOCKER_IMAGE_NAME!
echo ========================================

REM 檢查 Docker 是否運行
echo 檢查 Docker 狀態...
docker info >nul 2>&1
if errorlevel 1 (
    echo 錯誤: Docker 未運行或未安裝
    echo 請先啟動 Docker Desktop
    pause
    exit /b 1
)

REM 檢查 Docker Hub 登入狀態
echo 檢查 Docker Hub 登入狀態...
docker search hello-world >nul 2>&1
if errorlevel 1 (
    echo 警告: 可能未登入 Docker Hub
    echo 建議先執行: docker login
) else (
    echo Docker Hub 登入狀態正常
)

REM 檢查是否有預設的 Docker 用戶名
if defined DOCKER_USERNAME (
    echo 使用環境變數中的用戶名: !DOCKER_USERNAME!
) else (
    echo 未設定 DOCKER_USERNAME 環境變數
)

REM 獲取 Docker Hub 用戶名
if "!DOCKER_USERNAME!"=="" (
    echo.
    echo 請輸入你的 Docker Hub 用戶名:
    set /p DOCKER_USERNAME=

    if "!DOCKER_USERNAME!"=="" (
        echo 錯誤: Docker Hub 用戶名不能為空
        pause
        exit /b 1
    )
    
    echo.
    echo 使用用戶名: !DOCKER_USERNAME!
    
    REM 詢問是否要記住用戶名
    echo.
    set /p REMEMBER_USERNAME="是否要記住這個用戶名供下次使用? (y/n): "
    if /i "!REMEMBER_USERNAME!"=="y" (
        echo 設定環境變數 DOCKER_USERNAME=!DOCKER_USERNAME!
        setx DOCKER_USERNAME "!DOCKER_USERNAME!"
        echo 環境變數已設定，下次執行時會自動使用此用戶名
    )
) else (
    echo.
    echo 使用環境變數中的用戶名: !DOCKER_USERNAME!
)

echo.
echo 開始建置 Docker 映像檔...
echo 映像檔名稱: !DOCKER_USERNAME!/!DOCKER_IMAGE_NAME!:latest

REM 建置映像檔
docker build -t !DOCKER_USERNAME!/!DOCKER_IMAGE_NAME!:latest .
if errorlevel 1 (
    echo 錯誤: Docker 建置失敗
    pause
    exit /b 1
)

echo.
echo Docker 映像檔建置成功！

REM 直接推送到 Docker Hub
echo.
echo 開始推送到 Docker Hub...

REM 推送映像檔
echo.
echo 推送映像檔到 Docker Hub...
docker push !DOCKER_USERNAME!/!DOCKER_IMAGE_NAME!:latest
if errorlevel 1 (
    echo 錯誤: 推送失敗
    pause
    exit /b 1
)

echo.
echo 推送成功!
echo 映像檔位置: !DOCKER_USERNAME!/!DOCKER_IMAGE_NAME!:latest

REM 清理未使用的 Docker 映像檔
echo.
echo 清理未使用的 Docker 映像檔...
docker image prune -f

echo.
echo ========================================
echo 完成!
echo ========================================
echo.
echo 使用說明:
echo 1. 本地運行: docker run -d --name !DOCKER_IMAGE_NAME! !DOCKER_USERNAME!/!DOCKER_IMAGE_NAME!:latest
echo 2. 使用 docker-compose: 修改 docker-compose.yml 中的 image 欄位
echo 3. 查看容器日誌: docker logs !DOCKER_IMAGE_NAME!
echo.
pause 