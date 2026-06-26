# Test VBus TCP Resol — stessa sequenza dell'Heltec (porta 7053)
# Uso: powershell -ExecutionPolicy Bypass -File test_resol_vbus.ps1
# Opzionale: powershell -ExecutionPolicy Bypass -File test_resol_vbus.ps1 -Password "vbus"

param(
    [string]$HostIp = "192.168.8.201",
    [int]$Port = 7053,
    [string]$Password = "vbus"
)

Write-Host "Connessione a ${HostIp}:${Port} ..."
Write-Host "Password da provare: $Password"
Write-Host ""

try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.ReceiveTimeout = 8000
    $tcp.SendTimeout = 8000
    $tcp.Connect($HostIp, $Port)

    $stream = $tcp.GetStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $writer = New-Object System.IO.StreamWriter($stream)
    $writer.AutoFlush = $true

    $hello = $reader.ReadLine()
    Write-Host "Ricevuto: $hello"

    Write-Host "Invio: PASS $Password"
    $writer.WriteLine("PASS $Password")
    $passReply = $reader.ReadLine()
    Write-Host "Ricevuto: $passReply"

    if ($passReply -match "accepted") {
        Write-Host "Invio: DATA"
        $writer.WriteLine("DATA")
        $dataReply = $reader.ReadLine()
        Write-Host "Ricevuto: $dataReply"
        Write-Host ""
        Write-Host "OK - password corretta, VBus risponde."
    } else {
        Write-Host ""
        Write-Host "ERRORE - password rifiutata dal Resol (non e' un problema Heltec)."
        Write-Host "Prova altra password: -Password ""tua_password"""
    }
}
catch {
    Write-Host "ERRORE connessione: $_"
    Write-Host "Il PC e' sulla stessa rete del Resol (192.168.8.x)?"
}
finally {
    if ($tcp) { $tcp.Close() }
}
