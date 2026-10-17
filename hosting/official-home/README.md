# Home institucional — pacote do domínio oficial

Pacote isolado para servir a home institucional somente na raiz de
`https://inspiracred.com.br/`, preservando o WordPress e todas as demais rotas.

## Publicação

1. Fazer backup de `public_html/.htaccess`.
2. Criar `public_html/_institucional/`.
3. Enviar `index.html` e `script.js` para essa pasta.
4. Substituir o bloco InspiraCred existente pelo conteúdo completo de
   `htaccess-root-snippet.conf`, sempre acima de `# BEGIN WordPress`.
5. Limpar somente o cache web/CDN do domínio e conferir a raiz em HTTPS.

O snippet não captura `www`; o redirect atual de `www.inspiracred.com.br` para
o apex deve permanecer sob a configuração já existente da Hostinger. Além da
home, ele envia por `301` apenas as URLs legadas exatas que ainda aparecem como
sitelinks no Google para suas páginas atuais. Rotas filhas e outras páginas do
WordPress permanecem intactas.

Os assets visuais, o tracking e as páginas de sucesso usam URLs absolutas de
`nova.inspiracred.com.br`; por isso a raiz do projeto Pages continua histórica e
`/home/` continua sendo a fonte aprovada da home.

## Rollback

Restaurar o backup de `.htaccess` feito imediatamente antes da publicação. A
pasta `_institucional` pode permanecer inerte ou ser removida depois da
confirmação. Nenhum registro DNS, nameserver, MX/TXT ou email precisa ser
alterado.
