# Preparar planilha

Aplicativo local para preparar dados e exportar uma planilha Excel.

## Pré-requisitos

- Node.js 22 ou superior
- npm (instalado junto com o Node.js)

Confira as versões instaladas:

```bash
node --version
npm --version
```

## Executar o projeto

No terminal, acesse a pasta do projeto e instale as dependências:

```bash
cd /home/seu_usuario/edit_planilha
npm ci
```

Inicie o servidor local:

```bash
npm run dev:e2e
```

## Abrir no navegador

Abra o endereço informado pelo terminal, seguido de `/app.html`.

Normalmente, o endereço é:

```text
http://127.0.0.1:4173/app.html
```

Se a porta `4173` já estiver ocupada, o Vite escolhe outra porta, como `4174` ou `4175`. Use a porta exibida no terminal.

## Parar o servidor

No terminal que está executando o projeto, pressione:

```text
Ctrl + C
```

## Problemas comuns

### Erro de permissão em `node_modules`

Se aparecer um erro `EACCES`, corrija a propriedade da pasta e instale novamente:

```bash
sudo chown -R "$USER":"$USER" node_modules
rm -rf node_modules
npm ci
```

### Erro do Rollup ao iniciar

Se aparecer `Cannot find module @rollup/rollup-linux-x64-gnu`, reinstale as dependências opcionais:

```bash
rm -rf node_modules
npm install --include=optional
```

## Verificar o projeto

Execute os testes e o build de produção:

```bash
npm test
npm run build
```
