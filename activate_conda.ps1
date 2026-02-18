# PowerShell script to activate the .conda environment
$env:CONDA_DEFAULT_ENV = ".conda"
$env:CONDA_PREFIX = "D:\code\AudioLab\.conda"
$env:PATH = "D:\code\AudioLab\.conda\Scripts;D:\code\AudioLab\.conda;D:\code\AudioLab\.conda\Library\bin;" + $env:PATH

Write-Host "Conda environment '.conda' activated!" -ForegroundColor Green
Write-Host "Python: $(python --version)" -ForegroundColor Cyan
Write-Host "Python path: $(where.exe python)" -ForegroundColor Cyan
