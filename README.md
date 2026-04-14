# RotaPDF (PWA)

PWA web para abrir PDF, identificar enderecos e redirecionar para o Waze.

## Como usar

1. Abra `index.html` por um servidor local (exemplo: `npx serve .`).
2. Instale o app no celular pelo navegador (Adicionar a tela inicial).
3. Abra um PDF dentro do app ou use a opcao Abrir com para enviar ao PWA.
4. O app tenta detectar enderecos e abrir automaticamente o primeiro no Waze.

## Recursos

- Leitura de PDF no navegador com PDF.js.
- Deteccao automatica de linhas com padrao de endereco.
- Botao para abrir cada endereco no Waze.
- Modo PWA instalavel com cache offline basico.
- Suporte a abertura de arquivos PDF em navegadores que implementam file handlers + launchQueue.

## Observacoes importantes

- A deteccao de endereco usa heuristica. PDFs muito desestruturados podem exigir ajuste.
- Suporte de abrir PDF diretamente no app depende do navegador/dispositivo.
- Em Android, use Chrome recente para maior compatibilidade.

## Deploy na Hostinger via Git

- Guia completo: veja `HOSTINGER_GIT_DEPLOY.md`.
- Arquivo `.htaccess` incluido para compatibilidade PWA em hospedagem Apache.
