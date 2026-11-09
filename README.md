# Sistema C.R.I.S. — extensão para Owlbear Rodeo

Extensão vertical de consulta que registra links de fichas C.R.I.S., permite associá-los a Tokens da cena e apresenta um dossiê compacto dentro do Owlbear Rodeo.

> **Limite importante da integração:** na verificação realizada em 9 de novembro de 2026, não foi localizada documentação oficial pública de uma API do C.R.I.S. que permita consultar fichas de terceiros. Por isso, esta versão **não faz leitura automática do conteúdo remoto**. Ela valida o formato do link e permite importar dados em um JSON normalizado próprio do projeto. O link validado não comprova que a ficha exista, esteja pública ou possa ser lida por outra aplicação.

A extensão não usa rotas internas não documentadas, scraping da interface, proxy de terceiros, login, cookies, tokens ou mecanismos para contornar autenticação/CORS. A importação manual é uma ponte transparente até que exista uma integração oficial documentada.

## Funcionalidades

- Action própria no Owlbear Rodeo para abrir o painel principal.
- Menu contextual no Token para abrir o dossiê ou vincular/substituir uma ficha.
- Validação de HTTPS, domínio e rota pública conhecida `/agente/{id}` do C.R.I.S.
- Biblioteca de múltiplas fichas por sala.
- Associação de fichas a Tokens por metadata namespaced do Owlbear.
- Metadata da cena/Token sincronizada pelo Owlbear, sem guardar o conteúdo completo por padrão.
- Cache local no navegador para os dados importados.
- Importação manual de JSON normalizado, com campos opcionais e preservação de dados adicionais.
- Compartilhamento opcional dos dados importados no Token, desligado por padrão.
- Desvincular um Token ou remover uma ficha da sala (removendo também seus vínculos).
- Interface vertical, responsiva, com abas de personagem, combate, perícias, equipamento e configurações.
- Testes unitários de validação de URL e parser.

## Instalação no Owlbear Rodeo

O endereço do manifesto após publicar no GitHub Pages será:

`https://onze1onze.github.io/Sistema-Cris/manifest.json`

1. Abra ou entre em uma sala no Owlbear Rodeo.
2. Acesse a área de Extensions / Extensões.
3. Adicione uma extensão por URL e cole o endereço do manifesto acima.
4. Abra a Action **Sistema C.R.I.S.** na barra da sala.
5. Para consultar um Token, abra o menu contextual dele e escolha **Abrir ficha C.R.I.S.**.
6. Para associar uma ficha, use **Vincular / substituir ficha C.R.I.S.** no menu contextual, ou selecione um Token e use o botão **VINCULAR** na biblioteca.

O manifesto é servido na raiz pública do GitHub Pages do repositório `Sistema-Cris`. Se o nome do repositório ou o proprietário mudar, atualize `base` em `vite.config.ts`, os caminhos em `src/owlbear/contextMenu.ts` e o endereço no manifesto/README.

## Cadastrar e vincular uma ficha

1. Abra **Sistema C.R.I.S.**.
2. Cole o link HTTPS de uma ficha pública do C.R.I.S. no formato `https://crisordemparanormal.com/agente/ID`.
3. Clique em **VALIDAR** ou abra a opção de vínculo pelo menu do Token.
4. O sistema confirma somente o domínio, a rota e o formato do identificador. A extensão não faz uma consulta ao servidor do C.R.I.S. nesta versão.
5. Para apresentar atributos, recursos, perícias, combate e inventário, importe os dados normalizados na área **IMPORTAÇÃO MANUAL** / aba **ARQUIVO**.

## Formato de importação

O JSON abaixo é um **formato interno do Sistema C.R.I.S.**, e não um formato de exportação oficial do C.R.I.S. A ficha precisa ter `identity.name`; os demais campos são opcionais. O ID é sempre derivado do link previamente validado, nunca do JSON importado.

    {
      "identity": {
        "name": "Eleanor Hale",
        "player": "Jogadora",
        "origin": "Investigadora",
        "className": "Especialista",
        "nex": "35%",
        "rank": "Operadora",
        "age": "27",
        "appearance": "Descrição física",
        "description": "Descrição do personagem"
      },
      "attributes": { "AGI": 3, "FOR": 1, "INT": 4, "PRE": 2, "VIG": 2 },
      "resources": {
        "pv": { "current": 21, "max": 30 },
        "pe": { "current": 8, "max": 12 },
        "san": { "current": 35, "max": 40 }
      },
      "skills": [
        { "name": "Investigação", "attribute": "INT", "bonus": 8, "training": "Treinado" }
      ],
      "combat": {
        "defense": 16,
        "dodge": 20,
        "block": 5,
        "initiative": 8,
        "movement": "9m",
        "resistances": ["Balístico 5"],
        "attacks": [
          { "name": "Revólver", "test": "Pontaria +8", "damage": "2d6", "critical": "19/x3", "range": "Curto", "effects": "—" }
        ]
      },
      "inventory": [
        { "name": "Kit médico", "category": "Equipamento", "quantity": 2, "weight": "1 espaço", "detail": "Uso de primeiros socorros" }
      ],
      "abilities": [ { "name": "Perito", "category": "Origem", "detail": "Descrição" } ],
      "rituals": [ { "name": "Ouvir os Sussurros", "category": "Conhecimento", "detail": "Descrição" } ],
      "additional": { "campoNaoMapeado": "Este conteúdo é preservado" }
    }

A extensão não inventa perícias, recursos, ataques ou habilidades: apresenta apenas os campos fornecidos. Para atualizar os dados, substitua o JSON pela versão atual e importe novamente. O botão de revalidar verifica novamente a sintaxe do link, não baixa a ficha.

## Persistência, cache e multiplayer

- **Vínculo:** ID e URL da ficha são guardados na metadata namespaced do Token.
- **Biblioteca:** referências de links são guardadas na metadata da cena atual.
- **Sincronização:** metadata de cena e de Token é sincronizada pelo Owlbear com os participantes da sala.
- **Cache:** os dados detalhados importados são armazenados no `localStorage` deste navegador. O cache não é sincronizado entre dispositivos e não deve ser usado como mecanismo de permissão.
- **Privacidade:** por padrão, somente URL e identificadores técnicos são enviados à metadata compartilhada. O nome e o conteúdo detalhado não são propagados. O Mestre pode ativar explicitamente **Compartilhar dados com jogadores** para gravar uma cópia do JSON normalizado na metadata do Token.
- **Acesso:** operações de cadastro, importação, vinculação, remoção e alteração de compartilhamento são restritas ao Mestre. Jogadores podem visualizar somente snapshots que o Mestre tenha compartilhado.
- **Remoção:** remover uma ficha da biblioteca também desvincula os Tokens da sala que apontam para aquele registro.

Metadata sincronizada em uma sala é visível aos participantes conforme as permissões do Owlbear. Não use a opção de compartilhamento para informações que devam permanecer secretas. A extensão não é um cofre de segredos.

## Limitações conhecidas

- Não existe neste projeto uma API pública oficial do C.R.I.S. verificada/documentada para leitura de fichas.
- Validar um link não permite distinguir ficha inexistente, privada ou removida; isso só poderá ser confirmado por um mecanismo oficial de consulta.
- Não há sincronização automática dos dados com o C.R.I.S. O Mestre precisa importar novamente os dados quando a ficha mudar.
- O esquema JSON desta extensão é próprio. Ele não deve ser confundido com o formato interno do site ou com um endpoint do C.R.I.S.
- A extensão não grava PV, PE, SAN ou alterações de volta no C.R.I.S.
- A opção de compartilhamento copia dados para metadata sincronizada dos Tokens; controle cuidadosamente o que está sendo compartilhado.

## Desenvolvimento local

Requisitos: Node.js 22 ou superior e npm.

1. Clone `https://github.com/Onze1Onze/Sistema-Cris.git`.
2. Instale dependências: `npm install`.
3. Inicie o Vite: `npm run dev`.
4. Execute testes: `npm test`.
5. Verifique TypeScript: `npm run typecheck`.
6. Gere a extensão: `npm run build`.
7. O resultado ficará na pasta `dist/`.

A Action do Owlbear deve apontar para uma URL pública servida por HTTPS. Para desenvolvimento, use uma URL HTTPS de preview/túnel ou um deploy de teste; o endereço local `localhost` não estará disponível para os demais participantes.

## Build e publicação

O workflow `.github/workflows/deploy.yml` executa instalação, TypeScript, testes e build em cada push para `main`. Em pushes e execuções manuais, publica `dist/` usando GitHub Pages Actions.

Para habilitar Pages, abra **Settings → Pages** no GitHub e selecione **GitHub Actions** como fonte de publicação, caso o Pages ainda não esteja configurado. Depois acompanhe a execução na aba **Actions**. Quando o deploy terminar com sucesso, abra `https://onze1onze.github.io/Sistema-Cris/manifest.json` para confirmar que o manifesto está acessível.

## Estrutura

- `src/cris/`: validação do link, tipos e parser JSON.
- `src/owlbear/`: adaptador do SDK, metadata, vinculação e menu contextual.
- `src/storage/`: cache privado local.
- `src/ui/`: interface e fluxo da aplicação.
- `src/styles/`: identidade visual responsiva.
- `tests/`: testes unitários.
- `public/manifest.json`: manifesto para o Owlbear Rodeo.
- `public/icon.svg`: ícone original da extensão.
- `.github/workflows/deploy.yml`: CI e deploy.

## Referências oficiais e integração

- Owlbear Rodeo Extensions: https://docs.owlbear.rodeo/extensions/
- Owlbear Rodeo Manifest: https://docs.owlbear.rodeo/extensions/reference/manifest/
- Owlbear Rodeo SDK: https://www.npmjs.com/package/@owlbear-rodeo/sdk
- C.R.I.S.: https://crisordemparanormal.com/

A integração automatizada só deve ser ativada quando o C.R.I.S. oferecer ou documentar um método permitido de acesso externo. Até lá, o projeto preserva a transparência da limitação e evita depender de APIs privadas não verificadas.
