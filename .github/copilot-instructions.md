# Engineering Quality Governance

## Idioma

- Responder em pt-BR.
- Relatórios técnicos devem ser objetivos e verificáveis.

## Regra pré-implementação

Antes de escrever código:

1. inspecionar implementação relacionada;
2. identificar código reutilizável;
3. identificar duplicações;
4. avaliar refatoração antes de criar abstração nova;
5. mapear dependências afetadas;
6. avaliar acoplamento;
7. avaliar complexidade prevista;
8. definir comportamento testável;
9. avaliar riscos de segurança;
10. somente então implementar.

## Ordem obrigatória de decisão

1. Reutilizar.
2. Estender.
3. Refatorar.
4. Criar código novo.

## Complexidade

- Ciclomática 1-5: baixa.
- Ciclomática 6-10: média.
- Ciclomática >10: bloqueante.
- Cognitiva 0-8: baixa.
- Cognitiva 9-15: média.
- Cognitiva >15: bloqueante.
- Aninhamento máximo: 3.
- Preferir funções <=40 linhas.
- Bloquear funções >60 linhas sem justificativa arquitetural formal.
- Preferir <=4 parâmetros.
- Máximo: 5 parâmetros.
- Dependências diretas preferidas por módulo: <=5.
- Máximo de dependências diretas por módulo: 7.
- Dependências circulares: 0.
- Duplicação máxima: 5%.

## Arquitetura

- Alta coesão.
- Baixo acoplamento.
- Proibir dependências circulares.
- Evitar estado global novo.
- Preferir composição.
- Evitar abstrações especulativas.
- Evitar camadas sem benefício demonstrável.
- Preservar contratos públicos durante refatorações, salvo requisito explícito em contrário.

## Segurança

Verificar defensivamente:

- entradas não confiáveis;
- autenticação;
- autorização;
- injection;
- XSS;
- CSRF;
- SSRF;
- path traversal;
- execução arbitrária;
- desserialização insegura;
- segredos;
- criptografia;
- dependências vulneráveis;
- configurações inseguras;
- exposição de dados;
- condições de corrida.

Bloqueadores:

- vulnerabilidades críticas: 0;
- vulnerabilidades altas: 0.

Não explorar infraestrutura externa sem autorização explícita.

## Testes

Cobrir, quando aplicável:

- lógica;
- unidade;
- integração;
- componentes;
- temas;
- regressão;
- limites;
- falhas;
- segurança.

Metas:

- cobertura global >=90%;
- fluxos críticos =100%;
- testes falhando =0.

## Evidência

Nenhum agente pode declarar PASS com base apenas em opinião.

Toda aprovação deve referenciar arquivos analisados, métricas medidas e/ou comandos executados.

## Definition of Done

Uma alteração só está concluída quando:

- build aplicável passa;
- typecheck aplicável passa;
- lint aplicável passa;
- testes passam;
- cobertura atende ao limite;
- complexidade atende aos limites;
- segurança não possui bloqueadores;
- dependências circulares =0;
- duplicação atende ao limite;
- não há regressão conhecida;
- quality score >=91/100.
