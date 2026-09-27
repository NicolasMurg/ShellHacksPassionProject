import app from "./app";

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
}
app.listen(port, () => console.log(`Server running at http://localhost:${port}`));

