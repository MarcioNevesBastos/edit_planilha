# Agentes EQC do Codex

Estes arquivos TOML são agentes personalizados descobertos nativamente pelo Codex. As skills em `.agents/skills/` fornecem a invocação explícita no terminal e devem delegar ao agente indicado.

| Skill | Agente TOML | Uso |
| --- | --- | --- |
| `wednesday` | `wednesday` | Orquestra o fluxo EQC. |
| `eqc-context-architect` | `eqc_context_architect` | Arquitetura e reutilização. |
| `eqc-complexity-reviewer` | `eqc_complexity_reviewer` | Complexidade PRE e POST. |
| `eqc-implementer` | `eqc_implementer` | Implementação mínima aprovada. |
| `eqc-test-engineer` | `eqc_test_engineer` | Plano e execução de testes. |
| `eqc-security-auditor` | `eqc_security_auditor` | Revisão defensiva local. |
| `eqc-adversarial-reviewer` | `eqc_adversarial_reviewer` | Revisão independente. |
| `eqc-final-evaluator` | `eqc_final_evaluator` | Quality gate final. |

## Protocolo EQC

Todo relatório deve conter:

```text
AGENTE:
FASE:
STATUS: APROVADO | REPROVADO | BLOQUEADO
ESCOPO:
ARQUIVOS_ANALISADOS:
EVIDENCIAS:
METRICAS:
ACHADOS:
DECISOES:
BLOQUEADORES:
PROXIMA_ACAO_RECOMENDADA:
```

Um agente ausente ou inválido deve bloquear a delegação. O coordenador não deve executar silenciosamente o papel solicitado.
