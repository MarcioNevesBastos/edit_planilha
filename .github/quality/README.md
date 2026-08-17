# EQC Quality Gate

Este diretório contém a configuração e os runners do Engineering Quality Controller.

## Execução Linux/macOS

```bash
bash .github/quality/run-quality-gate.sh
```

## Execução Windows

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .github\quality\run-quality-gate.ps1
```

O gate reutiliza os scripts do `package.json`, mede cobertura, complexidade, duplicação, ciclos e vulnerabilidades, e retorna código diferente de zero quando um hard gate falha.

O hook de Stop é opcional; a validação direta pelo runner permanece obrigatória.
