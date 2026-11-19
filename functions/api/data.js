export async function onRequestGet(context) {
  const row = await context.env.DB
    .prepare("SELECT json_data FROM app_data WHERE id = 1")
    .first();
  
  if (!row || !row.json_data) {
    return Response.json({ books: [], wanted: [], msgs: {} });
  }
  return new Response(row.json_data, {
    headers: { "Content-Type": "application/json" }
  });
}

export async function onRequestPost(context) {
  const body = await context.request.text();
  
  await context.env.DB
    .prepare("INSERT INTO app_data (id, json_data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json_data = excluded.json_data")
    .bind(body)
    .run();

  return new Response(body, {
    headers: { "Content-Type": "application/json" }
  });
}