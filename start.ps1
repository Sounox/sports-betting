# Script de démarrage Windows PowerShell
# Usage : .\start.ps1

Write-Host "SportsBet Analyzer — Démarrage" -ForegroundColor Green

# Vérifier que Docker est lancé
try {
    docker info | Out-Null
} catch {
    Write-Host "Docker n'est pas lancé. Démarrez Docker Desktop." -ForegroundColor Red
    exit 1
}

# Copier .env si pas existant
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host ".env créé. Editez-le pour ajouter vos clés API." -ForegroundColor Yellow
    notepad .env
    Read-Host "Appuyez sur Entrée après avoir sauvegardé le .env"
}

# Démarrer les services
Write-Host "Démarrage des services..." -ForegroundColor Cyan
docker-compose up -d postgres redis

Write-Host "Attente de la base de données..." -ForegroundColor Cyan
Start-Sleep -Seconds 8

Write-Host "Démarrage du backend et worker..." -ForegroundColor Cyan
docker-compose up -d backend worker

Write-Host "Attente du backend..." -ForegroundColor Cyan
Start-Sleep -Seconds 10

Write-Host "Démarrage du frontend..." -ForegroundColor Cyan
docker-compose up -d frontend

Write-Host ""
Write-Host "Tous les services sont démarrés !" -ForegroundColor Green
Write-Host ""
Write-Host "Frontend  : http://localhost:3000" -ForegroundColor White
Write-Host "API       : http://localhost:8000" -ForegroundColor White
Write-Host "API Docs  : http://localhost:8000/docs" -ForegroundColor White
Write-Host ""
Write-Host "Pour importer les données de la Coupe du Monde :" -ForegroundColor Yellow
Write-Host "  Allez sur http://localhost:3000/config et cliquez 'Importer' sur WC" -ForegroundColor Yellow
