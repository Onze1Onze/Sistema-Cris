# Sistema C.R.I.S. — dossiês e protocolo de combate para Owlbear Rodeo

Extensão unificada para consultar fichas públicas do C.R.I.S., rolar atributos e perícias e conduzir o combate de Ordem Paranormal dentro do Owlbear Rodeo. O C.R.I.S. é a fonte principal dos dados dos agentes; o rastreador de iniciativa usa esses atributos e bônus sem manter uma ficha paralela ou recalcular o treinamento.

## Instalação no Owlbear Rodeo

O endereço do manifesto publicado é:

`https://onze1onze.github.io/Sistema-Cris/manifest.json`

1. Abra uma sala no Owlbear Rodeo.
2. Entre em Extensions / Extensões e escolha adicionar por URL.
3. Cole o endereço do manifesto acima.
4. Abra a Action **Sistema C.R.I.S.** na barra da sala.
5. Cole o link público de uma ficha, por exemplo `https://crisordemparanormal.com/agente/ID_DA_FICHA`.
6. Clique em **CONECTAR FICHA**. A extensão consulta os dados públicos e abre o dossiê automaticamente.
7. Para associar ao Token, selecione um Token e use **VINCULAR / SUBSTITUIR FICHA C.R.I.S.** no menu contextual, ou abra a ficha já cadastrada e escolha **VINCULAR**.
8. Ao clicar no Token depois, a ficha vinculada será carregada dentro do Owlbear.
9. Use o botão **INICIATIVA** no cabeçalho do C.R.I.S. para abrir o protocolo de combate unificado. O painel está disponível para a sala; os controles de operação são exclusivos do Mestre.

## O que é importado

Quando o documento remoto oferece os campos, a extensão apresenta:

- Identidade: nome, jogador, origem, classe, NEX, patente, idade, descrição física, histórico, personalidade, objetivo e anotações.
- Retrato do personagem, quando existe uma URL HTTPS válida.
- Atributos: AGI, FOR, INT, PRE e VIG.
- Recursos: PV, PE e SAN, sempre no formato atual / máximo.
- Perícias, atributo, grau de treinamento e bônus.
- Combate: defesa, esquiva, bloqueio, deslocamento, iniciativa, resistências e ataques, com teste, dano, crítico, alcance e tipo.
- Inventário: nome, categoria, espaços/peso e descrição.
- Poderes/habilidades e rituais, com detalhes quando disponíveis.
- Informações adicionais reconhecidas no documento, sem inventar campos ausentes.

A extensão só apresenta valores recebidos. Se o documento não possuir um campo, ele fica ausente ou aparece como não informado. Não calculamos ataques ou habilidades que não estejam no documento remoto, exceto a defesa derivada dos atributos e modificadores básicos quando o valor de defesa não vem explicitamente.

## Como funciona a leitura automática

O link público de uma ficha usa o padrão `/agente/{id}`. A extensão extrai esse ID e faz uma requisição somente de leitura (HTTP GET) ao documento Firestore correspondente:

`https://firestore.googleapis.com/v1/projects/cris-ordem-paranormal/databases/(default)/documents/characters/{id}`

A resposta do Firestore usa valores tipados (`stringValue`, `integerValue`, `mapValue`, `arrayValue`, etc.). O parser decodifica esses valores recursivamente e converte os campos conhecidos para o modelo visual da extensão.

### Importante sobre a API

O C.R.I.S. não forneceu, nesta implementação, uma especificação oficial/documentada que garanta este endpoint como API pública estável para terceiros. A rota Firestore foi identificada em integrações comunitárias públicas que também consultam a coleção `characters` do projeto Firebase do C.R.I.S.:

- [Adaptador público do visualizador comunitário](https://github.com/LucasPennacchi/visualizador_de_fichas/blob/main/services/servico-poller/adapters/crisAdapter.js)
- [Overlay comunitário que consulta o mesmo documento](https://github.com/VizzottoNCF/CRIS-Overlay/blob/main/stats.js)
- [Outro importador comunitário com mapeamento de campos](https://github.com/ferreis/paranormal-rpg-sheet-flutter/blob/main/lib/features/characters/data/services/cris_import_service.dart)

Portanto, esta é uma **integração direta com o documento Firestore observado em clientes comunitários**, e não uma API oficial garantida pelo C.R.I.S. O nome da coleção, as regras de leitura e o formato dos documentos podem mudar sem aviso. A extensão não usa scraping da interface, endpoint privado do frontend, cookies, senha, sessão de usuário, proxy de terceiros ou métodos para contornar autenticação/CORS.

O identificador Firebase incluído no cliente é uma chave pública de aplicação encontrada em implementações públicas do cliente web/importador; não é uma senha nem um token de sessão. A permissão efetiva de leitura continua sendo controlada pelas regras do Firestore. O projeto não tenta ler documentos que o Firestore recusa.

### Fichas privadas e erros

A extensão respeita os sinais de privacidade disponíveis:

- Se o documento tiver o campo `private: true`, a importação é recusada.
- Se o Firestore responder 401/403, a extensão informa que a leitura foi negada.
- Se responder 404, a ficha é informada como inexistente, removida ou indisponível publicamente.
- Se houver timeout, indisponibilidade do serviço, resposta malformada ou bloqueio CORS, a extensão apresenta uma mensagem amigável.
- Se já houver dados em cache, a última cópia continua disponível quando a atualização falhar.

Validar o formato do link, por si só, não prova que a ficha existe ou está pública.

## Vinculação por Token

Cada Token recebe metadata namespaced em:

`com.onze1onze.sistema-cris/binding`

A associação armazena o ID e a URL de origem, a data de vínculo e a configuração de compartilhamento. A biblioteca de fichas da sala fica na metadata da cena. A metadata do Owlbear é sincronizada pelos participantes da sala.

É possível associar fichas diferentes a Tokens diferentes, substituir a ficha, abrir a ficha pelo menu contextual ou remover o vínculo sem alterar o conteúdo do C.R.I.S.

## Multiplayer e privacidade

O comportamento padrão é restritivo:

- O Mestre pode conectar, atualizar, remover e vincular fichas.
- O Mestre sempre consulta a origem quando abre o Token associado.
- Os dados detalhados ficam no cache local do navegador do Mestre.
- **Compartilhar dados com jogadores** fica desligado por padrão.
- Quando o Mestre ativa essa opção, uma cópia normalizada da ficha é gravada na metadata do Token para os jogadores da sala.
- Jogadores veem apenas um snapshot compartilhado pelo Mestre. Sem autorização, a extensão não mostra os dados detalhados.
- Desativar o compartilhamento remove a cópia detalhada da metadata do Token.

A metadata sincronizada da sala é visível a participantes com acesso à cena. Não compartilhe fichas com informação que deva permanecer secreta. O botão de compartilhar é uma autorização explícita do Mestre, não um cofre de dados.

## Sincronização remota e edição bidirecional

### C.R.I.S. → Owlbear

O C.R.I.S. não ofereceu documentação oficial de WebSocket, webhook ou feed de eventos consultável por extensões externas. Por isso, não inventamos um canal em tempo real. A versão 1.2 usa polling de leitura a cada 15 segundos enquanto o dossiê estiver aberto, o Mestre estiver visualizando a extensão e a página estiver visível. Ao ocultar/fechar a extensão, o polling é interrompido.

- O Mestre consulta a origem remota e é responsável por propagar os snapshots autorizados. Na aba **ARQUIVO → DIAGNÓSTICO C.R.I.S.**, a frequência pode ser ajustada para 10, 15 ou 30 segundos; o padrão é 15 segundos e a preferência fica salva neste navegador.
- Jogadores não consultam a origem em segundo plano: recebem atualizações por `OBR.scene.items.onChange` quando o Mestre atualiza metadata do Token.
- A consulta é ignorada quando nenhum campo realmente mudou; `updatedAt` isolado não gera um falso delta.
- Quando a leitura remota muda um recurso, o histórico local registra campo, valor anterior, valor novo, horário e origem `C.R.I.S.`.
- O botão **ATUALIZAR FICHA AGORA** força uma consulta imediata.
- A extensão para o polling quando a página fica oculta ou quando o dossiê é fechado.
- Se a origem ficar indisponível, a última cópia confirmada continua visível e o estado muda para offline/erro.

### Owlbear → C.R.I.S. — escrita ainda indisponível

PV, PE e SAN permanecem em **somente leitura** nesta versão. Não foi localizada uma API oficial/documentada do C.R.I.S. para atualizar esses campos, nem um fluxo público de autorização para uma extensão externa.

O endpoint REST do Firestore aceita operações de atualização no produto Firebase, mas isso não autoriza por si só a escrita em uma ficha do C.R.I.S. A documentação do Firebase explica que as solicitações REST precisam de um Firebase ID token ou credencial OAuth apropriada, e que as regras de segurança do Firestore decidem se a operação é permitida. A chave pública Firebase apenas identifica o projeto; não concede permissão. Consulte [autenticação da API REST do Firestore](https://firebase.google.com/docs/firestore/use-rest-api) e [regras de segurança](https://firebase.google.com/docs/firestore/security/rules-conditions).

Existe código comunitário que tenta usar `PATCH` diretamente no Firestore, mas o próprio repositório mantém o acionador da funcionalidade desativado (`IntencaoAssassina = false`) e não comprova uma operação de escrita autorizada e bem-sucedida. Veja [o código experimental do overlay comunitário](https://github.com/VizzottoNCF/CRIS-Overlay/blob/main/stats.js). Portanto, esse trecho não é tratado como contrato oficial de escrita.

Consequências:
- Não há botões de dano, cura, perda de SAN ou alteração manual que aparentem salvar no C.R.I.S.
- Não há fila offline de alterações, desfazer remoto ou edição local pendente.
- A extensão não muda PV/PE/SAN no cache para fingir que o servidor confirmou.
- Se o C.R.I.S. publicar futuramente uma API de escrita ou um fluxo OAuth/Firebase autorizado para terceiros, a camada `crisWrite.ts` poderá receber um adaptador verificado. Até lá, todas as capacidades estão marcadas explicitamente como indisponíveis.

### Conflitos

A camada `crisConflict.ts` já contém uma pré-verificação genérica de concorrência para uma futura operação de escrita: compara o valor-base, o valor proposto e o valor remoto atual. Se o C.R.I.S. tiver mudado desde a leitura-base, o resultado será conflito; a nova versão remota não pode ser sobrescrita silenciosamente. Essa rotina não envia dados e não habilita edição.

### Diagnóstico visível

A aba **ARQUIVO → DIAGNÓSTICO C.R.I.S.** mostra a capacidade de leitura, a escrita não disponível, a ausência de eventos oficiais documentados e o intervalo de polling. PV, PE e SAN exibem a marca **SOMENTE LEITURA · C.R.I.S.** até que uma escrita autorizada seja implementada.

## Cache

- O cache local usa o armazenamento do navegador e preserva a última cópia quando o Firestore está indisponível.
- A origem remota continua sendo a referência: quando o dossiê está aberto, o Mestre consulta novamente o C.R.I.S. periodicamente.
- A metadata dos Tokens recebe snapshots apenas quando o Mestre autorizou o compartilhamento.
- Atualizações de jogadores são aplicadas ao vivo quando a metadata do Token muda.
- A sincronização não consulta a cada frame e não faz polling quando a extensão está oculta.


## Operação de mesa: rolagens, painel do Mestre, condições e histórico

### Rolador de atributos e perícias

- Os cinco atributos e as perícias reconhecidas aparecem como controles clicáveis no dossiê.
- Ao clicar, o Mestre ou jogador abre uma confirmação rápida com DT opcional e modificador opcional.
- O motor usa a regra de teste do Ordem Paranormal RPG 1.2: um d20 por ponto do atributo e mantém o maior; com atributo 0, rola 2d20 e mantém o menor; em testes de perícia, soma o bônus da perícia e modificadores informados.
- O atributo-base é retirado da ficha quando informado. Caso esteja ausente, a extensão usa a tabela de perícias conhecida do sistema. Se ainda não for possível determinar o atributo, bloqueia a rolagem em vez de adivinhar.
- Cada resultado informa os dados rolados, o dado escolhido, bônus, total e DT/sucesso/falha quando há dificuldade.
- Os resultados são enviados a todos os participantes pelo canal oficial `OBR.broadcast`, aparecem no feed de resultados da própria extensão e geram uma notificação do Owlbear.

**Limitação do chat:** o SDK atual do Owlbear não oferece uma função para inserir diretamente mensagens no histórico do chat nativo. Por isso, o resultado não é anunciado como uma mensagem nativa do chat; ele é transmitido pelo Broadcast da sala e exibido no feed da extensão. O Broadcast é efêmero e limitado a 16 KB.

### Painel de Operação do Mestre

A biblioteca da sala possui o botão **ABRIR PAINEL DE OPERAÇÃO DO MESTRE**. O painel lista Tokens da camada de personagens que possuem vínculo C.R.I.S., consulta cada ficha uma vez por lote e permite:

- Pesquisar por nome do Token ou personagem.
- Filtrar todos, vivos, incapacitados, feridos, com condições ou com erro.
- Consultar PV, PE, SAN, Defesa, Iniciativa, condições e estado da sincronização.
- Localizar o Token por `OBR.scene.items.getItemBounds` e `OBR.viewport.animateToBounds`.
- Abrir o dossiê associado ao Token.
- Forçar atualização do grupo. A consulta automática do painel é limitada a 30 segundos por ficha e é suspensa quando a interface fica oculta.

Os indicadores de sincronização descrevem o resultado da última consulta, não uma garantia de conexão contínua.

### Condições e marcadores no mapa

A extensão reconhece condições somente se o documento consultado fornecer um array `conditions` com nomes e, opcionalmente, descrição, duração e origem. Ela não cria uma lista genérica de condições nem inventa efeitos.

Quando condições estão presentes e os dados podem ser visualizados por aquele participante, a extensão desenha uma etiqueta local anexada ao Token. A etiqueta acompanha o Token, não recebe cliques e não modifica a arte original. Os itens são locais ao usuário que abriu a extensão; não são uma camada persistente de condições compartilhadas.

A extensão ainda não adiciona ou remove condições na ficha: não foi identificada uma API oficial de escrita/autorização do C.R.I.S. para essa operação.

### Histórico da sessão

O histórico utiliza a metadata da cena sob a chave `com.onze1onze.sistema-cris/session-history` e guarda até 300 eventos recentes da sessão. Ele registra:

- Rolagens recebidas pelo Broadcast.
- Mudanças confirmadas de PV, PE e SAN detectadas em consultas ao C.R.I.S.
- Condições adicionadas/removidas quando a estrutura remota oferece esses dados.
- Horário, personagem, campo, valor anterior/novo e origem.

O histórico é gravado pelo Mestre. Para persistir rolagens realizadas por jogadores, a extensão do Mestre precisa estar aberta e conectada à sala para receber o Broadcast e registrar o evento na metadata sincronizada. O canal Broadcast não entrega eventos retroativamente a quem entrou depois.

### Protocolo de combate e iniciativa integrada

O rastreador de iniciativa do antigo projeto **Sistema-Iniciativa** foi incorporado ao C.R.I.S. como uma área nativa da mesma extensão. A interface usa as cores, tipografia, componentes de dossiê e organização visual do C.R.I.S.; o rastreador não abre uma segunda extensão nem mantém uma ficha alternativa para agentes.

**Agentes — dados provenientes da ficha C.R.I.S.**

- Ao adicionar Tokens como agentes, o Mestre deve selecionar Tokens já vinculados a fichas C.R.I.S. acessíveis.
- O sistema localiza a perícia **Iniciativa** na ficha e lê a Agilidade e o bônus total da perícia normalizados pelo parser do C.R.I.S.
- A rolagem é executada pelo motor já utilizado nas rolagens de perícias do C.R.I.S.: um d20 por ponto do atributo, mantendo o maior; com AGI 0, 2d20 mantendo o menor.
- O bônus já calculado pela ficha é utilizado integralmente. O módulo não soma novamente os níveis de treinamento (+5/+10/+15), evitando bônus duplicados.
- Modificadores situacionais são guardados separadamente e adicionados ao teste sem alterar a ficha remota.
- Se a perícia Iniciativa ou a Agilidade não puderem ser identificadas com segurança, o teste é bloqueado e a interface informa o problema em vez de inventar um valor.

**Ameaças e grupos**

- O Mestre pode selecionar vários Tokens e registrá-los como um único grupo de ameaças.
- Se todos os Tokens do grupo tiverem fichas C.R.I.S. acessíveis e a perícia Iniciativa válida, o módulo utiliza automaticamente o menor bônus de Iniciativa do grupo.
- Caso contrário, o Mestre informa o bônus manual do grupo.
- O grupo realiza um único teste compartilhado de 1d20 + bônus, preservando o comportamento do Sistema-Iniciativa.

**Controle do combate**

- Ordem decrescente dos resultados, identificação e nova rolagem de empates.
- Cartão do turno atual, progresso da sequência, avanço e retorno de turno.
- Rodadas, encerramento e limpeza da ocorrência.
- Surpreendidos não agem na primeira rodada.
- Participantes recrutados depois do início ficam elegíveis a partir da rodada seguinte.
- A iniciativa permanece fixa entre rodadas; não é rolada novamente a cada turno.
- Condições fornecidas pela ficha C.R.I.S. aparecem no cartão de combate. O Mestre também pode adicionar condições e notas locais ao registro tático.

**Sincronização e compatibilidade**

A metadata do combate usa as chaves `com.onze1onze.sistema-cris/initiative-combatant` nos Tokens e `com.onze1onze.sistema-cris/initiative-scene` na cena. O vínculo C.R.I.S. continua em sua própria chave e não é substituído pelo estado da iniciativa.

O módulo reconhece os registros e o estado de cena da antiga extensão `com.onze1onze.sistema-iniciativa`. Ao abrir uma cena anterior, os valores de iniciativa existentes são lidos; novos testes de agentes passam a usar a ficha C.R.I.S. vinculada. Registros antigos sem uma ficha acessível podem manter o resultado anterior, mas precisam de uma ficha válida para realizar uma nova rolagem automática.

Somente o Mestre pode adicionar participantes, realizar rolagens, alterar registros e controlar os turnos. Os jogadores recebem a ordem e os resultados de iniciativa pela metadata da sala, respeitando as regras de compartilhamento das fichas C.R.I.S. Os dados detalhados de uma ficha continuam privados até que o Mestre autorize seu compartilhamento.

Dano, cura, perda/recuperação de SAN, alteração de PE e inventário editável continuam bloqueados enquanto não houver uma operação de escrita oficial e autorizada do C.R.I.S. A iniciativa não altera PV, PE ou SAN.

### Permissões

O Painel do Mestre é restrito ao papel `GM` verificado pelo SDK do Owlbear. Rolagens podem ser iniciadas por quem tem acesso à ficha. Jogadores só recebem snapshots detalhados dos Tokens quando o Mestre ativa o compartilhamento já existente. Os dados transmitidos nas rolagens identificam personagem e jogador; não incluem o restante da ficha.

## Desenvolvimento local

Requisitos: Node.js 22+ e npm.

```bash
git clone https://github.com/Onze1Onze/Sistema-Cris.git
cd Sistema-Cris
npm install
npm run dev
npm test
npm run typecheck
npm run build
```

O build fica em `dist/`. Para testar no Owlbear, sirva o manifesto por HTTPS (por exemplo, usando um deploy de preview). O endereço local `localhost` não fica acessível aos outros participantes.

## Publicação

O workflow `.github/workflows/deploy.yml` executa instalação, typecheck, testes e build a cada push em `main`, e publica `dist/` no GitHub Pages. A origem do Pages deve estar configurada como **GitHub Actions** em **Settings → Pages**.

Manifesto publicado: `https://onze1onze.github.io/Sistema-Cris/manifest.json`.

## Estrutura do projeto

- `src/cris/crisClient.ts`: valida link, consulta o documento Firestore e trata erros de rede.
- `src/cris/crisParser.ts`: decodifica o formato tipado do Firestore e normaliza a ficha.
- `src/cris/crisSync.ts`: compara snapshots remotos, detecta deltas e registra mudanças de recursos.
- `src/cris/crisEvents.ts`: declara os transportes remotos documentados e configura polling conservador.
- `src/cris/crisWrite.ts`: matriz explícita de capacidades de escrita; PV, PE e SAN ficam bloqueados até haver autorização verificável.
- `src/cris/crisConflict.ts`: pré-verificação de conflitos para uma possível integração de escrita futura.
- `src/rolls/`: tipos genéricos de rolagem, motor d20 e construção de testes de atributo/perícia.
- `src/initiative/`: derivação de iniciativa a partir de fichas C.R.I.S., regras de agentes/ameaças, metadados, rodadas, empates e migração de registros antigos.
- `src/master-panel/`: lista de Tokens vinculados, filtros, consulta e localização.
- `src/conditions/`: marcadores locais anexados aos Tokens quando a ficha fornece condições.
- `src/history/`: histórico limitado de eventos da sessão na metadata da cena.
- `src/cris/crisTypes.ts`: tipos dos dados exibidos.
- `src/owlbear/`: integração SDK, metadata, menu contextual e vínculo com Tokens.
- `src/storage/`: cache local.
- `src/ui/`: interface vertical.
- `src/styles/`: identidade visual responsiva.
- `tests/`: testes de URL, parser, integração simulada com Firestore e persistência.

## Referências

- [C.R.I.S. — site](https://crisordemparanormal.com/)
- [Owlbear Rodeo Extensions](https://docs.owlbear.rodeo/extensions/)
- [Owlbear Rodeo Manifest](https://docs.owlbear.rodeo/extensions/reference/manifest/)
- [SDK Owlbear Rodeo](https://www.npmjs.com/package/@owlbear-rodeo/sdk)

