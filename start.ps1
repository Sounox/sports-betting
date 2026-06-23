# SportsBet Analyzer — Script de démarrage (sans Docker)
# Double-cliquez sur ce fichier ou lancez : .\start.ps1

$ErrorActionPreference = "SilentlyContinue"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  SportsBet Analyzer — Démarrage" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# ── Backend ──────────────────────────────────────────────────────────
# Vérifier si déjà lancé
$backendRunning = (Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue) -ne $null
if (-not $backendRunning) {
    Write-Host "[1/2] Démarrage du backend FastAPI..." -ForegroundColor Cyan
    $env:DATABASE_URL = "sqlite:///./sportsbet.db"
    $env:SECRET_KEY = "dev-secret-change-in-prod"
    $env:ODDS_API_KEY = "baa56883db051af74cc48c5512bfc426"
    $env:FOOTBALL_DATA_API_KEY = "23589c0d13d34aa1bc32e5f2017b7e34"
    Start-Process -FilePath "python" `
        -ArgumentList "-m uvicorn app.main:app --host 0.0.0.0 --port 8000" `
        -WorkingDirectory "$root\backend" `
        -WindowStyle Minimized
    Start-Sleep -Seconds 4
} else {
    Write-Host "[1/2] Backend déjà actif sur :8000" -ForegroundColor Green
}

# ── Frontend ─────────────────────────────────────────────────────────
$frontendRunning = (Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue) -ne $null
if (-not $frontendRunning) {
    Write-Host "[2/2] Démarrage du frontend Next.js..." -ForegroundColor Cyan
    Start-Process -FilePath "npm" `
        -ArgumentList "run dev" `
        -WorkingDirectory "$root\frontend" `
        -WindowStyle Minimized
    Start-Sleep -Seconds 6
} else {
    Write-Host "[2/2] Frontend déjà actif sur :3000" -ForegroundColor Green
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Tout est prêt !" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Dashboard  : http://localhost:3000" -ForegroundColor White
Write-Host "  API Docs   : http://localhost:8000/docs" -ForegroundColor White
Write-Host ""

# Ouvrir le navigateur automatiquement
Start-Process "http://localhost:3000"
