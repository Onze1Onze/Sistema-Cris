# Conexão com CRIS — extensão para Owlbear Rodeo

Extensão para importar fichas públicas do C.R.I.S., apresentar o dossiê completo em um painel vertical do Owlbear Rodeo e vincular o registro a um Token da cena.

**Versão da interface:** 0.2.0

## Instalar no Owlbear

1. Abra o Owlbear Rodeo e entre em uma sala.
2. Em Extensions, adicione uma extensão usando o manifesto:
   `https://onze1onze.github.io/Sistema-Conex-o-com-Cris/manifest.json`
3. Na barra de ações da sala, abra **Conexão com CRIS**. Não selecione outra extensão, como “Munição”.
4. O campo de link fica visível logo ao abrir o arquivo. Cole o endereço público de uma ficha CRIS e pressione **IMPORTAR FICHA**.
5. Depois da importação, o dossiê abre com os dados disponíveis: retrato, identidade, atributos, recursos, combate, perícias, poderes, habilidades, rituais, armas, equipamentos e inventário. Campos ainda não reconhecidos são preservados em **Informações adicionais**.

O nome da ficha, a classe e o conteúdo dependem dos dados públicos que o CRIS disponibiliza para aquele agente. Apenas o Mestre pode importar, atualizar, remover e alterar o estado temporário da sessão; jogadores visualizam as fichas compartilhadas na cena.

## O que está implementado

- Painel vertical responsivo, com rolagem própria para celulares e telas estreitas.
- Formulário de importação apresentado por padrão quando o painel é aberto.
- Validação de links HTTPS de fichas no formato `https://crisordemparanormal.com/agente/{id}`.
- Leitura pública do documento Firestore, decodificação de mapas/listas/tipos e normalização dos campos de personagem.
- Parser de HTML público como alternativa para páginas que exponham metadados úteis.
- Dossiê recolhível com retrato, identidade, PV/PE/SAN/DT, atributos, combate, perícias, habilidades, rituais, armas, equipamentos, inventário e dados adicionais.
- Cards compactos, atualização manual e atualização automática opcional enquanto o painel estiver aberto.
- Vínculo de ficha com Token e atalho contextual **Abrir ficha do CRIS**.
- Estado temporário de PV/PE/SAN/DT e condição, sem escrever de volta na ficha original do CRIS.
- Cache local e sincronização da biblioteca nos metadados da cena atual.

## Integração com CRIS: limitação técnica

O CRIS não disponibiliza uma especificação oficial documentada de API para leitura externa de fichas. A extensão usa um caminho REST do Firestore observado no adaptador comunitário público [visualizador_de_fichas](https://github.com/LucasPennacchi/visualizador_de_fichas) e tenta analisar o HTML público como alternativa.

Esse caminho pode mudar e o acesso depende das regras públicas e de CORS do serviço. A extensão não usa login, senha, cookies, tokens, proxy de terceiros nem tenta contornar fichas privadas. Quando a origem bloqueia a leitura ou não fornece dados suficientes, o painel mostra uma mensagem de erro em vez de inventar informações.

## Arquivos-fonte e build

Os módulos de base permanecem organizados em `source-core.zip`, `source-sync.zip`, `source-ui-shell.zip`, `source-ui-style.zip` e `source-docs.zip`. O bundle `source-ui-fix.zip.b64` contém a versão atualizada da interface, do CSS responsivo e do manifesto, substituindo a implementação visual antiga.

Para preparar o projeto localmente, extraia os módulos acima na raiz do repositório e aplique a interface atualizada com:
`base64 --decode source-ui-fix.zip.b64 > /tmp/source-ui-fix.zip && unzip -o /tmp/source-ui-fix.zip -d .`

Depois execute `npm install`, `npm test` e `npm run build`. A build é gerada em `dist/`.

O CI e o GitHub Pages executam essa preparação automaticamente antes de testar e publicar a extensão.

## Persistência e permissões

A biblioteca compartilhada fica nos metadados da cena atual do Owlbear. Cada Token guarda somente o identificador da ficha vinculada. O cache IndexedDB é local ao navegador e serve como contingência offline. O painel não armazena documentos completos nos metadados da sala.

## Referências

- [Documentação oficial do Owlbear Rodeo](https://docs.owlbear.rodeo/extensions/)
- [Referência do manifesto](https://docs.owlbear.rodeo/extensions/reference/manifest/)
- [C.R.I.S. — site oficial](https://crisordemparanormal.com/)
- [Adaptador comunitário de dados CRIS](https://github.com/LucasPennacchi/visualizador_de_fichas)
