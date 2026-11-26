# DS3231'in saatini bilgisayarin saatine (UTC) ayarlar. ESP32'de rtc_test.ino ya da beacon.ino yuklu olmali.
# Arduino Serial Monitor KAPALI olmali (ayni anda iki program portu acamaz).
# Kullanim (proje kokunde):
#   powershell -ExecutionPolicy Bypass -File esp32\rtc_test\set_time.ps1 -Port COM9
param([string]$Port = "COM9")

$serial = New-Object System.IO.Ports.SerialPort $Port, 115200
$serial.NewLine = "`n"
$serial.ReadTimeout = 500
$serial.Open()

# Port acilinca ESP32 yeniden baslar; acilmasini bekle
Start-Sleep -Seconds 3
$serial.DiscardInBuffer()

$unix = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$serial.WriteLine("T$unix")
Write-Host "Gonderildi: T$unix (bilgisayar saati, UTC)"

# ESP32'nin cevabini birkac saniye goster
$until = (Get-Date).AddSeconds(4)
while ((Get-Date) -lt $until) {
    try { Write-Host $serial.ReadLine() } catch { }
}
$serial.Close()
