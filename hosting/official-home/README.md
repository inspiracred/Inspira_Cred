# Home institucional — pacote do domínio oficial

Pacote isolado para servir a home institucional somente na raiz de
`https://inspiracred.com.br/`, preservando o WordPress e todas as demais rotas.

## Publicação

1. Fazer backup de `public_html/.htaccess`.
2. Criar `public_html/_institucional/`.
3. Enviar `index.html` e `script.js` para essa pasta.
4. Inserir o conteúdo de `htaccess-root-snippet.conf` acima de
   `# BEGIN WordPress`.
5. Limpar somente o cache web/CDN do domínio e conferir a raiz em HTTPS.

O snippet não captura `www`; o redirect atual de `www.inspiracred.com.br` para
o apex deve permanecer sob a configuração já existente da Hostinger.

Os assets visuais, o tracking e as páginas de sucesso usam URLs absolutas de
`nova.inspiracred.com.br`; por isso a raiz do projeto Pages continua histórica e
`/home/` continua sendo a fonte aprovada da home.

## Rollback

Remover somente o bloco de seis linhas identificado pelo comentário do snippet,
ou restaurar o backup de `.htaccess`. A pasta `_institucional` pode permanecer
inerte ou ser removida depois da confirmação. Nenhum registro DNS, nameserver,
MX/TXT, email ou rota WordPress precisa ser alterado.
