import { createApi } from "./index.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

const { app } = await createApi();

await app.listen({ port, host });

if (process.argv.includes("--demo")) {
  console.log(`OpenVitals demo running at http://${host}:${port}`);
  console.log(`Dashboard: http://${host}:${port}/dashboard`);
  console.log(`Playground: http://${host}:${port}/playground`);
  console.log(`OpenAPI: http://${host}:${port}/v1/openapi.json`);
}
