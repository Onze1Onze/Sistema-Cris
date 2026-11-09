# Conexão com CRIS — extensão para Owlbear Rodeo

Extensão vertical para importar fichas públicas do C.R.I.S., exibi-las em um painel temático de Ordem Paranormal e vinculá-las a Tokens do Owlbear Rodeo.

## Código-fonte

O projeto modular completo está no arquivo **[conexao-com-cris-source.zip](./conexao-com-cris-source.zip)**. Baixe o arquivo e extraia seu conteúdo para obter a estrutura TypeScript, interface, parser, cache, sincronização, testes e documentação.

## Situação da integração CRIS

A importação tenta consultar um caminho público do Firestore observado em um adaptador comunitário e, em seguida, tenta ler o HTML público da ficha (metadados Open Graph, JSON embutido, rótulos e seções). O endpoint Firestore não é apresentado como API oficial do CRIS e pode mudar. O acesso direto depende de a origem permitir CORS; não há proxy, cookies, credenciais nem contorno de autenticação. Quando a origem bloquear o navegador, a extensão informa a limitação e mantém a última cópia em cache.

## Desenvolvimento

Requer Node.js 20 ou superior.

- `npm install`
- `npm run build`
- `npm test`

O resultado do build fica em `dist/`; hospede essa pasta em HTTPS e registre o `manifest.json` público no Owlbear Rodeo.

## Persistência e sincronização

As fichas são sincronizadas no metadata da cena do Owlbear, sem guardar imagens binárias nesse metadata. Cache IndexedDB mantém uma cópia local de contingência. O metadata da sala tem limites próprios; por isso o projeto utiliza metadata da cena para o estado compartilhado e evita incorporar retratos em base64.

## Licença

MIT. Consulte `LICENSE` no arquivo-fonte.
