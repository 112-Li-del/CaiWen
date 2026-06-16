@echo off
chcp 65001 >nul
echo ============================================
echo   DeepTutor 更新脚本
echo ============================================

cd /d %~dp0

echo.
echo [1/5] 停止当前服务...
python scripts\stop_web.py 2>nul

echo.
echo [2/5] 拉取最新代码...
git pull
if %errorlevel% neq 0 (
    echo ⚠️ git pull 失败，请检查网络
    pause
    exit /b 1
)

echo.
echo [3/5] 检查 Python 依赖...
.venv\Scripts\python.exe -m pip install -r requirements.txt --quiet

echo.
echo [4/5] 检查前端依赖并构建...
cd web
call npm install --legacy-peer-deps 2>nul
call npm run build
cd ..

echo.
echo [5/5] 更新完成！现在可以用 start.bat 启动服务。
echo ============================================
pause
