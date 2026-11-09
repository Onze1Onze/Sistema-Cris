# Conexão com CRIS — extensão para Owlbear Rodeo

Extensão vertical para importar fichas públicas do C.R.I.S., exibi-las como dossiês de investigação inspirados em Ordem Paranormal e vinculá-las a Tokens do Owlbear Rodeo.

## Estado da implementação

O repositório contém a primeira implementação modular. Os módulos TypeScript estão divididos em arquivos ZIP para facilitar a publicação: `source-core.zip`, `source-sync.zip`, `source-ui-shell.zip`, `source-ui-style.zip` e `source-docs.zip`. O ponto de entrada visual `src/ui/app.ts` está diretamente no repositório.

## Preparar o código-fonte

Requer Node.js 20+ e npm. Extraia os módulos na raiz do repositório:

- `unzip -o source-core.zip -d .`
- `unzip -o source-sync.zip -d .`
- `unzip -o source-ui-shell.zip -d .`
- `unzip -o source-ui-style.zip -d .`
- `unzip -o source-docs.zip -d .`

Depois execute:

- `npm install`
- `npm test`
- `npm run build`

A build é gerada em `dist/`.

## Importação do CRIS: limitação importante

A extensão aceita links públicos no formato `https://crisordemparanormal.com/agente/{id}`. O adaptador consulta, em modo best-effort e sem credenciais, um caminho REST do Firestore observado em um projeto comunitário público e tenta analisar o HTML da página como alternativa.

Esse caminho **não é uma API oficial documentada pelo CRIS** e não há garantia de acesso público ou CORS. O código não usa cookies, senhas, tokens, proxy ou qualquer tentativa de contornar autenticação. A importação real precisa ser validada no navegador com fichas públicas atuais; quando a origem bloquear o acesso, a extensão preserva o último cache válido e informa a falha.

## Persistência

As fichas e alterações de sessão são sincronizadas nos metadados da cena atual do Owlbear. O Token guarda apenas o identificador da ficha em seus próprios metadados, mantendo o vínculo ao mover o Token. O cache IndexedDB/localStorage é local ao navegador. Metadados da cena não devem ser confundidos com metadados da sala; a extensão não armazena documentos completos em `OBR.room`.

## Publicar pelo GitHub Pages

O workflow `.github/workflows/pages.yml` faz a extração dos módulos, instala dependências, executa testes/build e publica `dist/`.

1. Abra **Settings → Pages** no GitHub.
2. Selecione **GitHub Actions** em *Build and deployment*.
3. Verifique a execução em **Actions**.
4. Quando a publicação estiver concluída, cadastre no Owlbear o manifesto em:
   `https://Onze1Onze.github.io/Sistema-Conex-o-com-Cris/manifest.json`

A URL só estará disponível depois de o GitHub Pages estar habilitado e o workflow terminar com sucesso.

## Documentação

A documentação técnica está em `source-docs.zip`: arquitetura, importação do CRIS e checklist de testes manuais.

## Referências

- [Documentação oficial do Owlbear Rodeo](https://docs.owlbear.rodeo/extensions/)
- [SDK oficial do Owlbear Rodeo](https://github.com/owlbear-rodeo/sdk)
- [C.R.I.S. — site oficial](https://crisordemparanormal.com/)
- [Projeto comunitário de visualização de fichas CRIS](https://github.com/LucasPennacchi/visualizador_de_fichas)
