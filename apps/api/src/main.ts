import { buildServer } from "./server";

const server = await buildServer();
const port = Number(process.env.PORT ?? 4000);

await server.listen({ host: "0.0.0.0", port });

