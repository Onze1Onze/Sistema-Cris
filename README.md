# Sistema C.R.I.S.

Extensão para Owlbear Rodeo. No primeiro workflow, o repositório reconstitui os arquivos TypeScript individuais a partir dos fragmentos do pacote-fonte e faz um commit dessa estrutura na branch `main`.

A integração com C.R.I.S. é deliberadamente conservadora: na verificação de 9 de novembro de 2026 não foi localizada documentação oficial de uma API pública para leitura externa de fichas. A extensão valida o formato dos links públicos e aceita importação manual de dados em JSON normalizado próprio; não usa scraping de endpoints internos, credenciais, proxies de terceiros ou bypass de autenticação/CORS.

O primeiro workflow reconstitui o código, executa typecheck, testes e build, e tenta publicar o artefato no GitHub Pages. Caso Pages ainda não esteja configurado, abra **Settings → Pages** e escolha **GitHub Actions** como fonte de publicação.

Consulte o README completo após a materialização dos arquivos-fonte.
