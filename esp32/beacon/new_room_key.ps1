# Bir derslik icin yeni, rastgele 32 baytlik sinif anahtari uretir (docs/protocol.md bolum 8).
# Cikan iki satir AYNI anahtardir:
#   - C dizisi  -> esp32/beacon/config.h icindeki ROOM_KEY
#   - base64    -> Firebase Console'da RoomSecrets/{derslik}/key
# Anahtari bir yere kaydetme, mesajla gonderme; iki yere yapistirdiktan sonra pencereyi kapat.
# Kullanim (proje kokunde):
#   powershell -ExecutionPolicy Bypass -File esp32\beacon\new_room_key.ps1

$key = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($key)
$rng.Dispose()

$hex = ($key | ForEach-Object { '0x{0:x2}' -f $_ })
$lines = for ($i = 0; $i -lt 32; $i += 8) { '  ' + ($hex[$i..($i + 7)] -join ', ') }

Write-Host ""
Write-Host "config.h icin:"
Write-Host "static const uint8_t ROOM_KEY[32] = {"
Write-Host ($lines -join ",`n")
Write-Host "};"
Write-Host ""
Write-Host "Firebase RoomSecrets/{derslik}/key icin (base64):"
Write-Host ([Convert]::ToBase64String($key))
Write-Host ""
