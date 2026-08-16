# EQC Quality Gate Configuration

## Ambiente detectado

- Linguagem: TypeScript/TSX
- Framework: React 19 com Vite
- Package manager: npm
- Test framework: Vitest, Testing Library e Playwright
- Plataforma: Node.js 22+, navegador Chromium e extensão Chrome

## Comandos

### Build
`npm run build`

### Typecheck
`npm run typecheck`

### Lint
`NAO_APLICAVEL — não existe configuração de lint no projeto`

### Testes
`npm test`

### Cobertura
`npm run test:coverage`

### Complexidade
`node .github/quality/measure-complexity.mjs`

### Segurança
`npm audit --audit-level=high`

### Dependências circulares
`npm run check:circular`

### Duplicação
`npm run check:duplication`

### Fluxos críticos
`npm run test:e2e`

## Limites

- cobertura_global_minima: 90%
- cobertura_fluxos_criticos: 100%
- complexidade_ciclomatica_maxima_por_funcao: 10
- complexidade_cognitiva_maxima_por_funcao: 15
- profundidade_aninhamento_maxima: 3
- linhas_por_funcao_preferido: 40
- linhas_por_funcao_maximo: 60
- parametros_por_funcao_preferido: 4
- parametros_por_funcao_maximo: 5
- dependencias_diretas_preferido_por_modulo: 5
- dependencias_diretas_maximo_por_modulo: 7
- dependencias_circulares: 0
- duplicacao_maxima: 5%
- vulnerabilidades_criticas: 0
- vulnerabilidades_altas: 0
- testes_falhando: 0

## Critérios operacionais

- `NAO_APLICAVEL` é aceito somente para lint porque o repositório não possui lint configurado.
- Métricas de complexidade, cobertura, duplicação, ciclos e segurança não podem ser `NAO_MEDIDA`.
- O fluxo crítico é considerado coberto quando a suíte E2E completa passa sem falhas.
- Qualquer comando obrigatório com exit code diferente de zero reprova o gate.
