# Deploy do PWA na Hostinger via Git

Este projeto e estatico (HTML/CSS/JS), entao funciona bem com deploy por Git na Hostinger.

## Pre-requisitos

1. Repositorio no GitHub pronto (ja esta):
   - https://github.com/r3br4k3/Leitor-de-PDF.git
2. Hospedagem Hostinger com acesso ao hPanel.
3. HTTPS ativo no dominio (obrigatorio para PWA).

## Metodo recomendado (hPanel Git)

1. No hPanel, entre em **Advanced > Git** (ou **Git Deployment**, dependendo do plano).
2. Clique em **Create Repository** ou **Deploy from Git**.
3. Informe:
   - Repository URL: `https://github.com/r3br4k3/Leitor-de-PDF.git`
   - Branch: `main`
   - Deploy path: `public_html`
4. Salve e execute o primeiro deploy (Clone/Pull).
5. Abra seu dominio e valide se o app carregou.

## Atualizacoes futuras

1. Faça commit/push no GitHub normalmente.
2. No hPanel Git, rode **Pull** para trazer a versao nova.

## Validacao do PWA em producao

1. Acesse seu dominio em HTTPS.
2. Abra DevTools > Application e confirme:
   - Manifest carregado
   - Service Worker ativo
3. Teste instalacao no celular (Adicionar a tela inicial).

## Se sua Hostinger nao tiver Git no hPanel

Use o metodo alternativo por SSH:

1. Ative SSH no hPanel.
2. Adicione sua chave publica SSH na hospedagem.
3. Conecte por terminal SSH e rode:

```bash
git clone https://github.com/r3br4k3/Leitor-de-PDF.git public_html
```

Para atualizar depois:

```bash
cd public_html
git pull origin main
```

## Observacoes importantes

- O arquivo `.htaccess` ja foi incluido para melhorar cache e compatibilidade PWA.
- Se publicar em subpasta (nao em `public_html` raiz), ajuste `start_url` e `scope` no `manifest.webmanifest`.
