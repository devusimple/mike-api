export {};
for (let i = 0; i < 20; i++) {
  try {
    const spec = await (await fetch("http://localhost:8787/api/openapi.json")).json() as any;
    console.log("openapi:", spec.openapi, "| paths:", Object.keys(spec.paths ?? {}).length, "| schemas:", Object.keys(spec.components?.schemas ?? {}).length);
    const docs = await (await fetch("http://localhost:8787/docs")).text();
    console.log("docs html:", docs.includes("@scalar/api-reference") && docs.includes("/api/openapi.json") ? "OK" : "MISSING");
    // Spot-check a served path entry matches a real route.
    console.log("has checkout:", !!spec.paths?.["/api/orders/checkout"], "| has variants:", !!spec.paths?.["/api/products/{id}/variants"]);
    process.exit(0);
  } catch {
    await new Promise((r) => setTimeout(r, 1000));
  }
}
console.log("OPENAPI NOT SERVED");
process.exit(1);
