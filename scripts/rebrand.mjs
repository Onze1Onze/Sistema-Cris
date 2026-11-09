import fs from "node:fs";

function updateFile(path, transform) {
  if (!fs.existsSync(path)) {
    console.warn(`[Sistema-Cris] Arquivo não encontrado durante a aplicação da marca: ${path}`);
    return;
  }

  const current = fs.readFileSync(path, "utf8");
  const updated = transform(current);

  if (updated !== current) {
    fs.writeFileSync(path, updated, "utf8");
  }
}

function replaceBrand(source) {
  return source
    .replaceAll("[Conexão com CRIS]", "[Sistema-Cris]")
    .replaceAll("C.R.I.S. // ARQUIVO DE CAMPO", "SISTEMA-CRIS // ARQUIVO DE CAMPO")
    .replaceAll("CONEXÃO <span>COM CRIS</span>", "SISTEMA-<span>CRIS</span>");
}

updateFile("src/ui/app.ts", replaceBrand);
updateFile("src/main.ts", replaceBrand);

updateFile("index.html", (source) => source
  .replace('<meta name="description" content="Arquivo de agentes — integração comunitária entre C.R.I.S. e Owlbear Rodeo." />',
           '<meta name="description" content="Sistema-Cris — arquivo de agentes e integração comunitária entre C.R.I.S. e Owlbear Rodeo." />')
  .replace("<title>Conexão com CRIS</title>", "<title>Sistema-Cris</title>")
);

updateFile("public/manifest.json", (source) => {
  const manifest = JSON.parse(source);
  manifest.name = "Sistema-Cris";
  manifest.action = {
    ...manifest.action,
    title: "Sistema-Cris",
  };
  return JSON.stringify(manifest, null, 2) + "\n";
});

// Os identificadores internos da extensão e do cache permanecem estáveis
// para preservar fichas e vínculos já gravados nas cenas do Owlbear.
