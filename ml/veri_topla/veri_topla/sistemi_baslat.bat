@echo off
color 0A
echo ===================================================
echo MCBU - IoT Otomatik Yoklama Sistemi Baslatiliyor...
echo ===================================================
echo.

:: Bat dosyasının çalıştığı dizini çalışma dizini olarak ayarla
cd /d "%~dp0"

echo [1] Canli Tahmin Sistemi (canli_tahmin.py) baslatiliyor...
start "Canli Tahmin Sistemi" cmd /k "title Canli Tahmin Sistemi && python canli_tahmin.py"

:: API limitlerine veya dosya çakışmalarına takılmamak için 2 saniye bekle
timeout /t 2 /nobreak >nul

echo [2] Anomali Tespit Sistemi (anomali_tespit.py) baslatiliyor...
start "Anomali Tespit Sistemi" cmd /k "title Anomali Tespit Sistemi && python anomali_tespit.py"

echo.
echo Sistemler basariyla ayri pencerelerde calismaya basladi!
echo Konsol pencerelerini kapatmak sistemleri durdurur.
timeout /t 5 >nul
exit